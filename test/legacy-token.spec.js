// @ts-check
import { test, expect } from "@playwright/test";

/**
 * The legacy picker reads its token once, at setup. setToken() lets a caller
 * hand it a new one when the old one expires, without tearing the picker down
 * and setting it up again.
 */

const FIXTURE_HTML = `<!doctype html>
<html lang="da">
  <head><meta charset="utf-8" /><title>fixture</title></head>
  <body>
    <div><input type="search" id="picker" /></div>
    <script type="module">
      import * as lib from "./adressevaelger.esm.js";
      window.lib = lib;
    </script>
  </body>
</html>`;

const ADDRESS = {
  type: "adresse",
  id: "86031378-ab45-471c-a585-1ee0052009c8",
  titel: "Rentemestervej 2, 2400 København NV",
};

/**
 * Serve a one-hit search and its lookup from any API host, and record the URL
 * of every request the picker sends.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<URL[]>} live array, appended to as requests are made
 */
async function stubAPI(page) {
  /** @type {URL[]} */
  const requests = [];
  const answer = async (/** @type {import('@playwright/test').Route} */ route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    await route.fulfill({
      json: url.pathname.endsWith("/soeg")
        ? { status: "ok", fund: [ADDRESS] }
        : { status: "ok", ...ADDRESS },
    });
  };
  await page.route("https://adressevaelger.dk/**", answer);
  await page.route("https://api.example.test/**", answer);
  return requests;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {Record<string, unknown>} options
 */
async function setUpPicker(page, options) {
  await page.route("**/__token.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.goto("/__token.html");
  await page.waitForFunction(() => "lib" in window);
  await page.evaluate((options) => {
    const w = /** @type {any} */ (window);
    w.picker = w.lib.adressevaelger(document.getElementById("picker"), {
      ...options,
      select() {},
    });
  }, options);
}

test("legacy: searches and lookups use the token given by setToken()", async ({
  page,
}) => {
  const requests = await stubAPI(page);
  await setUpPicker(page, { token: "old-token" });
  const input = page.locator("#picker");
  const option = page.getByRole("option", { name: ADDRESS.titel });

  await input.fill("Rentemestervej");
  await expect(option).toBeVisible();
  expect(requests.map((url) => url.searchParams.get("token"))).toEqual([
    "old-token",
  ]);

  await page.evaluate(() => (/** @type {any} */ (window)).picker.setToken("new-token"));

  await input.fill("Rentemestervej 2");
  await expect.poll(() => requests.length).toBe(2);
  await option.click();
  await expect.poll(() => requests.length).toBe(3);

  expect(
    requests.slice(1).map((url) => [url.pathname, url.searchParams.get("token")]),
  ).toEqual([
    ["/adresser/soeg", "new-token"],
    [`/adresser/${ADDRESS.id}`, "new-token"],
  ]);
});

test("legacy: setToken() keeps a custom apiUrl", async ({ page }) => {
  const requests = await stubAPI(page);
  await setUpPicker(page, {
    token: "old-token",
    apiUrl: "https://api.example.test",
  });

  await page.evaluate(() => (/** @type {any} */ (window)).picker.setToken("new-token"));
  await page.locator("#picker").fill("Rentemestervej");
  await expect.poll(() => requests.length).toBe(1);

  expect(requests[0].origin).toBe("https://api.example.test");
  expect(requests[0].searchParams.get("token")).toBe("new-token");
});

test("legacy: setToken() rejects an empty token and keeps the old one", async ({
  page,
}) => {
  const requests = await stubAPI(page);
  await setUpPicker(page, { token: "old-token" });

  const error = await page.evaluate(() => {
    try {
      (/** @type {any} */ (window)).picker.setToken("");
    } catch (err) {
      return String(err);
    }
  });
  expect(error).toContain("token");

  await page.locator("#picker").fill("Rentemestervej");
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].searchParams.get("token")).toBe("old-token");
});
