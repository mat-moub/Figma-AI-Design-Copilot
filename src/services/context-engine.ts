import type {
  ContextLoadMeta,
  DocumentContext,
  DesignSystem,
  TextEntry,
  TextRole,
  ScreenTextContext,
  SelectedTextContext,
  SelectedComponentContext,
  ComponentTextEntry,
} from "../types/ui-types";

interface ExtractOptions {
  maxTokens?: number;
  onProgress?: (update: {
    processedNodes: number;
    totalNodes: number;
    estimatedTokens: number;
    scopeLabel: string;
  }) => void;
}

interface ScopeBuildResult {
  pageTextContext: ScreenTextContext[];
  estimatedTokens: number;
  totalTexts: number;
  truncated: boolean;
  processedNodes: number;
}

const DEFAULT_MAX_TOKENS = 80_000;
const PROGRESS_EMIT_EVERY_N_FRAMES = 5;

/**
 * Context Engine
 *
 * Runs inside the Figma plugin sandbox (main.ts) and reads the current page
 * to produce a structured {@link DocumentContext} sent to the AI as background
 * knowledge.
 *
 * Strategy:
 * - With selection: find the direct page child that is an ancestor of the
 *   selected node (the "root node"), then extract ALL text descendants
 *   recursively using Figma's native `findAll`.
 * - Without selection: scan every direct child of the current page.
 * - Hard token cap: 80 000 tokens (chars / 4). Truncates cleanly at entry
 *   boundaries if the cap is reached.
 */
export class ContextEngine {
  /**
   * Lightweight extraction used by legacy flow.
   * Delegates to the main scoped extraction.
   */
  async extract(): Promise<DocumentContext> {
    return this.extractScopedContext();
  }

  /**
   * Scoped extraction with token cap + progress updates.
   */
  async extractScopedContext(options: ExtractOptions = {}): Promise<DocumentContext> {
    const startedAt = Date.now();
    const maxTokens = Math.max(1_000, options.maxTokens ?? DEFAULT_MAX_TOKENS);
    const onProgress = options.onProgress;

    const designSystemPromise = this.extractDesignSystem();
    const selection = figma.currentPage.selection;

    // Resolve which root nodes to scan
    const { rootNodes, strategy, scopeNode, scopePath, scopeLabel } =
      this.resolveScope(selection);

    // Extract text context with token cap
    const scopeBuild = this.buildTextContext(
      rootNodes,
      maxTokens,
      scopeLabel,
      onProgress
    );

    const designSystem = await designSystemPromise;

    const contextMeta: ContextLoadMeta = {
      strategy,
      scopeType: strategy === "root-node" ? "root-node" : "page",
      scopeName: scopeNode ? scopeNode.name : null,
      scopePath,
      totalFrames: rootNodes.length,
      totalTexts: scopeBuild.totalTexts,
      estimatedTokens: scopeBuild.estimatedTokens,
      truncated: scopeBuild.truncated,
      maxTokens,
      minTokensTarget: 0,
      durationMs: Date.now() - startedAt,
    };

    if (onProgress) {
      onProgress({
        processedNodes: scopeBuild.processedNodes,
        totalNodes: rootNodes.length,
        estimatedTokens: scopeBuild.estimatedTokens,
        scopeLabel,
      });
    }

    return {
      designSystem,
      screens: this.extractScreenNames(),
      pages: this.extractPageNames(),
      pageTextContext: scopeBuild.pageTextContext,
      selectedText: this.extractSelectedText(),
      selectedComponent: this.extractSelectedComponent(),
      contextMeta,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private extractPageNames(): string[] {
    return figma.root.children.map((page) => page.name);
  }

  /** Top-level FRAME nodes on the current page only. */
  private extractScreenNames(): string[] {
    return [
      ...new Set(
        figma.currentPage.children
          .filter((node) => node.type === "FRAME")
          .map((f) => f.name)
      ),
    ];
  }

  private async extractDesignSystem(): Promise<DesignSystem> {
    return {
      components: this.extractComponentNames(),
      colors: await this.extractColorNames(),
      textStyles: await this.extractTextStyleNames(),
    };
  }

  private extractComponentNames(): string[] {
    const components = figma.currentPage.findAll(
      (node) => node.type === "COMPONENT"
    ) as ComponentNode[];

    return [...new Set(components.map((c) => c.name))];
  }

  private async extractColorNames(): Promise<string[]> {
    const paintStyles = await figma.getLocalPaintStylesAsync();
    return paintStyles.map((style) => style.name);
  }

  private async extractTextStyleNames(): Promise<string[]> {
    const textStyles = await figma.getLocalTextStylesAsync();
    return textStyles.map((style) => style.name);
  }

  /**
   * Determine the scope for extraction.
   *
   * With selection: walk up from the selected node until we reach a direct
   * child of the page (parent.type === "PAGE"). That node is the root.
   *
   * Without selection: use all direct page children.
   */
  private resolveScope(selection: readonly SceneNode[]): {
    rootNodes: SceneNode[];
    strategy: "root-node" | "page-all";
    scopeNode: SceneNode | null;
    scopePath: string[];
    scopeLabel: string;
  } {
    const selectedNode = selection[0] ?? null;

    if (selectedNode) {
      const rootNode = this.findPageRootAncestor(selectedNode);
      if (rootNode) {
        return {
          rootNodes: [rootNode],
          strategy: "root-node",
          scopeNode: rootNode,
          scopePath: [rootNode.name],
          scopeLabel: `${rootNode.type === "SECTION" ? "Section" : rootNode.type === "FRAME" ? "Frame" : "Node"}: ${rootNode.name}`,
        };
      }
    }

    // No selection or couldn't find root → scan whole page
    const rootNodes = figma.currentPage.children as SceneNode[];
    return {
      rootNodes: [...rootNodes],
      strategy: "page-all",
      scopeNode: null,
      scopePath: [figma.currentPage.name],
      scopeLabel: `Page: ${figma.currentPage.name}`,
    };
  }

  /**
   * Walk up from `node` until we find its ancestor that is a direct child
   * of the current page (i.e. `parent.type === "PAGE"`).
   * Returns `node` itself if it is already a direct page child.
   */
  private findPageRootAncestor(node: BaseNode): SceneNode | null {
    let current: BaseNode = node;

    while (current.parent !== null) {
      if (current.parent.type === "PAGE") {
        // current is a direct child of the page
        return current as SceneNode;
      }
      current = current.parent;
    }

    return null;
  }

  /**
   * Extract all TEXT descendants from each root node recursively using
   * Figma's native `findAll`, then pack them into ScreenTextContext entries
   * while respecting the hard token cap.
   *
   * Progress events are emitted every PROGRESS_EMIT_EVERY_N_FRAMES nodes.
   */
  private buildTextContext(
    rootNodes: SceneNode[],
    maxTokens: number,
    scopeLabel: string,
    onProgress?: (update: {
      processedNodes: number;
      totalNodes: number;
      estimatedTokens: number;
      scopeLabel: string;
    }) => void
  ): ScopeBuildResult {
    const result: ScreenTextContext[] = [];
    let estimatedTokens = 0;
    let totalTexts = 0;
    let truncated = false;
    let processedNodes = 0;

    for (const rootNode of rootNodes) {
      if (truncated) break;

      // Use Figma's native recursive findAll to get ALL text nodes in this subtree
      const findAllMixin = rootNode as unknown as ChildrenMixin;
      const textNodes: TextNode[] =
        typeof findAllMixin.findAll === "function"
          ? (findAllMixin.findAll((n) => n.type === "TEXT") as TextNode[])
          : rootNode.type === "TEXT"
          ? [rootNode as TextNode]
          : [];

      const texts: TextEntry[] = [];

      for (const node of textNodes) {
        if (node.characters.trim() === "") continue;

        const entry = this.buildTextEntry(node);
        const entryTokens = this.estimateTokensForTextEntry(entry);

        if (estimatedTokens + entryTokens > maxTokens) {
          truncated = true;
          break;
        }

        texts.push(entry);
        estimatedTokens += entryTokens;
        totalTexts += 1;
      }

      if (texts.length > 0) {
        result.push({ screenName: rootNode.name, texts });
      }

      processedNodes += 1;

      if (
        onProgress &&
        (processedNodes % PROGRESS_EMIT_EVERY_N_FRAMES === 0 ||
          processedNodes === rootNodes.length)
      ) {
        onProgress({
          processedNodes,
          totalNodes: rootNodes.length,
          estimatedTokens,
          scopeLabel,
        });
      }
    }

    return {
      pageTextContext: result,
      estimatedTokens,
      totalTexts,
      truncated,
      processedNodes,
    };
  }

  private estimateTokensForTextEntry(entry: TextEntry): number {
    const payload = [
      entry.layerName,
      entry.characters,
      entry.role,
      entry.fontFamily,
      entry.fontStyle,
      String(entry.fontSize),
      String(entry.importance),
      entry.insideComponent ? "1" : "0",
    ].join("|");
    return Math.max(1, Math.ceil(payload.length / 4));
  }

  // ── Selected text extraction ─────────────────────────────────────────────

  /**
   * Read the first selected node and return a structured SelectedTextContext.
   *
   * - If the selection is a TextNode → use it directly.
   * - If the selection is a container (frame/group/component/instance) that has
   *   at least one TEXT descendant → concatenate all descendant texts (joined by
   *   newlines) and return a synthetic SelectedTextContext so the AI knows what
   *   copy is inside the selected frame.
   * - Otherwise → return null.
   */
  extractSelectedText(): SelectedTextContext | null {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) return null;

    const first = selection[0];

    // ── Direct text node ──────────────────────────────────────────────────────
    if (first.type === "TEXT") {
      const textNode = first as TextNode;
      const fontName = textNode.fontName;
      const fontSize = textNode.fontSize;

      const fontFamily = fontName === figma.mixed ? "mixed" : fontName.family;
      const fontSizeVal: number | "mixed" =
        fontSize === figma.mixed ? "mixed" : fontSize;

      const role = this.inferTextRole(textNode);
      const insideComponent = this.isInsideComponent(textNode);
      const screenName = this.findParentScreenName(textNode);

      return {
        characters: textNode.characters,
        role,
        fontSize: fontSizeVal,
        fontFamily,
        charCount: textNode.characters.length,
        insideComponent,
        screenName,
      };
    }

    // ── Container with text descendants ───────────────────────────────────────
    const container = first as unknown as ChildrenMixin;
    if (typeof container.findAll !== "function") return null;

    const textNodes = container.findAll((n) => n.type === "TEXT") as TextNode[];
    const nonEmpty = textNodes.filter((t) => t.characters.trim() !== "");
    if (nonEmpty.length === 0) return null;

    const combined = nonEmpty.map((t) => t.characters).join("\n");

    // Use the font properties of the first text node as representative metadata
    const ref = nonEmpty[0];
    const fontName = ref.fontName;
    const fontSize = ref.fontSize;

    return {
      characters: combined,
      role: this.inferTextRole(ref),
      fontSize: fontSize === figma.mixed ? "mixed" : fontSize,
      fontFamily: fontName === figma.mixed ? "mixed" : fontName.family,
      charCount: combined.length,
      insideComponent: this.isInsideComponent(ref),
      screenName: this.findParentScreenName(ref),
    };
  }

  /**
   * Walk up the parent chain to find the top-level FRAME name (screen name).
   */
  private findParentScreenName(node: TextNode): string | null {
    let current: BaseNode | null = node.parent;
    let lastFrameName: string | null = null;

    while (current !== null && current.type !== "PAGE") {
      if (current.type === "FRAME") {
        lastFrameName = current.name;
      }
      current = current.parent;
    }

    return lastFrameName;
  }

  private buildTextEntry(node: TextNode): TextEntry {
    const fontName = node.fontName;
    const fontSize = node.fontSize;

    const fontFamily = fontName === figma.mixed ? "mixed" : fontName.family;
    const fontStyle = fontName === figma.mixed ? "mixed" : fontName.style;
    const fontSizeVal: number | "mixed" =
      fontSize === figma.mixed ? "mixed" : fontSize;

    const role = this.inferTextRole(node);
    const importance = this.inferImportance(role, fontSizeVal);
    const insideComponent = this.isInsideComponent(node);

    return {
      layerName: node.name,
      characters: node.characters,
      charCount: node.characters.length,
      role,
      importance,
      fontFamily,
      fontStyle,
      fontSize: fontSizeVal,
      insideComponent,
    };
  }

  /**
   * Infer the semantic role of a text node.
   * Priority: layer-name keywords → font-size thresholds.
   */
  private inferTextRole(node: TextNode): TextRole {
    const name = node.name.toLowerCase();
    const fontSize = node.fontSize;

    if (/\b(h1|heading|title|hero|display)\b/.test(name)) return "heading";
    if (/\b(h2|h3|subtitle|subheading|subhead|eyebrow)\b/.test(name))
      return "subheading";
    if (/\b(btn|button|cta|action)\b/.test(name)) return "button";
    if (/\b(label|tag|chip|badge)\b/.test(name)) return "label";
    if (/\b(caption|hint|helper|footnote|note|overline)\b/.test(name))
      return "caption";
    if (/\b(body|paragraph|content|description|desc|text)\b/.test(name))
      return "body";

    if (fontSize !== figma.mixed) {
      if (fontSize >= 28) return "heading";
      if (fontSize >= 18) return "subheading";
      if (fontSize >= 12) return "body";
      return "caption";
    }

    return "unknown";
  }

  /** Map role + font size to a 1-3 importance score. */
  private inferImportance(
    role: TextRole,
    fontSize: number | "mixed"
  ): 1 | 2 | 3 {
    if (role === "heading" || role === "button") return 1;
    if (role === "caption") return 3;

    if (fontSize !== "mixed") {
      if (fontSize >= 24) return 1;
      if (fontSize >= 13) return 2;
      return 3;
    }

    return 2;
  }

  /** Walk up the parent chain to detect if the node is inside a component or instance. */
  private isInsideComponent(node: TextNode): boolean {
    let parent: BaseNode | null = node.parent;
    while (parent !== null && parent.type !== "PAGE") {
      if (parent.type === "INSTANCE" || parent.type === "COMPONENT") {
        return true;
      }
      parent = parent.parent;
    }
    return false;
  }

  // ── Selected component extraction ────────────────────────────────────────────

  /**
   * When the first selected node is NOT a text node, extract it as a
   * SelectedComponentContext: its name, type, screen, and all text children.
   * Returns null when the selection is empty or is a text node (handled by
   * extractSelectedText instead).
   */
  extractSelectedComponent(): SelectedComponentContext | null {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) return null;

    const node = selection[0];
    if (node.type === "TEXT") return null;

    const nodeType = this.mapNodeType(node.type);
    const screenName = this.findParentScreenNameFromNode(node);

    const textNodes = (node as ChildrenMixin).findAll
      ? ((node as ChildrenMixin).findAll((n) => n.type === "TEXT") as TextNode[])
      : [];

    const texts: ComponentTextEntry[] = textNodes
      .filter((t) => t.characters.trim() !== "")
      .map((t) => {
        const fontName = t.fontName;
        const fontSize = t.fontSize;
        return {
          characters: t.characters,
          fontFamily: fontName === figma.mixed ? "mixed" : fontName.family,
          fontStyle: fontName === figma.mixed ? "mixed" : fontName.style,
          fontSize: fontSize === figma.mixed ? "mixed" : fontSize,
        };
      });

    return {
      componentName: node.name,
      nodeType,
      texts,
      screenName,
    };
  }

  private mapNodeType(
    type: string
  ): SelectedComponentContext["nodeType"] {
    if (type === "COMPONENT") return "COMPONENT";
    if (type === "INSTANCE")  return "INSTANCE";
    if (type === "FRAME")     return "FRAME";
    if (type === "GROUP")     return "GROUP";
    return "OTHER";
  }

  /**
   * Walk up the parent chain to find the top-level FRAME name (screen name)
   * for any arbitrary node (not just TextNode).
   */
  private findParentScreenNameFromNode(node: BaseNode): string | null {
    let current: BaseNode | null = node.parent;
    let lastFrameName: string | null = null;
    while (current !== null && current.type !== "PAGE") {
      if (current.type === "FRAME") lastFrameName = current.name;
      current = current.parent;
    }
    return lastFrameName;
  }
}
