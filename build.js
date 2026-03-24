// @ts-check
const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");
const isWatch = process.argv.includes("--watch");

const sharedConfig = {
  bundle: true,
  target: "es2017",
  logLevel: "info",
};

function emitBundledUiHtml() {
  const templatePath = path.join(__dirname, "src", "ui", "template.html");
  const stylesPath   = path.join(__dirname, "src", "ui", "styles.css");
  const iconsPath    = path.join(__dirname, "src", "ui", "icons.svg");
  const uiJsPath     = path.join(__dirname, "dist", "ui.js");
  const outPath      = path.join(__dirname, "dist", "ui.html");

  if (!fs.existsSync(templatePath) || !fs.existsSync(uiJsPath)) {
    return;
  }

  let html   = fs.readFileSync(templatePath, "utf8");
  const uiJs = fs.readFileSync(uiJsPath, "utf8");

  if (fs.existsSync(stylesPath)) {
    const css = fs.readFileSync(stylesPath, "utf8");
    html = html.replace("<!--{{STYLES}}-->", css);
  }

  if (fs.existsSync(iconsPath)) {
    const svg = fs.readFileSync(iconsPath, "utf8");
    html = html.replace("<!--{{ICONS}}-->", svg);
  }

  html = html.replace("<!--{{BUNDLE}}-->", `<script>\n${uiJs}\n</script>`);

  fs.writeFileSync(outPath, html, "utf8");
  console.log("[build] wrote dist/ui.html with inlined UI bundle");
}

const inlineUiHtmlPlugin = {
  name: "inline-ui-html-plugin",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;
      try {
        emitBundledUiHtml();
      } catch (err) {
        console.error("[build] failed to emit dist/ui.html", err);
      }
    });
  },
};

/** @type {esbuild.BuildOptions} */
const mainConfig = {
  ...sharedConfig,
  entryPoints: ["src/main.ts"],
  outfile: "dist/code.js",
  platform: "node",
};

/** @type {esbuild.BuildOptions} */
const uiConfig = {
  ...sharedConfig,
  entryPoints: ["src/ui/index.ts"],
  outfile: "dist/ui.js",
  platform: "browser",
  plugins: [inlineUiHtmlPlugin],
};

if (isWatch) {
  Promise.all([
    esbuild.context(mainConfig).then((ctx) => ctx.watch()),
    esbuild.context(uiConfig).then((ctx) => ctx.watch()),
  ]).catch(() => process.exit(1));
} else {
  Promise.all([
    esbuild.build(mainConfig),
    esbuild.build(uiConfig),
  ])
    .then(() => {
      emitBundledUiHtml();
    })
    .catch(() => process.exit(1));
}
