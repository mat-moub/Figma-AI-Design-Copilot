/**
 * main.ts — Figma Plugin Controller
 *
 * Runs inside the Figma plugin sandbox. Has exclusive access to the Figma
 * API. Communicates with the UI (ui.html) via postMessage.
 */

import { ContextEngine } from "./services/context-engine";
import { FigmaBuilder } from "./services/figma-builder";
import type { BuildScreensMessage, UIToPluginMessage } from "./types/ui-types";

const contextEngine = new ContextEngine();
const figmaBuilder = new FigmaBuilder();

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
        handleGetContext();
        break;

      case "build-screens":
        await handleBuildScreens(msg);
        break;

      default:
        break;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    figma.ui.postMessage({ type: "error", message });
  }
};

// ── Handlers ─────────────────────────────────────────────────────────────────

function handleGetContext(): void {
  const context = contextEngine.extract();
  figma.ui.postMessage({ type: "context-ready", context });
}

async function handleBuildScreens(msg: BuildScreensMessage): Promise<void> {
  figma.ui.postMessage({ type: "notify", message: "Building screens in Figma…" });

  const count = await figmaBuilder.buildScreens(msg.screens);

  figma.ui.postMessage({ type: "screens-built", count });
  figma.notify(`✅ ${count} screen${count !== 1 ? "s" : ""} created successfully!`);
}
