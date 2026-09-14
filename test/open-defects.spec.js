// @ts-check
/**
 * Reproductions for the open defects filed as issues on Notalib/adressevaelger.
 *
 * Each lettered test asserts the *correct* behaviour, so it FAILS while the
 * defect is open and passes once it is fixed. The letter in the title is
 * referenced from the corresponding issue.
 *
 * Tests prefixed "control:" are expected to PASS today. They pin down the
 * behaviour the defects are contrasted with (for example, that the keyboard
 * path already restores focus while the mouse path does not), and guard
 * against the fixture itself being broken. "I1. web component" and both
 * "I2." tests are controls too; they share a loop with the failing variant.
 *
 * The API is stubbed with page.route and the component is loaded on an
 * isolated fixture page, so nothing here touches the live service.
 *
 * Run:  npx playwright test test/open-defects.spec.js --reporter=line
 *
 * Make sure nothing else is listening on port 8000 first: playwright.config
 * reuses an existing server there, so a dev server from another checkout
 * would silently be the thing under test.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const API = "https://adressevaelger.dk/**";
const H1 = "0a3f507b-37d7-32b8-e044-0003ba298018";
const A1 = "0a3f50c7-9994-32b8-e044-0003ba298018";
const LEAF = {
  type: "adresse",
  id: A1,
  titel: "Århusgade 1, st. tv, 2100 København Ø",
  husnummerId: H1,
};
const RESULTS = {
  Årh: [
    { type: "vejnavn", titel: "Århusgade", vejNavn: "Århusgade" },
    { type: "vejnavn", titel: "Århusvej", vejNavn: "Århusvej" },
    LEAF,
  ],
  Århu: [{ type: "vejnavn", titel: "Århusgade", vejNavn: "Århusgade" }],
  Århusgade: [
    {
      id: "387c8db6-bb43-4613-af5d-c7bb06b858ef",
      type: "navngivenvejpostnummer",
      titel: "Århusgade 2100 København Ø",
      vejnavn: "Århusgade",
      postnr: "2100",
    },
  ],
  "Århusgade 2100 København Ø": [
    { type: "husnummer", id: H1, titel: "Århusgade 1, 2100 København Ø" },
    LEAF,
  ],
  Vej: Array.from({ length: 100 }, (_, i) => ({
    type: "vejnavn",
    titel: `Vej ${i + 1}`,
    vejNavn: `Vej ${i + 1}`,
  })),
};

const FIXTURE_HTML = `<!doctype html>
<html lang="da"><head><meta charset="utf-8" /><title>probe</title>
<link rel="stylesheet" href="./adressevaelger.css" /></head>
<body>
  <label for="legacy">Adresse (legacy)</label>
  <div class="autocomplete-container"><input type="search" id="legacy" /></div>
  <input id="after-legacy" placeholder="next field" />
  <adresse-search-input id="author-id" token="adressevaelger123"></adresse-search-input>
  <input id="after-wc" placeholder="next field" />
  <script type="module">
    import * as lib from "./adressevaelger.esm.js";
    customElements.define("adresse-search-input", lib.AdresseSearchInput);
    window.lib = lib;
    window.events = [];
    for (const type of ["address:error", "address:select"]) {
      document.addEventListener(type, (e) =>
        window.events.push({ type, target: e.target.id || e.target.tagName, detail: e.detail && (e.detail.message || "select") }));
    }
    window.picker = lib.adressevaelger(document.getElementById("legacy"), {
      token: "adressevaelger123", select() {},
    });
  </script>
</body></html>`;

async function gotoFixture(page) {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message)));
  await page.route("**/__probe.html", (route) =>
    route.fulfill({ contentType: "text/html", body: FIXTURE_HTML }),
  );
  await page.goto("/__probe.html");
  await page.waitForFunction(() => "picker" in window);
  return pageErrors;
}

async function stubAPI(page, { delayFor = {}, status = 200, body } = {}) {
  const log = [];
  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    log.push(url.pathname + url.search);
    if (body !== undefined) {
      return route.fulfill({ status, contentType: "text/plain", body });
    }
    const m = url.pathname.match(/^\/(adresser|husnumre)\/(soeg|[^/]+)$/);
    if (m && m[2] === "soeg") {
      const tekst = url.searchParams.get("tekst") ?? "";
      if (delayFor[tekst]) await new Promise((r) => setTimeout(r, delayFor[tekst]));
      return route.fulfill({
        json: { status: "ok", beskrivelse: "", fund: RESULTS[tekst] || [] },
      });
    }
    if (m) {
      return route.fulfill({
        json: { status: "ok", adresse: { id_lokalid: m[2], adressebetegnelse: "x" } },
      });
    }
    return route.fulfill({ status: 404, body: "no stub" });
  });
  return log;
}

const wcInput = (page) => page.locator("adresse-search-input input");
const legacyInput = (page) => page.locator("#legacy");
const events = (page) => page.evaluate(() => window.events);
const active = (page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName.toLowerCase()}#${a.id}` : null;
  });

// ---------------------------------------------------------------------------
test("control: browser and CSS anchor positioning support", async ({ page, browserName }) => {
  await gotoFixture(page);
  const info = await page.evaluate(() => ({
    ua: navigator.userAgent,
    anchor: CSS.supports("position-anchor: --x") && CSS.supports("top: anchor(bottom)"),
    popover: "popover" in HTMLElement.prototype,
    nesting: CSS.supports("selector(&)"),
  }));
  console.log(`[${browserName}] env`, JSON.stringify(info));
});

// A. spurious address:error on type-then-delete inside the debounce window
for (const [label, getInput, wait] of [
  ["web component", wcInput, 600],
  ["legacy", legacyInput, 900],
]) {
  test(`A. ${label}: type then delete quickly does not raise address:error`, async ({ page, browserName }) => {
    await gotoFixture(page);
    const log = await stubAPI(page);
    const input = getInput(page);
    await input.pressSequentially("Å");
    await input.press("Backspace");
    await page.waitForTimeout(wait);
    const ev = await events(page);
    console.log(`[${browserName}] A ${label}: requests=${JSON.stringify(log)} events=${JSON.stringify(ev)}`);
    expect(ev.filter((e) => e.type === "address:error")).toHaveLength(0);
  });
}

// B1. stale response overwrites newer results
for (const [label, getInput, debounce] of [
  ["web component", wcInput, 300],
  ["legacy", legacyInput, 500],
]) {
  test(`B1. ${label}: a slow earlier response does not overwrite newer results`, async ({ page, browserName }) => {
    await gotoFixture(page);
    await stubAPI(page, { delayFor: { Årh: 1500 } });
    const input = getInput(page);
    await input.pressSequentially("Årh");
    await page.waitForTimeout(debounce + 100); // "Årh" request is now in flight (slow)
    await input.press("u"); // "Århu" → fast
    await expect(page.getByRole("option", { name: "Århusgade", exact: true })).toBeVisible();
    await page.waitForTimeout(1800); // slow "Årh" response lands
    const names = await page.getByRole("option").allInnerTexts();
    console.log(`[${browserName}] B1 ${label}: value=${await input.inputValue()} options=${JSON.stringify(names)}`);
    expect(names).toEqual(["Århusgade"]);
  });

  test(`B2. ${label}: list stays closed after selecting while a search is in flight`, async ({ page, browserName }) => {
    await gotoFixture(page);
    await stubAPI(page, { delayFor: { Århu: 1500 } });
    const input = getInput(page);
    await input.pressSequentially("Årh");
    await page.getByRole("option", { name: LEAF.titel }).waitFor();
    await input.press("u"); // "Århu" search now pending (slow)
    await page.waitForTimeout(debounce + 100);
    await page.getByRole("option", { name: LEAF.titel }).click();
    await expect(input).toHaveValue(LEAF.titel);
    const before = await page.getByRole("option").count();
    await page.waitForTimeout(1800);
    const visible = await page.getByRole("option").filter({ visible: true }).count();
    const ev = await events(page);
    console.log(`[${browserName}] B2 ${label}: options right after select=${before}, visible options 1.8s later=${visible}, events=${JSON.stringify(ev)}`);
    expect(visible).toBe(0);
  });
}

// C. `style` class field shadows HTMLElement.prototype.style
test("C. web component: element.style is still a CSSStyleDeclaration", async ({ page, browserName }) => {
  await gotoFixture(page);
  const r = await page.evaluate(() => {
    "use strict";
    const el = document.querySelector("adresse-search-input");
    let threw = null;
    try {
      el.style.display = "none";
    } catch (e) {
      threw = `${e.constructor.name}: ${e.message}`;
    }
    return {
      typeofStyle: typeof el.style,
      own: Object.prototype.hasOwnProperty.call(el, "style"),
      setProperty: typeof el.style.setProperty,
      threw,
      computedDisplay: getComputedStyle(el).display,
    };
  });
  console.log(`[${browserName}] C:`, JSON.stringify(r));
  expect(r.typeofStyle).toBe("object");
});

// D. author-supplied id is overwritten
test("D. web component: keeps the id the author gave it", async ({ page, browserName }) => {
  await gotoFixture(page);
  const r = await page.evaluate(() => ({
    byAuthorId: !!document.getElementById("author-id"),
    actualId: document.querySelector("adresse-search-input").id,
  }));
  console.log(`[${browserName}] D:`, JSON.stringify(r));
  expect(r.byAuthorId).toBe(true);
});

// E. attribute handling
test("E1. web component: disabled=\"disabled\" disables the input", async ({ page, browserName }) => {
  await gotoFixture(page);
  await page.evaluate(() => document.querySelector("adresse-search-input").setAttribute("disabled", "disabled"));
  const d = await wcInput(page).isDisabled();
  console.log(`[${browserName}] E1: disabled="disabled" → input.disabled=${d}`);
  expect(d).toBe(true);
});

test("E2. web component: removing disabled re-enables the input", async ({ page, browserName }) => {
  await gotoFixture(page);
  await page.evaluate(() => document.querySelector("adresse-search-input").setAttribute("disabled", ""));
  const afterSet = await wcInput(page).isDisabled();
  await page.evaluate(() => document.querySelector("adresse-search-input").removeAttribute("disabled"));
  const afterRemove = await wcInput(page).isDisabled();
  console.log(`[${browserName}] E2: after set=${afterSet}, after remove=${afterRemove}`);
  expect(afterRemove).toBe(false);
});

test("E3. web component: an attribute change keeps the typed value", async ({ page, browserName }) => {
  await gotoFixture(page);
  await stubAPI(page);
  await wcInput(page).pressSequentially("Årh");
  await page.evaluate(() => document.querySelector("adresse-search-input").setAttribute("placeholder", "Adresse"));
  const v = await wcInput(page).inputValue();
  const focused = await active(page);
  console.log(`[${browserName}] E3: value after placeholder change="${v}", activeElement=${focused}`);
  expect(v).toBe("Årh");
});

test("E4. web component: removing medtag-foreloebige stops sending it", async ({ page, browserName }) => {
  await gotoFixture(page);
  const log = await stubAPI(page);
  await page.evaluate(() => {
    const el = document.querySelector("adresse-search-input");
    el.setAttribute("medtag-foreloebige", "");
    el.removeAttribute("medtag-foreloebige");
  });
  await wcInput(page).pressSequentially("Årh");
  await page.getByRole("option", { name: "Århusgade", exact: true }).waitFor();
  console.log(`[${browserName}] E4: ${JSON.stringify(log)}`);
  expect(log[0]).not.toContain("medtagForeloebige=true");
});

test("E5. web component: vejnavn / postnummer attributes from the demo are honoured", async ({ page, browserName }) => {
  await gotoFixture(page);
  const log = await stubAPI(page);
  await page.evaluate(() => {
    const el = document.querySelector("adresse-search-input");
    el.setAttribute("vejnavn", "Århusgade");
    el.setAttribute("postnummer", "2100");
  });
  await wcInput(page).pressSequentially("Årh");
  await page.getByRole("option", { name: "Århusgade", exact: true }).waitFor();
  console.log(`[${browserName}] E5: ${JSON.stringify(log)}`);
  expect(log[0]).toContain("vejnavn=");
});

// F. ArrowDown with nothing to move to
test("F1. web component: ArrowDown before any results does not throw", async ({ page, browserName }) => {
  const errors = await gotoFixture(page);
  await wcInput(page).focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(100);
  console.log(`[${browserName}] F1: pageerrors=${JSON.stringify(errors)}`);
  expect(errors).toEqual([]);
});

test("F2. legacy: ArrowDown after a search with no hits does not throw", async ({ page, browserName }) => {
  const errors = await gotoFixture(page);
  await stubAPI(page);
  await legacyInput(page).pressSequentially("zzz");
  await page.waitForTimeout(900);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(100);
  console.log(`[${browserName}] F2: pageerrors=${JSON.stringify(errors)}`);
  expect(errors).toEqual([]);
});

// G. legacy: clearing the field leaves the list open
test("G. legacy: clearing the input closes the suggestion list", async ({ page, browserName }) => {
  await gotoFixture(page);
  await stubAPI(page);
  const input = legacyInput(page);
  await input.pressSequentially("Årh");
  await page.getByRole("option", { name: "Århusgade", exact: true }).waitFor();
  await input.fill("");
  await page.waitForTimeout(700);
  const visible = await page.getByRole("option").filter({ visible: true }).count();
  console.log(`[${browserName}] G: visible options after clearing=${visible}`);
  expect(visible).toBe(0);
});

// H. Focus leaving the component leaves the list open.
// Focus is moved to the next field directly rather than with Tab, so this
// isolates the missing focusout handling from the tab-stop defect (H2): with
// Tab, focus would land on the first option and never leave the component.
for (const [label, getInput, nextId] of [
  ["web component", wcInput, "after-wc"],
  ["legacy", legacyInput, "after-legacy"],
]) {
  test(`H. ${label}: moving focus to the next field closes the list`, async ({ page, browserName }) => {
    await gotoFixture(page);
    await stubAPI(page);
    const input = getInput(page);
    await input.pressSequentially("Årh");
    await page.getByRole("option", { name: "Århusgade", exact: true }).waitFor();
    await page.locator(`#${nextId}`).focus();
    await page.waitForTimeout(100);
    const visible = await page.getByRole("option").filter({ visible: true }).count();
    const focused = await active(page);
    console.log(`[${browserName}] H ${label}: focus=${focused}, visible options after focus moved=${visible}`);
    expect(focused).toBe(`input#${nextId}`);
    expect(visible).toBe(0);
  });
}

// I. focus after selection
for (const [label, getInput] of [
  ["web component", wcInput],
  ["legacy", legacyInput],
]) {
  test(`I1. ${label}: focus returns to the input after a mouse selection`, async ({ page, browserName }) => {
    await gotoFixture(page);
    await stubAPI(page);
    const input = getInput(page);
    await input.pressSequentially("Årh");
    await page.getByRole("option", { name: "Århusgade", exact: true }).click(); // vejnavn → list refreshes
    await page.getByRole("option", { name: "Århusgade 2100 København Ø" }).waitFor();
    const afterStreet = await active(page);
    await page.keyboard.press("ArrowDown");
    const afterArrow = await active(page);
    await page.getByRole("option", { name: "Århusgade 2100 København Ø" }).click();
    await page.getByRole("option", { name: LEAF.titel }).click();
    await expect(input).toHaveValue(LEAF.titel);
    const afterLeaf = await active(page);
    console.log(`[${browserName}] I1 ${label}: after street click=${afterStreet}, after ArrowDown=${afterArrow}, after leaf click=${afterLeaf}`);
    expect(afterLeaf).toMatch(/^input#/);
  });

  test(`I2. ${label}: focus returns to the input after a keyboard selection`, async ({ page, browserName }) => {
    await gotoFixture(page);
    await stubAPI(page);
    const input = getInput(page);
    await input.pressSequentially("Årh");
    await page.getByRole("option", { name: LEAF.titel }).waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("option", { name: LEAF.titel })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(input).toHaveValue(LEAF.titel);
    const focused = await active(page);
    console.log(`[${browserName}] I2 ${label}: focus after Enter=${focused}`);
    expect(focused).toMatch(/^input#/);
  });
}

// J. accessibility tree
for (const [label, getInput] of [
  ["web component", wcInput],
  ["legacy", legacyInput],
]) {
  test(`J. ${label}: combobox reports expanded state`, async ({ page, browserName }) => {
    await gotoFixture(page);
    await stubAPI(page);
    const input = getInput(page);
    const before = await input.ariaSnapshot();
    await input.pressSequentially("Årh");
    await page.getByRole("option", { name: "Århusgade", exact: true }).waitFor();
    const after = await input.ariaSnapshot();
    const expanded = await input.getAttribute("aria-expanded");
    console.log(`[${browserName}] J ${label}: before=${JSON.stringify(before)} after=${JSON.stringify(after)} aria-expanded=${expanded}`);
    expect(expanded).toBe("true");
  });
}

// K. legacy list has no max-height
test("K. legacy: 100 results fit in the viewport", async ({ page, browserName }) => {
  await gotoFixture(page);
  await stubAPI(page);
  await legacyInput(page).pressSequentially("Vej");
  await page.getByRole("option", { name: "Vej 100" }).waitFor();
  const r = await page.evaluate(() => {
    const ul = document.querySelector("ul.adressevaelger-suggestions");
    const b = ul.getBoundingClientRect();
    return { listHeight: Math.round(b.height), viewport: window.innerHeight, scrollable: ul.scrollHeight > ul.clientHeight };
  });
  console.log(`[${browserName}] K:`, JSON.stringify(r));
  expect(r.listHeight).toBeLessThanOrEqual(r.viewport);
});

// L. non-2xx responses lose the API's own message
test("L. api: a 400 with a message surfaces that message", async ({ page, browserName }) => {
  await gotoFixture(page);
  await stubAPI(page, { status: 400, body: "maksimum skal være <= 200 (500)" });
  await wcInput(page).pressSequentially("Årh");
  await page.waitForTimeout(600);
  const ev = await events(page);
  console.log(`[${browserName}] L:`, JSON.stringify(ev));
  expect(ev[0]?.detail).toContain("maksimum");
});

// M. web component popover placement
test("control M. web component: popover sits under the input", async ({ page, browserName }) => {
  await gotoFixture(page);
  await stubAPI(page);
  await wcInput(page).pressSequentially("Årh");
  await page.getByRole("option", { name: "Århusgade", exact: true }).waitFor();
  const r = await page.evaluate(() => {
    const i = document.querySelector("adresse-search-input input").getBoundingClientRect();
    const l = document.querySelector("adresse-search-input ul").getBoundingClientRect();
    return { inputBottom: Math.round(i.bottom), inputLeft: Math.round(i.left), listTop: Math.round(l.top), listLeft: Math.round(l.left), listWidth: Math.round(l.width) };
  });
  console.log(`[${browserName}] M:`, JSON.stringify(r));
  expect(Math.abs(r.listTop - r.inputBottom)).toBeLessThan(4);
});

// H2. every option is a tab stop
for (const [label, getInput, nextId] of [
  ["web component", wcInput, "after-wc"],
  ["legacy", legacyInput, "after-legacy"],
]) {
  test(`H2. ${label}: one Tab reaches the next field with 100 results open`, async ({ page, browserName }) => {
    await gotoFixture(page);
    await stubAPI(page);
    await getInput(page).pressSequentially("Vej");
    await page.getByRole("option", { name: "Vej 100", exact: true }).waitFor();
    let presses = 0;
    let focused = "";
    while (presses < 150) {
      await page.keyboard.press("Tab");
      presses++;
      focused = await active(page);
      if (!focused.startsWith("li#")) break;
    }
    const visible = await page.getByRole("option").filter({ visible: true }).count();
    console.log(`[${browserName}] H2 ${label}: Tab presses to leave the list=${presses}, landed on=${focused}, visible options then=${visible}`);
    expect(presses).toBe(1);
    expect(focused).toBe(`input#${nextId}`);
  });
}

// N. keyup-based navigation ignores key auto-repeat
test("N. web component: holding ArrowDown (3 repeated keydowns) moves three options", async ({ page, browserName }) => {
  await gotoFixture(page);
  await stubAPI(page);
  await wcInput(page).pressSequentially("Vej");
  await page.getByRole("option", { name: "Vej 100", exact: true }).waitFor();
  await page.keyboard.press("ArrowDown"); // into the list
  await page.keyboard.down("ArrowDown");
  await page.keyboard.down("ArrowDown");
  await page.keyboard.down("ArrowDown");
  await page.keyboard.up("ArrowDown");
  const focused = await page.evaluate(() => document.activeElement.textContent);
  console.log(`[${browserName}] N: focused after 3 held keydowns + 1 keyup = "${focused}"`);
  expect(focused).toBe("Vej 4");
});

// O. web component in a browser without the Popover API (Safari ≤ 16, Firefox ≤ 124)
test("O. web component: still usable without the Popover API", async ({ page, browserName }) => {
  await page.addInitScript(() => {
    delete HTMLElement.prototype.popover;
    delete HTMLElement.prototype.showPopover;
    delete HTMLElement.prototype.hidePopover;
    delete HTMLElement.prototype.togglePopover;
  });
  const errors = await gotoFixture(page);
  await stubAPI(page);
  await wcInput(page).pressSequentially("Årh");
  await page.waitForTimeout(700);
  const visible = await page.getByRole("option").filter({ visible: true }).count();
  const ev = await events(page);
  console.log(`[${browserName}] O: visible options=${visible}, events=${JSON.stringify(ev)}, pageerrors=${JSON.stringify(errors)}`);
  expect(visible).toBe(3);
});

// P. the package cannot be imported where there is no DOM
test("P. package: index.js can be imported in Node without a DOM", async () => {
  // Runs in the Playwright worker process, which has no HTMLElement.
  await expect(import(pathToFileURL(path.join(ROOT, "index.js")).href)).resolves.toBeDefined();
});

// Q. README quick start links the stylesheet
test("Q. docs: README quick start has a well-formed stylesheet link", () => {
  const readme = readFileSync(path.join(ROOT, "README.md"), "utf8");
  expect(readme).toContain('href="./adressevaelger.css"');
});
