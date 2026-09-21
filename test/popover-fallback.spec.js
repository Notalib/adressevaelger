// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Regression for an upstream defect in 5.0.0: the web component called
 * hidePopover()/showPopover() unconditionally, so in a browser without the
 * Popover API — Safari and iOS 16 and older, Chrome before 113, Firefox
 * before 125 — every search ended in
 *
 *   address:error  "…this.listElement.hidePopover is not a function"
 *
 * with no suggestions on screen at all. The component also needs CSS anchor
 * positioning (Chrome 125+, Safari 26+, Firefox 148+) to place the list: a
 * popover the engine cannot anchor opens in the middle of the screen. Missing
 * either one now puts the list below the field as an ordinary box, the way
 * the legacy picker has always done it.
 *
 * Each test runs twice: once in the engine as it is, and once with both
 * features taken away before the bundle loads.
 */

const RESULTS = {
  Årh: [
    { type: "vejnavn", titel: "Århusgade", vejNavn: "Århusgade" },
    { type: "vejnavn", titel: "Århusvej", vejNavn: "Århusvej" },
    {
      type: "adresse",
      id: "0a3f50c7-9994-32b8-e044-0003ba298018",
      titel: "Århusgade 1, st. tv, 2100 København Ø",
    },
  ],
};

const FIXTURE_HTML = `<!doctype html>
<html lang="da">
  <head><meta charset="utf-8" /><title>fixture</title></head>
  <body>
    <div style="height: 40vh"></div>
    <adresse-search-input token="test-token" label="Adresse">
    </adresse-search-input>
    <input id="after" placeholder="next field" />
    <script type="module">
      import * as lib from "./adressevaelger.esm.js";
      customElements.define("adresse-search-input", lib.AdresseSearchInput);
      window.lib = lib;
      window.errors = [];
      document.addEventListener("address:error", (event) =>
        window.errors.push(event.detail.message),
      );
      window.selected = [];
      document.addEventListener("address:select", () =>
        window.selected.push(true),
      );
    </script>
  </body>
</html>`;

/** Takes the Popover API and anchor positioning away before anything loads. */
async function withoutTheAPIs(page) {
  await page.addInitScript(() => {
    for (const name of ["showPopover", "hidePopover", "togglePopover"]) {
      delete (/** @type {any} */ (HTMLElement.prototype)[name]);
    }
    const supports = CSS.supports.bind(CSS);
    CSS.supports = (...args) =>
      /anchor/.test(args.join(" ")) ? false : supports(...args);
  });
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function gotoFixture(page) {
  await page.route("**/__fallback.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) => {
    const url = new URL(route.request().url());
    const tekst = url.searchParams.get("tekst") ?? "";
    if (url.pathname.endsWith("/soeg")) {
      return route.fulfill({
        json: { status: "ok", beskrivelse: "", fund: RESULTS[tekst] ?? [] },
      });
    }
    return route.fulfill({
      json: { status: "ok", adresse: { adressebetegnelse: "Århusgade 1" } },
    });
  });
  await page.goto("/__fallback.html");
  await page.waitForFunction(() => "lib" in window);
}

const field = (page) => page.locator("adresse-search-input input");
const list = (page) => page.locator("adresse-search-input ul");
const options = (page) => page.locator("adresse-search-input li");

for (const withAPIs of [true, false]) {
  const where = withAPIs ? "with the APIs" : "without the APIs";

  test.describe(where, () => {
    test.beforeEach(async ({ page }) => {
      if (!withAPIs) {
        await withoutTheAPIs(page);
      }
    });

    test(`${where}: a search puts suggestions on screen, and raises nothing`, async ({
      page,
    }) => {
      await gotoFixture(page);

      await field(page).pressSequentially("Årh");
      await expect(options(page)).toHaveCount(3);
      await expect(options(page).first()).toBeVisible();
      expect(await page.evaluate(() => window.errors)).toEqual([]);
      await expect(field(page)).toHaveAttribute("aria-expanded", "true");
    });

    test(`${where}: the list is under its field, and as wide as the component`, async ({
      page,
    }) => {
      await gotoFixture(page);

      await field(page).pressSequentially("Årh");
      await expect(options(page)).toHaveCount(3);

      const box = await page.evaluate(() => {
        const host = document.querySelector("adresse-search-input");
        const input = host.querySelector("input").getBoundingClientRect();
        const ul = host.querySelector("ul").getBoundingClientRect();
        return {
          below: Math.round(ul.top - input.bottom),
          aligned: Math.round(ul.left - input.left),
          onScreen: ul.top >= 0 && ul.bottom <= window.innerHeight,
        };
      });

      expect(box.below).toBeLessThanOrEqual(2);
      expect(box.aligned).toBeLessThanOrEqual(2);
      expect(box.onScreen, "the whole list is in the window").toBe(true);
    });

    test(`${where}: Escape closes the list`, async ({ page }) => {
      await gotoFixture(page);

      await field(page).pressSequentially("Årh");
      await expect(options(page)).toHaveCount(3);
      await field(page).press("Escape");

      await expect(options(page)).toHaveCount(0);
      await expect(field(page)).toHaveAttribute("aria-expanded", "false");
    });

    test(`${where}: leaving the field closes the list`, async ({ page }) => {
      await gotoFixture(page);

      await field(page).pressSequentially("Årh");
      await expect(options(page)).toHaveCount(3);
      await page.locator("#after").focus();

      await expect(options(page)).toHaveCount(0);
    });

    test(`${where}: an address can be picked with the mouse`, async ({
      page,
    }) => {
      await gotoFixture(page);

      await field(page).pressSequentially("Årh");
      await options(page).last().click();

      await expect(field(page)).toHaveValue(
        "Århusgade 1, st. tv, 2100 København Ø",
      );
      expect(await page.evaluate(() => window.selected)).toEqual([true]);
      expect(await page.evaluate(() => window.errors)).toEqual([]);
    });

    test(`${where}: an address can be picked with the keyboard`, async ({
      page,
    }) => {
      await gotoFixture(page);

      await field(page).pressSequentially("Årh");
      await expect(options(page)).toHaveCount(3);
      await field(page).press("ArrowDown");
      await field(page).press("ArrowDown");
      await field(page).press("ArrowDown");
      await field(page).press("Enter");

      await expect(field(page)).toHaveValue(
        "Århusgade 1, st. tv, 2100 København Ø",
      );
      expect(await page.evaluate(() => window.errors)).toEqual([]);
    });

    test(`${where}: with no room below, the list goes above the field`, async ({
      page,
    }) => {
      await gotoFixture(page);

      // The field just above the fold, so a list below it would not fit.
      await page.evaluate(() => {
        const host = /** @type {HTMLElement} */ (
          document.querySelector("adresse-search-input")
        );
        host.previousElementSibling.style.height = `${window.innerHeight - 60}px`;
        host.scrollIntoView({ block: "end" });
      });

      await field(page).pressSequentially("Årh");
      await expect(options(page)).toHaveCount(3);

      const box = await page.evaluate(() => {
        const host = document.querySelector("adresse-search-input");
        const input = host.querySelector("input").getBoundingClientRect();
        const ul = host.querySelector("ul").getBoundingClientRect();
        return {
          above: ul.bottom <= input.top + 2,
          onScreen: ul.top >= 0 && ul.bottom <= window.innerHeight,
        };
      });

      expect(box.above, "the list sits above the field").toBe(true);
      expect(box.onScreen, "and all of it is in the window").toBe(true);
    });
  });
}

test("without the APIs: the list is a plain element, not a popover", async ({
  page,
}) => {
  await withoutTheAPIs(page);
  await gotoFixture(page);

  await field(page).pressSequentially("Årh");
  await expect(options(page)).toHaveCount(3);

  const how = await list(page).evaluate((ul) => ({
    popover: ul.getAttribute("popover"),
    inline: ul.classList.contains("adr-wc-inline"),
    position: getComputedStyle(ul).position,
  }));

  expect(how).toEqual({ popover: null, inline: true, position: "absolute" });
});

test("with the APIs: the list is still a popover in the top layer", async ({
  page,
}) => {
  await gotoFixture(page);

  await field(page).pressSequentially("Årh");
  await expect(options(page)).toHaveCount(3);

  const how = await list(page).evaluate((ul) => ({
    popover: ul.getAttribute("popover"),
    open: ul.matches(":popover-open"),
    inline: ul.classList.contains("adr-wc-inline"),
  }));

  expect(how).toEqual({ popover: "auto", open: true, inline: false });
});
