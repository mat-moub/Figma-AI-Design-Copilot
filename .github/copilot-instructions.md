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

Screenshots live in `screenshots/` and are referenced by the README. They are **380 × 600 px PNG** files named after the step they represent:

| File | Step |
|------|------|
| `onboarding-step-1.png` | Step 1 — Welcome |
| `onboarding-step-2.png` | Step 2 — Configure provider |
| `onboarding-step-3.png` | Step 3 — Functional context |
| `onboarding-final.png` | Final — You're all set! |
| `main-view.png` | Main plugin view |
| `settings-view.png` | Settings panel |

### Sandbox constraints

In the CI/coding-agent sandbox the following are **unavailable**:
- The browser (Playwright) cannot connect to `localhost` — local HTTP servers are unreachable.
- External CDNs (cdnjs, fonts.googleapis.com …) are blocked.
- `puppeteer` / `playwright` Node packages are not installed.
- The actual Figma desktop app is not running.

As a result, screenshots must be generated **programmatically with Python + Pillow**.

### Procedure

1. **Install Pillow** (already available in the sandbox after the first `pip install`):

   ```bash
   pip install Pillow
   ```

2. **Run the generation script** (see template below), writing the output PNG directly to `screenshots/`.

3. **Verify dimensions** with:

   ```bash
   python3 -c "
   from PIL import Image
   img = Image.open('screenshots/onboarding-step-2.png')
   print(img.size)   # should be (380, 600)
   "
   ```

4. **Commit** the updated PNG via `report_progress`.

### Python screenshot template

The script below renders a faithful approximation of the plugin's onboarding step 2 using only Pillow. Adapt colors, layout, and text to match any future UI changes.

```python
from PIL import Image, ImageDraw, ImageFont

# ── Palette (mirrors ui.html CSS variables) ────────────────────────
BG          = (240, 242, 248)   # --bg
SURFACE     = (255, 255, 255)   # --surface
BORDER      = (212, 216, 232)   # --border
PRIMARY     = ( 30,  48, 112)   # --primary
TEXT        = ( 26,  29,  46)   # --text
TEXT_MUTED  = (107, 114, 128)   # --text-muted

W, H = 380, 600
img  = Image.new("RGB", (W, H), BG)
draw = ImageDraw.Draw(img)

# Load system fonts (DejaVu ships with most Linux distros)
def _font(bold=False, size=11):
    name = "DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"
    try:
        return ImageFont.truetype(f"/usr/share/fonts/truetype/dejavu/{name}", size)
    except OSError:
        return ImageFont.load_default()

font_sm      = _font(size=9)
font_sm_bold = _font(bold=True, size=9)
font_reg     = _font(size=11)
font_bold    = _font(bold=True, size=11)
font_title   = _font(bold=True, size=14)
font_header  = _font(bold=True, size=12)

def rrect(draw, xy, r, fill, outline=None, lw=1):
    draw.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=lw)

# ── Header bar ────────────────────────────────────────────────────
draw.rectangle([0, 0, W, 38], fill=PRIMARY)
draw.text((14, 12), "✨  AI Design Copilot", fill=(255, 255, 255), font=font_header)
# Progress dots  (dot 2 active = provider step)
for i, active in enumerate([False, True, False, False]):
    x = W - 70 + i * 16
    draw.ellipse([x-3, 16, x+3, 22],
                 fill=(255, 255, 255) if active else (180, 190, 220))

# ── Title + description ───────────────────────────────────────────
Y = 38
draw.text((W//2, Y + 20), "Configure your AI provider",
          fill=TEXT, font=font_title, anchor="mm")
draw.text((W//2, Y + 41), "Choose a provider and enter your API key.",
          fill=TEXT_MUTED, font=font_sm, anchor="mm")
draw.text((W//2, Y + 54), "You can change this later in Settings.",
          fill=TEXT_MUTED, font=font_sm, anchor="mm")

# ── Configure box (provider / model / key rows) ───────────────────
BX, BY, BW = 14, Y + 70, W - 28
rrect(draw, [BX, BY, BX + BW, BY + 120], 10, SURFACE, BORDER)
PX, PY, LW = BX + 12, BY + 10, 65
IX = PX + LW + 10   # input/select start-x

for row_offset, label, value in [
    (4,  "⬡ Provider", "GitHub Copilot"),
    (40, "⬢ Model",    "GPT-5.2"),
    (76, "⬡ GH Token", "ghp_… (copilot scope)"),
]:
    ry = PY + row_offset
    draw.text((PX, ry + 2), label, fill=TEXT_MUTED, font=font_sm)
    rrect(draw, [IX, ry - 2, BX + BW - 12, ry + 18], 5, BG, BORDER)
    color = TEXT if row_offset < 70 else TEXT_MUTED
    draw.text((IX + 6, ry + 2), value, fill=color, font=font_sm)
    if row_offset < 70:   # dropdowns get a chevron
        draw.text((BX + BW - 22, ry + 2), "▾", fill=TEXT_MUTED, font=font_sm)

# ── Instructions box ──────────────────────────────────────────────
IY = BY + 130
rrect(draw, [BX, IY, BX + BW, IY + 170], 10, SURFACE, BORDER)
IPX, IPY = BX + 14, IY + 12
draw.text((IPX, IPY), "GitHub Copilot — How to get your token",
          fill=PRIMARY, font=font_sm_bold)
steps = [
    "1. Go to github.com → Settings → Developer settings →",
    "   Personal access tokens → Tokens (classic).",
    "2. Click Generate new token (classic).",
    "3. Select the copilot scope (under GitHub Copilot).",
    "4. Copy the token (ghp_…) and paste it in the field above.",
]
sy = IPY + 18
for s in steps:
    draw.text((IPX, sy), s, fill=TEXT_MUTED, font=font_sm)
    sy += 13
draw.text((IPX, sy + 4),
          "⚠️  Requires an active GitHub Copilot subscription.",
          fill=TEXT_MUTED, font=font_sm)

# ── Security hint ─────────────────────────────────────────────────
draw.text((W//2, IY + 183),
          "🔒 Your key is stored locally and never shared.",
          fill=TEXT_MUTED, font=font_sm, anchor="mm")

# ── Bottom nav ────────────────────────────────────────────────────
NY = H - 52
draw.rectangle([0, NY, W, H], fill=SURFACE)
draw.line([0, NY, W, NY], fill=BORDER, width=1)
rrect(draw, [14, NY + 12, 100, NY + 34], 6, BG, BORDER)
draw.text((57, NY + 23), "← Back", fill=TEXT_MUTED, font=font_sm, anchor="mm")
rrect(draw, [W - 110, NY + 12, W - 14, NY + 34], 6, PRIMARY)
draw.text((W - 62, NY + 23), "Next →", fill=(255, 255, 255),
          font=font_sm_bold, anchor="mm")

img.save("screenshots/onboarding-step-2.png")
print("✅  screenshots/onboarding-step-2.png written (380×600)")
```

> **Tip:** Duplicate and adapt this script for other steps (`onboarding-step-3.png`, `main-view.png`, …), keeping the same 380 × 600 canvas and color palette.
