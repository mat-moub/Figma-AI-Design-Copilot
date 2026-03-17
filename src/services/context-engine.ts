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
  async extract(): Promise<DocumentContext> {
    return {
      designSystem: await this.extractDesignSystem(),
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

  private async extractDesignSystem(): Promise<DesignSystem> {
    return {
      components: this.extractComponentNames(),
      colors: await this.extractColorNames(),
      textStyles: await this.extractTextStyleNames(),
    };
  }

  private extractComponentNames(): string[] {
    const components = figma.root.findAll(
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
}
