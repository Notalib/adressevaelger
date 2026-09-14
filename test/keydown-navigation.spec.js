// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Navigation runs on keydown rather than keyup. Three things that buys, all
 * asserted here:
 *
 *   - auto-repeat works. A keyup arrives once however long a key is held, so
 *     holding ArrowDown used to move exactly one option out of a hundred.
 *   - the keys the component consumes can have their defaults cancelled,
 *     which on keyup is already too late.
 *   - the keys it does not consume are left alone: Enter with no option
 *     active still submits the enclosing form, and Escape with the list
 *     closed still reaches the field and whatever dialog is around it.
 *
 * The last one is what stops a fix here from breaking ordinary form use.
 */

const RESULT_COUNT = 12;
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
    <form id="form" action="about:blank">
      <label for="legacy">Adresse</label>
      <div class="autocomplete-container">
        <input type="search" id="legacy" />
      </div>
      <adresse-search-input token="test-token"></adresse-search-input>
      <button type="submit" id="save">Gem</button>
    </form>
    <script type="module">
      import * as lib from "./adressevaelger.esm.js";
      customElements.define("adresse-search-input", lib.AdresseSearchInput);
      window.submits = 0;
      document.getElementById("form").addEventListener("submit", (event) => {
        event.preventDefault();
        window.submits++;
      });
      window.keys = [];
      document.addEventListener("keydown", (event) =>
        window.keys.push({ key: event.key, prevented: event.defaultPrevented }),
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
 */
async function gotoFixture(page) {
  await page.route("**/__keydown.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) =>
    route.fulfill({ json: SEARCH_RESULTS }),
  );
  await page.goto("/__keydown.html");
  await page.waitForFunction(() => "picker" in window);
}

const versions = [
  { label: "legacy", input: "#legacy" },
  { label: "web component", input: "adresse-search-input input" },
];

for (const { label, input } of versions) {
  const combobox = (page) => page.locator(input);
  const options = (page) =>
    page.locator(input).locator("xpath=..").getByRole("option");
  const activeOption = (page) =>
    page.locator(input).locator('xpath=..').locator('[aria-selected="true"]');

  test(`${label}: holding ArrowDown moves more than one option`, async ({
    page,
  }) => {
    await gotoFixture(page);
    await combobox(page).pressSequentially("Vej");
    await options(page).first().waitFor();

    await page.keyboard.press("ArrowDown");
    await expect(activeOption(page)).toHaveText("Vej 1");

    // Three repeats of a held key, then the single keyup that ends it.
    await page.keyboard.down("ArrowDown");
    await page.keyboard.down("ArrowDown");
    await page.keyboard.down("ArrowDown");
    await page.keyboard.up("ArrowDown");

    await expect(activeOption(page)).toHaveText("Vej 4");
  });

  test(`${label}: the arrow keys are consumed only while the list is open`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    // Before any search there is nothing to navigate, so the caret keeps the
    // key.
    await field.focus();
    await page.keyboard.press("ArrowDown");

    await field.pressSequentially("Vej");
    await options(page).first().waitFor();
    await page.keyboard.press("ArrowDown");

    const arrows = await page.evaluate(() =>
      window.keys.filter((k) => k.key === "ArrowDown").map((k) => k.prevented),
    );
    expect(arrows, "closed, then open").toEqual([false, true]);
  });

  test(`${label}: a dismissed list cannot be navigated or selected from`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Vej");
    await options(page).first().waitFor();
    await page.keyboard.press("Escape");

    // Hiding a popover leaves its options in the DOM. Arrowing into them would
    // mark an option nobody can see, and Enter would then select it.
    await page.keyboard.press("ArrowDown");
    await expect(activeOption(page)).toHaveCount(0);

    await page.keyboard.press("Enter");
    await expect(field).toHaveValue("Vej");
    // Enter the component did not consume belongs to the form.
    expect(await page.evaluate(() => window.submits)).toBe(1);
  });
}
