# How to implement Adressevaelger

Adressevaelger is a JavaScript-component that enables users to enter a Danish address in a single input field.

## Usage

Adressevaelger is distributed only via GitHub and must be downloaded and included in your project manually.
No package manager or CDN distribution is provided; the component must be included as static files in your project.

Repository: https://github.com/SDFIdk/adressevaelger

**Important notice:** Setting up Adressevaelger requires a valid token. [Learn how to get one at confluence.sdfi.dk](https://confluence.sdfi.dk/display/ADV/Brugerstyring)

## Download

The bundles are built, not committed, so there is nothing to copy out of the
repository tree. Install the package:

```sh
echo "@notalib:registry=https://npm.pkg.github.com" >> .npmrc
npm install @notalib/adressevaelger
```

Its `dist/` holds what you will typically need:

adressevaelger.iife.js (for direct browser usage)
adressevaelger.esm.js (for ES module usage)
adressevaelger.css

Building a checkout yourself gives you the same files:

```sh
npm ci && npm run build
```

`npm run dev` rebuilds as you edit and serves the demo page from `demo/`.



## Setting up CSS

Add the necessary CSS styles in your HTML `<head>` section.

Option 1: Link to local file
```html
<link rel="stylesheet" href="./adressevaelger.css" />
```

Option 2: Inline CSS
```html
<style>
  /* adressevaelger styles*/
  .autocomplete-container {
    /* relative position for at de absolut positionerede forslag får korrekt placering.*/
    position: relative;
    width: 100%;
    max-width: 30em;
  }

  .autocomplete-container input {
    /* Både input og forslag får samme bredde som omkringliggende DIV */
    width: 100%;
    box-sizing: border-box;
  }

  .adressevaelger-suggestions {
    margin: 0.3em 0 0 0;
    padding: 0;
    text-align: left;
    border-radius: 0.3125em;
    background: #fcfcfc;
    box-shadow: 0 0.0625em 0.15625em rgba(0, 0, 0, 0.15);
    position: absolute;
    left: 0;
    right: 0;
    z-index: 9999;
    overflow-y: auto;
    box-sizing: border-box;
  }

  .adressevaelger-suggestions .adressevaelger-suggestion {
    margin: 0;
    list-style: none;
    cursor: pointer;
    padding: 0.4em 0.6em;
    color: #333;
    border: 0.0625em solid #ddd;
    border-bottom-width: 0;
  }

  .adressevaelger-suggestions .adressevaelger-suggestion:first-child {
    border-top-left-radius: inherit;
    border-top-right-radius: inherit;
  }

  .adressevaelger-suggestions .adressevaelger-suggestion:last-child {
    border-bottom-left-radius: inherit;
    border-bottom-right-radius: inherit;
    border-bottom-width: 0.0625em;
  }

  .adressevaelger-suggestions
    .adressevaelger-suggestion.dawa-selected,
  .adressevaelger-suggestions .adressevaelger-suggestion:hover {
    background: #f0f0f0;
  }
</style>
```

## Script option 1: Direct browser usage (IIFE)

Include the script file from your local project:

```html
<script src="./adressevaelger.iife.js"></script>
```

Then add the following markup and script to your HTML <body> section:

```html
<!-- HTML -->
<label for="adressevaelger-input">Søg efter adresser</label>
<div class="autocomplete-container">
  <input type="search" id="adressevaelger-input" />
</div>

<!-- Javascript -->
<script>
  adressevaelger.adressevaelger(document.getElementById("adressevaelger-input"), {
    select: function (selected) {
      console.log("Selected address:", selected);
    },
    token: "your-token-here",
  });
</script>
```

## Script option 2: ES module

Add the following markup and script to your HTML `<body>` section:

```html
<!-- HTML -->
<label for="adressevaelger-input">Søg efter adresser</label>
<div class="autocomplete-container">
  <input type="search" id="adressevaelger-input" />
</div>

<!-- Javascript -->
<script type="module">
  import { adressevaelger } from "./adressevaelger.esm.js"; 
  var inputElement = document.getElementById("adressevaelger-input");
  var component = adressevaelger(inputElement, {
    select: function (selected) {
      console.log("Valgt adresse: ", selected);
    },
    token: "your-token-here"
  });
</script>
```

## Script option 3: Web component

Register the element under a name of your choice, and put it in your markup
with a `label`:

```html
<!-- HTML -->
<adresse-search-input
  token="your-token-here"
  label="Søg efter adresser"
></adresse-search-input>

<!-- Javascript -->
<script type="module">
  import { AdresseSearchInput } from "./adressevaelger.esm.js";
  customElements.define("adresse-search-input", AdresseSearchInput);

  document
    .querySelector("adresse-search-input")
    .addEventListener("address:select", (event) => {
      console.log("Valgt adresse: ", event.detail);
    });
</script>
```

The element makes its own input, so there is no input of yours to point a
`<label for>` at, and the input's id is generated. Give it a `label` instead:
the element puts a `<label>` for its input in front of it, visible and tied to
the field, and keeps it in step when the attribute changes. Without one, the
field is named only by its placeholder, which disappears as soon as the user
types and which some screen readers read only as a hint. Style it with
`adresse-search-input label`, or whatever name you registered.

Attributes:

| Attribute | Legacy option |
|---|---|
| `token` (required) | [token](#token-string-required) |
| `label` | — the visible label for the field |
| `placeholder` | — default `Søg adresse` |
| `disabled` | — |
| `adgangsadresser-only` | [adgangsadresserOnly](#adgangsadresseronly-boolean) |
| `kommune-kode` | [kommuneKode](#kommunekode-string) |
| `maksimum` | [maksimum](#maksimum-number) |
| `medtag-foreloebige` | [medtagForeloebige](#medtagforeloebige-boolean) |
| `api-url` | [apiUrl](#apiurl-string) |

`disabled`, `adgangsadresser-only` and `medtag-foreloebige` are on while
present, except `medtag-foreloebige="false"`, which is off. Instead of a `select` callback, the element dispatches
`address:select` with the selected object as `detail`, and `address:error` as
described [below](#the-addresserror-event).

## adressevaelger Options

Here are the options for `adressevaelger` function in pseudocode format:
```
adressevaelger(
  element: HTMLElement
  options: {
    adgangsadresserOnly: boolean
    kommuneKode: string
    maksimum: number
    medtagForeloebige: boolean
    select: (selectedItem: object) => void
    token: string
  }
)
```

### adgangsadresserOnly: boolean
default: `false`

Restrict searches to *husnumre* only.

### kommuneKode: string
default: `undefined`

Restrict searches to municipalities with a specific *kommuneKode.*

### maksimum: number
default: `undefined`

Max number of search hits to return.

Left out, the API returns **100**. It accepts values up to **200** and rejects
anything larger with a `400` — `maksimum skal være <= 200 (500)` — which
arrives as an `address:error` carrying that message, a `status` of `400` and
the service's own text in `detail`. The component does not check the value
itself, so that a cap the API raises later works without a new release.

### medtagForeloebige: boolean
default: `false`

Include *foreløbige* adresser/husnumre in search.

### select: function (required)

Callback function for when an adresse/husnummer is selected. 
Uses the selected object as the first parameter.

### token: string (required)

Access token - [Learn how to get one at confluence.sdfi.dk](https://confluence.sdfi.dk/display/ADV/Brugerstyring)

When a token expires, give the picker a new one rather than setting it up
again. `adressevaelger()` returns the picker, and every request after the call
uses the new token:

```js
const picker = adressevaelger(inputElement, { token: "old-token", select });
// …later
picker.setToken("new-token");
```

An empty token throws, and the picker keeps the one it had. For the web
component, set its `token` attribute instead.

### apiUrl: string
default: `https://adressevaelger.dk`

Point to a different API

## The address:error event

A search or a lookup that fails dispatches `address:error` from the input (or
from the element, for the web component). Its `detail` carries three things:

```js
element.addEventListener("address:error", (event) => {
  const { message, status, detail } = event.detail;
});
```

- `message` — the whole thing, ready for a log.
- `status` — the HTTP status, **when the request itself failed**: `504` for a
  gateway timeout worth retrying, `400` for a request the service would not
  accept. Absent when the service answered `200` and refused the search in its
  own envelope — an expired token, for instance — because there is no failing
  status to report.
- `detail` — the service's own words, on their own: `upstream request timeout`,
  `maksimum skal være <= 200 (500)`, `Token er ikke gyldigt`.

The user is shown a general sentence instead. These messages are about the
service's health or the way the component was configured, and none of them is
something the person typing an address can act on.

## What the component sets on your input

The legacy `adressevaelger()` is handed an input you own, and turns it into an
ARIA combobox: it sets `role`, `aria-autocomplete`, `aria-controls` and
`aria-expanded`, and points `aria-activedescendant` at the suggestion the arrow
keys are on.

Alongside the input it adds two regions of its own: a visually hidden
`role="status"` that announces how many suggestions appeared, or that there
were none, and a `role="alert"` line below the field that shows when a search
fails. Both are styled by `adressevaelger.css` — `.adressevaelger-status` and
`.adressevaelger-error` — so restyle the error line there if it should look
like the rest of your form. The wording lives in `src/texts.js`.

It also sets `autocomplete="off"`, as dawa-autocomplete2 did. Without it the
browser opens its own history dropdown over the suggestion list and takes the
keys meant for it — in Firefox, an input that has been submitted in a form
before gets a dropdown that swallows Enter. If you need a different value, set
it on the input after `adressevaelger()` returns, and expect the two lists to
compete.
