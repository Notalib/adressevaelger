// @ts-check
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * The demo listed vejnavn="xxx" and postnummer="xxx" among the web component's
 * optional attributes, and the API client sent both when the legacy picker was
 * given them. The component never observed either attribute, and the service
 * would not have used them anyway: it reads vejnavn and postnummer only for a
 * search without tekst, and every search both versions make sends tekst.
 * Measured on the live service for /adresser/soeg and /husnumre/soeg,
 *
 *   tekst=Århusgade                → 2100 København Ø, 2150 Nordhavn, 9900 …
 *   tekst=Århusgade&postnummer=8000 → the same three
 *
 * so the fix is to stop advertising and sending them, not to wire them up.
 */

const FIXTURE_HTML = `<!doctype html>
<html lang="da">
  <head><meta charset="utf-8" /><title>fixture</title></head>
  <body>
    <div><input type="search" id="legacy" /></div>
    <adresse-search-input token="test-token" vejnavn="Århusgade" postnummer="2100">
    </adresse-search-input>
    <script type="module">
      import * as lib from "./adressevaelger.esm.js";
      customElements.define("adresse-search-input", lib.AdresseSearchInput);
      window.lib = lib;
      window.picker = lib.adressevaelger(document.getElementById("legacy"), {
        token: "test-token",
        vejnavn: "Århusgade",
        postnummer: "2100",
        kommuneKode: "0101",
        select() {},
      });
    </script>
  </body>
</html>`;

/**
 * @param {import('@playwright/test').Page} page
 */
async function gotoFixture(page) {
  await page.route("**/__filters.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) =>
    route.fulfill({ json: { status: "ok", beskrivelse: "", fund: [] } }),
  );
  await page.goto("/__filters.html");
  await page.waitForFunction(() => "picker" in window);
}

for (const { label, input } of [
  { label: "legacy", input: "#legacy" },
  { label: "web component", input: "adresse-search-input input" },
]) {
  test(`${label}: vejnavn and postnummer are not sent`, async ({ page }) => {
    await gotoFixture(page);

    const request = page.waitForRequest(/adressevaelger\.dk\/.*\/soeg/);
    await page.locator(input).pressSequentially("Årh");
    const url = new URL((await request).url());

    expect(url.searchParams.get("tekst")).toBe("Årh");
    expect(url.searchParams.has("vejnavn")).toBe(false);
    expect(url.searchParams.has("postnummer")).toBe(false);
  });
}

test("legacy: the filters the service does use are still sent", async ({
  page,
}) => {
  await gotoFixture(page);

  const request = page.waitForRequest(/adressevaelger\.dk\/.*\/soeg/);
  await page.locator("#legacy").pressSequentially("Årh");
  const url = new URL((await request).url());

  expect(url.searchParams.get("kommuneKode")).toBe("0101");
});

test("web component: the demo lists only attributes the component observes", async ({
  page,
}) => {
  await gotoFixture(page);

  // The commented-out examples between "Optional attributes" and the closing
  // tag of the demo's web component.
  const demo = readFileSync(
    new URL("../demo/index.html", import.meta.url),
    "utf8",
  );
  const block = demo.match(
    /Optional attributes \*\* -->([\s\S]*?)<\/adressevaegler-input>/,
  );
  expect(block, "the demo's attribute list").toBeTruthy();
  const advertised = [...(block?.[1] ?? "").matchAll(/<!--\s*([a-z-]+)/g)].map(
    (match) => match[1],
  );
  expect(advertised.length).toBeGreaterThan(0);

  const observed = await page.evaluate(
    () => /** @type {any} */ (window).lib.AdresseSearchInput.observedAttributes,
  );
  expect(advertised.filter((name) => !observed.includes(name))).toEqual([]);
});
