# Migration guide

If you have already implemented dawa-autocomplete2 from https://github.com/SDFIdk/dawa-autocomplete2 ,
here is how to migrate to Adressevaelger.

**General directions** 
To migrate to adressevaelger, you'll need to:

1. Replace the JavaScript source (CDN/NPM → GitHub files)
2. Replace or update CSS inclusion
3. Add a `token` option when initializing the script
4. Add a label to your HTML for accessibility


## Migrate Javascript from CDN

If you used the CDN script from dawa-autocomplete2:

1. Change the Javascipt `<script>` element from 
   ```html
   <script src="https://cdn.dataforsyningen.dk/dawa/assets/dawa-autocomplete2/1.0.2/dawa-autocomplete2.min.js"></script>
   ```
   to
   
   ```html
   <script src="adressevaelger.iife.js"></script>
   ```
   Change the URL in the `src` attribute to a locally hosted file from the GitHub repository.
   
2. Aquire a valid `token` and add it you your initialization script:
   ```html
   <script>
    adressevaelger.adressevaelger(document.getElementById('adressevaelger-input'), {
      select: function(selected) {
        console.log('Valgt adresse: ' + selected);
      },
      token: "your-token-here"
    });
   </script>
   ```

## Migrate Javascript from NPM package

The dawa-autocomplete2 package is deprecated and will not receive further updates.

There is no NPM distribution of adressevaelger. Instead, you must install or copy the source files directly from GitHub.

Repository: https://github.com/SDFIdk/adressevaelger

You will typically use one of the following files from the repository:

adressevaelger.iife.js (browser usage)
adressevaelger.esm.js (ES module usage)

If your project previously used require() with dawa-autocomplete2, you must remove the dependency and update to the new manual import approach.

```javascript
/* Old implementation */
/*
var dawaAutocomplete2 = require('dawa-autocomplete2');
var inputElm = document.getElementById('dawa-autocomplete-input');
var component = dawaAutocomplete2.dawaAutocomplete(inputElm, {
  select: function(selected) {
    console.log('Valgt adresse: ' + selected.tekst);
  }
});
*/

/* New implementation*/
// adressevaelger must be loaded via script tag or bundled from local file
var inputElm = document.getElementById("adressevaelger-input");

var component = adressevaelger.adressevaelger(inputElm, {
  select: function (selected) {
    console.log("Valgt adresse:", selected);
  },
  token: "your-token-here"
});
```
Note: adressevaelger must be available in your environment either via:

<script src="./adressevaelger.iife.js"></script> (browser), or
local inclusion in your build setup.


If your project supports ES modules, import directly from the downloaded GitHub file:

Or Using ES module syntax:
```javascript
import { adressevaelger } from "./adressevaelger.esm.js";

const inputElm = document.getElementById("adressevaelger-input");

const component = adressevaelger(inputElm, {
  select: function (selected) {
    console.log("Valgt adresse:", selected);
  },
  token: "your-token-here"
});
```

## Migrate CSS

CSS must now also be included manually from the GitHub repository.

Option 1: Link to local file
```html
<link rel="stylesheet" href="./adressevaelger.css" />
```

Option 2: Inline CSS

1. Add the necessary CSS styles in your HTML `<head>` section.
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

## autocomplete on your input

dawa-autocomplete2 set `autocomplete="off"` on the input you passed it, and
adressevaelger does the same, so there is nothing to change on your side. It
matters: without it the browser opens its own history dropdown over the
suggestion list and takes the keys meant for it — in Firefox, an input that has
been submitted in a form before gets a dropdown that swallows Enter.

If your markup sets `autocomplete` on that input, the component overrides it.
Set it again after `adressevaelger()` returns if you would rather keep your own
value, and expect the browser's list and the suggestion list to compete.

## Improve HTML accessibility

To conform to requiremetns for accessibility, you should add a `<label>`-element for the search input field. You can place it anywhere you like if you use the `for` attribute to link it to the search input like in the example below.
```html
<!-- OLD HTML markup -->
<!--
<div class="autocomplete-container">
  <input type="search" id="demoCDN" />
</div>
-->

<!-- Adjusted HTML markup -->
<label for="adressevaelger-input">Søg efter adresser</label>
<div class="autocomplete-container">
  <input type="search" id="adressevaelger-input" />
</div>
```
