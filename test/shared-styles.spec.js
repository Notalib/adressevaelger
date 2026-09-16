// @ts-check
import { test, expect } from "@playwright/test";

/**
 * The rules both versions need used to be written twice: once in
 * src/style.css for the legacy picker and once in the web component's own
 * stylesheet. The copies had begun to drift — the 24px target floor existed
 * in one of them only — so they now live in src/shared.css, which style.css
 * imports and the component injects.
 *
 * The component must still need no stylesheet from the page, so the fixture
 * here deliberately loads adressevaelger.css for the legacy picker alone.
 */

const RESULTS = {
  Årh: [
    { type: "vejnavn", titel: "Århusgade", vejNavn: "Århusgade" },
    { type: "vejnavn", titel: "Århusvej", vejNavn: "Århusvej" },
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
 * @param {{stylesheet?: boolean}} [options] whether the page loads
 *   adressevaelger.css at all
 */
async function gotoFixture(page, { stylesheet = true } = {}) {
  await page.route("**/__shared.html", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: stylesheet
        ? FIXTURE_HTML
        : FIXTURE_HTML.replace(
            '<link rel="stylesheet" href="./adressevaelger.css" />',
            "",
          ),
    }),
  );
  await page.route("https://adressevaelger.dk/**", (route) => {
    const tekst =
      new URL(route.request().url()).searchParams.get("tekst") ?? "";
    return route.fulfill({
      json: { status: "ok", beskrivelse: "", fund: RESULTS[tekst] ?? [] },
    });
  });
  await page.goto("/__shared.html");
  await page.waitForFunction(() => "picker" in window);
}

/** The declarations shared.css carries, as the browser resolves them. */
const SHARED = {
  option: ["padding", "minHeight", "listStyleType", "cursor", "boxSizing"],
  list: ["maxHeight", "overflowY", "paddingLeft"],
  status: ["position", "width", "height", "clipPath", "whiteSpace"],
  error: ["color", "fontSize", "marginTop"],
};

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @param {string[]} properties
 */
async function computed(page, selector, properties) {
  return page
    .locator(selector)
    .first()
    .evaluate((element, props) => {
      const style = getComputedStyle(element);
      return Object.fromEntries(props.map((name) => [name, style[name]]));
    }, properties);
}

/**
 * Search in one version and read the shared declarations off its own list,
 * while that list is open: the other version's closes as soon as focus leaves
 * it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{input: string, option: string, list: string, status: string, error: string}} version
 */
async function sharedValues(page, version) {
  await page.locator(version.input).pressSequentially("Årh");
  await expect(page.locator(version.option)).toHaveCount(2);
  return {
    option: await computed(page, version.option, SHARED.option),
    list: await computed(page, version.list, SHARED.list),
    status: await computed(page, version.status, SHARED.status),
    error: await computed(page, version.error, SHARED.error),
  };
}

test("both versions resolve the shared rules to the same values", async ({
  page,
}) => {
  await gotoFixture(page);

  const legacy = await sharedValues(page, {
    input: "#legacy",
    option: ".adressevaelger-suggestion",
    list: ".adressevaelger-suggestions",
    status: ".adressevaelger-status",
    error: ".adressevaelger-error",
  });
  const component = await sharedValues(page, {
    input: "adresse-search-input input",
    option: "adresse-search-input li",
    list: "adresse-search-input ul",
    status: "adresse-search-input [role=status]",
    error: "adresse-search-input [role=alert]",
  });

  expect(component.option, "the rows of both are shaped alike").toEqual(
    legacy.option,
  );
  expect(component.list).toEqual(legacy.list);
  expect(component.status).toEqual(legacy.status);
  expect(component.error).toEqual(legacy.error);
});

test("the web component still needs no stylesheet from the page", async ({
  page,
}) => {
  await gotoFixture(page, { stylesheet: false });

  await page.locator("adresse-search-input input").pressSequentially("Årh");
  const options = page.locator("adresse-search-input li");
  await expect(options).toHaveCount(2);

  const heights = await options.evaluateAll((items) =>
    items.map((item) => item.getBoundingClientRect().height),
  );
  for (const height of heights) {
    expect(
      height,
      `option heights: ${heights.join(", ")}`,
    ).toBeGreaterThanOrEqual(24);
  }
  expect(
    await computed(page, "adresse-search-input [role=status]", ["clipPath"]),
  ).toEqual({ clipPath: "inset(50%)" });
});

test("the shared stylesheet is put in the page once, however many components", async ({
  page,
}) => {
  await gotoFixture(page, { stylesheet: false });

  const sheets = await page.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      const el = document.createElement("adresse-search-input");
      el.setAttribute("token", "test-token");
      document.body.append(el);
    }
    return document.head.querySelectorAll("style#adressevaelger-shared-styles")
      .length;
  });

  expect(sheets).toBe(1);
});

test("the built stylesheet carries the shared rules, not an import of them", async ({
  page,
}) => {
  await gotoFixture(page);

  const css = await page.evaluate(() =>
    fetch("./adressevaelger.css").then((response) => response.text()),
  );

  expect(css).toContain(".adr-suggestion");
  expect(
    css,
    "@import would leave integrators fetching a second file",
  ).not.toContain("@import");
});
