# How to implement Adressevaelger

Adressevaelger is a JavaScript-component that enables users to enter a Danish address in a single input field.

## Usage

Adressevaelger is distributed only via GitHub and must be downloaded and included in your project manually.
No package manager or CDN distribution is provided; the component must be included as static files in your project.

Repository: https://github.com/SDFIdk/adressevaelger

**Important notice:** Setting up Adressevaelger requires a valid token. [Learn how to get one at confluence.sdfi.dk](https://confluence.sdfi.dk/display/ADV/Brugerstyring)

## Download

Clone or download the repository:

git clone https://github.com/SDFIdk/adressevaelger.git

Or download it as a ZIP and extract it into your project.

You will typically need:

adressevaelger.iife.js (for direct browser usage)
adressevaelger.esm.js (for ES module usage)
adressevaelger.css



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

### apiUrl: string
default: `https://adressevaelger.dk`

Point to a different API

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
