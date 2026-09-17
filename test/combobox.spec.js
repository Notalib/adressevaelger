// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Regressions for three upstream defects in 5.0.0, in both versions:
 *
 *   1. The suggestion list stays open when focus leaves the field. The legacy
 *      list is absolutely positioned at z-index 9999 and covers whatever
 *      follows it; the web component's popover closes only on Escape or an
 *      outside click.
 *   2. Neither input reports whether the list is open. The web component's
 *      input has role="combobox" but never sets aria-expanded, and the legacy
 *      version leaves the caller's <input type="search"> untouched — no
 *      combobox role, no aria-controls, no aria-autocomplete — while giving the
 *      <ul> it controls role="listbox". A screen reader user gets no signal
 *      that suggestions have appeared.
 *   3. Legacy: clicking a suggestion leaves document.activeElement on <body>,
 *      because the click focuses the <li> and selecting then removes the list
 *      from under it. After picking a street the arrow keys are dead until the
 *      field is clicked again.
 *
 * The fix is the ARIA combobox pattern with aria-activedescendant: DOM focus
 * stays in the text field and the active option is marked rather than focused,
 * so the third defect cannot arise and the first has one place to be handled.
 */

const STREET = { type: "vejnavn", titel: "Århusgade", vejNavn: "Århusgade" };
const HOUSE_NUMBER_ID = "0a3f507b-37d7-32b8-e044-0003ba298018";
const ADDRESS = {
  type: "adresse",
  id: "0a3f50c7-9994-32b8-e044-0003ba298018",
  titel: "Århusgade 1, st. tv, 2100 København Ø",
  husnummerId: HOUSE_NUMBER_ID,
};

/** Enough of the real search flow to click a street and then an address. */
const RESULTS = {
  Årh: [
    STREET,
    { type: "vejnavn", titel: "Århusvej", vejNavn: "Århusvej" },
    ADDRESS,
  ],
  Århusgade: [
    { type: "husnummer", id: HOUSE_NUMBER_ID, titel: "Århusgade 1" },
    ADDRESS,
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
    <!-- Inside a form with a submit button, which is the shape an address
         field usually appears in, and the one that makes implicit submission
         on Enter reachable. -->
    <form id="form" action="about:blank">
      <label for="legacy">Adresse</label>
      <div class="autocomplete-container">
        <input type="search" id="legacy" />
      </div>
      <input id="after-legacy" />

      <adresse-search-input token="test-token"></adresse-search-input>
      <input id="after-wc" />

      <button type="submit" id="save">Gem</button>
    </form>

    <script type="module">
      import * as lib from "./adressevaelger.esm.js";
      customElements.define("adresse-search-input", lib.AdresseSearchInput);
      window.lib = lib;
      window.submits = 0;
      document.getElementById("form").addEventListener("submit", (event) => {
        event.preventDefault();
        window.submits++;
      });
      // Read in the bubble phase, after the component's own handler, so a test
      // can ask whether a key was consumed rather than infer it.
      window.keys = [];
      document.addEventListener("keydown", (event) =>
        window.keys.push({
          key: event.key,
          prevented: event.defaultPrevented,
        }),
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
  await page.route("**/__combobox.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/soeg")) {
      const tekst = url.searchParams.get("tekst") ?? "";
      return route.fulfill({
        json: { status: "ok", beskrivelse: "", fund: RESULTS[tekst] ?? [] },
      });
    }
    return route.fulfill({
      json: { status: "ok", adresse: { adressebetegnelse: ADDRESS.titel } },
    });
  });
  await page.goto("/__combobox.html");
  await page.waitForFunction(() => "picker" in window);
}

const versions = [
  { label: "legacy", input: "#legacy", next: "#after-legacy" },
  {
    label: "web component",
    input: "adresse-search-input input",
    next: "#after-wc",
  },
];

for (const { label, input, next } of versions) {
  /**
   * @param {import('@playwright/test').Page} page
   */
  const combobox = (page) => page.locator(input);

  /**
   * Options belonging to this version, so the other one on the page cannot
   * answer for it. Both versions put the list next to the input: inside the
   * caller's wrapper for the legacy one, inside the host element for the web
   * component.
   */
  const options = (page) =>
    page.locator(input).locator("xpath=..").getByRole("option");

  test(`${label}: the input is a combobox that reports its state`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await expect(field).toHaveAttribute("role", "combobox");
    await expect(field).toHaveAttribute("aria-autocomplete", "list");
    await expect(field).toHaveAttribute("aria-expanded", "false");

    // aria-controls has to name the listbox this field opens.
    const listId = await field.getAttribute("aria-controls");
    expect(listId, "aria-controls should be set").toBeTruthy();

    await field.pressSequentially("Årh");
    await options(page).first().waitFor();

    await expect(field).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(`#${listId}`)).toHaveRole("listbox");
  });

  test(`${label}: no suggestions means the combobox is not expanded`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("zzz");
    await page.waitForTimeout(800);

    await expect(field).toHaveAttribute("aria-expanded", "false");
    await expect(options(page)).toHaveCount(0);
  });

  test(`${label}: the list closes when focus leaves the field`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await options(page).first().waitFor();

    await page.keyboard.press("Tab");

    await expect(page.locator(next)).toBeFocused();
    await expect(options(page).filter({ visible: true })).toHaveCount(0);
    await expect(field).toHaveAttribute("aria-expanded", "false");
  });

  test(`${label}: Escape closes the list and keeps the text`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await options(page).first().waitFor();
    await page.keyboard.press("Escape");

    await expect(options(page).filter({ visible: true })).toHaveCount(0);
    await expect(field).toHaveAttribute("aria-expanded", "false");
    await expect(field).toHaveValue("Årh");
    await expect(field).toBeFocused();
  });

  test(`${label}: the arrow keys mark an option without moving focus`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await options(page).first().waitFor();

    await page.keyboard.press("ArrowDown");
    await expect(field).toBeFocused();
    const firstId = await options(page).first().getAttribute("id");
    await expect(field).toHaveAttribute("aria-activedescendant", `${firstId}`);
    await expect(options(page).first()).toHaveAttribute("aria-selected", "true");

    // Arrowing back up off the first option returns to what was typed, which
    // is a position in its own right: no option is active.
    await page.keyboard.press("ArrowUp");
    await expect(field).not.toHaveAttribute("aria-activedescendant", /.*/);
    await expect(options(page).first()).not.toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(field).toBeFocused();
  });

  test(`${label}: the active option is visibly marked, not only announced`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await options(page).first().waitFor();
    await page.keyboard.press("ArrowDown");

    // Focus stays in the text field, so no browser focus ring lands on the
    // option: whatever marks it has to come from the component's own styles.
    // Read from the option aria-activedescendant points at, so that the test
    // follows the same element a screen reader would.
    const seen = await field.evaluate((input) => {
      const active = document.getElementById(
        input.getAttribute("aria-activedescendant") ?? "",
      );
      const other = [...active.parentElement.querySelectorAll("li")].find(
        (li) => li !== active,
      );
      const read = (el) => {
        const style = getComputedStyle(el);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: parseFloat(style.outlineWidth),
          background: style.backgroundColor,
        };
      };
      return { active: read(active), other: read(other) };
    });

    expect(seen.active.outlineStyle).not.toBe("none");
    expect(seen.active.outlineWidth).toBeGreaterThanOrEqual(2);
    // And it has to differ from the options around it.
    expect(seen.active).not.toEqual(seen.other);
  });

  test(`${label}: Enter on an option selects it without submitting the form`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await options(page).first().waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    await expect(field).toHaveValue(STREET.titel);
    // Keeping DOM focus in the text field puts Enter within reach of implicit
    // submission, which would submit the half-typed text and, in the legacy
    // version, close the list before keyup could select anything.
    expect(
      await page.evaluate(() => window.submits),
      "the form should not have been submitted",
    ).toBe(0);
  });

  test(`${label}: Enter with no option active still submits the form`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await options(page).first().waitFor();
    // No ArrowDown: nothing is active, so Enter is the form's to handle.
    await page.keyboard.press("Enter");

    expect(await page.evaluate(() => window.submits)).toBe(1);
  });

  test(`${label}: Escape is consumed only while the list is open`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await options(page).first().waitFor();

    await page.keyboard.press("Escape");
    await expect(options(page).filter({ visible: true })).toHaveCount(0);

    // Hiding a popover leaves its options in the DOM, so asking them whether
    // the list is open answers yes forever after the first search — and every
    // later Escape is swallowed, taking with it the field's own clear and any
    // enclosing dialog's close.
    await page.keyboard.press("Escape");

    const escapes = await page.evaluate(() =>
      window.keys.filter((k) => k.key === "Escape").map((k) => k.prevented),
    );
    expect(escapes, "first Escape closes the list, the second is not ours").toEqual([
      true,
      false,
    ]);
  });

  test(`${label}: focus stays in the field through a mouse selection`, async ({
    page,
  }) => {
    await gotoFixture(page);
    const field = combobox(page);

    await field.pressSequentially("Årh");
    await options(page).first().waitFor();

    // Picking a street refreshes the list rather than ending the search.
    await options(page).first().click();
    await expect(field).toHaveValue(STREET.titel);
    await expect(field).toBeFocused();
    // The whole refreshed list, not just an option matching "Århusgade 1":
    // the list for "Årh" holds "Århusgade 1, st. tv, …" too, so a looser wait
    // passes against the list that is about to be replaced, and the refresh
    // then clears the option the arrow keys had just marked.
    await expect(options(page)).toHaveText(["Århusgade 1", ADDRESS.titel]);

    // The arrow keys have to still work, without clicking back into the field.
    await page.keyboard.press("ArrowDown");
    await expect(options(page).first()).toHaveAttribute("aria-selected", "true");

    // And picking an address ends with the field focused, not <body>.
    await options(page).last().click();
    await expect(field).toHaveValue(ADDRESS.titel);
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute("aria-expanded", "false");
  });
}
