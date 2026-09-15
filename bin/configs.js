import * as esbuild from "esbuild";

export const ctxESM = await esbuild.context({
  entryPoints: ["index.js"],
  bundle: true,
  outfile: "dist/adressevaelger.esm.js",
  format: "esm",
  minify: true,
  keepNames: true,
});

export const ctxIIFE = await esbuild.context({
  entryPoints: ["index.js"],
  bundle: true,
  outfile: "dist/adressevaelger.iife.js",
  globalName: "adressevaelger",
  format: "iife",
  minify: true,
  keepNames: true,
});

export const ctxCJS = await esbuild.context({
  entryPoints: ["index.js"],
  bundle: true,
  outfile: "dist/adressevaelger.cjs.js",
  format: "cjs",
  minify: true,
  keepNames: true,
});

// The demo page is source, not output: it is written by hand and copied into
// dist beside the bundles it loads, so that `npm run dev` serves a working
// page and `npm run build` produces one.
export const ctxDemo = await esbuild.context({
  entryPoints: ["demo/index.html"],
  outdir: "dist",
  loader: { ".html": "copy" },
});

export const ctxCSS = await esbuild.context({
  entryPoints: ["src/style.css"],
  bundle: true,
  outfile: "dist/adressevaelger.css",
  minify: true,
});
