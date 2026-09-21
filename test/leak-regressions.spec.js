// @ts-check
import { test, expect } from "@playwright/test";

/**
 * Regression tests for three upstream defects in adressevaelger 5.0.0.
 *
 * THESE TESTS ARE EXPECTED TO FAIL against 5.0.0. They assert the *correct*
 * behaviour, so that a fix can be verified by running them. To keep CI green
 * while the defects are open, add `test.fail();` as the first line of each.
 *
 *   1. AdresseSearchUI registers a document-level click listener per
 *      instantiation and never removes it (src/legacy.js:28).
 *   2. AdresseSearchInput appends a <style> to document.head on every
 *      connectedCallback and never removes it (src/web-component.js:151),
 *      appends a duplicate <ul> on every reconnect (src/web-component.js:178),
 *      and never clears the debounce timer (src/web-component.js:237).
 *   3. AdresseSearchAPI interpolates the search text into the request URL
 *      without encoding it (src/api.js:26).
 */

/** Number of open/close cycles; mirrors the five dialogs that embed the widget. */
const CYCLES = 5;

const API_GLOB = "https://adressevaelger.dk/**";

/**
 * A pristine page that loads the built ESM bundle and nothing else.
 * The demo page at / instantiates six pickers on load, which would make the
 * listener and <style> counts below ambiguous.
 */
const FIXTURE_HTML = `<!doctype html>
<html lang="da">
  <head><meta charset="utf-8" /><title>fixture</title></head>
  <body>
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
  await page.route("**/__fixture.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.goto("/__fixture.html");
  await page.waitForFunction(() => "lib" in window);
}

/**
 * Stub the search endpoint so these tests never touch the live API, and record
 * every request URL the component actually sends.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>} live array, appended to as requests are made
 */
async function stubAPI(page) {
  /** @type {string[]} */
  const requests = [];
  await page.route(API_GLOB, async (route) => {
    requests.push(route.request().url());
    await route.fulfill({ json: { fund: [] } });
  });
  return requests;
}

/**
 * Count document-level click listeners added and removed, and how often they
 * fire.
 *
 * Two details keep this from misreporting a fixed implementation. Wrapping
 * keeps a map from the original handler to its wrapper, so a removeEventListener
 * (fn) still unregisters correctly. And a listener added with an AbortSignal is
 * counted as removed when that signal aborts, because aborting releases the
 * listener without ever calling removeEventListener.
 *
 * @param {import('@playwright/test').Page} page
 */
async function probeDocumentListeners(page) {
  await page.addInitScript(() => {
    const w = /** @type {any} */ (window);
    w.__probe = { added: 0, removed: 0, fired: 0 };
    const wrappers = new Map();
    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;

    EventTarget.prototype.addEventListener = function (type, fn, options) {
      if (this === document && type === "click" && typeof fn === "function") {
        const wrapped = function (/** @type {Event} */ event) {
          w.__probe.fired++;
          return fn.call(this, event);
        };
        wrappers.set(fn, wrapped);
        w.__probe.added++;
        const signal = options && typeof options === "object" && options.signal;
        if (signal) {
          signal.addEventListener("abort", () => w.__probe.removed++, {
            once: true,
          });
        }
        return add.call(this, type, wrapped, options);
      }
      return add.call(this, type, fn, options);
    };

    EventTarget.prototype.removeEventListener = function (type, fn, options) {
      if (this === document && type === "click" && wrappers.has(fn)) {
        const wrapped = wrappers.get(fn);
        wrappers.delete(fn);
        w.__probe.removed++;
        return remove.call(this, type, wrapped, options);
      }
      return remove.call(this, type, fn, options);
    };
  });
}

test("legacy: document click listeners are released when the host is removed", async ({
  page,
}) => {
  await probeDocumentListeners(page);
  await stubAPI(page);
  await gotoFixture(page);

  const probe = await page.evaluate(async (cycles) => {
    const w = /** @type {any} */ (window);
    const click = () =>
      document.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    /** @type {HTMLElement[]} */
    const containers = [];
    for (let i = 0; i < cycles; i++) {
      // Open a "dialog": container + input, wire up the picker.
      const container = document.createElement("div");
      const input = document.createElement("input");
      input.type = "search";
      container.append(input);
      document.body.append(container);
      w.lib.adressevaelger(input, { token: "test-token", select() {} });
      containers.push(container);
    }

    // While mounted, every picker should respond to an outside click. This
    // also proves the probe is wired up, so the assertions below cannot pass
    // vacuously.
    w.__probe.fired = 0;
    click();
    const firedWhileMounted = w.__probe.fired;

    // Close them all again.
    for (const container of containers) container.remove();

    // Give any teardown a chance to run: an observer-based cleanup fires on a
    // microtask, so a synchronous click here would race it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    w.__probe.fired = 0;
    click();

    return { ...w.__probe, firedWhileMounted };
  }, CYCLES);

  // Sanity check: a mounted picker does dismiss on an outside click.
  expect(
    probe.firedWhileMounted,
    "every mounted picker should respond to an outside click",
  ).toBe(CYCLES);

  // The invariant, stated without prescribing how it is met: a picker whose
  // host is gone must leave no live document-level handler behind. Removing
  // the listener on teardown satisfies this; so would not registering one.
  expect
    .soft(
      probe.added - probe.removed,
      "no document click listener should outlive the host it was added for",
    )
    .toBe(0);
  expect
    .soft(
      probe.fired,
      "no detached picker should still respond to document clicks",
    )
    .toBe(0);
});

test("web component: document.head does not grow across open/close cycles", async ({
  page,
}) => {
  await stubAPI(page);
  await gotoFixture(page);

  const styles = await page.evaluate((cycles) => {
    const count = () => document.head.querySelectorAll("style").length;

    // One component first, and gone again: the shared stylesheet is put in the
    // page the first time any component is connected, and stays. It belongs to
    // the document rather than to an instance, so it is not what this counts.
    const warmUp = document.createElement("adresse-search-input");
    warmUp.setAttribute("token", "test-token");
    document.body.append(warmUp);
    warmUp.remove();

    const before = count();

    for (let i = 0; i < cycles; i++) {
      const el = document.createElement("adresse-search-input");
      el.setAttribute("token", "test-token");
      document.body.append(el);
      el.remove();
    }

    return { before, after: count() };
  }, CYCLES);

  expect(
    styles.after - styles.before,
    "each connectedCallback appends a <style> to document.head that disconnectedCallback never removes",
  ).toBe(0);
});

test("web component: reconnecting does not duplicate the listbox", async ({
  page,
}) => {
  await stubAPI(page);
  await gotoFixture(page);

  // A reconnect is not exotic: moving the element to another parent, or a
  // framework re-parenting it, disconnects and reconnects it.
  const lists = await page.evaluate((cycles) => {
    const el = document.createElement("adresse-search-input");
    el.setAttribute("token", "test-token");
    for (let i = 0; i < cycles; i++) {
      document.body.append(el);
      el.remove();
    }
    document.body.append(el);
    return el.querySelectorAll("ul").length;
  }, CYCLES);

  expect(
    lists,
    "renderList() appends a fresh <ul> per connect without removing the previous one",
  ).toBe(1);
});

test("web component: a pending search is cancelled when the element is removed", async ({
  page,
}) => {
  const requests = await stubAPI(page);
  await gotoFixture(page);

  await page.evaluate(() => {
    const el = document.createElement("adresse-search-input");
    el.setAttribute("token", "test-token");
    document.body.append(el);
    /** @type {any} */ (window).el = el;
  });

  // Type, then close the dialog inside the 300 ms debounce window.
  await page
    .locator("adresse-search-input input")
    .pressSequentially("Århus", { delay: 20 });
  await page.evaluate(() => /** @type {any} */ (window).el.remove());

  // Waiting for a fixed period is the point here: we are asserting that
  // something does *not* happen after the debounce would have elapsed.
  await page.waitForTimeout(800);

  expect(
    requests,
    "the debounce timer is never cleared, so a detached element still searches",
  ).toEqual([]);
});

/**
 * Type a query into a legacy picker and return the URL it requested.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} query
 * @returns {Promise<URL>}
 */
async function captureSearchURL(page, query) {
  const requests = await stubAPI(page);
  await gotoFixture(page);

  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    const container = document.createElement("div");
    const input = document.createElement("input");
    input.type = "search";
    input.id = "picker";
    container.append(input);
    document.body.append(container);
    w.lib.adressevaelger(input, { token: "test-token", select() {} });
  });

  await page.locator("#picker").fill(query);
  // fill() does not fire the per-character input events the debounce relies on,
  // so nudge it with a final keystroke and let the 500 ms debounce elapse.
  await page.locator("#picker").press("End");
  await page.waitForTimeout(900);

  expect(
    requests,
    `expected a search request for ${JSON.stringify(query)}`,
  ).not.toHaveLength(0);
  return new URL(requests[0]);
}

test("api: an ampersand in the address survives the query string", async ({
  page,
}) => {
  const url = await captureSearchURL(page, "Hovedgaden 1 & 2");

  expect(
    url.searchParams.get("tekst"),
    "an unencoded & splits the search text into a bogus extra parameter",
  ).toBe("Hovedgaden 1 & 2");
});

test("api: a hash in the address does not truncate the request", async ({
  page,
}) => {
  const url = await captureSearchURL(page, "Nørregade #3");

  expect
    .soft(
      url.searchParams.get("tekst"),
      "an unencoded # turns the rest of the URL into a fragment",
    )
    .toBe("Nørregade #3");
  // The live API answers this one with
  // 400 "Mangler nødvendig queryparameter: token".
  expect
    .soft(
      url.searchParams.get("token"),
      "the token is dropped entirely because it sits after the # in the URL",
    )
    .toBeTruthy();
});

test("api: the address cannot inject extra query parameters", async ({
  page,
}) => {
  const url = await captureSearchURL(page, "Hovedgaden&maksimum=1");

  expect
    .soft(
      url.searchParams.get("tekst"),
      "text typed by the user is interpolated straight into the query string",
    )
    .toBe("Hovedgaden&maksimum=1");
  // The live API honours the injected parameter rather than rejecting it.
  expect
    .soft(
      url.searchParams.getAll("maksimum"),
      "no parameter should appear that the caller did not set",
    )
    .toEqual([]);
});
