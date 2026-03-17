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
  const templatePath = path.join(__dirname, "ui.html");
  const uiJsPath = path.join(__dirname, "dist", "ui.js");
  const outPath = path.join(__dirname, "dist", "ui.html");

  if (!fs.existsSync(templatePath) || !fs.existsSync(uiJsPath)) {
    return;
  }

  const htmlTemplate = fs.readFileSync(templatePath, "utf8");
  const uiJs = fs.readFileSync(uiJsPath, "utf8");

  const scriptTagPattern = /<script[^>]*src=["']dist\/ui\.js["'][\s\S]*?<\/script>/i;
  let bundledHtml;

  if (scriptTagPattern.test(htmlTemplate)) {
    bundledHtml = htmlTemplate.replace(scriptTagPattern, `<script>\n${uiJs}\n</script>`);
  } else {
    bundledHtml = htmlTemplate.replace("</body>", `<script>\n${uiJs}\n</script>\n</body>`);
  }

  fs.writeFileSync(outPath, bundledHtml, "utf8");
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
  entryPoints: ["src/ui.ts"],
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
