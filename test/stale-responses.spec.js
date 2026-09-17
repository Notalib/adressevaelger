// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Regression for an upstream defect in 5.0.0, in both versions: nothing
 * cancels or orders searches that are in flight, so whichever response arrives
 * last is the one rendered. Two things follow, and both are visible to a user:
 *
 *   1. Type "Årh", let that request go out slowly, type "u". The quick "Århu"
 *      response is rendered, then the slow "Årh" response lands and replaces
 *      it, so the field says "Århu" and the list shows the "Årh" results.
 *   2. Type "Årh", type "u" so a search is pending, pick an address from the
 *      still-visible list. The value is set and select fires. When the pending
 *      response arrives, the list opens again over the chosen address.
 *
 * The search endpoint times out at the gateway after 15 s often enough that
 * slow responses are routine rather than hypothetical, which is what makes
 * this worth cancelling rather than merely ordering.
 */

const STREET = { type: "vejnavn", titel: "Århusgade", vejNavn: "Århusgade" };
const ADDRESS = {
  type: "adresse",
  id: "0a3f50c7-9994-32b8-e044-0003ba298018",
  titel: "Århusgade 1, st. tv, 2100 København Ø",
};

const RESULTS = {
  Årh: [STREET, { type: "vejnavn", titel: "Århusvej" }, ADDRESS],
  Århu: [{ type: "vejnavn", titel: "Århusvej", vejNavn: "Århusvej" }],
  Århusgade: [ADDRESS],
};

/** Long enough to still be in flight when the next keystroke goes out. */
const SLOW_MS = 1500;

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
 * @param {Record<string, number>} [delays] milliseconds to hold a search for,
 *   by the text searched for
 */
async function gotoFixture(page, delays = {}) {
  /** @type {string[]} */
  const searched = [];
  await page.route("**/__stale.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/soeg")) {
      return route.fulfill({
        json: { status: "ok", adresse: { adressebetegnelse: ADDRESS.titel } },
      });
    }
    const tekst = url.searchParams.get("tekst") ?? "";
    searched.push(tekst);
    if (delays[tekst]) {
      await new Promise((resolve) => setTimeout(resolve, delays[tekst]));
    }
    // The page may have abandoned the request while this handler was held:
    // fulfilling it then is not an error the test should fail on.
    return route
      .fulfill({
        json: { status: "ok", beskrivelse: "", fund: RESULTS[tekst] ?? [] },
      })
      .catch(() => {});
  });
  await page.goto("/__stale.html");
  await page.waitForFunction(() => "picker" in window);
  return searched;
}

/** @param {import('@playwright/test').Page} page */
const errorsDispatched = (page) => page.evaluate(() => window.errors);

const versions = [
  { label: "legacy", input: "#legacy", debounce: 500 },
  { label: "web component", input: "adresse-search-input input", debounce: 300 },
];

for (const { label, input, debounce } of versions) {
  const combobox = (page) => page.locator(input);
  const options = (page) =>
    page.locator(input).locator("xpath=..").getByRole("option");

  test(`${label}: a slow earlier response does not replace newer results`, async ({
    page,
  }) => {
    await gotoFixture(page, { Årh: SLOW_MS });
    const field = combobox(page);

    await field.pressSequentially("Årh");
    // Let the "Årh" search go out, and stay out.
    await page.waitForTimeout(debounce + 100);
    await field.press("u");

    await expect(options(page)).toHaveText(["Århusvej"]);

    // Now the superseded response would have landed.
    await page.waitForTimeout(SLOW_MS + 300);

    await expect(field).toHaveValue("Århu");
    await expect(options(page)).toHaveText(["Århusvej"]);
    expect(await errorsDispatched(page)).toEqual([]);
  });

  test(`${label}: the list stays closed after selecting during a search`, async ({
    page,
  }) => {
    await gotoFixture(page, { Århu: SLOW_MS });
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await options(page).filter({ hasText: ADDRESS.titel }).waitFor();

    // A search for "Århu" is now pending while the "Årh" list is still up.
    await field.press("u");
    await page.waitForTimeout(debounce + 100);
    await options(page).filter({ hasText: ADDRESS.titel }).click();
    await expect(field).toHaveValue(ADDRESS.titel);

    await page.waitForTimeout(SLOW_MS + 300);

    await expect(options(page).filter({ visible: true })).toHaveCount(0);
    await expect(field).toHaveValue(ADDRESS.titel);
    await expect(field).toHaveAttribute("aria-expanded", "false");
    expect(await errorsDispatched(page)).toEqual([]);
  });

  test(`${label}: clearing the field discards a search in flight`, async ({
    page,
  }) => {
    await gotoFixture(page, { Årh: SLOW_MS });
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await page.waitForTimeout(debounce + 100);
    await field.fill("");

    await page.waitForTimeout(SLOW_MS + 300);

    await expect(options(page).filter({ visible: true })).toHaveCount(0);
    expect(await errorsDispatched(page)).toEqual([]);
  });

  test(`${label}: a superseded search is cancelled, not just ignored`, async ({
    page,
  }) => {
    // Record searches whose request was actually abandoned. Watching the
    // signal the component hands to fetch says both that one was passed at all
    // and that it was aborted, which "the stale results were ignored" does not.
    await page.addInitScript(() => {
      const w = /** @type {any} */ (window);
      w.aborted = [];
      const fetchImpl = w.fetch;
      w.fetch = (input, init) => {
        init?.signal?.addEventListener("abort", () =>
          w.aborted.push(new URL(String(input)).searchParams.get("tekst")),
        );
        return fetchImpl(input, init);
      };
    });
    await gotoFixture(page, { Årh: SLOW_MS });
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await page.waitForTimeout(debounce + 100);
    await field.press("u");
    await expect(options(page)).toHaveText(["Århusvej"]);

    // The request for "Årh" should have been dropped rather than left to hold
    // a connection until the gateway times out.
    expect(await page.evaluate(() => window.aborted)).toEqual(["Årh"]);
  });
}
