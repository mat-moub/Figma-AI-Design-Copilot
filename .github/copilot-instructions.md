# Copilot Repository Instructions

## Project Overview

This repository is a **Figma plugin** that helps designers write better copy by generating AI-powered wording alternatives for selected text nodes. The plugin reads the selected text node, the surrounding Figma document context (design system, screens, page text), and forwards everything to the selected AI provider to produce contextually-aware copy suggestions that can be applied in one click.

**Key capabilities:**
- Supports four AI providers: Gemini (Google), OpenAI, Anthropic, and Mistral
- Generates N wording alternatives for any selected Figma text node
- Context-aware: reads design system, screen names, and surrounding text from the document
- `Ask` mode for free-form UX writing questions without modifying any node
- Named functional contexts: create multiple business contexts and switch between them

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
  ui/
    index.ts               # UI entry point — shared state, init, postMessage handler
    chat.ts                # Chat UI, generate/ask handlers, markdown renderer
    settings.ts            # Settings panel, provider config, onboarding
    context.ts             # Named functional contexts, Figma selection badge
    template.html          # HTML shell with placeholders (assembled by build.js)
    styles.css             # All CSS (injected into template at build time)
    icons.svg              # SVG sprite (injected into template at build time)
  types/ui-types.ts        # Shared TypeScript types for sandbox ↔ UI messaging
  providers/               # LLM provider implementations (one file per provider)
  services/                # Core services: AI orchestration, context engine
  agents/                  # Agent implementations (ux-writer-agent)
  utils/                   # Shared utilities (redact-secrets, etc.)
  __tests__/               # Jest unit tests (co-located test files)
build.js                   # esbuild build script
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
- **No secrets in source** — API keys and tokens are entered by the user at runtime in the plugin UI; never hard-code credentials.

## Testing Guidelines

- Tests live in `src/__tests__/` and use the `.test.ts` suffix.
- `main.ts` is intentionally excluded from tests (no Figma API mock available).
- Focus tests on pure TypeScript logic: provider factory routing, HTTP request construction, error handling (401, 429 responses), and response parsing.
- Run a single test suite: `npm test -- <suite-name>` (e.g., `npm test -- providers`).
- Do not add new test dependencies without updating `package.json` and `jest.config.json`.

## Important Patterns

- **Sandbox ↔ UI messaging** — use the typed message protocol defined in `src/types/ui-types.ts`; never send untyped `postMessage` payloads.
- **Context engine** — `src/services/context-engine.ts` extracts design-system context and the currently selected text node from the Figma document before forwarding to the AI provider. Changes here affect all generation.
- **apply-text flow** — when the user clicks "Apply" in the UI, an `ApplyTextMessage` is posted to the sandbox (`main.ts`), which loads fonts and writes the new text into the selected `TextNode`.
- **Adding a provider** — create a new file in `src/providers/`, implement `LLMProvider`, and register it in the provider factory in `src/services/ai-service.ts`.
- **Adding an agent** — create a new file in `src/agents/` and wire it into `src/ui/chat.ts`.
- **Functional contexts** — users create named contexts in Settings; the active context content is injected into the AI system prompt. Contexts are stored in `localStorage` under `copilot_contexts` (JSON array) and `copilot_active_context_id`.

---

## Updating README Screenshots

Screenshots live in `screenshots/` and are referenced by the README. They are **420 × 640 px PNG** files named after the step they represent:

| File | Step |
|------|------|
| `onboarding-step-1.png` | Step 1 — Welcome |
| `onboarding-step-2.png` | Step 2 — Configure provider |
| `onboarding-step-3.png` | Step 3 — Functional context |
| `onboarding-final.png` | Final — You're all set! |
| `main-view.png` | Main plugin view (Generate mode) |
| `main-view-ask.png` | Main plugin view (Ask mode) |
| `settings-view.png` | Settings panel |

### Sandbox constraints

In the CI/coding-agent sandbox the following are **unavailable**:
- The Playwright agent browser cannot connect to `localhost` — local HTTP servers are unreachable.
- External CDNs (cdnjs, fonts.googleapis.com …) are blocked.
- The actual Figma desktop app is not running.

However, **Chromium is pre-installed** at `/usr/bin/chromium` and the
`@fortawesome/fontawesome-free` npm package is in `devDependencies`.
These two together enable pixel-perfect, Font-Awesome–aware screenshots.

### Procedure

1. **Ensure the npm package is installed** (run `npm install` if `node_modules/` is missing):

   ```bash
   npm install
   pip install Pillow   # needed only for the final crop step
   ```

2. **Run `scripts/gen-screenshots.py`** — it renders each HTML snapshot
   through Chromium headless (at 420 × 900) then crops to 420 × 640:

   ```bash
   python3 scripts/gen-screenshots.py
   ```

3. **Verify dimensions** with:

   ```bash
   python3 -c "
   from PIL import Image, os
   for f in os.listdir('screenshots'):
       if f.endswith('.png'):
           print(f, Image.open('screenshots/' + f).size)
   "
   ```

4. **Commit** the updated PNGs via `report_progress`.

### How `scripts/gen-screenshots.py` works

The script uses three ingredients:

1. **Chromium headless** (`/usr/bin/chromium`) — renders HTML at 420 × 900 px  
2. **Local Font Awesome** from `node_modules/@fortawesome/fontawesome-free/css/all.min.css`  
   loaded via `file://` URL so icon fonts work without internet  
3. **Pillow** — crops the 420 × 900 render down to 420 × 640

Each screenshot is built by:
- Extracting the `<style>` block and `<svg>` symbol defs from `src/ui/styles.css` and `src/ui/icons.svg`
- Wrapping a hand-crafted HTML body (replicating the desired UI state) in that CSS
- Running `chromium --headless=new --screenshot --window-size=420,900 file://…`
- Cropping to 420 × 640

### Adding or updating a screenshot

1. Open `scripts/gen-screenshots.py`.
2. Find or add a section for the screenshot you want to change.
3. Edit the HTML body to match the desired UI state, using the same class names as `src/ui/template.html`.
4. Re-run `python3 scripts/gen-screenshots.py` and commit.
