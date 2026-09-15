// @ts-check
import { test, expect } from "@playwright/test";

/**
 * AdresseSearchInput kept its stylesheet text in a class field named `style`.
 * A class field is an own property of the instance, so it hid the `style`
 * accessor every element inherits from HTMLElement: `el.style` was a string,
 * and writing to it threw in strict mode — which is every module and every
 * bundle, and every framework's style binding on the element.
 */

const FIXTURE_HTML = `<!doctype html>
<html lang="da">
  <head><meta charset="utf-8" /><title>fixture</title></head>
  <body>
    <adresse-search-input token="test-token"></adresse-search-input>
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
  await page.route("**/__style.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) =>
    route.fulfill({ json: { fund: [] } }),
  );
  await page.goto("/__style.html");
  await page.waitForFunction(() => "lib" in window);
}

test("web component: element.style is the element's CSSStyleDeclaration", async ({
  page,
}) => {
  await gotoFixture(page);

  const result = await page.evaluate(() => {
    "use strict";
    const el = /** @type {HTMLElement} */ (
      document.querySelector("adresse-search-input")
    );
    let threw = null;
    try {
      el.style.display = "none";
    } catch (err) {
      threw = String(err);
    }
    return {
      isDeclaration: el.style instanceof CSSStyleDeclaration,
      threw,
      display: getComputedStyle(el).display,
    };
  });

  expect(result.threw, "a strict-mode write to el.style").toBeNull();
  expect(result.isDeclaration).toBe(true);
  // The component's own sheet sets display: block on the element; an inline
  // style has to win over it, as it would on any other element.
  expect(result.display).toBe("none");
});

test("web component: its stylesheet is still injected", async ({ page }) => {
  await gotoFixture(page);

  const sheet = await page.evaluate(() => {
    const el = /** @type {HTMLElement} */ (
      document.querySelector("adresse-search-input")
    );
    return {
      id: el.id,
      text: [...document.head.querySelectorAll("style")]
        .map((style) => style.textContent)
        .find((text) => text?.includes(`#${el.id}-list`)),
      display: getComputedStyle(el).display,
    };
  });

  expect(sheet.text, "a <style> in <head> for this element").toBeTruthy();
  expect(sheet.display).toBe("block");
});

test("web component: no field or method hides an HTMLElement member", async ({
  page,
}) => {
  await gotoFixture(page);

  // `style` was the one collision; `hidden`, `title`, `dataset`, `popover` and
  // the like are the easy ones to add next without noticing.
  const collisions = await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    const el = document.createElement("adresse-search-input");
    const lifecycle = new Set([
      "constructor",
      "connectedCallback",
      "disconnectedCallback",
      "attributeChangedCallback",
    ]);
    return [
      ...Object.getOwnPropertyNames(el),
      ...Object.getOwnPropertyNames(w.lib.AdresseSearchInput.prototype),
    ].filter((name) => !lifecycle.has(name) && name in HTMLElement.prototype);
  });

  expect(collisions).toEqual([]);
});
