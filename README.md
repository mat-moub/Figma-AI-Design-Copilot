# Figma AI Design Copilot

A Figma plugin that turns natural-language prompts into Figma frames using AI. The plugin reads the open document's design system (components, colours, text styles, existing screens) and forwards that context to the chosen AI provider so every generated frame is coherent with the current file.

Supported providers:
- **GitHub Copilot** — multi-model proxy (GPT, Claude, Gemini) via a GitHub PAT.
- **OpenAI** — direct Chat Completions API with your own OpenAI key (BYOK).
- **Anthropic** — direct Messages API with your own Anthropic key (BYOK).

---

## Screenshots

<table>
  <tr>
    <td align="center" width="33%">
      <strong>Main view</strong><br/>
      Connection badge + model always visible, agent selector, chat interface
      <br/><br/>
      <img src="screenshots/main-view.png" alt="Main view — connection badge, agent selector, chat" width="240"/>
    </td>
    <td align="center" width="33%">
      <strong>Settings (full-screen overlay)</strong><br/>
      Model config, API key, custom agents drag-and-drop, skills library
      <br/><br/>
      <img src="screenshots/settings-view.png" alt="Settings overlay — model, API key, custom agents, skills library" width="240"/>
    </td>
    <td align="center" width="33%">
      <strong>Skill chips in chat</strong><br/>
      Every AI response shows the skills that were invoked (e.g. Generate Variants, Apply Design System)
      <br/><br/>
      <img src="screenshots/chat-skill-chips.png" alt="Chat showing skill chip tags on each assistant message" width="240"/>
    </td>
  </tr>
</table>

---

## Table of contents

1. [Screenshots](#screenshots)
2. [Onboarding](#onboarding)
3. [Architecture overview](#architecture-overview)
4. [UI layout](#ui-layout)
5. [Two-process model](#two-process-model)
6. [Directory structure](#directory-structure)
7. [Core concepts](#core-concepts)
8. [Authentication & BYOK](#authentication--byok)
9. [Available providers and models](#available-providers-and-models)
10. [Agents](#agents)
11. [Skills](#skills)
12. [Custom agents & skills (`copilot.json`)](#custom-agents--skills-copilotjson)
13. [External skills library](#external-skills-library)
14. [Data flow — single request](#data-flow--single-request)
15. [Build & develop](#build--develop)
16. [Testing](#testing)
17. [Key types quick reference](#key-types-quick-reference)

---

## Onboarding

On first launch the plugin automatically shows a 3-step onboarding overlay to help new users get up and running without opening Settings manually.

<table>
  <tr>
    <td align="center" width="33%">
      <strong>Step 1 — Welcome</strong><br/>
      Introduction to the plugin's capabilities
      <br/><br/>
      <img src="https://github.com/user-attachments/assets/49494053-f807-4ecf-8f24-865474cb8205" alt="Onboarding step 1 — Welcome screen" width="240"/>
    </td>
    <td align="center" width="33%">
      <strong>Step 2 — Configure provider</strong><br/>
      Pick provider, model, and enter API key
      <br/><br/>
      <img src="https://github.com/user-attachments/assets/86dc7744-4908-4de0-8be1-fe746d7f92d0" alt="Onboarding step 2 — Configure AI provider" width="240"/>
    </td>
    <td align="center" width="33%">
      <strong>Step 3 — Ready!</strong><br/>
      Usage tips to get the most out of the plugin
      <br/><br/>
      <img src="https://github.com/user-attachments/assets/9bb8d68d-fd90-443d-b395-3dae5c8d9f15" alt="Onboarding step 3 — Ready to start" width="240"/>
    </td>
  </tr>
</table>

The onboarding is shown **only once** (on first install). It is dismissed either by completing all 3 steps or by clicking **Skip setup**. Settings entered in step 2 are immediately applied to the plugin — no need to re-enter them in the Settings panel. The onboarding can be re-triggered by clearing `localStorage` in the browser dev tools (key: `copilot_onboarding_done`).

---

## UI layout

The plugin UI is split into two distinct views:

### Main view (default)

| Area | Content |
|------|---------|
| **Header** | Brand logo, Context refresh button, Clear chat button, **Settings** button |
| **Info bar** | Connection dot (🟠 no key / 🟢 ready) + current provider · model label |
| **Agent bar** | Agent selector dropdown (includes custom agents loaded from Settings) + loaded agents/skills count |
| **Chat** | Scrollable conversation history |
| **Input** | Variants counter, prompt textarea, Generate button |

### Settings view (full-screen overlay)

Clicking the **Settings** button opens a full-screen overlay that completely covers the main view — preventing any accidental interaction with the chat while configuring the plugin.

| Section | Content |
|---------|---------|
| **Model Configuration** | Provider selector, Model selector, API key input with show/hide toggle |
| **Custom Agents & Skills** | Drag-and-drop zone for `copilot.json` files + loaded config summary |
| **Skills Library** | 28 bundled UX/design skills tags + Update (remote fetch) / Clear buttons |

The Settings overlay is closed with the **Close** button in its header. Any changes to provider/model/API key are reflected immediately in the info bar on the main page.

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
│  • Provider / agent / model / variant select │
│  • Routes requests to the selected provider  │
└──────┬─────────────────┬────────────────────┘
       │ GitHub Copilot  │ OpenAI / Anthropic
┌──────▼──────┐  ┌───────▼──────────────────────┐
│ Copilot API │  │  api.openai.com  /  api.anthro │
│ (proxy)     │  │  pic.com  (direct, BYOK)       │
└─────────────┘  └──────────────────────────────┘
```

The provider is selected in the **Provider** dropdown. Each provider has its own set of models and API key field. Keys are persisted per-provider in the plugin iframe's `localStorage` and never committed to source code.

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
├── providers/
│   ├── llm-provider.ts        # LLMProvider interface
│   ├── github-copilot-provider.ts  # GitHub Copilot proxy
│   ├── openai-provider.ts     # Direct OpenAI Chat Completions
│   └── anthropic-provider.ts  # Direct Anthropic Messages API
├── services/
│   ├── ai-service.ts          # Provider factory + AIService (orchestrator)
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
└── __tests__/                 # Jest unit tests (80 tests)
    ├── providers.test.ts      # Provider unit tests (NEW)
    └── …
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

This context is injected into every system prompt so the AI can reference existing components and colours.

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

## Authentication & BYOK

The plugin supports three providers, each with its own key:

### GitHub Copilot (default)

Uses a **GitHub Personal Access Token (classic)** with the `copilot` scope.

1. Go to **github.com → Settings → Developer settings → Personal access tokens → Tokens (classic)**.
2. Click **Generate new token (classic)**.
3. Select the **`copilot`** scope (under *GitHub Copilot*).
4. Copy the token (`ghp_…`) and paste it into the **GH Token** field in the plugin **Settings**.

> **Requirement:** A GitHub account with an active [GitHub Copilot subscription](https://github.com/features/copilot#pricing).

### OpenAI (BYOK)

Uses an **OpenAI API key** (`sk-…`).

1. Go to **platform.openai.com/api-keys**.
2. Click **Create new secret key**.
3. Copy the key and paste it into the **API Key** field when **OpenAI** is selected as the provider.

> Ensure your account has sufficient credits. Errors 401/429 are surfaced in the chat with a descriptive message.

### Anthropic (BYOK)

Uses an **Anthropic API key** (`sk-ant-…`).

1. Go to **console.anthropic.com → API Keys**.
2. Click **Create key**.
3. Copy the key and paste it into the **API Key** field when **Anthropic** is selected as the provider.

> Errors 401/429 are surfaced in the chat with a descriptive message.

**Security:** Keys are stored in `localStorage` within the plugin iframe. They are never committed to source code or sent to any endpoint other than the respective provider's official API.

---

## Available providers and models

### GitHub Copilot

| UI label | API model id | Best for |
|----------|-------------|----------|
| GPT-5.2 *(default)* | `gpt-5.2` | Fast, balanced UI generation |
| Claude Haiku 4.5 | `claude-haiku-4-5` | Lightweight, low-latency generation |
| Claude Sonnet 4.6 | `claude-sonnet-4-6` | Detailed, structured layouts |
| Gemini 3 Flash | `gemini-3-flash` | Speed-optimised multimodal generation |
| Gemini 3 Pro | `gemini-3-pro` | High-quality, reasoning-heavy design decisions |

### OpenAI

| UI label | API model id | Best for |
|----------|-------------|----------|
| GPT-4o | `gpt-4o` | Best overall reasoning + fast |
| GPT-4o mini | `gpt-4o-mini` | Fastest, most cost-effective |
| GPT-4 Turbo | `gpt-4-turbo` | High-quality generation |
| GPT-3.5 Turbo | `gpt-3.5-turbo` | Legacy, cheapest |

### Anthropic

| UI label | API model id | Best for |
|----------|-------------|----------|
| Claude Opus 4.5 | `claude-opus-4-5` | Best quality, complex layouts |
| Claude Sonnet 4.5 | `claude-sonnet-4-5` | Balanced quality/speed |
| Claude Haiku 4.5 | `claude-haiku-4-5` | Fast, cost-effective |

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
| `skills/generate-screen.ts` | Calls the AI once; returns one screen. Falls back to a placeholder if the response is empty. |
| `skills/generate-variants.ts` | Injects "generate N distinct variants (Variant A, B, C…)" into the prompt; returns N screens. Auto-labels screens that are missing the word "Variant". |
| `skills/apply-design-system.ts` | Pattern-matches element types against the design system component names and fills in the `component` field, enabling `figma-builder.ts` to use real Figma components. |

Skills call `aiService.generateScreens()`, which delegates to the configured provider via the `LLMProvider` interface. Switching providers requires no changes to skill code.

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
User selects Provider + Model + API Key
User types prompt → handleGenerate() in ui.ts
  │
  ├─ getModelConfig()    → { provider, model, openaiKey | anthropicKey | githubToken }
  ├─ getSelectedAgent()  → "ux-designer" | "design-system" | custom id
  ├─ agent.generate(prompt, variants, context, modelConfig, history)
  │     │
  │     ├─ generateScreen / generateVariants  (skill)
  │     │     └─ aiService.generateScreens()
  │     │           └─ createProvider(config)  → LLMProvider instance
  │     │                 └─ provider.chat(messages, modelId)
  │     │                       ├─ GitHubCopilotProvider → api.githubcopilot.com
  │     │                       ├─ OpenAIProvider        → api.openai.com
  │     │                       └─ AnthropicProvider     → api.anthropic.com
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
npm test                      # run all 80 tests
npm test -- --watch           # watch mode
npm test -- providers         # run provider suite only
npm test -- generate-screen   # run a single suite
```

The `providers.test.ts` suite specifically validates:
- `createProvider()` factory routes to the correct class.
- Each provider constructs the correct HTTP request (URL, headers, body shape).
- Error handling for missing keys and HTTP 401 / 429 responses.
- Anthropic's system-prompt separation logic.

---

## Key types quick reference

```ts
// src/types/ui-types.ts

type LLMProvider = "github-copilot" | "openai" | "anthropic";

type CopilotModel = "gpt-5.2" | "claude-haiku-4-5" | "claude-sonnet-4-6" | "gemini-3-flash" | "gemini-3-pro";
type OpenAIModel  = "gpt-4o" | "gpt-4o-mini" | "gpt-4-turbo" | "gpt-3.5-turbo";
type AnthropicModel = "claude-opus-4-5" | "claude-sonnet-4-5" | "claude-haiku-4-5";
type AIModel = CopilotModel | OpenAIModel | AnthropicModel;

interface ModelConfig {
  provider: LLMProvider;
  model: AIModel;
  githubToken?: string;  // GitHub PAT with 'copilot' scope
  openaiKey?: string;    // OpenAI API key (sk-…)
  anthropicKey?: string; // Anthropic API key (sk-ant-…)
}

type AgentType = "ux-designer" | "design-system";
type SkillType = "generate-screen" | "generate-variants" | "apply-design-system";

// Messages between iframe ↔ plugin sandbox
type UIToPluginMessage  = GetContextMessage | BuildScreensMessage;
type PluginToUIMessage  = ContextReadyMessage | ScreensBuiltMessage | ErrorMessage | NotifyMessage;
```
