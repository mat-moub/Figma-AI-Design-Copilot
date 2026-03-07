// @ts-check
const esbuild = require("esbuild");
const isWatch = process.argv.includes("--watch");

const sharedConfig = {
  bundle: true,
  target: "es2017",
  logLevel: "info",
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
  ]).catch(() => process.exit(1));
}
