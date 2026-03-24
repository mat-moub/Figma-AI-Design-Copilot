/**
 * main.ts — Figma UX Writer Copilot Controller
 *
 * Runs inside the Figma plugin sandbox. Has exclusive access to the Figma
 * API. Communicates with the UI (ui.html) via postMessage.
 */

import { ContextEngine } from "./services/context-engine";
import { redactSecrets } from "./utils/redact-secrets";
import type {
  ApplyTextMessage,
  PersistedSettings,
  SaveSettingsMessage,
  UIToPluginMessage,
} from "./types/ui-types";

const contextEngine = new ContextEngine();
const ONBOARDING_DONE_KEY = "copilot_onboarding_done";
const SETTINGS_KEY = "copilot_settings";

// ── Show the plugin UI ───────────────────────────────────────────────────────

figma.showUI(__html__, { width: 420, height: 800, themeColors: true });

figma.ui.postMessage({
  type: "notify",
  message: "UX Writer Copilot ready. Select a text node and start writing!",
});

// ── Selection change listener ─────────────────────────────────────────────────

figma.on("selectionchange", () => {
  figma.ui.postMessage({
    type: "selection-changed",
    selectedText: contextEngine.extractSelectedText(),
    selectedComponent: contextEngine.extractSelectedComponent(),
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

      case "reset-onboarding":
        await handleResetOnboarding();
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

async function handleResetOnboarding(): Promise<void> {
  await figma.clientStorage.setAsync(ONBOARDING_DONE_KEY, false);
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
// Selection extraction is handled by ContextEngine (context-engine.ts).
