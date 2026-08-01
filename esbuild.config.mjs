import esbuild from "esbuild";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const production = process.argv.includes("production");
const root = dirname(fileURLToPath(import.meta.url));
const context = await esbuild.context({
  absWorkingDir: root,
  banner: { js: "/* Import Doctor */" },
  entryPoints: [resolve(root, "src", "main.ts")],
  bundle: true,
  external: ["obsidian", "electron"],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  minify: production,
  outfile: resolve(root, "main.js")
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
