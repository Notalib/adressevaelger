// @ts-check
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * Regression for an upstream defect in 5.0.0: the web component's input was
 * named only by its placeholder. It makes that input itself and generates its
 * id, so a page had no way to label it, and a placeholder is not a label — it
 * disappears as soon as the user types. WCAG 3.3.2 and 4.1.2.
 *
 * The label attribute now has the component put a visible <label> for its
 * input in front of it.
 */

const FIXTURE_HTML = `<!doctype html>
<html lang="da">
  <head><meta charset="utf-8" /><title>fixture</title></head>
  <body>
    <adresse-search-input label="Søg efter adresser" token="test-token">
    </adresse-search-input>
    <script type="module">
      import * as lib from "./adressevaelger.esm.js";
      customElements.define("adresse-search-input", lib.AdresseSearchInput);
      window.lib = lib;
    </script>
  </body>
</html>`;

/**
 * @param {import('@playwright/test').Page} page
 */
async function gotoFixture(page) {
  await page.route("**/__label.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) =>
    route.fulfill({ json: { status: "ok", beskrivelse: "", fund: [] } }),
  );
  await page.goto("/__label.html");
  await page.waitForFunction(() => "lib" in window);
}

const host = (page) => page.locator("adresse-search-input");
const input = (page) => page.locator("adresse-search-input input");

test("web component: the label names the field, visibly", async ({ page }) => {
  await gotoFixture(page);

  const label = host(page).locator("label");
  await expect(label).toBeVisible();
  await expect(label).toHaveText("Søg efter adresser");
  await expect(
    page.getByRole("combobox", { name: "Søg efter adresser", exact: true }),
  ).toHaveCount(1);
  expect(await input(page).evaluate((el) => el.labels?.length)).toBe(1);

  // In front of the field, even though label came before token in the markup
  // and so was handled before the field existed.
  const order = await host(page).evaluate((el) =>
    [...el.children].slice(0, 2).map((child) => child.tagName.toLowerCase()),
  );
  expect(order).toEqual(["label", "input"]);
});

test("web component: the name stays once the user has typed", async ({
  page,
}) => {
  await gotoFixture(page);

  await input(page).pressSequentially("Årh");
  await expect(
    page.getByRole("combobox", { name: "Søg efter adresser", exact: true }),
  ).toHaveValue("Årh");
});

test("web component: clicking the label puts focus in the field", async ({
  page,
}) => {
  await gotoFixture(page);

  await host(page).locator("label").click();
  await expect(input(page)).toBeFocused();
});

test("web component: changing the label changes the name in place", async ({
  page,
}) => {
  await gotoFixture(page);

  await input(page).pressSequentially("Årh");
  const same = await host(page).evaluate((el) => {
    const before = el.querySelector("label");
    el.setAttribute("label", "Adresse");
    return before === el.querySelector("label");
  });

  expect(same).toBe(true);
  await expect(
    page.getByRole("combobox", { name: "Adresse", exact: true }),
  ).toHaveValue("Årh");
  await expect(input(page)).toBeFocused();
});

test("web component: removing the label removes it", async ({ page }) => {
  await gotoFixture(page);

  await host(page).evaluate((el) => el.removeAttribute("label"));

  await expect(host(page).locator("label")).toHaveCount(0);
  expect(await input(page).evaluate((el) => el.labels?.length)).toBe(0);
});

test("web component: a label set after connecting goes in front of the field", async ({
  page,
}) => {
  await gotoFixture(page);

  const result = await page.evaluate(() => {
    const el = document.createElement("adresse-search-input");
    document.body.append(el);
    el.setAttribute("token", "test-token");
    el.setAttribute("label", "Leveringsadresse");
    const field = el.querySelector("input");
    return {
      first: el.firstElementChild?.tagName.toLowerCase(),
      labelled: field?.labels?.[0]?.textContent,
      labels: el.querySelectorAll("label").length,
    };
  });

  expect(result).toEqual({
    first: "label",
    labelled: "Leveringsadresse",
    labels: 1,
  });
});

test("web component: two elements label their own fields", async ({ page }) => {
  await gotoFixture(page);

  await page.evaluate(() => {
    const el = document.createElement("adresse-search-input");
    el.setAttribute("token", "test-token");
    el.setAttribute("label", "Leveringsadresse");
    document.body.append(el);
  });

  await expect(
    page.getByRole("combobox", { name: "Søg efter adresser", exact: true }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("combobox", { name: "Leveringsadresse", exact: true }),
  ).toHaveCount(1);
});

test("demo: the web component is labelled", async () => {
  const demo = readFileSync(
    new URL("../demo/index.html", import.meta.url),
    "utf8",
  );
  expect(demo).toMatch(/<adressevaegler-input[^>]*\slabel="[^"]+"/);
});
