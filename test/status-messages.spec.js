// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Regression for an upstream defect in 5.0.0, in both versions: nothing is
 * ever announced. Neither version had a live region anywhere, so three changes
 * the user did not make went unremarked —
 *
 *   - suggestions appearing, where the only signal was the list itself;
 *   - a search with no hits, which looks and sounds exactly like still typing;
 *   - a search that failed, which dispatched address:error, logged to the
 *     console, and put nothing at all on the page. Given how often the gateway
 *     times out, that is the failure a user actually meets, and it was
 *     indistinguishable from "no results".
 *
 * WCAG 4.1.3 Status Messages, whose two worked examples are a result count and
 * a no-hits message, and 3.3.1 Error Identification.
 */

const STREET = { type: "vejnavn", titel: "Århusgade", vejNavn: "Århusgade" };
const RESULTS = {
  Årh: [
    STREET,
    { type: "vejnavn", titel: "Århusvej", vejNavn: "Århusvej" },
    { type: "vejnavn", titel: "Århus Plads", vejNavn: "Århus Plads" },
  ],
  zzz: [],
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
      window.errors = [];
      document.addEventListener("address:error", (event) =>
        window.errors.push(event.detail.message),
      );
      window.picker = lib.adressevaelger(document.getElementById("legacy"), {
        token: "test-token",
        select() {},
      });
    </script>
  </body>
</html>`;

/**
 * @param {import('@playwright/test').Page} page
 * @param {{failOn?: string}} [options] a search text the API should fail for,
 *   as the gateway does when it times out
 */
async function gotoFixture(page, { failOn } = {}) {
  await page.route("**/__status.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) => {
    const url = new URL(route.request().url());
    const tekst = url.searchParams.get("tekst") ?? "";
    if (failOn !== undefined && tekst === failOn) {
      return route.fulfill({
        status: 504,
        contentType: "text/plain",
        body: "upstream request timeout",
      });
    }
    return route.fulfill({
      json: { status: "ok", beskrivelse: "", fund: RESULTS[tekst] ?? [] },
    });
  });
  await page.goto("/__status.html");
  await page.waitForFunction(() => "picker" in window);
}

const versions = [
  { label: "legacy", input: "#legacy" },
  { label: "web component", input: "adresse-search-input input" },
];

for (const { label, input } of versions) {
  const combobox = (page) => page.locator(input);
  /** Regions belonging to this version, not the other one on the page. */
  const region = (page, role) =>
    page.locator(input).locator("xpath=..").locator(`[role=${role}]`);

  test(`${label}: the number of suggestions is announced`, async ({ page }) => {
    await gotoFixture(page);

    await combobox(page).pressSequentially("Årh");
    await expect(region(page, "status")).toHaveText(/3/);
  });

  test(`${label}: a search with no hits says so`, async ({ page }) => {
    await gotoFixture(page);

    await combobox(page).pressSequentially("zzz");
    await expect(region(page, "status")).toHaveText("Ingen adresser fundet");
  });

  test(`${label}: a failed search is put on screen, not only logged`, async ({
    page,
  }) => {
    await gotoFixture(page, { failOn: "Årh" });

    await combobox(page).pressSequentially("Årh");

    // Visible, not only announced: this is the message the user has to act on,
    // and a 504 is the common case rather than the exotic one.
    await expect(region(page, "alert")).toBeVisible();
    await expect(region(page, "alert")).toHaveText(/kunne ikke gennemføres/);
    expect(
      await page.evaluate(() => window.errors),
      "the event still carries the detail for the integrator",
    ).toHaveLength(1);
  });

  test(`${label}: a failure is cleared by the next search that works`, async ({
    page,
  }) => {
    await gotoFixture(page, { failOn: "zzz" });

    await combobox(page).pressSequentially("zzz");
    await expect(region(page, "alert")).toBeVisible();

    await combobox(page).fill("");
    await combobox(page).pressSequentially("Årh");

    await expect(region(page, "alert")).toBeHidden();
    await expect(region(page, "status")).toHaveText(/3/);
  });

  test(`${label}: the status region is announced but not drawn`, async ({
    page,
  }) => {
    await gotoFixture(page);
    await combobox(page).pressSequentially("Årh");
    await expect(region(page, "status")).toHaveText(/3/);

    // Visually hidden rather than display:none, which would take it out of the
    // accessibility tree along with the announcement.
    const box = await region(page, "status").evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
    expect(box.width).toBeLessThanOrEqual(1);
    expect(box.height).toBeLessThanOrEqual(1);
  });
}
