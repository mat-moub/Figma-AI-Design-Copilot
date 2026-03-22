#!/usr/bin/env python3
"""
Generate 420×640 plugin screenshots using Chromium headless.
- Plugin opens at 420×720 (see figma.showUI in src/main.ts)
- Renders at 420×900 to avoid cutting off bottom content
- Crops to 420×640 using Pillow
- Font Awesome loaded from local npm package
"""
import re
import subprocess
import tempfile
import os
import sys
import io
from PIL import Image

# Force UTF-8 output on Windows to avoid emoji encode errors
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHOTS_DIR = os.path.join(REPO, "screenshots")
FA_CSS = os.path.join(REPO, "node_modules/@fortawesome/fontawesome-free/css/all.min.css")
UI_HTML = os.path.join(REPO, "ui.html")

# ── Locate Chrome / Chromium executable ──────────────────────────────────────
def _find_chrome() -> str:
    candidates = [
        # Windows — Chrome stable
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        # Windows — Chromium
        r"C:\Program Files\Chromium\Application\chrome.exe",
        # macOS
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        # Linux
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome",
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    # Last resort: PATH
    import shutil
    for name in ("chromium", "chromium-browser", "google-chrome", "chrome"):
        found = shutil.which(name)
        if found:
            return found
    print("ERROR: Could not find Chrome/Chromium. Install Chrome and try again.", file=sys.stderr)
    sys.exit(1)

CHROME = _find_chrome()
print(f"Using browser: {CHROME}")

# Temp dir: use system temp (works on Windows, macOS, Linux)
TMP_DIR = tempfile.gettempdir()

with open(UI_HTML, "r", encoding="utf-8") as f:
    ui_src = f.read()

css_match = re.search(r"<style>(.*?)</style>", ui_src, re.DOTALL)
UI_CSS = css_match.group(1)

svg_match = re.search(
    r'(<svg xmlns="http://www\.w3\.org/2000/svg" style="display:none">.*?</svg>)',
    ui_src, re.DOTALL
)
SVG_DEFS = svg_match.group(1)
FA_LINK = f'<link rel="stylesheet" href="file://{FA_CSS}">'

RENDER_H = 900  # render taller than H so nothing gets clipped by viewport

# Screenshot crop size for README assets (fixed)
W = 420
H = 640

def make_html(body_html: str, extra_css: str = "") -> str:
    """Build a standalone HTML file for screenshot rendering."""
    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  {FA_LINK}
  <style>
    {UI_CSS}
    /* ── Screenshot overrides ── */
    html {{ width: {W}px; }}
    body {{
      width: {W}px;
      height: auto !important;
      min-height: {RENDER_H}px;
      overflow: visible !important;
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
    """Render HTML to PNG using Chrome headless, then crop to crop_h pixels tall."""
    with tempfile.NamedTemporaryFile(suffix=".html", mode="w", encoding="utf-8",
                                     delete=False, dir=TMP_DIR) as f:
        f.write(html)
        tmp_html = f.name
    tmp_png = tmp_html.replace(".html", ".png")
    try:
        result = subprocess.run([
            CHROME,
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--run-all-compositor-stages-before-draw",
            f"--window-size={W},{RENDER_H}",
            f"--screenshot={tmp_png}",
            f"file:///{tmp_html.replace(os.sep, '/')}",
        ], capture_output=True, text=True, timeout=90)
        if result.returncode != 0:
            print(f"  [chrome stderr] {result.stderr[:400]}", file=sys.stderr)

        # Crop to target height
        img = Image.open(tmp_png)
        cropped = img.crop((0, 0, W, crop_h))
        cropped.save(out_path)
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
      <div class="header__title">UX Writer Copilot</div>
      <div class="header__subtitle">Powered by LLM</div>
    </div>
  </div>
  <div class="header__actions">
    <button class="btn--header" type="button">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-cog"/></svg>
      Settings
    </button>
  </div>
</header>"""

CHAT_LABEL_EMPTY = """
  <div class="chat-section__label">
    <span class="section-title">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chat"/></svg>
      Chat
    </span>
    <button class="btn--new-convo" type="button">
      <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-refresh"/></svg>
    </button>
    <span class="connection-badge">
      <span class="connection-dot connection-dot--ready"></span>
      Gemini &middot; Flash Lite
    </span>
  </div>"""

# For main-view pages: pin the chat-section to a fixed height so the input-section
# below it gets its natural height (~200 px) and both fit within the 640 px crop.
# Header ~50px + chat 380px + resize 5px + input ~205px = ~640px total.
MAIN_LAYOUT_CSS = """
body { display: flex; flex-direction: column; }
.chat-section { flex: 0 0 380px !important; height: 380px !important; overflow: hidden; }
.resize-handle { height: 5px; flex-shrink: 0; }
.input-section { flex-shrink: 0; overflow: hidden; }
"""

# ══════════════════════════════════════════════════════════════════════════════
# 1. onboarding-step-1.png — Welcome
# ══════════════════════════════════════════════════════════════════════════════
html = make_html("""
<div class="onboarding-overlay" style="display:flex; position:relative; inset:auto; width:420px; height:640px;">
  <div class="onboarding-header">
    <div class="onboarding-header__brand">
      <svg class="icon icon-md" aria-hidden="true"><use href="#icon-sparkles"/></svg>
      UX Writer Copilot
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
      <h2 class="onboarding-title">Welcome to UX Writer Copilot</h2>
      <p class="onboarding-desc">
        Generate wording alternatives for any text node in Figma using AI.
        Let&#39;s get you set up in 3 quick steps.
      </p>
      <ul class="onboarding-features">
        <li>✍️ Select any text node and get AI-powered wording suggestions</li>
        <li>💬 Ask UX writing questions in <strong>Ask mode</strong> — no edits needed</li>
        <li>🎯 Context-aware: AI reads your Figma layout for better copy</li>
        <li>🔁 Generate multiple alternatives at once and apply with one click</li>
        <li>🤖 Supports Gemini, OpenAI, and Anthropic</li>
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
      UX Writer Copilot
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
              <option selected>Gemini (Google)</option>
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
            <option>Gemini 3.1 Flash Lite</option>
          </select>
        </div>
        <div class="settings__row">
          <span class="settings__label">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-key"/></svg>
            API Key
          </span>
          <div class="api-key-row">
            <input type="password" placeholder="AIza… (Google AI Studio key)" style="flex:1"/>
            <button class="btn btn--icon" type="button">
              <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-eye"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="ob-token-instructions" style="margin-top:10px">
        <div class="ob-inst-header">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-info"/></svg>
          Gemini (Google) — How to get your API key
        </div>
        <ol>
          <li>Go to <strong>aistudio.google.com</strong> → Get API key.</li>
          <li>Click <strong>Create API key</strong> and select or create a project.</li>
          <li>Copy the key (<code>AIza…</code>) and paste it in the field above.</li>
        </ol>
        <p style="margin-top:6px;font-size:10px;color:var(--text-muted)">
          Free tier available. No credit card required to start.
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
      UX Writer Copilot
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
        in every generation to produce copy that fits your application&#39;s voice and audience.
      </p>
      <div class="onboarding-configure">
        <div>
          <label for="ob-ctx" class="settings__label">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chat"/></svg>
            Functional context
          </label>
          <textarea id="ob-ctx" class="onboarding-textarea" spellcheck="false">We are building an application for... (describe your product, industry, or target users here). Generate copy that matches our brand voice and workflows.</textarea>
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
      UX Writer Copilot
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
        Start improving your copy by selecting a text node in Figma and typing a prompt.
        Here are some tips to get the most out of the plugin.
      </p>
      <ul class="onboarding-tips">
        <li>
          <i class="fa-solid fa-pen-nib" style="width:14px;color:var(--action)"></i>
          <strong>Generate mode</strong> — Select a text node, describe the wording you want, and get alternatives
        </li>
        <li>
          <i class="fa-solid fa-comments" style="width:14px;color:var(--primary)"></i>
          <strong>Ask mode</strong> — Ask UX writing questions and get AI advice without modifying anything
        </li>
        <li>
          <i class="fa-solid fa-list-ol" style="width:14px;color:var(--primary)"></i>
          <strong>Alternatives</strong> — Set a number to generate multiple copy options at once
        </li>
        <li>
          <i class="fa-solid fa-check" style="width:14px;color:var(--primary)"></i>
          <strong>Apply</strong> — Click &ldquo;Apply&rdquo; on any alternative to write it directly into the text node
        </li>
        <li>
          <i class="fa-solid fa-rotate" style="width:14px;color:var(--primary)"></i>
          <strong>Context</strong> — Click &ldquo;Context&rdquo; so AI reads your Figma document for better suggestions
        </li>
        <li>
          <i class="fa-solid fa-gear" style="width:14px;color:var(--primary)"></i>
          <strong>Settings</strong> — Change provider, model, or functional context
        </li>
      </ul>
    </div>
  </div>
  <div class="onboarding-nav">
    <div class="onboarding-nav__right">
      <button class="btn btn--primary" id="ob-next-btn" type="button">Get started 🚀</button>
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
""" + CHAT_LABEL_EMPTY + """
  <div id="chat-history">
    <div class="chat-empty">
      <div class="chat-empty__icon">
        <i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>
      </div>
      <p class="chat-empty__title">Select a text node to start</p>
      <p class="chat-empty__subtitle">Select any text in Figma, then describe<br>what you want &mdash; I&#39;ll suggest alternatives.</p>
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
  <textarea id="prompt-input" placeholder="Describe the wording you want &mdash; tone, audience, context&#8230;"></textarea>
  <div class="options-bar" id="options-bar">
    <label class="settings__label" for="alternatives-count-input">
      <i class="fa-solid fa-list" aria-hidden="true"></i>
      Alternatives
    </label>
    <input type="number" id="alternatives-count-input" value="3" min="1" max="10" style="width:52px"/>
    <span style="color:var(--text-muted);font-size:11px">(1&ndash;10)</span>
  </div>
  <div class="input-bottom">
    <p class="hint">
      <i class="fa-solid fa-keyboard" aria-hidden="true"></i>
      Enter &nbsp;&middot;&nbsp; Shift+Enter for newline
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
""" + CHAT_LABEL_EMPTY + """
  <div id="chat-history">
    <div class="chat-bubble chat-bubble--user">
      <p class="chat-label">You</p>
      <p class="chat-text">What&#39;s the difference between microcopy and UX writing?</p>
    </div>
    <div class="chat-bubble chat-bubble--assistant">
      <p class="chat-label">
        <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-sparkles"/></svg>
        UX Writer
      </p>
      <p class="chat-text"><strong>Microcopy</strong> refers to small, functional snippets of text — button labels, error messages, tooltips, and empty states. <strong>UX writing</strong> is the broader discipline that encompasses microcopy plus the overall voice, tone, and content strategy throughout a product.</p>
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
  <textarea id="prompt-input" placeholder="Ask a UX writing question&#8230;"></textarea>
  <div class="input-bottom">
    <p class="hint">
      <i class="fa-solid fa-keyboard" aria-hidden="true"></i>
      Enter &nbsp;&middot;&nbsp; Shift+Enter for newline
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
# 7. settings-view.png — Settings overlay (no Skills Library section)
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
          <option selected>Gemini (Google)</option>
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
          <option selected>Gemini 3.1 Flash Lite</option>
          <option>Gemini 3 Pro</option>
        </select>
      </div>
      <div class="settings__row">
        <span class="settings__label">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-key"/></svg>
          API Key
        </span>
        <div class="api-key-row">
          <input type="password" value="AIza_xxxxxxxxxxxx" style="flex:1"/>
          <button class="btn btn--icon" type="button">
            <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-eye"/></svg>
          </button>
        </div>
      </div>
      <p class="settings-key-hint">&#10003; Gemini &mdash; Key looks valid</p>
      <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
        <button class="btn btn--secondary" type="button">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-link"/></svg>
          <span>Test connection</span>
        </button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-section__header">
        <div class="settings-section__title">
          <svg class="icon icon-sm" aria-hidden="true"><use href="#icon-chat"/></svg>
          Functional Context
        </div>
      </div>
      <p class="settings-hint" style="font-size:11px;color:var(--text-muted);margin:0 0 6px">
        Describe your product, industry, target users, or tone of voice. This context is automatically
        injected into every generation to produce more relevant copy.
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
          <i class="fa-solid fa-palette" aria-hidden="true" style="font-size:11px"></i>
          Appearance
        </div>
      </div>
      <div class="settings__row">
        <span class="settings__label">
          <i class="fa-solid fa-circle-half-stroke" aria-hidden="true" style="font-size:11px"></i>
          Theme
        </span>
        <div class="theme-switch-row">
          <span class="theme-switch-label" id="theme-label-light">
            <i class="fa-solid fa-sun" aria-hidden="true"></i> Light
          </span>
          <label class="theme-switch" title="Toggle dark / light theme">
            <input type="checkbox" id="theme-toggle" checked />
            <span class="theme-switch__track">
              <span class="theme-switch__thumb"></span>
            </span>
          </label>
          <span class="theme-switch-label theme-switch-label--active" id="theme-label-dark">
            <i class="fa-solid fa-moon" aria-hidden="true"></i> Dark
          </span>
        </div>
      </div>
    </div>

  </div>
</div>
""")
screenshot(html, os.path.join(SHOTS_DIR, "settings-view.png"))
print("✅ settings-view.png")

# ── Verify ───────────────────────────────────────────────────────────────────
print("\nDimension check:")
for f in sorted(os.listdir(SHOTS_DIR)):
    if f.endswith(".png"):
        img = Image.open(os.path.join(SHOTS_DIR, f))
        print(f"  {f}: {img.size}")
