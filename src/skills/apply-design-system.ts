import type { DesignSystem, UIElement, UIScreen } from "../types/ui-types";

export interface ApplyDesignSystemInput {
  screens: UIScreen[];
  designSystem: DesignSystem;
}

/**
 * Apply Design System Skill
 *
 * Maps generic UI element types to the named components found in the Figma
 * design system.  When a matching component exists its name is set on the
 * `component` field so the Figma Builder can reference it.
 *
 * Default mapping heuristics:
 *   button  → first component matching /button/i
 *   input   → first component matching /input/i
 *   card    → first component matching /card/i
 *   avatar  → first component matching /avatar/i
 *   nav     → first component matching /nav|header/i
 *   footer  → first component matching /footer/i
 */
export function applyDesignSystem(input: ApplyDesignSystemInput): UIScreen[] {
  const { screens, designSystem } = input;

  const componentMap = buildComponentMap(designSystem.components);

  return screens.map((screen) => ({
    ...screen,
    elements: screen.elements.map((el) => applyToElement(el, componentMap)),
  }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

type ComponentMap = Map<string, string>;

function buildComponentMap(components: string[]): ComponentMap {
  const map: ComponentMap = new Map();

  const patterns: Array<[RegExp, string]> = [
    [/button/i, "button"],
    [/input|text.?field|field/i, "input"],
    [/card/i, "card"],
    [/avatar|profile.?pic/i, "avatar"],
    [/nav|header/i, "nav"],
    [/footer/i, "footer"],
    [/icon/i, "icon"],
    [/badge/i, "badge"],
    [/tab/i, "tab"],
    [/modal|dialog/i, "modal"],
    [/image|img|photo/i, "image"],
  ];

  for (const componentName of components) {
    for (const [pattern, elementType] of patterns) {
      if (pattern.test(componentName) && !map.has(elementType)) {
        map.set(elementType, componentName);
      }
    }
  }

  return map;
}

function applyToElement(element: UIElement, map: ComponentMap): UIElement {
  const mapped = { ...element };

  // Only set component if one is found and not already specified
  if (!mapped.component) {
    const match = map.get(element.type);
    if (match) {
      mapped.component = match;
    }
  }

  // Recurse into children
  if (mapped.children && mapped.children.length > 0) {
    mapped.children = mapped.children.map((child) => applyToElement(child, map));
  }

  return mapped;
}
