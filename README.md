# Figma AI Design Copilot

A Figma plugin that turns natural-language prompts into Figma frames using **GitHub Copilot** as its sole AI provider. The plugin reads the open document's design system (components, colours, text styles, existing screens) and forwards that context to Copilot so every generated frame is coherent with the current file.

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [Two-process model](#two-process-model)
3. [Directory structure](#directory-structure)
4. [Core concepts](#core-concepts)
5. [Authentication — GitHub token](#authentication--github-token)
6. [Available Copilot models](#available-copilot-models)
7. [Agents](#agents)
8. [Skills](#skills)
9. [Custom agents & skills (`copilot.json`)](#custom-agents--skills-copilotjson)
10. [External skills library](#external-skills-library)
11. [Data flow — single request](#data-flow--single-request)
12. [Build & develop](#build--develop)
13. [Testing](#testing)
14. [Key types quick reference](#key-types-quick-reference)

---

## Architecture overview

```
┌─────────────────────────────────────────────┐
│  Figma Plugin Sandbox  (main.ts / code.js)  │
│  • Reads Figma document via Figma API        │
│  • Creates frames from AI-generated JSON     │
│  • Communicates with UI via postMessage      │
└────────────────┬────────────────────────────┘
                 │ postMessage (JSON)
┌────────────────▼────────────────────────────┐
│  Plugin iframe  (ui.ts → dist/ui.js)         │
│  • Chat interface                            │
│  • Agent / model / variant selection         │
│  • Calls GitHub Copilot API via fetch()      │
└────────────────┬────────────────────────────┘
                 │ HTTPS (OpenAI-compatible)
┌────────────────▼────────────────────────────┐
│  api.githubcopilot.com/chat/completions      │
│  GPT-4o · Claude 3.5 Sonnet · o3-mini       │
└─────────────────────────────────────────────┘
```

**Only one AI provider is used: GitHub Copilot.** There are no OpenAI or Anthropic direct integrations. Users authenticate with a GitHub Personal Access Token that has the `copilot` scope.

---

## Two-process model

Figma plugins run in two separate JavaScript contexts that can only talk to each other through `postMessage`.

| File | Context | Capabilities |
|------|---------|--------------|
| `src/main.ts` → `dist/code.js` | Figma plugin sandbox | Full Figma API access; no DOM; no `fetch` |
| `src/ui.ts` → `dist/ui.js` | Sandboxed iframe | DOM + `fetch`; no direct Figma API |

Message types are defined in `src/types/ui-types.ts` under `UIToPluginMessage` and `PluginToUIMessage`.

---

## Directory structure

```
src/
├── main.ts                    # Plugin controller (Figma sandbox)
├── ui.ts                      # UI logic (iframe)
├── types/
│   └── ui-types.ts            # All shared TypeScript types
├── services/
│   ├── ai-service.ts          # GitHub Copilot API client
│   ├── context-engine.ts      # Extracts design system from Figma doc
│   ├── figma-builder.ts       # Converts AI JSON → Figma nodes
│   ├── custom-agent-registry.ts  # Manages user-provided agents/skills
│   └── skills-library-service.ts # Fetches external UX skills from GitHub
├── agents/
│   ├── ux-designer-agent.ts   # Default full-featured agent
│   ├── design-system-agent.ts # Strict design-system-mapping agent
│   └── custom-agent.ts        # Runs a user-defined copilot.json agent
├── skills/
│   ├── generate-screen.ts     # Skill: single screen generation
│   ├── generate-variants.ts   # Skill: multi-variant generation
│   └── apply-design-system.ts # Skill: map elements to design system components
├── data/
│   └── skills-library.ts      # 28 bundled UX/product-design frameworks
└── __tests__/                 # Jest unit tests (60 tests)
```

---

## Core concepts

### DocumentContext

Before every generation, the plugin sandbox scans the open file via `src/services/context-engine.ts` and sends a `DocumentContext` object to the iframe:

```ts
interface DocumentContext {
  designSystem: {
    components: string[]; // names of all COMPONENT nodes
    colors: string[];     // all paint style names
    textStyles: string[]; // all text style names
  };
  screens: string[];      // names of top-level FRAMEs
  pages: string[];        // names of all PAGEs
}
```

This context is injected into every system prompt so Copilot can reference existing components and colours.

### UIScreen (the AI's output format)

The AI is instructed to return a JSON array of `UIScreen` objects:

```ts
interface UIScreen {
  name: string;
  layout: "vertical" | "horizontal" | "none";
  elements: UIElement[];
  width?: number;  // default 390 (mobile)
  height?: number; // default 844
}

interface UIElement {
  type: "text" | "button" | "input" | "card" | "image" | "icon"
      | "divider" | "header" | "footer" | "nav" | "list"
      | "modal" | "tab" | "badge" | "avatar" | "container";
  value?: string;
  component?: string; // design system component name
  children?: UIElement[];
  style?: Record<string, string>;
}
```

`src/services/figma-builder.ts` walks this tree and creates the corresponding Figma nodes.

---

## Authentication — GitHub token

The plugin calls `https://api.githubcopilot.com/chat/completions` using a **GitHub Personal Access Token (classic)** with the `copilot` scope.

**How to get one:**

1. Go to **github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)**.
2. Click **Generate new token (classic)**.
3. Select the **`copilot`** scope (under *GitHub Copilot*).
4. Copy the token (`ghp_…`) and paste it into the **GH Token** field in the plugin panel.

The token is stored in `localStorage` within the plugin iframe and never sent anywhere except the official Copilot API endpoint.

> **Requirement:** A GitHub account with an active [GitHub Copilot subscription](https://github.com/features/copilot#pricing) (free tier included).

---

## Available Copilot models

| UI label | API model id | Best for |
|----------|-------------|----------|
| GPT-4o *(default)* | `gpt-4o` | Fast, balanced UI generation |
| Claude 3.5 Sonnet | `claude-3.5-sonnet` | Detailed, structured layouts |
| o3-mini | `o3-mini` | Reasoning-heavy design decisions |

All requests use the OpenAI-compatible chat-completions format. The model id is sent verbatim to the Copilot API.

---

## Agents

Agents provide the **system prompt** and decide which **skills** to invoke.

| Agent | File | Skills used | Best for |
|-------|------|------------|----------|
| UX Designer *(default)* | `agents/ux-designer-agent.ts` | generate-screen, generate-variants, apply-design-system | Full-featured UI generation with variants |
| Design System | `agents/design-system-agent.ts` | generate-screen, apply-design-system | Strict component mapping, no variants |
| Custom (user-defined) | `agents/custom-agent.ts` | As configured in `copilot.json` | Domain-specific generation without code |

Every agent's system prompt automatically includes the 28 bundled UX/product-design frameworks from `src/data/skills-library.ts`.

---

## Skills

Skills are the atomic units of work that agents orchestrate.

| Skill file | What it does |
|-----------|-------------|
| `skills/generate-screen.ts` | Calls Copilot once; returns one screen. Falls back to a placeholder if the response is empty. |
| `skills/generate-variants.ts` | Injects "generate N distinct variants (Variant A, B, C…)" into the prompt; returns N screens. Auto-labels screens that are missing the word "Variant". |
| `skills/apply-design-system.ts` | Pattern-matches element types against the design system component names and fills in the `component` field, enabling `figma-builder.ts` to use real Figma components. |

---

## Custom agents & skills (`copilot.json`)

Drop a `copilot.json` file into the plugin panel (drag-and-drop or file picker) to register your own agents and skills without writing TypeScript.

```jsonc
{
  "version": "1",
  "agents": [
    {
      "id": "brand-agent",
      "name": "Brand Agent",
      "systemPrompt": "You are a senior product designer for Acme Corp. Always use the Acme colour palette…",
      "skills": ["generate-screen", "generate-variants", "apply-design-system"]
    }
  ],
  "skills": [
    {
      "id": "dark-mode",
      "name": "Dark Mode",
      "promptModifier": "Generate all screens in dark mode with high contrast ratios."
    }
  ]
}
```

Custom agents appear in the **Agent** dropdown. Custom skills append their `promptModifier` to the agent's system prompt. The registry persists to `localStorage` so configs survive plugin restarts.

---

## External skills library

The plugin can fetch additional UX/product-design frameworks from an external GitHub repository. Click **⟳ Update** in the *Skills Library* panel to pull the latest non-code skills. These supplement (never replace) the 28 bundled skills.

Code-related skills (prefixed with `react-`, `typescript-`, `css-`, etc.) are filtered out automatically.

---

## Data flow — single request

```
User types prompt → handleGenerate() in ui.ts
  │
  ├─ getModelConfig()          → { model, githubToken }
  ├─ getSelectedAgent()        → "ux-designer" | "design-system" | custom id
  ├─ agent.generate(prompt, variants, context, modelConfig, history)
  │     │
  │     ├─ generateScreen / generateVariants  (skill)
  │     │     └─ aiService.generateScreens()
  │     │           └─ callCopilot()  →  POST api.githubcopilot.com
  │     │                                ← JSON array of UIScreen[]
  │     └─ applyDesignSystem()  (optional skill)
  │
  ├─ appendAssistantMessage()  (show summary in chat)
  └─ postMessage({ type: "build-screens", screens })
        └─ main.ts → figma-builder.ts → Figma frames inserted into document
```

---

## Build & develop

```bash
npm install          # install dev dependencies
npm run build        # one-off production build → dist/
npm run watch        # rebuild on file change (esbuild watch mode)
npm run typecheck    # TypeScript type-check without emitting
npm run lint         # ESLint (zero warnings policy)
npm test             # Jest unit tests
```

Load the plugin in Figma:

1. Open Figma → **Plugins → Development → Import plugin from manifest…**
2. Select `manifest.json` at the repository root.
3. Run **npm run watch** so the plugin auto-rebuilds as you edit.

---

## Testing

Tests live in `src/__tests__/` and use Jest + ts-jest. There is no Figma API mock — the plugin sandbox (`main.ts`) is intentionally excluded from the test suite. All tests exercise pure TypeScript logic.

```bash
npm test                        # run all 60 tests
npm test -- --watch             # watch mode
npm test -- generate-screen     # run a single suite
```

---

## Key types quick reference

```ts
// src/types/ui-types.ts

type AIModel = "gpt-4o" | "claude-3.5-sonnet" | "o3-mini";

interface ModelConfig {
  model: AIModel;
  githubToken?: string; // GitHub PAT with 'copilot' scope
}

type AgentType = "ux-designer" | "design-system";
type SkillType = "generate-screen" | "generate-variants" | "apply-design-system";

// Messages between iframe ↔ plugin sandbox
type UIToPluginMessage  = GetContextMessage | BuildScreensMessage;
type PluginToUIMessage  = ContextReadyMessage | ScreensBuiltMessage | ErrorMessage | NotifyMessage;
```

