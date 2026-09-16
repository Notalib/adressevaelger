// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Every rule the web component needs used to be keyed on the instance's
 * generated id, so each component appended its own <style> to the head: ten
 * components on a page meant ten copies of the same rules. Only the anchor
 * name tying a list to its own field genuinely differs between instances, and
 * that is now set on the elements themselves.
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
  await page.route("**/__sheets.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) =>
    route.fulfill({
      json: {
        status: "ok",
        beskrivelse: "",
        fund: [{ type: "vejnavn", titel: "Århusgade", vejNavn: "Århusgade" }],
      },
    }),
  );
  await page.goto("/__sheets.html");
  await page.waitForFunction(() => "lib" in window);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} count
 */
async function addComponents(page, count) {
  await page.evaluate((many) => {
    for (let i = 0; i < many; i++) {
      const el = document.createElement("adresse-search-input");
      el.setAttribute("token", "test-token");
      el.setAttribute("label", `Adresse ${i + 1}`);
      document.body.append(el);
    }
  }, count);
}

test("ten components share one copy of the stylesheets", async ({ page }) => {
  await gotoFixture(page);
  await addComponents(page, 10);

  const styles = await page.evaluate(() =>
    [...document.head.querySelectorAll("style")].map((style) => style.id),
  );

  expect(styles.sort()).toEqual([
    "adressevaelger-shared-styles",
    "adressevaelger-web-component-styles",
  ]);
});

test("each component's list is anchored to that component's own field", async ({
  page,
}) => {
  await gotoFixture(page);
  await addComponents(page, 3);

  const anchors = await page.evaluate(() =>
    [...document.querySelectorAll("adresse-search-input")].map((el) => ({
      field: /** @type {HTMLElement} */ (
        el.querySelector("input")
      )?.style.getPropertyValue("anchor-name"),
      list: /** @type {HTMLElement} */ (
        el.querySelector("ul")
      )?.style.getPropertyValue("position-anchor"),
    })),
  );

  for (const { field, list } of anchors) {
    expect(field, "the field names an anchor").toMatch(/^--input-adr-\d+$/);
    expect(list, "and its own list positions against it").toBe(field);
  }
  expect(
    new Set(anchors.map((pair) => pair.field)).size,
    "no two components share an anchor name",
  ).toBe(anchors.length);
});

test("the list opens against its own field, not another component's", async ({
  page,
}) => {
  await gotoFixture(page);
  await addComponents(page, 3);

  const supported = await page.evaluate(
    () =>
      CSS.supports("position-anchor: --x") &&
      CSS.supports("top: anchor(bottom)"),
  );
  test.skip(!supported, "the engine has no CSS anchor positioning");

  // The last of the three, the one furthest down the page.
  const host = page.locator("adresse-search-input").last();
  await host.locator("input").pressSequentially("Årh");
  await expect(host.getByRole("option")).toHaveCount(1);

  const box = await host.evaluate((el) => {
    const field = /** @type {HTMLElement} */ (
      el.querySelector("input")
    ).getBoundingClientRect();
    const list = /** @type {HTMLElement} */ (
      el.querySelector("ul")
    ).getBoundingClientRect();
    return { fieldBottom: field.bottom, fieldLeft: field.left, list };
  });

  expect(Math.abs(box.list.top - box.fieldBottom)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.list.left - box.fieldLeft)).toBeLessThanOrEqual(2);
});

test("a component can still be given its own highlight colour", async ({
  page,
}) => {
  await gotoFixture(page);
  await addComponents(page, 2);

  const colours = await page.evaluate(() => {
    const [first, second] = document.querySelectorAll("adresse-search-input");
    /** @type {HTMLElement} */ (first).style.setProperty(
      "--highlight-color",
      "rgb(255, 0, 0)",
    );
    return [first, second].map((el) =>
      getComputedStyle(el).getPropertyValue("--highlight-color").trim(),
    );
  });

  expect(colours).toEqual(["rgb(255, 0, 0)", "lightblue"]);
});
