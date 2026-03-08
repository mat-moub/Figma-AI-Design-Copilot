# Copilot Repository Instructions

## Project Overview

This repository is a **Figma plugin** that converts natural-language prompts into Figma frames using AI. The plugin reads the open document's design system (components, colors, text styles, existing screens), forwards that context to the selected AI provider, and generates coherent frames.

**Key capabilities:**
- Supports three AI providers: GitHub Copilot, OpenAI, and Anthropic
- Orchestrates work through **agents** (UX Designer, Design System, Custom) that compose **skills** (screen generation, variants, design system application)
- Bundles 28 UX/product-design frameworks for prompt enrichment
- Allows custom agents and skills via a drag-and-drop `copilot.json` file

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | TypeScript (ES2017 target, strict mode) |
| Plugin runtime | Figma Plugin API (`@figma/plugin-typings`) |
| Build tool | esbuild (`build.js`) |
| Testing | Jest + ts-jest |
| Linting | ESLint with `@typescript-eslint` (zero-warnings policy) |
| UI | Plain HTML + TypeScript (Figma iframe sandbox) |

## Directory Structure

```
src/
  main.ts                  # Figma plugin sandbox entry point (compiled → dist/code.js)
  ui.ts                    # Plugin iframe UI logic (compiled → dist/ui.js)
  types/ui-types.ts        # Shared TypeScript types for sandbox ↔ UI messaging
  providers/               # LLM provider implementations (one file per provider)
  services/                # Core services: AI orchestration, context engine, Figma builder
  agents/                  # Agent implementations (ux-designer, design-system, custom)
  skills/                  # Atomic work units composed by agents
  data/skills-library.ts   # 28 bundled UX frameworks
  __tests__/               # Jest unit tests (co-located test files)
build.js                   # esbuild build script
manifest.json              # Figma plugin manifest
ui.html                    # Plugin iframe HTML shell
```

## Setup & Build

```bash
npm install          # Install all dependencies
npm run build        # One-off production build → dist/
npm run watch        # Rebuild on file change (development)
npm run typecheck    # TypeScript type-check without emitting
npm run lint         # ESLint (zero warnings enforced)
npm test             # Run Jest unit tests
```

## Coding Standards

- **TypeScript strict mode** is enabled. Never use `any`; use explicit types or generics.
- **Zero ESLint warnings** — the lint script uses `--max-warnings 0`.
- **No external UI frameworks** — the UI iframe is plain TypeScript + DOM APIs (no React/Vue).
- **CommonJS modules** — esbuild targets CommonJS for Figma's plugin sandbox.
- **Provider interface** — all LLM providers must implement `LLMProvider` (`src/providers/llm-provider.ts`).
- **Skill interface** — all skills must follow the atomic-unit contract defined in the skills directory.
- **No secrets in source** — API keys and tokens are entered by the user at runtime in the plugin UI; never hard-code credentials.

## Testing Guidelines

- Tests live in `src/__tests__/` and use the `.test.ts` suffix.
- `main.ts` is intentionally excluded from tests (no Figma API mock available).
- Focus tests on pure TypeScript logic: provider factory routing, HTTP request construction, error handling (401, 429 responses), and Anthropic system-prompt logic.
- Run a single test suite: `npm test -- <suite-name>` (e.g., `npm test -- providers`).
- Do not add new test dependencies without updating `package.json` and `jest.config.json`.

## Important Patterns

- **Sandbox ↔ UI messaging** — use the typed message protocol defined in `src/types/ui-types.ts`; never send untyped `postMessage` payloads.
- **Context engine** — `src/services/context-engine.ts` extracts design-system context from the Figma document before forwarding to the AI provider. Changes here affect all agents.
- **Figma builder** — `src/services/figma-builder.ts` translates AI responses into Figma API calls. Keep builder logic free of AI/provider coupling.
- **Adding a provider** — create a new file in `src/providers/`, implement `LLMProvider`, and register it in the provider factory in `src/services/ai-service.ts`.
- **Adding an agent** — create a new file in `src/agents/`, and wire it into `main.ts`.
- **Adding a skill** — create a new file in `src/skills/` and export it from the skills index.
