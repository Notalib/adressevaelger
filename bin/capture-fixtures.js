/**
 * Capture real responses from the search API and freeze them as test fixtures.
 *
 *   node bin/capture-fixtures.js
 *
 * The GUI tests serve these instead of calling the API, so they are
 * deterministic and do not depend on the service being up. Re-run this when the
 * addresses the tests walk through change, or to refresh the data deliberately.
 *
 * A token is read from ADRESSEVAELGER_TOKEN, or from the demo page in dist/.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";

const BASE = process.env.ADRESSEVAELGER_API_URL ?? "https://adressevaelger.dk";
const OUT = "test/fixtures/dar-responses.json";

// Enough context around the target to exercise list rendering and keyboard
// navigation, without freezing all hundred results into the repository.
const KEEP = 10;

// The chain the GUI tests walk: each search selects an option whose title is
// the next search. Street, then street with postcode, then house number, then
// the address itself.
const STAGES = [
  ["Årh", "Århusgade"],
  ["Århusgade", "Århusgade 2100 København Ø"],
  ["Århusgade 2100 København Ø", "Århusgade 1, 2100 København Ø"],
  ["Århusgade 1, 2100 København Ø", "Århusgade 1, st. tv, 2100 København Ø"],
];

async function token() {
  if (process.env.ADRESSEVAELGER_TOKEN) {
    return process.env.ADRESSEVAELGER_TOKEN;
  }
  const demo = await readFile("dist/index.html", "utf8");
  const match = demo.match(/token: "([^"]*)"/);
  if (!match) {
    throw new Error(
      "No token found. Set ADRESSEVAELGER_TOKEN, or keep one in dist/index.html.",
    );
  }
  return match[1];
}

/** The endpoint returns an intermittent 504, so retry rather than give up. */
async function fetchJSON(path, params) {
  const url = new URL(path, BASE);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      lastError = err;
      console.warn(`  attempt ${attempt} failed: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error(`Giving up on ${url.pathname}: ${lastError.message}`);
}

/** Keep the target option plus some neighbours, in their original order. */
function trim(fund, titel) {
  const target = fund.find((item) => item.titel === titel);
  const kept = new Set([target, ...fund.slice(0, KEEP - 1)]);
  return fund.filter((item) => kept.has(item));
}

const auth = { token: await token() };
const searches = {};
let selected;

for (const [tekst, titel] of STAGES) {
  console.info(`searching ${JSON.stringify(tekst)}`);
  const data = await fetchJSON("/adresser/soeg", { ...auth, tekst });
  if (!data.fund?.some((item) => item.titel === titel)) {
    throw new Error(
      `${JSON.stringify(titel)} is no longer among the results for ` +
        `${JSON.stringify(tekst)}. The addresses in STAGES need updating.`,
    );
  }
  searches[tekst] = {
    status: "ok",
    beskrivelse: "",
    fund: trim(data.fund, titel),
  };
  selected = data.fund.find((item) => item.titel === titel);
}

console.info(`looking up ${selected.id}`);
const address = await fetchJSON(`/adresser/${selected.id}`, auth);

await mkdir("test/fixtures", { recursive: true });
await writeFile(
  OUT,
  JSON.stringify(
    {
      comment:
        "Captured from the live API by bin/capture-fixtures.js. The GUI tests " +
        "serve these instead of calling it. Re-run that script to refresh.",
      capturedAt: new Date().toISOString().slice(0, 10),
      searches,
      address: { id: selected.id, response: address },
    },
    null,
    2,
  ) + "\n",
  "utf8",
);

console.info(`\nWrote ${OUT}`);
for (const [tekst, body] of Object.entries(searches)) {
  console.info(`  ${JSON.stringify(tekst)}: ${body.fund.length} results`);
}
