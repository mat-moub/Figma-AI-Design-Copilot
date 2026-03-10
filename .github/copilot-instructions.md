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
| `main-view-versions.png` | Main plugin view (Multiple versions) |
| `chat-skill-chips.png` | Chat with skill chip tags |
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
- Extracting the `<style>` block and `<svg>` symbol defs straight from `ui.html`
- Wrapping a hand-crafted HTML body (replicating the desired UI state) in that CSS
- Running `chromium --headless=new --screenshot --window-size=420,900 file://…`
- Cropping to 420 × 640

### Adding or updating a screenshot

1. Open `scripts/gen-screenshots.py`.
2. Find or add a section for the screenshot you want to change.
3. Edit the HTML body to match the desired UI state, using the same class names as `ui.html`.
4. Re-run `python3 scripts/gen-screenshots.py` and commit.

### Key patterns

```python
import re, subprocess, tempfile, os
from PIL import Image

FA_CSS = "node_modules/@fortawesome/fontawesome-free/css/all.min.css"

with open("ui.html") as f:
    src = f.read()

UI_CSS = re.search(r"<style>(.*?)</style>", src, re.DOTALL).group(1)
SVG_DEFS = re.search(
    r'(<svg xmlns="http://www\.w3\.org/2000/svg" style="display:none">.*?</svg>)',
    src, re.DOTALL
).group(1)

def render(body_html, out_path, crop_h=640):
    html = f\"\"\"<!DOCTYPE html><html><head>
      <link rel=\"stylesheet\" href=\"file://{os.path.abspath(FA_CSS)}\">
      <style>{UI_CSS} html{{width:420px}} body{{width:420px;height:auto;min-height:900px;overflow:visible}}</style>
    </head><body>{SVG_DEFS}{body_html}</body></html>\"\"\"
    with tempfile.NamedTemporaryFile(suffix=".html", mode="w", delete=False) as f:
        f.write(html); tmp = f.name
    tmp_png = tmp.replace(".html", ".png")
    subprocess.run(["chromium", "--headless=new", "--no-sandbox",
                    "--disable-gpu", "--window-size=420,900",
                    f"--screenshot={tmp_png}", f"file://{tmp}"], check=True)
    Image.open(tmp_png).crop((0, 0, 420, crop_h)).save(out_path)
    for p in [tmp, tmp_png]: os.unlink(p)

# Usage — write HTML using exact ui.html class names so CSS applies unchanged:
render(\"\"\"
<section class=\"input-section\">
  <div class=\"mode-toggle\">
    <button class=\"mode-tab mode-tab--active\">
      <i class=\"fa-solid fa-wand-magic-sparkles\"></i> Generate
    </button>
  </div>
  <!-- ... rest of UI ... -->
</section>
\"\"\", "screenshots/my-screenshot.png")
```
