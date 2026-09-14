// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Regression for an upstream defect in 5.0.0: .adressevaelger-suggestions sets
 * overflow-y: auto but no max-height, so there is nothing for the overflow to
 * happen within. A default result set of 100 renders around 3200 px tall in a
 * 720 px viewport, unscrollable, covering the page from the field downwards.
 * The web component caps its list at 50vh; the legacy one now does too.
 *
 * Two things follow from the list becoming scrollable, and both are asserted
 * here rather than assumed:
 *
 *   - arrowing to an option below the fold has to bring it into view. Nothing
 *     in the list is focused any more, so the browser will not scroll it for
 *     us; setActive() calls scrollIntoView, and this is what holds that call
 *     in place.
 *   - a scrollable container is focusable in Firefox unless it says otherwise,
 *     which would put the list back in the tab sequence. test/tab-order.spec.js
 *     covers that, and it is the reason the <ul> carries an explicit
 *     tabindex="-1".
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

    <adresse-search-input token="test-token"></adresse-search-input>

    <script type="module">
      import * as lib from "./adressevaelger.esm.js";
      customElements.define("adresse-search-input", lib.AdresseSearchInput);
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
  await page.route("**/__height.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) =>
    route.fulfill({ json: SEARCH_RESULTS }),
  );
  await page.goto("/__height.html");
  await page.waitForFunction(() => "picker" in window);
}

const versions = [
  { label: "legacy", input: "#legacy", list: "ul.adressevaelger-suggestions" },
  {
    label: "web component",
    input: "adresse-search-input input",
    list: "adresse-search-input ul",
  },
];

for (const { label, input, list } of versions) {
  const options = (page) =>
    page.locator(input).locator("xpath=..").getByRole("option");

  test(`${label}: a full result set fits in the viewport and scrolls`, async ({
    page,
  }) => {
    await gotoFixture(page);
    await page.locator(input).pressSequentially("Vej");
    await options(page)
      .filter({ hasText: `Vej ${RESULT_COUNT}` })
      .first()
      .waitFor();

    const measured = await page.locator(list).evaluate((ul) => ({
      listHeight: Math.round(ul.getBoundingClientRect().height),
      viewport: window.innerHeight,
      scrollable: ul.scrollHeight > ul.clientHeight,
      contentHeight: ul.scrollHeight,
    }));

    expect(
      measured.listHeight,
      `${RESULT_COUNT} results should not be taller than the viewport`,
    ).toBeLessThanOrEqual(measured.viewport);
    expect(
      measured.scrollable,
      "the list should scroll rather than run off the page",
    ).toBe(true);
    // Guard against a cap so small the list is useless: several options have
    // to be visible at once.
    expect(measured.listHeight).toBeGreaterThan(100);
  });

  test(`${label}: arrowing past the fold brings the option into view`, async ({
    page,
  }) => {
    await gotoFixture(page);
    await page.locator(input).pressSequentially("Vej");
    await options(page)
      .filter({ hasText: `Vej ${RESULT_COUNT}` })
      .first()
      .waitFor();

    // Far enough down to be outside any sensible cap.
    for (let step = 0; step < 30; step++) {
      await page.keyboard.press("ArrowDown");
    }

    const active = options(page).filter({ hasText: "Vej 30" }).first();
    await expect(active).toHaveAttribute("aria-selected", "true");

    const visible = await active.evaluate((option) => {
      const ul = /** @type {HTMLElement} */ (option.parentElement);
      const box = option.getBoundingClientRect();
      const listBox = ul.getBoundingClientRect();
      return box.top >= listBox.top - 1 && box.bottom <= listBox.bottom + 1;
    });

    expect(visible, "the active option should be scrolled into view").toBe(true);
  });
}
