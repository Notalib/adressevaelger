// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Regression for an upstream defect in 5.0.0, in the web component: its
 * options were one bare line of text, 18px tall at the default font size,
 * where WCAG 2.5.8 Target Size (Minimum) asks for 24. They are stacked with
 * nothing between them, so the spacing exception does not apply either. The
 * legacy rows pad to about 31px and have always passed.
 *
 * The same missing rule left the user-agent bullets and their 40px indent on
 * the list.
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
  <head>
    <meta charset="utf-8" /><title>fixture</title>
    <link rel="stylesheet" href="./adressevaelger.css" />
  </head>
  <body>
    <div class="autocomplete-container">
      <input type="search" id="legacy" />
    </div>
    <adresse-search-input token="test-token" label="Adresse">
    </adresse-search-input>
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
 * @param {{fontSize?: string}} [options] the page's own font size, which the
 *   component's em padding is relative to
 */
async function gotoFixture(page, { fontSize } = {}) {
  await page.route("**/__target.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) => {
    const tekst =
      new URL(route.request().url()).searchParams.get("tekst") ?? "";
    return route.fulfill({
      json: { status: "ok", beskrivelse: "", fund: RESULTS[tekst] ?? [] },
    });
  });
  await page.goto("/__target.html");
  await page.waitForFunction(() => "picker" in window);
  if (fontSize) {
    await page.evaluate((size) => {
      document.documentElement.style.fontSize = size;
      document.body.style.fontSize = size;
    }, fontSize);
  }
}

const versions = [
  { label: "legacy", input: "#legacy" },
  { label: "web component", input: "adresse-search-input input" },
];

for (const { label, input } of versions) {
  /** Options belonging to this version, not the other one on the page. */
  const options = (page) =>
    page.locator(input).locator("xpath=..").getByRole("option");

  for (const fontSize of [undefined, "12px"]) {
    const where = fontSize
      ? `at a ${fontSize} page font`
      : "at the default font";

    test(`${label}: every option is at least 24px tall ${where}`, async ({
      page,
    }) => {
      await gotoFixture(page, { fontSize });

      await page.locator(input).pressSequentially("Årh");
      await expect(options(page)).toHaveCount(3);

      const heights = await options(page).evaluateAll((items) =>
        items.map((item) => item.getBoundingClientRect().height),
      );
      expect(heights).toHaveLength(3);
      for (const height of heights) {
        expect(
          height,
          `option heights: ${heights.map((h) => h.toFixed(1)).join(", ")}`,
        ).toBeGreaterThanOrEqual(24);
      }
    });
  }

  test(`${label}: the options carry no markers and no marker indent`, async ({
    page,
  }) => {
    await gotoFixture(page);

    await page.locator(input).pressSequentially("Årh");
    await expect(options(page)).toHaveCount(3);

    const listStyle = await options(page)
      .first()
      .evaluate((item) => getComputedStyle(item).listStyleType);
    expect(listStyle).toBe("none");

    // The option starts at the list's content edge, rather than 40px in.
    // Measured from inside the border, which the popover draws itself.
    const indent = await options(page)
      .first()
      .evaluate((item) => {
        const list = /** @type {HTMLElement} */ (item.parentElement);
        return (
          item.getBoundingClientRect().left -
          (list.getBoundingClientRect().left + list.clientLeft)
        );
      });
    expect(indent).toBeLessThanOrEqual(1);
  });
}
