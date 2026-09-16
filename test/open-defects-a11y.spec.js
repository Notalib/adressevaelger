// @ts-check
/**
 * Reproductions for the accessibility defects found in the third review
 * (2026-09-14), filed as issues on Notalib/adressevaelger. Lettering continues
 * from test/open-defects.spec.js.
 *
 * Each lettered test asserts the *correct* behaviour, so it FAILS while the
 * defect is open and passes once it is fixed. The letter in the title is
 * referenced from the corresponding issue.
 *
 * The API is stubbed with page.route and the component is loaded on an
 * isolated fixture page, so nothing here touches the live service.
 *
 * Run:  npx playwright test test/open-defects-a11y.spec.js --reporter=line
 *
 * Make sure nothing else is listening on port 8000 first: playwright.config
 * reuses an existing server there, so a dev server from another checkout
 * would silently be the thing under test.
 */
import { test, expect } from "@playwright/test";

const API = "https://adressevaelger.dk/**";
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
  zzz: [],
};

const FIXTURE_HTML = `<!doctype html>
<html lang="da"><head><meta charset="utf-8" /><title>probe</title>
<link rel="stylesheet" href="./adressevaelger.css" /></head>
<body>
  <label for="legacy">Adresse (legacy)</label>
  <div class="autocomplete-container"><input type="search" id="legacy" /></div>
  <adresse-search-input token="adressevaelger123" label="Søg efter adresser"></adresse-search-input>
  <script type="module">
    import * as lib from "./adressevaelger.esm.js";
    customElements.define("adresse-search-input", lib.AdresseSearchInput);
    window.events = [];
    for (const type of ["address:error", "address:select"]) {
      document.addEventListener(type, (e) => window.events.push(type));
    }
    window.picker = lib.adressevaelger(document.getElementById("legacy"), {
      token: "adressevaelger123", select() {},
    });
  </script>
</body></html>`;

async function gotoFixture(page) {
  await page.route("**/__a11y.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.goto("/__a11y.html");
  await page.waitForFunction(() => "picker" in window);
}

/** Stub the search endpoint; "err" answers 504 with a plain-text body. */
async function stubAPI(page) {
  await page.route(API, (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.endsWith("/soeg")) {
      return route.fulfill({ json: { status: "ok", adresse: {} } });
    }
    const tekst = url.searchParams.get("tekst") ?? "";
    if (tekst === "err") {
      return route.fulfill({ status: 504, contentType: "text/plain", body: "Gateway Timeout" });
    }
    return route.fulfill({
      json: { status: "ok", beskrivelse: "", fund: RESULTS[tekst] || [] },
    });
  });
}

const wcInput = (page) => page.locator("adresse-search-input input");
const legacyInput = (page) => page.locator("#legacy");
const wcOptions = (page) => page.locator("adresse-search-input li");
const legacyOptions = (page) => page.locator("#legacy ~ div li");

/** Text of every live region on the page, in document order. */
const statusText = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll("[aria-live], [role=status], [role=alert], [role=log]")]
      .map((el) => el.textContent.trim())
      .filter(Boolean),
  );

// R. The resolution (#48) is a `label` attribute on the element; the fixture sets one.
test("R. web component: a label attribute names the input, not just its placeholder", async ({ page }) => {
  await gotoFixture(page);
  const naming = await wcInput(page).evaluate((input) => ({
    labels: input.labels.length,
    ariaLabel: input.getAttribute("aria-label"),
    ariaLabelledby: input.getAttribute("aria-labelledby"),
    placeholder: input.placeholder,
  }));
  // Placeholder text is the only thing the accessibility tree has to call
  // this field, and it disappears as soon as the user types.
  expect(
    naming.labels > 0 || naming.ariaLabel || naming.ariaLabelledby,
    `named only by placeholder: ${JSON.stringify(naming)}`,
  ).toBeTruthy();
});

for (const [label, input, options] of [
  ["legacy", legacyInput, legacyOptions],
  ["web component", wcInput, wcOptions],
]) {
  test(`S1. ${label}: results are announced through a live region`, async ({ page }) => {
    await gotoFixture(page);
    await stubAPI(page);
    await input(page).fill("Årh");
    await expect(options(page).filter({ visible: true })).toHaveCount(3);
    expect(await statusText(page), "no live region carries a result count").not.toEqual([]);
  });

  test(`S2. ${label}: a search with no hits says so`, async ({ page }) => {
    await gotoFixture(page);
    await stubAPI(page);
    await input(page).fill("zzz");
    await page.waitForTimeout(900);
    await expect(options(page).filter({ visible: true })).toHaveCount(0);
    expect(await statusText(page), "nothing tells the user there were no hits").not.toEqual([]);
  });

  test(`S3. ${label}: a failed search is shown to the user, not only logged`, async ({ page }) => {
    await gotoFixture(page);
    await stubAPI(page);
    await input(page).fill("err");
    await expect.poll(() => page.evaluate(() => window.events)).toContain("address:error");
    expect(await statusText(page), "address:error fired but the page shows nothing").not.toEqual([]);
  });

  test(`T. ${label}: browser autofill is switched off on the combobox`, async ({ page }) => {
    await gotoFixture(page);
    // dawa-autocomplete2 set autocomplete="off" on the caller's input; without
    // it the browser's own history dropdown competes with the suggestion list.
    await expect(input(page)).toHaveAttribute("autocomplete", "off");
  });
}

test("U. web component: every option is at least 24 CSS px tall (WCAG 2.5.8)", async ({ page }) => {
  await gotoFixture(page);
  await stubAPI(page);
  await wcInput(page).fill("Årh");
  await expect(wcOptions(page).filter({ visible: true })).toHaveCount(3);
  const heights = await wcOptions(page).evaluateAll((lis) =>
    lis.map((li) => li.getBoundingClientRect().height),
  );
  for (const height of heights) {
    expect(height, `option heights: ${heights.map((h) => h.toFixed(1)).join(", ")}`).toBeGreaterThanOrEqual(24);
  }
});
