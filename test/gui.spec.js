// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Walk the listbox down to the option called `name` and select it.
 *
 * The number of presses is derived from where the option actually sits in the
 * current result set, rather than hard-coded. These searches run against live
 * DAR data: "Århusgade" was the fourth suggestion for "Årh" when these tests
 * were written and is the third today, which silently selected a neighbouring
 * street and left the test waiting for a list that never arrived.
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
  await page.goto("/");
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
  await page.goto("/");
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
  await page.goto("/");
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
