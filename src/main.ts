/**
 * main.ts — Figma UX Writer Copilot Controller
 *
 * Runs inside the Figma plugin sandbox. Has exclusive access to the Figma
 * API. Communicates with the UI (ui.html) via postMessage.
 */

import { ContextEngine } from "./services/context-engine";
import type {
  ApplyTextMessage,
  PersistedSettings,
  SaveSettingsMessage,
  SelectedTextContext,
  UIToPluginMessage,
} from "./types/ui-types";

const contextEngine = new ContextEngine();
const ONBOARDING_DONE_KEY = "copilot_onboarding_done";
const SETTINGS_KEY = "copilot_settings";

function redactSecrets(raw: unknown): string {
  const text = typeof raw === "string" ? raw : String(raw);
  return text
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, "AIza***")
    .replace(/sk-ant-[A-Za-z0-9\-_]+/g, "sk-ant-***")
    .replace(/sk-[A-Za-z0-9\-_]{10,}/g, "sk-***")
    .replace(/ghp_[A-Za-z0-9]+/g, "ghp_***")
    .replace(/(key=)[^&\s]+/gi, "$1***");
}

// ── Show the plugin UI ───────────────────────────────────────────────────────

figma.showUI(__html__, { width: 420, height: 640, themeColors: true });

figma.ui.postMessage({
  type: "notify",
  message: "UX Writer Copilot ready. Select a text node and start writing!",
});

// ── Selection change listener ─────────────────────────────────────────────────

figma.on("selectionchange", () => {
  figma.ui.postMessage({
    type: "selection-changed",
    selectedText: extractSelectedText(),
  });
});

// ── Message handler ──────────────────────────────────────────────────────────

figma.ui.onmessage = async (msg: UIToPluginMessage) => {
  try {
    switch (msg.type) {
      case "get-context":
        await handleGetContext();
        break;

      case "get-onboarding-status":
        await handleGetOnboardingStatus();
        break;

      case "get-settings":
        await handleGetSettings();
        break;

      case "save-settings":
        await handleSaveSettings(msg);
        break;

      case "set-onboarding-done":
        await handleSetOnboardingDone();
        break;

      case "apply-text":
        await handleApplyText(msg);
        break;

      default:
        break;
    }
  } catch (err) {
    const message = redactSecrets(err instanceof Error ? err.message : String(err));
    figma.ui.postMessage({ type: "error", message });
  }
};

// ── Handlers ─────────────────────────────────────────────────────────────────

async function handleGetContext(): Promise<void> {
  const context = await contextEngine.extract();
  figma.ui.postMessage({ type: "context-ready", context });
}

async function handleGetOnboardingStatus(): Promise<void> {
  const done = (await figma.clientStorage.getAsync(ONBOARDING_DONE_KEY)) === true;
  figma.ui.postMessage({ type: "onboarding-status", done });
}

async function handleGetSettings(): Promise<void> {
  const settings = (await figma.clientStorage.getAsync(SETTINGS_KEY)) as PersistedSettings | null;
  figma.ui.postMessage({ type: "settings-loaded", settings: settings ?? null });
}

async function handleSaveSettings(msg: SaveSettingsMessage): Promise<void> {
  await figma.clientStorage.setAsync(SETTINGS_KEY, msg.settings);
}

async function handleSetOnboardingDone(): Promise<void> {
  await figma.clientStorage.setAsync(ONBOARDING_DONE_KEY, true);
}

/**
 * Apply a text alternative to the first selected TextNode in Figma.
 * Loads fonts before writing to avoid a "font not loaded" error.
 */
async function handleApplyText(msg: ApplyTextMessage): Promise<void> {
  const selection = figma.currentPage.selection;
  const textNode = selection.find((n) => n.type === "TEXT") as TextNode | undefined;

  if (!textNode) {
    figma.ui.postMessage({
      type: "error",
      message: "No text node selected. Please select a text layer in Figma first.",
    });
    return;
  }

  // Load all fonts used by this text node before editing
  const fontName = textNode.fontName;
  if (fontName !== figma.mixed) {
    await figma.loadFontAsync(fontName);
  } else {
    // Mixed fonts — load each unique font in the node
    const segments = textNode.getStyledTextSegments(["fontName"]);
    const uniqueFonts = new Map<string, FontName>();
    for (const seg of segments) {
      const key = `${seg.fontName.family}::${seg.fontName.style}`;
      if (!uniqueFonts.has(key)) uniqueFonts.set(key, seg.fontName);
    }
    await Promise.all([...uniqueFonts.values()].map((f) => figma.loadFontAsync(f)));
  }

  textNode.characters = msg.text;

  figma.ui.postMessage({ type: "text-applied" });
  figma.notify(`Text updated successfully.`);
}

// ── Selection helper ──────────────────────────────────────────────────────────

/**
 * Read the first selected TextNode and return a SelectedTextContext.
 * Returns null when no text node is selected.
 * Mirrors the logic in ContextEngine.extractSelectedText().
 */
function extractSelectedText(): SelectedTextContext | null {
  const selection = figma.currentPage.selection;
  const textNode = selection.find((n) => n.type === "TEXT") as TextNode | undefined;
  if (!textNode) return null;

  const fontName = textNode.fontName;
  const fontSize = textNode.fontSize;
  const fontFamily = fontName === figma.mixed ? "mixed" : fontName.family;
  const fontSizeVal: number | "mixed" = fontSize === figma.mixed ? "mixed" : fontSize;

  // Walk parent chain to find top-level FRAME name (screen name)
  let screenName: string | null = null;
  let current: BaseNode | null = textNode.parent;
  while (current !== null && current.type !== "PAGE") {
    if (current.type === "FRAME") screenName = current.name;
    current = current.parent;
  }

  // Infer semantic role from layer name and font size
  const name = textNode.name.toLowerCase();
  let role: SelectedTextContext["role"] = "unknown";
  if (/heading|title|h1|h2/.test(name)) role = "heading";
  else if (/subhead|subtitle|h3|h4/.test(name)) role = "subheading";
  else if (/body|paragraph|text/.test(name)) role = "body";
  else if (/label|tag/.test(name)) role = "label";
  else if (/caption|footnote|hint/.test(name)) role = "caption";
  else if (/button|btn|cta/.test(name)) role = "button";
  else if (typeof fontSizeVal === "number") {
    if (fontSizeVal >= 24) role = "heading";
    else if (fontSizeVal >= 18) role = "subheading";
    else if (fontSizeVal >= 14) role = "body";
    else role = "caption";
  }

  const insideComponent = (() => {
    let p: BaseNode | null = textNode.parent;
    while (p && p.type !== "PAGE") {
      if (p.type === "COMPONENT" || p.type === "INSTANCE") return true;
      p = p.parent;
    }
    return false;
  })();

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
