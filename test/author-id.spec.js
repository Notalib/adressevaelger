// @ts-check
import { test, expect } from "@playwright/test";

/**
 * AdresseSearchInput set its own id on connect, unconditionally, so an id the
 * author had given the element was gone the moment it was connected. Every
 * getElementById, #id rule and <label for> pointing at it stopped working.
 *
 * The component's stylesheet used that id to find the element. It now finds it
 * through its list, so the id can stay the author's, and can even change.
 */

const FIXTURE_HTML = `<!doctype html>
<html lang="da">
  <head>
    <meta charset="utf-8" /><title>fixture</title>
    <style>
      #author-id { outline: 3px solid rgb(255, 0, 0); }
    </style>
  </head>
  <body>
    <adresse-search-input id="author-id" token="test-token"></adresse-search-input>
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
  await page.route("**/__author-id.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) =>
    route.fulfill({ json: { fund: [] } }),
  );
  await page.goto("/__author-id.html");
  await page.waitForFunction(() => "lib" in window);
}

/**
 * What the component's own sheet and the author's sheet do to an element.
 *
 * @param {Element} el
 */
function styling(el) {
  const computed = getComputedStyle(el);
  return {
    // From the component's sheet: max-width: 30rem, display: block.
    maxWidth: computed.maxWidth,
    display: computed.display,
    // From the author's #author-id rule.
    outlineColor: computed.outlineColor,
  };
}

test("web component: keeps the id the author gave it", async ({ page }) => {
  await gotoFixture(page);

  const result = await page.evaluate(() => {
    const el = document.querySelector("adresse-search-input");
    return {
      id: el?.id,
      found: document.getElementById("author-id") === el,
    };
  });

  expect(result.id).toBe("author-id");
  expect(result.found, "getElementById finds the element").toBe(true);
});

test("web component: an id set before connecting is kept too", async ({
  page,
}) => {
  await gotoFixture(page);

  const id = await page.evaluate(() => {
    const el = document.createElement("adresse-search-input");
    el.id = "scripted";
    document.body.append(el);
    return el.id;
  });

  expect(id).toBe("scripted");
});

test("web component: both stylesheets apply to an element with the author's id", async ({
  page,
}) => {
  await gotoFixture(page);

  const style = await page.evaluate(
    `(${styling})(document.getElementById("author-id"))`,
  );

  expect(style).toEqual({
    maxWidth: "480px",
    display: "block",
    outlineColor: "rgb(255, 0, 0)",
  });
});

test("web component: an element without an id still gets one, and its styling", async ({
  page,
}) => {
  await gotoFixture(page);

  const result = await page.evaluate(`(() => {
    const el = document.querySelectorAll("adresse-search-input")[1];
    return { id: el.id, style: (${styling})(el) };
  })()`);

  expect(result.id).toMatch(/^adr-\d+$/);
  expect(result.style.maxWidth).toBe("480px");
  expect(result.style.display).toBe("block");
});

test("web component: styling survives the author changing the id", async ({
  page,
}) => {
  await gotoFixture(page);

  const style = await page.evaluate(`(() => {
    const [authored, generated] = document.querySelectorAll("adresse-search-input");
    authored.id = "renamed";
    generated.removeAttribute("id");
    return [authored, generated].map((el) => (${styling})(el).maxWidth);
  })()`);

  expect(style).toEqual(["480px", "480px"]);
});
