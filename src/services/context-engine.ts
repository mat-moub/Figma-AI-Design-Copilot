import type { DocumentContext, DesignSystem } from "../types/ui-types";

/**
 * Context Engine
 *
 * Runs inside the Figma plugin sandbox (main.ts) and reads the entire
 * document to produce a structured {@link DocumentContext} that is sent
 * to the AI as background knowledge.
 */
export class ContextEngine {
  /** Extract a full DocumentContext from the open Figma document. */
  extract(): DocumentContext {
    return {
      designSystem: this.extractDesignSystem(),
      screens: this.extractScreenNames(),
      pages: this.extractPageNames(),
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  private extractPageNames(): string[] {
    return figma.root.children.map((page) => page.name);
  }

  private extractScreenNames(): string[] {
    const frames = figma.root.findAll(
      (node) => node.type === "FRAME" && node.parent?.type === "PAGE"
    ) as FrameNode[];

    return [...new Set(frames.map((f) => f.name))];
  }

  private extractDesignSystem(): DesignSystem {
    return {
      components: this.extractComponentNames(),
      colors: this.extractColorNames(),
      textStyles: this.extractTextStyleNames(),
    };
  }

  private extractComponentNames(): string[] {
    const components = figma.root.findAll(
      (node) => node.type === "COMPONENT"
    ) as ComponentNode[];

    return [...new Set(components.map((c) => c.name))];
  }

  private extractColorNames(): string[] {
    const paintStyles = figma.getLocalPaintStyles();
    return paintStyles.map((style) => style.name);
  }

  private extractTextStyleNames(): string[] {
    const textStyles = figma.getLocalTextStyles();
    return textStyles.map((style) => style.name);
  }
}
