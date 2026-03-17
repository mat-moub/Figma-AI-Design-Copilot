/**
 * main.ts — Figma Plugin Controller
 *
 * Runs inside the Figma plugin sandbox. Has exclusive access to the Figma
 * API. Communicates with the UI (ui.html) via postMessage.
 */

import { ContextEngine } from "./services/context-engine";
import { FigmaBuilder } from "./services/figma-builder";
import type {
  BuildScreensMessage,
  PersistedSettings,
  SaveSettingsMessage,
  UIToPluginMessage,
} from "./types/ui-types";

const contextEngine = new ContextEngine();
const figmaBuilder = new FigmaBuilder();
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
  message: "Plugin ready. Configure your API key and start designing!",
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

      case "build-screens":
        await handleBuildScreens(msg);
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
  await figma.loadAllPagesAsync();
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

async function handleBuildScreens(msg: BuildScreensMessage): Promise<void> {
  figma.ui.postMessage({ type: "notify", message: "Building screens in Figma…" });

  const count = await figmaBuilder.buildScreens(msg.screens);

  figma.ui.postMessage({ type: "screens-built", count });
  figma.notify(`✅ ${count} screen${count !== 1 ? "s" : ""} created successfully!`);
}
