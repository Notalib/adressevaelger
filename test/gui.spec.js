// @ts-check
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * These tests serve captured API responses by default, so a run cannot be
 * broken by the search service being slow or unavailable. That service returns
 * an intermittent 504 after a 15 s gateway timeout, and with retries disabled a
 * single one fails the whole run — including on tagged releases, where the
 * publish job depends on the test job.
 *
 * To exercise the real endpoint instead:
 *
 *   npm run test:live
 *
 * That is worth doing deliberately — before a release, or on a schedule — to
 * catch changes in the API or in the data. It is not worth having in the path
 * of every push, which is what it was before.
 *
 * Refresh the captured responses with `npm run capture-fixtures`.
 */
const LIVE_API = Boolean(process.env.ADRESSEVAELGER_LIVE_API);

const fixtures = JSON.parse(
  readFileSync(new URL("./fixtures/dar-responses.json", import.meta.url), "utf8"),
);

/**
 * Answer the component's requests from the captured responses.
 *
 * An unknown request fails loudly rather than returning an empty list: a test
 * that drifts onto a search we have no fixture for should say so, not quietly
 * wait for options that were never going to appear.
 *
 * @param {import('@playwright/test').Page} page
 */
async function serveCapturedResponses(page) {
  if (LIVE_API) {
    return;
  }
  await page.route("https://adressevaelger.dk/**", async (route) => {
    const url = new URL(route.request().url());

    if (url.pathname.endsWith("/soeg")) {
      const tekst = url.searchParams.get("tekst");
      const body = fixtures.searches[tekst];
      return body
        ? route.fulfill({ json: body })
        : route.fulfill({
            status: 500,
            json: {
              status: "fejl",
              beskrivelse:
                `No captured response for tekst=${JSON.stringify(tekst)}. ` +
                `Run \`npm run capture-fixtures\` if the test now searches for ` +
                `something else.`,
            },
          });
    }

    const id = url.pathname.split("/").pop();
    return id === fixtures.address.id
      ? route.fulfill({ json: fixtures.address.response })
      : route.fulfill({
          status: 500,
          json: {
            status: "fejl",
            beskrivelse: `No captured response for address ${id}.`,
          },
        });
  });
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function openDemoPage(page) {
  await serveCapturedResponses(page);
  await page.goto("/");
}

/**
 * Walk the listbox down to the option called `name` and select it.
 *
 * The number of presses is derived from where the option actually sits in the
 * current result set, rather than hard-coded. The results used to come straight
 * from live DAR data, where "Århusgade" was the fourth suggestion for "Årh" when
 * these tests were written and later became the third — which silently selected
 * a neighbouring street and left the test waiting for a list that never
 * arrived. Deriving the count keeps that from recurring, in either mode.
 */
async function selectWithKeyboard(page, name) {
  const option = page.getByRole("option", { name });
  await option.waitFor();
  const steps = await option.evaluate((element) => {
    const options = [...element.parentElement.querySelectorAll("[role=option]")];
    return options.indexOf(element) + 1;
  });
  for (let step = 0; step < steps; step++) {
    await page.keyboard.press("ArrowDown");
  }
  // Guard the assumption above: if arrow handling ever changes, fail here
  // rather than silently selecting the wrong address further down.
  await expect(option).toBeFocused();
  await page.keyboard.press("Enter");
}

async function keyboardTest(page, id) {
  await openDemoPage(page);
  const searchElement = page.locator(id);
  await searchElement.pressSequentially("Årh", { delay: 100 });
  await selectWithKeyboard(page, "Århusgade");
  await selectWithKeyboard(page, "Århusgade 2100");
  await selectWithKeyboard(page, "Århusgade 1, 2100");
  await selectWithKeyboard(page, "Århusgade 1, st. tv, 2100");
  await expect(searchElement).toHaveValue(
    "Århusgade 1, st. tv, 2100 København Ø",
  );
}

async function pointerTest(page, id) {
  await openDemoPage(page);
  const searchElement = page.locator(id);
  await searchElement.pressSequentially("Årh", { delay: 100 });
  await page.getByRole("option", { name: "Århusgade" }).click();
  await page.getByRole("option", { name: "Århusgade 2100" }).click();
  await page.getByRole("option", { name: "Århusgade 1, 2100" }).click();
  await page.getByRole("option", { name: "Århusgade 1, st. tv, 2100" }).click();
  await expect(searchElement).toHaveValue(
    "Århusgade 1, st. tv, 2100 København Ø",
  );
}

async function visibilityTest(page, id) {
  await openDemoPage(page);
  await expect(page.locator(id)).toBeVisible();
}

test("CDN search field visible", async ({ page }) => {
  await visibilityTest(page, "input#demoCDN");
});

test("ESM search field visible", async ({ page }) => {
  await visibilityTest(page, "input#demoES");
});

test("Web component search field visible", async ({ page }) => {
  await visibilityTest(page, "adressevaegler-input input");
});

test("Use web component with keyboard", async ({ page }) => {
  await keyboardTest(page, "adressevaegler-input input");
});

test("Use CDN component with keyboard", async ({ page }) => {
  await keyboardTest(page, "input#demoCDN");
});

test("Use web component with mouse/touch", async ({ page }) => {
  await pointerTest(page, "adressevaegler-input input");
});

test("Use CDN component with mouse/touch", async ({ page }) => {
  await pointerTest(page, "input#demoCDN");
});
