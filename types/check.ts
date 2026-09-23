/**
 * What a consumer in TypeScript should be able to write, compiled as part of
 * `npm run test:types`. Nothing here runs; if it stops compiling, the
 * generated declarations no longer describe the package.
 *
 * The @ts-expect-error lines are assertions too: each says the compiler must
 * reject what follows, so a declaration that quietly widens to `any` fails
 * this file rather than passing it.
 */
import adressevaelger, {
  AdresseSearchAPI,
  AdresseSearchInput,
  AdresseSearchUI,
} from "@notalib/adressevaelger";

const field = document.querySelector("input")!;

const picker: AdresseSearchUI = adressevaelger(field, {
  token: "a-token",
  select(address) {
    console.log(address);
  },
  adgangsadresserOnly: true,
  kommuneKode: "0580",
  maksimum: 10,
  medtagForeloebige: false,
  apiUrl: "https://example.test",
});

picker.setToken("another-token");
picker.destroy();

// The picker is what the factory returns, not a bare object.
const alsoAPicker: AdresseSearchUI = new AdresseSearchUI(field, {
  token: "a-token",
  select: () => {},
});
void alsoAPicker;

// token and select are required.
// @ts-expect-error
adressevaelger(field, { select: () => {} });
// @ts-expect-error
adressevaelger(field, { token: "a-token" });

// The field has to be an input: the picker reads and writes its value.
// @ts-expect-error
adressevaelger(document.createElement("div"), {
  token: "a-token",
  select: () => {},
});

// The internals are not the API: they are marked private, so a consumer
// cannot reach them and a later change cannot quietly expose them again.
// @ts-expect-error
picker.renderDOMList;
// @ts-expect-error
picker.inputElement;
// @ts-expect-error
picker.closeList();

const api = new AdresseSearchAPI({ token: "a-token" });

async function search() {
  const suggestions = await api.search("adresser", "Århusgade", {
    maksimum: 10,
  });
  const first: string = suggestions[0].titel;
  const address = await api.get("husnumre", "an-id");
  return { first, address };
}
void search;

// Only the two endpoints the service has.
// @ts-expect-error
void api.search("vejnavne", "Århusgade");

// The web component is a class to register yourself; it has no tag of its own.
customElements.define("adresse-search-input", AdresseSearchInput);

field.addEventListener("address:error", (event) => {
  const { message, status, detail } = (
    event as CustomEvent<{ message: string; status?: number; detail?: string }>
  ).detail;
  console.log(message, status, detail);
});
