#!/usr/bin/env python3
"""
Generate 420×640 plugin screenshots using Chromium headless.
- Plugin opens at 420×640 (see figma.showUI in src/main.ts)
- Renders at 420×900 to avoid cutting off bottom content
- Crops to 420×640 using Pillow
- Font Awesome loaded from local npm package
"""
import re
import subprocess
import tempfile
import os
from PIL import Image

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS_DIR = os.path.join(REPO, "screenshots")
FA_CSS = os.path.join(REPO, "node_modules/@fortawesome/fontawesome-free/css/all.min.css")
UI_HTML = os.path.join(REPO, "ui.html")

with open(UI_HTML, "r") as f:
    ui_src = f.read()

css_match = re.search(r"<style>(.*?)</style>", ui_src, re.DOTALL)
UI_CSS = css_match.group(1)

svg_match = re.search(
    r'(<svg xmlns="http://www\.w3\.org/2000/svg" style="display:none">.*?</svg>)',
    ui_src, re.DOTALL
)
SVG_DEFS = svg_match.group(1)
FA_LINK = f'<link rel="stylesheet" href="file://{FA_CSS}">'

RENDER_H = 640  # body is fixed to H px; no crop needed for most screenshots

# Target dimensions matching figma.showUI({ width: 420, height: 640 })
W = 420
H = 640

def make_html(body_html: str, extra_css: str = "") -> str:
    """Build a standalone HTML file for screenshot rendering."""
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  {FA_LINK}
  <style>
    {UI_CSS}
    /* ── Screenshot overrides ── */
    html {{ width: {W}px; height: {H}px; }}
    body {{
      width: {W}px;
      height: {H}px !important;
      overflow: hidden !important;
    }}
    {extra_css}
  </style>
</head>
<body>
  {SVG_DEFS}
  {body_html}
</body>
</html>"""


def screenshot(html: str, out_path: str, crop_h: int = H):
    """Render HTML to PNG using Chromium, then crop to crop_h pixels tall."""
    with tempfile.NamedTemporaryFile(suffix=".html", mode="w", delete=False, dir="/tmp") as f:
        f.write(html)
        tmp_html = f.name
    tmp_png = tmp_html.replace(".html", ".png")
    try:
        subprocess.run([
            "chromium",
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--run-all-compositor-stages-before-draw",
            f"--window-size={W},{H}",
            f"--screenshot={tmp_png}",
            f"file://{tmp_html}",
        ], capture_output=True, text=True, timeout=30)

        # Crop to target height if needed (e.g. for scrollable pages)
        img = Image.open(tmp_png)
        if img.size[1] > crop_h:
            img = img.crop((0, 0, W, crop_h))
        img.save(out_path)
    finally:
        for p in [tmp_html, tmp_png]:
            try: os.unlink(p)
            except: pass


# ── Shared elements ──────────────────────────────────────────────────────────

MAIN_HEADER = """
<header class="header">
  <div class="header__brand">
    <div class="header__icon">
      <svg class="icon icon-md" aria-hidden="true"><use href="#icon-sparkles"/></svg>
    </div>
    <div>
      <div class="header__title">AI Design Copilot</div>
      <div class="header__subtitle">Powered by LLM</div>
    </div>
  </div>
  <div class="header__actions">
    <button class="btn--header" type="button">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-refresh"/></svg>
      Context
    </button>
    <button class="btn--header" type="button">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-trash"/></svg>
    </button>
    <button class="btn--header" type="button">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-cog"/></svg>
      Settings
    </button>
  </div>
</header>"""

# The original .input-section has overflow:hidden, which makes its flex automatic
# minimum size 0 — causing the flex layout to collapse it. We fix this by setting
# an explicit min-height so the section gets its proper space.
MAIN_LAYOUT_CSS = """
.input-section { min-height: 190px !important; flex-shrink: 0 !important; }
"""

# ══════════════════════════════════════════════════════════════════════════════
# 1. onboarding-step-1.png — Welcome
# ══════════════════════════════════════════════════════════════════════════════
html = make_html("""
<div class="onboarding-overlay" style="display:flex; position:relative; inset:auto; width:420px; height:640px;">
  <div class="onboarding-header">
    <div class="onboarding-header__brand">
      <svg class="icon icon-md" aria-hidden="true"><use href="#icon-sparkles"/></svg>
      AI Design Copilot
    </div>
    <div class="onboarding-progress">
      <span class="onboarding-dot onboarding-dot--active"></span>
      <span class="onboarding-dot"></span>
      <span class="onboarding-dot"></span>
      <span class="onboarding-dot"></span>
    </div>
  </div>
  <div class="onboarding-body">
    <div class="onboarding-step">
      <div class="onboarding-icon" aria-hidden="true">✨</div>
      <h2 class="onboarding-title">Welcome to AI Design Copilot</h2>
      <p class="onboarding-desc">
        Generate Figma screens from natural language prompts using AI.
        Let's get you set up in 3 quick steps.
      </p>
      <ul class="onboarding-features">
        <li>🎨 Describe a screen and watch it appear in Figma</li>
        <li>💬 Ask design questions in <strong>Ask mode</strong> — no frame needed</li>
        <li>🤖 Supports GitHub Copilot, OpenAI, and Anthropic</li>
        <li>📐 Respects your design system's components and styles</li>
        <li>🔀 Generate multiple versions of a screen at once</li>
      </ul>
    </div>
  </div>
  <div class="onboarding-nav">
    <button class="btn btn--ghost" type="button">Skip setup</button>
    <div class="onboarding-nav__right">
      <button class="btn btn--primary" type="button">Next →</button>
    </div>
  </div>
</div>
""")
screenshot(html, os.path.join(SHOTS_DIR, "onboarding-step-1.png"))
print("✅ onboarding-step-1.png")

# ══════════════════════════════════════════════════════════════════════════════
# 2. onboarding-step-2.png — Configure Provider
# ══════════════════════════════════════════════════════════════════════════════
html = make_html("""
<div class="onboarding-overlay" style="display:flex; position:relative; inset:auto; width:420px; height:640px;">
  <div class="onboarding-header">
    <div class="onboarding-header__brand">
      <svg class="icon icon-md" aria-hidden="true"><use href="#icon-sparkles"/></svg>
      AI Design Copilot
    </div>
    <div class="onboarding-progress">
      <span class="onboarding-dot"></span>
      <span class="onboarding-dot onboarding-dot--active"></span>
      <span class="onboarding-dot"></span>
      <span class="onboarding-dot"></span>
    </div>
  </div>
  <div class="onboarding-body">
    <div class="onboarding-step">
      <h2 class="onboarding-title">Configure your AI provider</h2>
      <p class="onboarding-desc">
        Choose a provider and enter your API key. You can change this later in Settings.
      </p>
      <div class="onboarding-configure">
        <div class="settings__row">
          <label class="settings__label" for="ob-prov">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-link"/></svg>
            Provider
          </label>
          <div class="ob-provider-select-wrap" style="flex:1">
            <select id="ob-prov" style="flex:1;width:100%">
              <option selected>GitHub Copilot</option>
              <option>OpenAI</option>
              <option>Anthropic</option>
            </select>
          </div>
        </div>
        <div class="settings__row">
          <label class="settings__label" for="ob-mod">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chip"/></svg>
            Model
          </label>
          <select id="ob-mod" style="flex:1">
            <option>GPT-5.2</option>
          </select>
        </div>
        <div class="settings__row">
          <span class="settings__label">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-key"/></svg>
            GH Token
          </span>
          <div class="api-key-row">
            <input type="password" placeholder="ghp_… (copilot scope)" style="flex:1"/>
            <button class="btn btn--icon" type="button">
              <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-eye"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="ob-token-instructions" style="margin-top:10px">
        <div class="ob-inst-header">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-info"/></svg>
          GitHub Copilot — How to get your token
        </div>
        <ol>
          <li>Go to <strong>github.com</strong> → Settings → Developer settings →<br>Personal access tokens → Tokens (classic).</li>
          <li>Click <strong>Generate new token (classic)</strong>.</li>
          <li>Select the <strong>copilot</strong> scope (under GitHub Copilot).</li>
          <li>Copy the token (<code>ghp_…</code>) and paste it in the field above.</li>
        </ol>
        <p style="margin-top:6px;font-size:10px;color:var(--text-muted)">
          ⚠️ Requires an active <strong>GitHub Copilot</strong> subscription.
        </p>
      </div>
      <p class="onboarding-hint">🔒 Your key is stored locally and never shared.</p>
    </div>
  </div>
  <div class="onboarding-nav">
    <button class="btn btn--ghost" type="button">Skip setup</button>
    <div class="onboarding-nav__right">
      <button class="btn btn--ghost" type="button">← Back</button>
      <button class="btn btn--primary" type="button">Next →</button>
    </div>
  </div>
</div>
""")
screenshot(html, os.path.join(SHOTS_DIR, "onboarding-step-2.png"))
print("✅ onboarding-step-2.png")

# ══════════════════════════════════════════════════════════════════════════════
# 3. onboarding-step-3.png — Functional Context
# ══════════════════════════════════════════════════════════════════════════════
html = make_html("""
<div class="onboarding-overlay" style="display:flex; position:relative; inset:auto; width:420px; height:640px;">
  <div class="onboarding-header">
    <div class="onboarding-header__brand">
      <svg class="icon icon-md" aria-hidden="true"><use href="#icon-sparkles"/></svg>
      AI Design Copilot
    </div>
    <div class="onboarding-progress">
      <span class="onboarding-dot"></span>
      <span class="onboarding-dot"></span>
      <span class="onboarding-dot onboarding-dot--active"></span>
      <span class="onboarding-dot"></span>
    </div>
  </div>
  <div class="onboarding-body">
    <div class="onboarding-step">
      <h2 class="onboarding-title">
        Add your functional context
        <span class="onboarding-badge">Optional</span>
      </h2>
      <p class="onboarding-desc">
        Describe your product, industry, or target users. The AI will use this business context
        in every generation to produce screens that fit your application.
      </p>
      <div class="onboarding-configure">
        <div>
          <label for="ob-ctx" class="settings__label">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chat"/></svg>
            Functional context
          </label>
          <textarea id="ob-ctx" class="onboarding-textarea" spellcheck="false">We are building an application for... (describe your product, industry, or target users here). Generate screens that match our brand and workflows.</textarea>
        </div>
      </div>
      <p class="onboarding-hint">
        💡 This context will be automatically applied to all AI generations. You can update it
        anytime in <strong>Settings → Functional Context</strong>.
        Click <strong>Skip for now</strong> to start without it.
      </p>
    </div>
  </div>
  <div class="onboarding-nav">
    <button class="btn btn--ghost" type="button">Skip setup</button>
    <div class="onboarding-nav__right">
      <button class="btn btn--ghost" type="button">← Back</button>
      <button class="btn btn--primary" type="button">Next →</button>
    </div>
  </div>
</div>
""")
screenshot(html, os.path.join(SHOTS_DIR, "onboarding-step-3.png"))
print("✅ onboarding-step-3.png")

# ══════════════════════════════════════════════════════════════════════════════
# 4. onboarding-final.png — You're all set!
# ══════════════════════════════════════════════════════════════════════════════
html = make_html("""
<div class="onboarding-overlay" style="display:flex; position:relative; inset:auto; width:420px; height:640px;">
  <div class="onboarding-header">
    <div class="onboarding-header__brand">
      <svg class="icon icon-md" aria-hidden="true"><use href="#icon-sparkles"/></svg>
      AI Design Copilot
    </div>
    <div class="onboarding-progress">
      <span class="onboarding-dot"></span>
      <span class="onboarding-dot"></span>
      <span class="onboarding-dot"></span>
      <span class="onboarding-dot onboarding-dot--active"></span>
    </div>
  </div>
  <div class="onboarding-body">
    <div class="onboarding-step">
      <div class="onboarding-icon" aria-hidden="true">🚀</div>
      <h2 class="onboarding-title">You&#39;re all set!</h2>
      <p class="onboarding-desc">
        Start generating screens by typing a prompt below.
        Here are some tips to get the most out of the plugin.
      </p>
      <ul class="onboarding-tips">
        <li>
          <i class="fa-solid fa-wand-magic-sparkles" style="width:14px;color:var(--action)"></i>
          <strong>Generate mode</strong> — Describe a screen and watch it appear in Figma
        </li>
        <li>
          <i class="fa-solid fa-comments" style="width:14px;color:var(--primary)"></i>
          <strong>Ask mode</strong> — Ask design questions and get AI advice without creating frames
        </li>
        <li>
          <i class="fa-regular fa-clone" style="width:14px;color:var(--primary)"></i>
          <strong>Versions</strong> — Set a number to generate multiple versions at once
        </li>
        <li>
          <i class="fa-solid fa-palette" style="width:14px;color:var(--primary)"></i>
          <strong>Keep existing design system</strong> — Enforce your Figma components
        </li>
        <li>
          <i class="fa-solid fa-brain" style="width:14px;color:var(--primary)"></i>
          <strong>Advanced UX skills</strong> — Apply UX frameworks to generation
        </li>
        <li>
          <i class="fa-solid fa-rotate" style="width:14px;color:var(--primary)"></i>
          <strong>Context</strong> — Click &ldquo;Context&rdquo; so AI reads your Figma document
        </li>
        <li>
          <i class="fa-solid fa-gear" style="width:14px;color:var(--primary)"></i>
          <strong>Settings</strong> — Change provider, model, or functional context
        </li>
      </ul>
    </div>
  </div>
  <div class="onboarding-nav">
    <div class="onboarding-nav__right" style="width:100%">
      <button class="btn btn--primary" type="button" style="flex:1">Get started!</button>
    </div>
  </div>
</div>
""")
screenshot(html, os.path.join(SHOTS_DIR, "onboarding-final.png"))
print("✅ onboarding-final.png")

# ══════════════════════════════════════════════════════════════════════════════
# 5. main-view.png — Generate mode (empty state)
# ══════════════════════════════════════════════════════════════════════════════
html = make_html(
    MAIN_HEADER + """
<div class="chat-section">
  <div class="chat-section__label">
    <span class="section-title">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chat"/></svg>
      Chat
    </span>
    <span class="connection-badge">
      <span class="connection-dot connection-dot--ready"></span>
      GitHub Copilot &middot; GPT-5.2
    </span>
  </div>
  <div id="chat-history">
    <div class="chat-empty">
      <div class="chat-empty__icon">
        <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      </div>
      <p class="chat-empty__title">Start creating a screen</p>
      <p class="chat-empty__subtitle">Describe any UI screen and I&#39;ll design it<br>directly in your Figma file.</p>
    </div>
  </div>
</div>

<div class="resize-handle"></div>

<section class="input-section">
  <div class="mode-toggle" role="tablist">
    <button class="mode-tab mode-tab--active" role="tab" type="button">
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      Generate
    </button>
    <button class="mode-tab" role="tab" type="button">
      <i class="fa-solid fa-comments" aria-hidden="true"></i>
      Ask
    </button>
  </div>
  <textarea id="prompt-input" placeholder="Describe the screen you want to generate&#8230;"></textarea>
  <div class="options-bar" id="options-bar">
    <label class="checkbox-option">
      <input type="checkbox"/>
      <i class="fa-solid fa-palette" aria-hidden="true"></i>
      Design system
    </label>
    <label class="checkbox-option">
      <input type="checkbox"/>
      <i class="fa-solid fa-brain" aria-hidden="true"></i>
      Advanced UX skills
    </label>
    <label class="checkbox-option">
      <input type="checkbox"/>
      <i class="fa-regular fa-clone" aria-hidden="true"></i>
      Multiple versions
    </label>
  </div>
  <div class="input-bottom">
    <p class="hint">
      <i class="fa-solid fa-keyboard" aria-hidden="true"></i>
      Ctrl+Enter / &#8984;+Enter
    </p>
    <button class="btn btn--primary" type="button">
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      <span>Generate</span>
    </button>
  </div>
</section>
""",
    extra_css=MAIN_LAYOUT_CSS
)
screenshot(html, os.path.join(SHOTS_DIR, "main-view.png"))
print("✅ main-view.png")

# ══════════════════════════════════════════════════════════════════════════════
# 6. main-view-ask.png — Ask mode with conversation
# ══════════════════════════════════════════════════════════════════════════════
html = make_html(
    MAIN_HEADER + """
<div class="chat-section">
  <div class="chat-section__label">
    <span class="section-title">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chat"/></svg>
      Chat
    </span>
    <span class="connection-badge">
      <span class="connection-dot connection-dot--ready"></span>
      GitHub Copilot &middot; GPT-5.2
    </span>
  </div>
  <div id="chat-history">
    <div class="chat-bubble chat-bubble--user">
      <p class="chat-label">You</p>
      <p class="chat-text">What&#39;s the best navigation pattern for a mobile dashboard?</p>
    </div>
    <div class="chat-bubble chat-bubble--assistant">
      <p class="chat-label">
        <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-sparkles"/></svg>
        AI Copilot
      </p>
      <p class="chat-text">For a mobile dashboard, I&#39;d recommend a <strong>bottom tab bar</strong> with 4&#8211;5 primary sections. This pattern has the highest reach score on phones and aligns with platform conventions (iOS HIG, Material 3).</p>
    </div>
  </div>
</div>

<div class="resize-handle"></div>

<section class="input-section mode--ask">
  <div class="mode-toggle" role="tablist">
    <button class="mode-tab" role="tab" type="button">
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      Generate
    </button>
    <button class="mode-tab mode-tab--active" role="tab" type="button">
      <i class="fa-solid fa-comments" aria-hidden="true"></i>
      Ask
    </button>
  </div>
  <textarea id="prompt-input" placeholder="Ask a design question&#8230;"></textarea>
  <div class="input-bottom">
    <p class="hint">
      <i class="fa-solid fa-keyboard" aria-hidden="true"></i>
      Ctrl+Enter / &#8984;+Enter
    </p>
    <button class="btn btn--primary" type="button">
      <i class="fa-solid fa-comments" aria-hidden="true"></i>
      <span>Ask</span>
    </button>
  </div>
</section>
""",
    extra_css=MAIN_LAYOUT_CSS
)
screenshot(html, os.path.join(SHOTS_DIR, "main-view-ask.png"))
print("✅ main-view-ask.png")

# ══════════════════════════════════════════════════════════════════════════════
# 7. settings-view.png — Settings overlay
# ══════════════════════════════════════════════════════════════════════════════
html = make_html("""
<div class="settings-overlay" style="display:flex; position:relative; inset:auto; width:420px; min-height:640px;">
  <div class="settings-overlay__header">
    <div class="settings-overlay__title">
      <svg class="icon icon-md" aria-hidden="true"><use href="#icon-cog"/></svg>
      Settings
    </div>
    <button class="btn--header" type="button">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-xmark"/></svg>
      Close
    </button>
  </div>
  <div class="settings-overlay__body" style="overflow:visible">

    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chip"/></svg>
          Model Configuration
        </div>
      </div>
      <div class="settings__row">
        <label class="settings__label" for="s-prov">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-link"/></svg>
          Provider
        </label>
        <select id="s-prov" style="flex:1">
          <option selected>GitHub Copilot</option>
          <option>OpenAI</option>
          <option>Anthropic</option>
        </select>
      </div>
      <div class="settings__row">
        <label class="settings__label" for="s-mod">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chip"/></svg>
          Model
        </label>
        <select id="s-mod" style="flex:1">
          <option selected>GPT-5.2</option>
        </select>
      </div>
      <div class="settings__row">
        <span class="settings__label">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-key"/></svg>
          GH Token
        </span>
        <div class="api-key-row">
          <input type="password" value="ghp_xxxxxxxxxxxx" style="flex:1"/>
          <button class="btn btn--icon" type="button">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-eye"/></svg>
          </button>
        </div>
      </div>
      <p class="settings-key-hint">&#10003; GitHub Copilot &mdash; Token looks valid</p>
    </div>

    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chat"/></svg>
          Functional Context
        </div>
      </div>
      <p class="settings-hint" style="font-size:11px;color:var(--text-muted);margin:0 0 6px">
        Describe your product, industry, or target users. This context is automatically
        injected into every generation to produce more relevant screens.
      </p>
      <textarea class="functional-context-textarea" spellcheck="false">We are building a B2B SaaS for HR managers in mid-sized companies&#8230;</textarea>
    </div>

    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-puzzle"/></svg>
          Custom Skills
        </div>
        <div class="settings-section__actions">
          <button class="btn btn--ghost" type="button">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-xmark"/></svg>
            Clear
          </button>
        </div>
      </div>
      <div class="drop-zone">
        <p class="drop-zone__label">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-code"/></svg>
          Drop <strong>copilot.json</strong> or <strong>click to browse</strong>
        </p>
      </div>
      <p id="custom-config-summary">
        <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-info"/></svg>
        No custom config loaded.
      </p>
    </div>

    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-layers"/></svg>
          Skills Library
        </div>
        <div class="settings-section__actions">
          <button class="btn btn--ghost" type="button">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-refresh"/></svg>
            Update
          </button>
        </div>
      </div>
      <p>
        <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-check"/></svg>
        28 bundled skills active in all agents.
      </p>
      <div id="skills-library-list" style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px">
        <span class="skill-tag">UX Research</span>
        <span class="skill-tag">Accessibility</span>
        <span class="skill-tag">Mobile First</span>
        <span class="skill-tag">Design Patterns</span>
        <span class="skill-tag">Atomic Design</span>
        <span class="skill-tag">User Flows</span>
        <span class="skill-tag">Information Architecture</span>
        <span class="skill-tag">Gestalt Principles</span>
      </div>
    </div>
  </div>
</div>
""")
screenshot(html, os.path.join(SHOTS_DIR, "settings-view.png"))
print("✅ settings-view.png")

# ══════════════════════════════════════════════════════════════════════════════
# 8. chat-skill-chips.png — Chat with generation result and skill chips
# ══════════════════════════════════════════════════════════════════════════════
html = make_html(
    MAIN_HEADER + """
<div class="chat-section">
  <div class="chat-section__label">
    <span class="section-title">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chat"/></svg>
      Chat
    </span>
    <span class="connection-badge">
      <span class="connection-dot connection-dot--ready"></span>
      GitHub Copilot &middot; GPT-5.2
    </span>
  </div>
  <div id="chat-history">
    <div class="chat-bubble chat-bubble--user">
      <p class="chat-label">You</p>
      <p class="chat-text">Create a mobile login screen with email &amp; password fields</p>
    </div>
    <div class="chat-bubble chat-bubble--assistant">
      <p class="chat-label">
        <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-sparkles"/></svg>
        AI Copilot
      </p>
      <p class="chat-text">Generated <strong>1 screen</strong>: Login with email &amp; password &mdash; 8 elements, vertical layout.</p>
      <div class="chat-skills">
        <span class="chat-skill-tag">
          <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
          Generate Screen
        </span>
        <span class="chat-skill-tag">
          <i class="fa-solid fa-palette" aria-hidden="true"></i>
          Design System
        </span>
        <span class="chat-skill-tag">
          <i class="fa-solid fa-brain" aria-hidden="true"></i>
          Advanced UX
        </span>
      </div>
    </div>
    <div class="chat-bubble chat-bubble--user">
      <p class="chat-label">You</p>
      <p class="chat-text">Add a &ldquo;Forgot password?&rdquo; link and social login section</p>
    </div>
    <div class="chat-bubble chat-bubble--assistant">
      <p class="chat-label">
        <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-sparkles"/></svg>
        AI Copilot
      </p>
      <p class="chat-text">Updated the login screen with a forgot-password link and Google/Apple social buttons. The frame is now updated in your Figma file.</p>
      <div class="chat-skills">
        <span class="chat-skill-tag">
          <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
          Generate Screen
        </span>
        <span class="chat-skill-tag">
          <i class="fa-solid fa-palette" aria-hidden="true"></i>
          Design System
        </span>
      </div>
    </div>
  </div>
</div>

<div class="resize-handle"></div>

<section class="input-section">
  <div class="mode-toggle" role="tablist">
    <button class="mode-tab mode-tab--active" role="tab" type="button">
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      Generate
    </button>
    <button class="mode-tab" role="tab" type="button">
      <i class="fa-solid fa-comments" aria-hidden="true"></i>
      Ask
    </button>
  </div>
  <textarea id="prompt-input" placeholder="Describe the screen you want to generate&#8230;"></textarea>
  <div class="options-bar">
    <label class="checkbox-option">
      <input type="checkbox" checked/>
      <i class="fa-solid fa-palette" aria-hidden="true"></i>
      Design system
    </label>
    <label class="checkbox-option">
      <input type="checkbox"/>
      <i class="fa-solid fa-brain" aria-hidden="true"></i>
      Advanced UX skills
    </label>
    <label class="checkbox-option">
      <input type="checkbox"/>
      <i class="fa-regular fa-clone" aria-hidden="true"></i>
      Multiple versions
    </label>
  </div>
  <div class="input-bottom">
    <p class="hint">
      <i class="fa-solid fa-keyboard" aria-hidden="true"></i>
      Ctrl+Enter / &#8984;+Enter
    </p>
    <button class="btn btn--primary" type="button">
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      <span>Generate</span>
    </button>
  </div>
</section>
""",
    extra_css=MAIN_LAYOUT_CSS
)
screenshot(html, os.path.join(SHOTS_DIR, "chat-skill-chips.png"))
print("✅ chat-skill-chips.png")

# ══════════════════════════════════════════════════════════════════════════════
# 9. main-view-versions.png — Multiple versions enabled
# ══════════════════════════════════════════════════════════════════════════════
html = make_html(
    MAIN_HEADER + """
<div class="chat-section">
  <div class="chat-section__label">
    <span class="section-title">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chat"/></svg>
      Chat
    </span>
    <span class="connection-badge">
      <span class="connection-dot connection-dot--ready"></span>
      GitHub Copilot &middot; GPT-5.2
    </span>
  </div>
  <div id="chat-history">
    <div class="chat-empty">
      <div class="chat-empty__icon">
        <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      </div>
      <p class="chat-empty__title">Start creating a screen</p>
      <p class="chat-empty__subtitle">Multiple versions enabled &mdash; the AI will generate<br>3 variations of your screen side by side.</p>
    </div>
  </div>
</div>

<div class="resize-handle"></div>

<section class="input-section">
  <div class="mode-toggle" role="tablist">
    <button class="mode-tab mode-tab--active" role="tab" type="button">
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      Generate
    </button>
    <button class="mode-tab" role="tab" type="button">
      <i class="fa-solid fa-comments" aria-hidden="true"></i>
      Ask
    </button>
  </div>
  <textarea id="prompt-input" placeholder="Describe the screen you want to generate&#8230;"></textarea>
  <div class="options-bar">
    <label class="checkbox-option">
      <input type="checkbox"/>
      <i class="fa-solid fa-palette" aria-hidden="true"></i>
      Design system
    </label>
    <label class="checkbox-option">
      <input type="checkbox"/>
      <i class="fa-solid fa-brain" aria-hidden="true"></i>
      Advanced UX skills
    </label>
    <label class="checkbox-option">
      <input type="checkbox" checked/>
      <i class="fa-regular fa-clone" aria-hidden="true"></i>
      Multiple versions
    </label>
  </div>
  <div class="variants-row" id="variants-row">
    <label class="settings__label" for="variants-input">
      <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
      Versions
    </label>
    <input type="number" id="variants-input" value="3" min="1" max="5" style="width:52px"/>
    <span style="color:var(--text-muted);font-size:11px">(max 5)</span>
  </div>
  <div class="input-bottom">
    <p class="hint">
      <i class="fa-solid fa-keyboard" aria-hidden="true"></i>
      Ctrl+Enter / &#8984;+Enter
    </p>
    <button class="btn btn--primary" type="button">
      <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      <span>Generate 3 versions</span>
    </button>
  </div>
</section>
""",
    extra_css=MAIN_LAYOUT_CSS + """
/* Show variants row */
#variants-row { display: flex !important; }
"""
)
screenshot(html, os.path.join(SHOTS_DIR, "main-view-versions.png"))
print("✅ main-view-versions.png")

# ── Verify ───────────────────────────────────────────────────────────────────
print("\nDimension check:")
for f in sorted(os.listdir(SHOTS_DIR)):
    if f.endswith(".png"):
        img = Image.open(os.path.join(SHOTS_DIR, f))
        print(f"  {f}: {img.size}")
