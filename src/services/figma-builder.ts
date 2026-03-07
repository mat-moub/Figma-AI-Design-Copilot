import type { UIElement, UIScreen } from "../types/ui-types";

// Default dimensions
const DEFAULT_WIDTH = 390;
const DEFAULT_HEIGHT = 844;
const PADDING = 24;
const ITEM_HEIGHT = 48;
const ITEM_GAP = 12;

/**
 * Figma Builder
 *
 * Converts AI-generated {@link UIScreen} JSON objects into real Figma nodes
 * and appends them to the current page.
 */
export class FigmaBuilder {
  private fontsLoaded = false;

  /** Build all screens and return the number of frames created. */
  async buildScreens(screens: UIScreen[]): Promise<number> {
    await this.loadFonts();

    let offsetX = 0;
    for (const screen of screens) {
      const frame = await this.buildFrame(screen, offsetX);
      figma.currentPage.appendChild(frame);
      offsetX += (screen.width ?? DEFAULT_WIDTH) + 40;
    }

    // Zoom to fit the new frames
    figma.viewport.scrollAndZoomIntoView(
      figma.currentPage.children.slice(-screens.length)
    );

    return screens.length;
  }

  // ── Private builders ─────────────────────────────────────────────────────

  private async buildFrame(screen: UIScreen, x: number): Promise<FrameNode> {
    const frame = figma.createFrame();
    frame.name = screen.name;
    frame.resize(screen.width ?? DEFAULT_WIDTH, screen.height ?? DEFAULT_HEIGHT);
    frame.x = x;
    frame.y = 0;
    frame.fills = [{ type: "SOLID", color: { r: 0.97, g: 0.97, b: 0.97 } }];
    frame.cornerRadius = 12;

    if (screen.layout !== "none") {
      frame.layoutMode = screen.layout === "vertical" ? "VERTICAL" : "HORIZONTAL";
      frame.paddingLeft = PADDING;
      frame.paddingRight = PADDING;
      frame.paddingTop = PADDING;
      frame.paddingBottom = PADDING;
      frame.itemSpacing = ITEM_GAP;
      frame.primaryAxisSizingMode = "FIXED";
      frame.counterAxisSizingMode = "FIXED";
    }

    for (const element of screen.elements) {
      const node = await this.buildElement(element);
      if (node) {
        frame.appendChild(node);
      }
    }

    return frame;
  }

  private async buildElement(element: UIElement): Promise<SceneNode | null> {
    switch (element.type) {
      case "text":
      case "header":
      case "badge":
        return this.buildText(element);
      case "button":
        return this.buildButton(element);
      case "input":
        return this.buildInput(element);
      case "card":
        return this.buildCard(element);
      case "divider":
        return this.buildDivider();
      case "nav":
      case "footer":
        return this.buildNavBar(element);
      case "image":
        return this.buildImagePlaceholder(element);
      case "avatar":
        return this.buildAvatar();
      case "icon":
        return this.buildIconPlaceholder(element);
      case "container":
      case "list":
      case "modal":
      case "tab":
        return this.buildContainer(element);
      default:
        return null;
    }
  }

  private async buildText(element: UIElement): Promise<TextNode> {
    const text = figma.createText();
    await this.ensureFont({ family: "Inter", style: "Regular" });
    text.fontName = { family: "Inter", style: "Regular" };
    text.characters = element.value ?? element.type;
    text.fontSize = element.type === "header" ? 20 : 14;

    if (element.type === "header") {
      text.fontName = { family: "Inter", style: "Bold" };
    }

    text.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
    text.name = element.value ?? element.type;
    return text;
  }

  private async buildButton(element: UIElement): Promise<FrameNode> {
    const btn = figma.createFrame();
    btn.name = element.component ?? "Button";
    btn.resize(DEFAULT_WIDTH - PADDING * 2, ITEM_HEIGHT);
    btn.cornerRadius = 8;
    btn.fills = [{ type: "SOLID", color: { r: 0.22, g: 0.42, b: 0.96 } }];
    btn.layoutMode = "HORIZONTAL";
    btn.primaryAxisAlignItems = "CENTER";
    btn.counterAxisAlignItems = "CENTER";

    const label = figma.createText();
    await this.ensureFont({ family: "Inter", style: "Medium" });
    label.fontName = { family: "Inter", style: "Medium" };
    label.characters = element.value ?? "Button";
    label.fontSize = 14;
    label.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    btn.appendChild(label);
    return btn;
  }

  private async buildInput(element: UIElement): Promise<FrameNode> {
    const inputFrame = figma.createFrame();
    inputFrame.name = element.component ?? "Input";
    inputFrame.resize(DEFAULT_WIDTH - PADDING * 2, ITEM_HEIGHT);
    inputFrame.cornerRadius = 8;
    inputFrame.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    inputFrame.strokes = [{ type: "SOLID", color: { r: 0.8, g: 0.8, b: 0.8 } }];
    inputFrame.strokeWeight = 1;
    inputFrame.layoutMode = "HORIZONTAL";
    inputFrame.paddingLeft = 12;
    inputFrame.paddingRight = 12;
    inputFrame.counterAxisAlignItems = "CENTER";

    const placeholder = figma.createText();
    await this.ensureFont({ family: "Inter", style: "Regular" });
    placeholder.fontName = { family: "Inter", style: "Regular" };
    placeholder.characters = element.value ?? "Enter text...";
    placeholder.fontSize = 14;
    placeholder.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
    inputFrame.appendChild(placeholder);
    return inputFrame;
  }

  private async buildCard(element: UIElement): Promise<FrameNode> {
    const card = figma.createFrame();
    card.name = element.component ?? "Card";
    card.resize(DEFAULT_WIDTH - PADDING * 2, 120);
    card.cornerRadius = 12;
    card.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    card.effects = [
      {
        type: "DROP_SHADOW",
        color: { r: 0, g: 0, b: 0, a: 0.08 },
        offset: { x: 0, y: 2 },
        radius: 8,
        spread: 0,
        visible: true,
        blendMode: "NORMAL",
      },
    ];
    card.layoutMode = "VERTICAL";
    card.paddingLeft = 16;
    card.paddingRight = 16;
    card.paddingTop = 16;
    card.paddingBottom = 16;
    card.itemSpacing = 8;

    if (element.children && element.children.length > 0) {
      for (const child of element.children) {
        const childNode = await this.buildElement(child);
        if (childNode) card.appendChild(childNode);
      }
    } else {
      const title = figma.createText();
      await this.ensureFont({ family: "Inter", style: "SemiBold" });
      title.fontName = { family: "Inter", style: "SemiBold" };
      title.characters = element.value ?? "Card Title";
      title.fontSize = 16;
      title.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
      card.appendChild(title);

      const subtitle = figma.createText();
      await this.ensureFont({ family: "Inter", style: "Regular" });
      subtitle.fontName = { family: "Inter", style: "Regular" };
      subtitle.characters = "Card description";
      subtitle.fontSize = 13;
      subtitle.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
      card.appendChild(subtitle);
    }

    return card;
  }

  private buildDivider(): RectangleNode {
    const divider = figma.createRectangle();
    divider.name = "Divider";
    divider.resize(DEFAULT_WIDTH - PADDING * 2, 1);
    divider.fills = [{ type: "SOLID", color: { r: 0.88, g: 0.88, b: 0.88 } }];
    return divider;
  }

  private async buildNavBar(element: UIElement): Promise<FrameNode> {
    const nav = figma.createFrame();
    nav.name = element.component ?? (element.type === "nav" ? "NavBar" : "Footer");
    nav.resize(DEFAULT_WIDTH - PADDING * 2, 56);
    nav.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    nav.layoutMode = "HORIZONTAL";
    nav.primaryAxisAlignItems = "SPACE_BETWEEN";
    nav.counterAxisAlignItems = "CENTER";
    nav.paddingLeft = 16;
    nav.paddingRight = 16;

    const label = figma.createText();
    await this.ensureFont({ family: "Inter", style: "Medium" });
    label.fontName = { family: "Inter", style: "Medium" };
    label.characters = element.value ?? "Navigation";
    label.fontSize = 14;
    label.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1 } }];
    nav.appendChild(label);
    return nav;
  }

  private buildImagePlaceholder(element: UIElement): RectangleNode {
    const img = figma.createRectangle();
    img.name = element.value ?? "Image";
    img.resize(DEFAULT_WIDTH - PADDING * 2, 200);
    img.cornerRadius = 8;
    img.fills = [{ type: "SOLID", color: { r: 0.85, g: 0.85, b: 0.85 } }];
    return img;
  }

  private buildAvatar(): EllipseNode {
    const avatar = figma.createEllipse();
    avatar.name = "Avatar";
    avatar.resize(40, 40);
    avatar.fills = [{ type: "SOLID", color: { r: 0.7, g: 0.7, b: 0.85 } }];
    return avatar;
  }

  private buildIconPlaceholder(element: UIElement): RectangleNode {
    const icon = figma.createRectangle();
    icon.name = element.value ?? "Icon";
    icon.resize(24, 24);
    icon.cornerRadius = 4;
    icon.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.9 } }];
    return icon;
  }

  private async buildContainer(element: UIElement): Promise<FrameNode> {
    const container = figma.createFrame();
    container.name = element.component ?? element.type;
    container.resize(DEFAULT_WIDTH - PADDING * 2, 200);
    container.fills = [{ type: "SOLID", color: { r: 0.95, g: 0.95, b: 0.95 } }];
    container.cornerRadius = 8;
    container.layoutMode = "VERTICAL";
    container.paddingLeft = 12;
    container.paddingRight = 12;
    container.paddingTop = 12;
    container.paddingBottom = 12;
    container.itemSpacing = 8;

    if (element.children) {
      for (const child of element.children) {
        const childNode = await this.buildElement(child);
        if (childNode) container.appendChild(childNode);
      }
    }

    return container;
  }

  // ── Font helpers ─────────────────────────────────────────────────────────

  private loadedFonts = new Set<string>();

  private async ensureFont(font: FontName): Promise<void> {
    const key = `${font.family}:${font.style}`;
    if (!this.loadedFonts.has(key)) {
      try {
        await figma.loadFontAsync(font);
        this.loadedFonts.add(key);
      } catch {
        // Fall back to a common font if the requested one is unavailable
        const fallback: FontName = { family: "Roboto", style: font.style };
        const fallbackKey = `${fallback.family}:${fallback.style}`;
        if (!this.loadedFonts.has(fallbackKey)) {
          await figma.loadFontAsync(fallback);
          this.loadedFonts.add(fallbackKey);
        }
      }
    }
  }

  private async loadFonts(): Promise<void> {
    if (this.fontsLoaded) return;
    const fonts: FontName[] = [
      { family: "Inter", style: "Regular" },
      { family: "Inter", style: "Medium" },
      { family: "Inter", style: "SemiBold" },
      { family: "Inter", style: "Bold" },
    ];
    await Promise.all(fonts.map((f) => this.ensureFont(f)));
    this.fontsLoaded = true;
  }
}
