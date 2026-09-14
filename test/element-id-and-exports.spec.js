// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Regressions for two defects in 5.0.0:
 *
 *   1. AdresseSearchInput derives elementId from Math.random() over a space of
 *      100 000, so ids collide. The id drives both the injected CSS block and
 *      the anchor-name / position-anchor pair, so a collision cross-wires the
 *      styling and popover positioning of two components.
 *   2. AdresseSearchUI is not exported, so consumers cannot reach the class.
 */

const FIXTURE_HTML = `<!doctype html>
<html lang="da">
  <head><meta charset="utf-8" /><title>fixture</title></head>
  <body>
    <script type="module">
      import * as lib from "./adressevaelger.esm.js";
      customElements.define("adresse-search-input", lib.AdresseSearchInput);
      window.lib = lib;
    </script>
  </body>
</html>`;

/**
 * @param {import('@playwright/test').Page} page
 */
async function gotoFixture(page) {
  await page.route("**/__ids.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) =>
    route.fulfill({ json: { fund: [] } }),
  );
  await page.goto("/__ids.html");
  await page.waitForFunction(() => "lib" in window);
}

test("element ids are unique across many instances", async ({ page }) => {
  await gotoFixture(page);

  // 500 instances is past the point where a 100 000-value random space is
  // more likely than not to have collided (even odds at roughly 370).
  const result = await page.evaluate((count) => {
    /** @type {string[]} */
    const ids = [];
    for (let i = 0; i < count; i++) {
      const el = document.createElement("adresse-search-input");
      document.body.append(el);
      ids.push(el.id);
      el.remove();
    }
    const unique = new Set(ids);
    return { created: ids.length, unique: unique.size };
  }, 500);

  expect(
    result.unique,
    "every instance should get an id no other instance has used",
  ).toBe(result.created);
});

test("element ids are valid CSS identifiers", async ({ page }) => {
  await gotoFixture(page);

  // The id is interpolated into a stylesheet and into anchor-name, so it has
  // to survive being used as a selector.
  const ids = await page.evaluate(() => {
    /** @type {string[]} */
    const out = [];
    for (let i = 0; i < 5; i++) {
      const el = document.createElement("adresse-search-input");
      document.body.append(el);
      out.push(el.id);
      el.remove();
    }
    return out;
  });

  for (const id of ids) {
    expect(id, `${id} should be usable as a CSS selector`).toMatch(
      /^[A-Za-z][A-Za-z0-9_-]*$/,
    );
    expect(
      await page.evaluate((value) => {
        try {
          document.querySelector(`#${value}`);
          return true;
        } catch {
          return false;
        }
      }, id),
    ).toBe(true);
  }
});

test("AdresseSearchUI is exported", async ({ page }) => {
  await gotoFixture(page);

  const surface = await page.evaluate(() => {
    const lib = /** @type {any} */ (window).lib;
    return {
      exports: Object.keys(lib).sort(),
      uiIsConstructor: typeof lib.AdresseSearchUI === "function",
    };
  });

  expect(
    surface.exports,
    "the legacy UI class should be reachable alongside the other entry points",
  ).toContain("AdresseSearchUI");
  expect(surface.uiIsConstructor, "and it should be the class itself").toBe(
    true,
  );
});
