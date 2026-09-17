// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Regression for an upstream defect in 5.0.0, in both versions via
 * AdresseSearchAPI: search() and get() threw "HTTP error! Status: <code>" on
 * any non-OK response without reading the body, so the service's own account
 * of what went wrong was discarded. Its error bodies say something worth
 * knowing:
 *
 *   maksimum=500          → 400  "maksimum skal være <= 200 (500)"
 *   /adresser/not-a-uuid  → 400  "id skal være en gyldig uuid (not-a-uuid)"
 *   gateway timeout       → 504  "upstream request timeout"
 *
 * address:error now carries that message, and the status and the service's
 * text separately, so that an integrator can tell a 504 worth retrying from a
 * 400 about their own configuration without parsing English.
 *
 * What the user sees is deliberately unchanged: these are messages about an
 * integrator's mistake or the service's health, in terms no user can act on.
 * The sentence on screen stays the general one.
 */

const GENERIC = "Adressesøgningen kunne ikke gennemføres. Prøv igen.";

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
      window.events = [];
      document.addEventListener("address:error", (event) =>
        window.events.push(event.detail),
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
 * @param {{status: number, body: string, contentType?: string}} failure how the
 *   service should answer a search
 */
async function gotoFixture(page, failure) {
  await page.route("**/__apierr.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) =>
    route.fulfill({
      status: failure.status,
      contentType: failure.contentType ?? "text/plain",
      body: failure.body,
    }),
  );
  await page.goto("/__apierr.html");
  await page.waitForFunction(() => "picker" in window);
}

/** @param {import('@playwright/test').Page} page */
const firstError = (page) =>
  page.evaluate(() => /** @type {any} */ (window).events[0]);

const versions = [
  { label: "legacy", input: "#legacy" },
  { label: "web component", input: "adresse-search-input input" },
];

for (const { label, input } of versions) {
  const combobox = (page) => page.locator(input);
  const alert = (page) =>
    page.locator(input).locator("xpath=..").locator("[role=alert]");

  test(`${label}: the service's own message reaches address:error`, async ({
    page,
  }) => {
    await gotoFixture(page, {
      status: 400,
      body: "maksimum skal være <= 200 (500)",
    });

    await combobox(page).pressSequentially("Årh");
    await expect.poll(() => page.evaluate(() => window.events.length)).toBe(1);

    const error = await firstError(page);
    expect(error.message).toContain("maksimum skal være <= 200 (500)");
    expect(error.status, "the status, for branching on").toBe(400);
    expect(error.detail, "the service's words, on their own").toBe(
      "maksimum skal være <= 200 (500)",
    );
  });

  test(`${label}: a gateway timeout is distinguishable from a bad request`, async ({
    page,
  }) => {
    await gotoFixture(page, { status: 504, body: "upstream request timeout" });

    await combobox(page).pressSequentially("Årh");
    await expect.poll(() => page.evaluate(() => window.events.length)).toBe(1);

    const error = await firstError(page);
    expect(error.status).toBe(504);
    expect(error.detail).toBe("upstream request timeout");
  });

  test(`${label}: a JSON error body is read as well as plain text`, async ({
    page,
  }) => {
    await gotoFixture(page, {
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({
        status: "fejl",
        beskrivelse: "id skal være en gyldig uuid (not-a-uuid)",
      }),
    });

    await combobox(page).pressSequentially("Årh");
    await expect.poll(() => page.evaluate(() => window.events.length)).toBe(1);

    const error = await firstError(page);
    expect(error.detail).toBe("id skal være en gyldig uuid (not-a-uuid)");
    expect(error.message, "not the raw JSON").not.toContain("beskrivelse");
  });

  test(`${label}: an empty body still says what the status was`, async ({
    page,
  }) => {
    await gotoFixture(page, { status: 500, body: "" });

    await combobox(page).pressSequentially("Årh");
    await expect.poll(() => page.evaluate(() => window.events.length)).toBe(1);

    const error = await firstError(page);
    expect(error.message).toContain("HTTP 500");
    expect(error.message, "no dangling separator").not.toMatch(/:\s*$/);
    expect(error.status).toBe(500);
  });

  test(`${label}: a page of HTML is trimmed rather than carried whole`, async ({
    page,
  }) => {
    // What a proxy in front of the service answers with when it is unwell.
    await gotoFixture(page, {
      status: 502,
      contentType: "text/html",
      body: `<html>\n<head><title>502 Bad Gateway</title></head>\n<body>\n${"<p>bad gateway</p>\n".repeat(80)}</body>\n</html>`,
    });

    await combobox(page).pressSequentially("Årh");
    await expect.poll(() => page.evaluate(() => window.events.length)).toBe(1);

    const error = await firstError(page);
    expect(error.detail, "the page's title, not its markup").toBe(
      "502 Bad Gateway",
    );
    expect(error.detail).not.toContain("<");
    expect(error.status).toBe(502);
  });

  test(`${label}: a page with no title is stripped of its markup`, async ({
    page,
  }) => {
    await gotoFixture(page, {
      status: 502,
      contentType: "text/html",
      body: `<html><body>\n${"<p>bad gateway</p>\n".repeat(80)}</body></html>`,
    });

    await combobox(page).pressSequentially("Årh");
    await expect.poll(() => page.evaluate(() => window.events.length)).toBe(1);

    const error = await firstError(page);
    expect(error.detail).not.toContain("<");
    expect(error.detail.length).toBeLessThanOrEqual(201);
    expect(error.detail, "collapsed to one line").not.toContain("\n");
  });

  test(`${label}: a refusal the service answers 200 with carries no status`, async ({
    page,
  }) => {
    // An expired token comes back as 200 with a "fejl" envelope. Reporting
    // status 200 on a failed search would make the field useless to branch on.
    await gotoFixture(page, {
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "fejl",
        beskrivelse: "Token er ikke gyldigt",
      }),
    });

    await combobox(page).pressSequentially("Årh");
    await expect.poll(() => page.evaluate(() => window.events.length)).toBe(1);

    const error = await firstError(page);
    expect(error.detail).toBe("Token er ikke gyldigt");
    expect(error.message).toContain("Token er ikke gyldigt");
    expect(error.status, "no failing status to report").toBeUndefined();
  });

  test(`${label}: the user is not shown the service's words`, async ({
    page,
  }) => {
    await gotoFixture(page, {
      status: 400,
      body: "maksimum skal være <= 200 (500)",
    });

    await combobox(page).pressSequentially("Årh");
    await expect(alert(page)).toBeVisible();

    // A cap an integrator set wrongly is not something a user can act on.
    await expect(alert(page)).toHaveText(GENERIC);
  });
}
