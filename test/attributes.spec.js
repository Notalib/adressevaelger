// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Regressions for upstream defects in 5.0.0, all in the web component's
 * attributeChangedCallback:
 *
 *   - disabled was only honoured as disabled="", so disabled="disabled" (the
 *     canonical form, and what Angular's [attr.disabled] writes) did nothing;
 *   - removing disabled, adgangsadresser-only or medtag-foreloebige left each
 *     of them on, because a removed attribute arrives as null and nothing
 *     handled it: medtag-foreloebige was even computed as null !== "false";
 *   - every attribute change removed the <input> and made a new one, which
 *     emptied what the user had typed, took their focus, and dropped any
 *     listener the page had put on the field.
 */

const FIXTURE_HTML = `<!doctype html>
<html lang="da">
  <head><meta charset="utf-8" /><title>fixture</title></head>
  <body>
    <adresse-search-input token="test-token"></adresse-search-input>
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
  await page.route("**/__attributes.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.route("https://adressevaelger.dk/**", (route) =>
    route.fulfill({ json: { status: "ok", beskrivelse: "", fund: [] } }),
  );
  await page.goto("/__attributes.html");
  await page.waitForFunction(() => "lib" in window);
}

const host = (page) => page.locator("adresse-search-input");
const input = (page) => page.locator("adresse-search-input input");

/**
 * Types into the field and returns the search request it sends.
 *
 * @param {import('@playwright/test').Page} page
 */
async function searchRequest(page) {
  const request = page.waitForRequest(/adressevaelger\.dk\/.*\/soeg/);
  await input(page).pressSequentially("Årh");
  return new URL((await request).url());
}

test.describe("web component: disabled", () => {
  for (const value of ["", "disabled", "true"]) {
    test(`disabled="${value}" disables the field`, async ({ page }) => {
      await gotoFixture(page);

      await host(page).evaluate(
        (el, v) => el.setAttribute("disabled", v),
        value,
      );
      await expect(input(page)).toBeDisabled();
    });
  }

  test("removing disabled enables the field again", async ({ page }) => {
    await gotoFixture(page);

    await host(page).evaluate((el) => el.setAttribute("disabled", ""));
    await expect(input(page)).toBeDisabled();
    await host(page).evaluate((el) => el.removeAttribute("disabled"));
    await expect(input(page)).toBeEnabled();
  });

  test("disabled set before connecting disables the field from the start", async ({
    page,
  }) => {
    await gotoFixture(page);

    const disabled = await page.evaluate(() => {
      const el = document.createElement("adresse-search-input");
      el.setAttribute("token", "test-token");
      el.setAttribute("disabled", "disabled");
      document.body.append(el);
      return el.querySelector("input")?.disabled;
    });
    expect(disabled).toBe(true);
  });
});

test.describe("web component: an attribute change leaves the field alone", () => {
  test("what the user typed, and their focus, survive a placeholder change", async ({
    page,
  }) => {
    await gotoFixture(page);

    await input(page).pressSequentially("Årh");
    await host(page).evaluate((el) =>
      el.setAttribute("placeholder", "Adresse"),
    );

    await expect(input(page)).toHaveValue("Årh");
    await expect(input(page)).toBeFocused();
    await expect(input(page)).toHaveAttribute("placeholder", "Adresse");
  });

  test("what the user typed survives being disabled and enabled again", async ({
    page,
  }) => {
    await gotoFixture(page);

    await input(page).pressSequentially("Årh");
    await host(page).evaluate((el) => el.setAttribute("disabled", ""));
    await host(page).evaluate((el) => el.removeAttribute("disabled"));

    await expect(input(page)).toHaveValue("Årh");
  });

  test("it is the same element, with the page's own listeners still on it", async ({
    page,
  }) => {
    await gotoFixture(page);

    const result = await host(page).evaluate((el) => {
      const before = el.querySelector("input");
      let heard = 0;
      before?.addEventListener("input", () => heard++);
      for (const name of [
        "placeholder",
        "disabled",
        "adgangsadresser-only",
        "kommune-kode",
        "maksimum",
        "medtag-foreloebige",
        "token",
        "api-url",
      ]) {
        el.setAttribute(name, name === "maksimum" ? "5" : "x");
        el.removeAttribute(name);
      }
      const after = el.querySelector("input");
      after?.dispatchEvent(new Event("input"));
      return {
        same: before === after,
        inputs: el.querySelectorAll("input").length,
        heard,
      };
    });

    expect(result).toEqual({ same: true, inputs: 1, heard: 1 });
  });

  test("removing placeholder puts the default back", async ({ page }) => {
    await gotoFixture(page);

    await host(page).evaluate((el) =>
      el.setAttribute("placeholder", "Adresse"),
    );
    await host(page).evaluate((el) => el.removeAttribute("placeholder"));
    await expect(input(page)).toHaveAttribute("placeholder", "Søg adresse");
  });
});

test.describe("web component: search options follow their attributes", () => {
  test("medtag-foreloebige is sent while present", async ({ page }) => {
    await gotoFixture(page);

    await host(page).evaluate((el) =>
      el.setAttribute("medtag-foreloebige", ""),
    );
    const url = await searchRequest(page);
    expect(url.searchParams.get("medtagForeloebige")).toBe("true");
  });

  test("removing medtag-foreloebige stops sending it", async ({ page }) => {
    await gotoFixture(page);

    await host(page).evaluate((el) => {
      el.setAttribute("medtag-foreloebige", "");
      el.removeAttribute("medtag-foreloebige");
    });
    const url = await searchRequest(page);
    expect(url.searchParams.has("medtagForeloebige")).toBe(false);
  });

  test('medtag-foreloebige="false" is still off', async ({ page }) => {
    await gotoFixture(page);

    await host(page).evaluate((el) =>
      el.setAttribute("medtag-foreloebige", "false"),
    );
    const url = await searchRequest(page);
    expect(url.searchParams.has("medtagForeloebige")).toBe(false);
  });

  test("removing adgangsadresser-only searches adresser again", async ({
    page,
  }) => {
    await gotoFixture(page);

    await host(page).evaluate((el) =>
      el.setAttribute("adgangsadresser-only", ""),
    );
    expect((await searchRequest(page)).pathname).toBe("/husnumre/soeg");

    await input(page).clear();
    await host(page).evaluate((el) =>
      el.removeAttribute("adgangsadresser-only"),
    );
    expect((await searchRequest(page)).pathname).toBe("/adresser/soeg");
  });

  test("removing maksimum stops sending it", async ({ page }) => {
    await gotoFixture(page);

    await host(page).evaluate((el) => {
      el.setAttribute("maksimum", "5");
      el.removeAttribute("maksimum");
    });
    const url = await searchRequest(page);
    expect(url.searchParams.has("maksimum")).toBe(false);
  });
});
