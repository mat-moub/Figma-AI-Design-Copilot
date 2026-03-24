import type {
  DocumentContext,
  DesignSystem,
  TextEntry,
  TextRole,
  ScreenTextContext,
  SelectedTextContext,
  SelectedComponentContext,
  ComponentTextEntry,
} from "../types/ui-types";

/**
 * Context Engine
 *
 * Runs inside the Figma plugin sandbox (main.ts) and reads the current page
 * to produce a structured {@link DocumentContext} sent to the AI as background
 * knowledge.  Text extraction is scoped to `figma.currentPage` so the context
 * stays focused and avoids loading every page in large files.
 *
 * For UX writing, the most important piece of context is the currently
 * selected text node — its content, role, and surrounding screen.
 */
export class ContextEngine {
  /** Extract a full DocumentContext from the open Figma document. */
  async extract(): Promise<DocumentContext> {
    return {
      designSystem: await this.extractDesignSystem(),
      screens: this.extractScreenNames(),
      pages: this.extractPageNames(),
      pageTextContext: this.extractPageTextContext(),
      selectedText: this.extractSelectedText(),
      selectedComponent: this.extractSelectedComponent(),
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

  // ── Selected text extraction ─────────────────────────────────────────────

  /**
   * Read the first selected TextNode (if any) and return a structured
   * SelectedTextContext for the AI.  Returns null when no text node is selected.
   */
  extractSelectedText(): SelectedTextContext | null {
    const selection = figma.currentPage.selection;
    const textNode = selection.find((n) => n.type === "TEXT") as TextNode | undefined;

    if (!textNode) return null;

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

  // ── Text context extraction ─────────────────────────────────────────────

  /**
   * Gather all TEXT nodes from every top-level FRAME on the current page.
   * Results are grouped by screen and preserve the order in which nodes
   * appear in the Figma layer tree (top-to-bottom, as designed).
   */
  private extractPageTextContext(): ScreenTextContext[] {
    const screens = figma.currentPage.children.filter(
      (node) => node.type === "FRAME"
    ) as FrameNode[];

    return screens
      .map((frame) => {
        const textNodes = frame.findAll(
          (node) => node.type === "TEXT"
        ) as TextNode[];

        const texts: TextEntry[] = textNodes
          .filter((node) => node.characters.trim() !== "")
          .map((node) => this.buildTextEntry(node));

        return { screenName: frame.name, texts };
      })
      .filter((screen) => screen.texts.length > 0);
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
    // If the first selected node is text, this slot is null (selectedText handles it)
    if (node.type === "TEXT") return null;

    const nodeType = this.mapNodeType(node.type);
    const screenName = this.findParentScreenNameFromNode(node);

    // Collect all TEXT descendants in tree order
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
