// @ts-check
import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Regression for a defect in 5.0.0: AdresseSearchInput extended HTMLElement
 * directly, so evaluating the class at import time threw
 * `ReferenceError: HTMLElement is not defined` in any environment without a
 * DOM — Node/SSR, or Jest/Vitest without jsdom — even for consumers who only
 * wanted adressevaelger() or AdresseSearchAPI. These run as plain Node code,
 * without the `page` fixture, so no browser or DOM is involved.
 */

test("the ESM bundle can be imported under plain Node (no DOM)", async () => {
  const mod = await import("../dist/adressevaelger.esm.js");

  expect(typeof mod.adressevaelger).toBe("function");
  expect(typeof mod.AdresseSearchAPI).toBe("function");
  expect(typeof mod.AdresseSearchInput).toBe("function");
});

test("the CJS bundle can be required under plain Node (no DOM)", () => {
  // In a node of its own, not through createRequire here: the test runner
  // loads a .js file as CommonJS whatever the package says, and under real
  // Node this bundle was read as ESM and came back empty.
  const bundle = fileURLToPath(
    new URL("../dist/adressevaelger.cjs", import.meta.url),
  );
  const output = execFileSync(
    "node",
    [
      "-e",
      `const mod = require(${JSON.stringify(bundle)});
       console.log(["adressevaelger", "AdresseSearchAPI", "AdresseSearchInput"]
         .map((name) => typeof mod[name]).join(","));`,
    ],
    { encoding: "utf8" },
  ).trim();

  expect(output).toBe("function,function,function");
});
