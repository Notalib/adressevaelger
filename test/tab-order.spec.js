// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Regression for an upstream defect in 5.0.0, in both the legacy UI and the
 * web component: suggestions are rendered as `<li tabindex="0">`, so every
 * suggestion is a tab stop. A search returns up to 100 results by default, and
 * a three-letter search regularly fills that, so Tab from the field walks the
 * whole list one option at a time instead of moving to the next control.
 *
 * The list is navigated with the arrow keys, which focus options by script, so
 * the options only ever needed to be focusable programmatically. The tests
 * below assert both halves of that: one Tab leaves the component, and the
 * arrow keys still walk the list.
 *
 * They deliberately say nothing about whether the list is still open after
 * Tab. Closing it when focus leaves is a separate defect with its own fix.
 */

/** What a search returns when nothing narrows it: the API's default maksimum. */
const RESULT_COUNT = 100;

const SEARCH_RESULTS = {
  status: "ok",
  beskrivelse: "",
  fund: Array.from({ length: RESULT_COUNT }, (_, i) => ({
    type: "vejnavn",
    titel: `Vej ${i + 1}`,
    vejNavn: `Vej ${i + 1}`,
  })),
};

/**
 * Both versions, each followed by the next control in the form, so that "the
 * next tab stop" is something a test can name.
 */
const FIXTURE_HTML = `<!doctype html>
<html lang="da">
  <head>
    <meta charset="utf-8" /><title>fixture</title>
    <link rel="stylesheet" href="./adressevaelger.css" />
  </head>
  <body>
    <label for="legacy">Adresse</label>
    <div class="autocomplete-container">
      <input type="search" id="legacy" />
    </div>
    <input id="after-legacy" />

    <adresse-search-input token="test-token"></adresse-search-input>
    <input id="after-wc" />

    <script type="module">
      import * as lib from "./adressevaelger.esm.js";
      customElements.define("adresse-search-input", lib.AdresseSearchInput);
      window.lib = lib;
      window.picker = lib.adressevaelger(document.getElementById("legacy"), {
        token: "test-token",
        select() {},
      });
    </script>
  </body>
</html>`;

/**
 * @param {import('@playwright/test').Page} page
 */
async function gotoFixture(page) {
  await page.route("**/__taborder.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) =>
    route.fulfill({ json: SEARCH_RESULTS }),
  );
  await page.goto("/__taborder.html");
  await page.waitForFunction(() => "picker" in window);
}

/**
 * Identify the focused element well enough to assert on, and to read when an
 * assertion fails.
 *
 * @param {import('@playwright/test').Page} page
 */
function activeElement(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) {
      return "none";
    }
    const name = el.id ? `#${el.id}` : (el.textContent ?? "").trim();
    return `${el.tagName.toLowerCase()} ${name}`.trim();
  });
}

const versions = [
  {
    label: "legacy",
    input: "#legacy",
    list: "ul.adressevaelger-suggestions",
    next: "input #after-legacy",
  },
  {
    label: "web component",
    input: "adresse-search-input input",
    list: "adresse-search-input ul",
    next: "input #after-wc",
  },
];

for (const { label, input, list, next } of versions) {
  test(`${label}: one Tab from the field reaches the next control`, async ({
    page,
  }) => {
    await gotoFixture(page);
    await page.locator(input).pressSequentially("Vej");
    await page
      .getByRole("option", { name: `Vej ${RESULT_COUNT}`, exact: true })
      .waitFor();

    await page.keyboard.press("Tab");

    expect(
      await activeElement(page),
      `one Tab should leave the component, not step into ${RESULT_COUNT} suggestions`,
    ).toBe(next);
  });

  test(`${label}: no part of the suggestion list is in the tab sequence`, async ({
    page,
  }) => {
    await gotoFixture(page);
    await page.locator(input).pressSequentially("Vej");
    await page
      .getByRole("option", { name: `Vej ${RESULT_COUNT}`, exact: true })
      .waitFor();

    const tabbable = await page.locator(list).evaluate((ul) =>
      [ul, ...ul.querySelectorAll("*")]
        .filter((el) => /** @type {HTMLElement} */ (el).tabIndex >= 0)
        .map((el) => el.tagName.toLowerCase()),
    );

    expect(tabbable, "nothing in the list should be tabbable").toEqual([]);
  });

  test(`${label}: the arrow keys still walk the suggestions`, async ({
    page,
  }) => {
    await gotoFixture(page);
    await page.locator(input).pressSequentially("Vej");
    await page
      .getByRole("option", { name: `Vej ${RESULT_COUNT}`, exact: true })
      .waitFor();

    // tabindex="-1" has to leave the options reachable by script, which is how
    // both versions move through them.
    await page.keyboard.press("ArrowDown");
    expect(await activeElement(page)).toBe("li Vej 1");
    await page.keyboard.press("ArrowDown");
    expect(await activeElement(page)).toBe("li Vej 2");
  });
}
