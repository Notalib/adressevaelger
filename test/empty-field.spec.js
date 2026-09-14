// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Regressions for two upstream defects in 5.0.0, both in what happens when the
 * field is emptied:
 *
 *   1. inputHandler returns early on an empty value without clearing the
 *      pending debounce timer. The timer fires, reads the now-empty field, and
 *      search() rejects on its own argument guard, so typing a character and
 *      deleting it within the debounce window dispatches address:error and
 *      logs to the console without a request ever being sent. Both versions.
 *   2. Legacy: emptying the field leaves the previous suggestions open beneath
 *      it, and clicking one still selects it. The web component hides its
 *      popover in the same situation.
 *
 * The first matters beyond the noise: surfacing address:error to the user is
 * the obvious remedy for a search that fails silently at the gateway, and that
 * cannot be done while an ordinary type-and-delete raises one.
 */

const STREET = { type: "vejnavn", titel: "Århusgade", vejNavn: "Århusgade" };
const RESULTS = {
  Å: [STREET],
  Årh: [STREET, { type: "vejnavn", titel: "Århusvej", vejNavn: "Århusvej" }],
};

/** Past both debounce windows: legacy 500 ms, web component 300 ms. */
const PAST_DEBOUNCE = 900;

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
 * @returns {Promise<{searched: string[], logged: string[]}>} live arrays: the
 *   text of every search request sent, and every console error the component
 *   logged. A 404 for the favicon also reaches the console, so the log is
 *   narrowed to what errorHandler prints.
 */
async function gotoFixture(page) {
  /** @type {string[]} */
  const searched = [];
  /** @type {string[]} */
  const logged = [];
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("search items")) {
      logged.push(message.text());
    }
  });
  await page.route("**/__empty.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) => {
    const url = new URL(route.request().url());
    const tekst = url.searchParams.get("tekst") ?? "";
    searched.push(tekst);
    return route.fulfill({
      json: { status: "ok", beskrivelse: "", fund: RESULTS[tekst] ?? [] },
    });
  });
  await page.goto("/__empty.html");
  await page.waitForFunction(() => "picker" in window);
  return { searched, logged };
}

/** @param {import('@playwright/test').Page} page */
const errorsDispatched = (page) => page.evaluate(() => window.errors);

const versions = [
  { label: "legacy", input: "#legacy" },
  { label: "web component", input: "adresse-search-input input" },
];

for (const { label, input } of versions) {
  const combobox = (page) => page.locator(input);
  const options = (page) =>
    page.locator(input).locator("xpath=..").getByRole("option");

  test(`${label}: typing a character and deleting it raises nothing`, async ({
    page,
  }) => {
    const { searched, logged } = await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Å");
    await field.press("Backspace");
    await page.waitForTimeout(PAST_DEBOUNCE);

    expect(await errorsDispatched(page)).toEqual([]);
    expect(logged).toEqual([]);
    // Nothing was ever worth asking the API about, either.
    expect(searched).toEqual([]);
  });

  test(`${label}: retyping after a delete searches once, for what is there`, async ({
    page,
  }) => {
    const { searched } = await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Å");
    await field.press("Backspace");
    await field.pressSequentially("Årh");
    await options(page).first().waitFor();
    await page.waitForTimeout(PAST_DEBOUNCE);

    expect(searched).toEqual(["Årh"]);
    expect(await errorsDispatched(page)).toEqual([]);
  });

  test(`${label}: emptying the field closes the suggestions`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await expect(options(page)).toHaveCount(2);

    // Select all and delete, as the field's own clear button also does.
    await field.fill("");
    await page.waitForTimeout(PAST_DEBOUNCE);

    await expect(options(page).filter({ visible: true })).toHaveCount(0);
    await expect(field).toHaveAttribute("aria-expanded", "false");
    expect(await errorsDispatched(page)).toEqual([]);
  });

  test(`${label}: backspacing to empty closes the suggestions`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await expect(options(page)).toHaveCount(2);

    await field.press("Backspace");
    await field.press("Backspace");
    await field.press("Backspace");
    await page.waitForTimeout(PAST_DEBOUNCE);

    await expect(field).toHaveValue("");
    await expect(options(page).filter({ visible: true })).toHaveCount(0);
    expect(await errorsDispatched(page)).toEqual([]);
  });

  test(`${label}: an ordinary search still works`, async ({ page }) => {
    const { searched } = await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await expect(options(page)).toHaveText(["Århusgade", "Århusvej"]);

    expect(searched).toEqual(["Årh"]);
    await expect(field).toHaveAttribute("aria-expanded", "true");
  });
}
