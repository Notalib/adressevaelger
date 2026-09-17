// @ts-check
import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";

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
  const require = createRequire(import.meta.url);
  const mod = require("../dist/adressevaelger.cjs.js");

  expect(typeof mod.adressevaelger).toBe("function");
  expect(typeof mod.AdresseSearchAPI).toBe("function");
  expect(typeof mod.AdresseSearchInput).toBe("function");
});
