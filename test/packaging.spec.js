// @ts-check
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What a consumer gets from the published package, checked by publishing it:
 * npm pack, install the tarball into an empty project, and load it from there.
 *
 * #23 was the first version of this — importing the package under Node threw,
 * because the module evaluated HTMLElement at import time. The test written
 * for it imported dist/adressevaelger.esm.js by path, so it kept passing when
 * the entry broke again: main pointed at index.js, which reaches
 * src/web-component.js, which imports two stylesheets as text. Only the build
 * understands that, so the entry died on
 *
 *   ERR_UNKNOWN_FILE_EXTENSION  Unknown file extension ".css"
 *
 * under both import and require. These load the package by name, as a
 * consumer does, so the entry is what is under test.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test.describe.configure({ mode: "serial" });

// Packaging is the same whatever the browser; running it once is enough, and
// npm pack takes long enough that three times is worth avoiding.
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "the package is the same for every engine",
);

/** @type {string} */
let consumer;

test.afterAll(() => {
  // The hook runs for the skipped projects too, which never made one.
  if (consumer) {
    rmSync(consumer, { recursive: true, force: true });
  }
});

test.beforeAll(async () => {
  test.setTimeout(180_000);
  consumer = mkdtempSync(path.join(tmpdir(), "adressevaelger-consumer-"));
  writeFileSync(
    path.join(consumer, "package.json"),
    JSON.stringify({ name: "consumer", private: true, version: "1.0.0" }),
  );
  // prepack builds dist, so this is the tarball a release would carry.
  execFileSync("npm", ["pack", "--pack-destination", consumer], {
    cwd: ROOT,
    stdio: "pipe",
  });
  const tarball = readdirSync(consumer).find((name) => name.endsWith(".tgz"));
  expect(tarball, "npm pack produced a tarball").toBeTruthy();
  execFileSync(
    "npm",
    ["install", `./${tarball}`, "--no-audit", "--no-fund", "--silent"],
    { cwd: consumer, stdio: "pipe" },
  );
});

/**
 * Run a snippet in the consumer project, as its own module or script.
 *
 * @param {string} source
 * @param {"module" | "commonjs"} kind
 */
function inConsumer(source, kind) {
  return execFileSync(
    "node",
    ["--input-type", kind === "module" ? "module" : "commonjs", "-e", source],
    { cwd: consumer, encoding: "utf8" },
  ).trim();
}

const EXPORTS = [
  "AdresseSearchAPI",
  "AdresseSearchInput",
  "AdresseSearchUI",
  "adressevaelger",
  "default",
];

test("the package can be imported by name, with no DOM", () => {
  const output = inConsumer(
    `const mod = await import("adressevaelger");
     console.log(Object.keys(mod).sort().join(","));`,
    "module",
  );

  expect(output).toBe(EXPORTS.join(","));
});

test("and required by name, with no DOM", () => {
  const output = inConsumer(
    `const mod = require("adressevaelger");
     console.log(Object.keys(mod).sort().join(","));`,
    "commonjs",
  );

  // The CJS bundle carries the same four, and its default.
  for (const name of EXPORTS) {
    expect(output.split(",")).toContain(name);
  }
});

test("the stylesheet is reachable by name too", () => {
  const output = inConsumer(
    `const { readFileSync } = require("node:fs");
     const css = readFileSync(require.resolve("adressevaelger/adressevaelger.css"), "utf8");
     // A string: console.log colours a boolean when it takes stdout for a
     // terminal, and the escape codes come back with it.
     console.log(css.includes(".adr-suggestion") ? "found" : "missing");`,
    "commonjs",
  );

  expect(output).toBe("found");
});

test("the published files are the bundles, not the sources", () => {
  // --ignore-scripts so that prepack's own "Files built." does not land in
  // front of the JSON; the pack in beforeAll has already built dist.
  const listed = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--ignore-scripts"],
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  const files = JSON.parse(listed)[0].files.map((entry) => entry.path);

  // The whole list, not a few names: a bundle renamed and left behind by an
  // older build would otherwise be published along with the rest, and the
  // demo page carries a token of its own.
  expect(files.sort()).toEqual([
    "LICENSE",
    "README.md",
    "dist/adressevaelger.cjs",
    "dist/adressevaelger.css",
    "dist/adressevaelger.esm.js",
    "dist/adressevaelger.iife.js",
    "package.json",
  ]);
});
