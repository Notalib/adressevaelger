# Adressevælger

A UI component for implementing Adressevælger search in Javascript applications.

# Quick start

The ready-to-use files are built rather than kept in the repository. Take them
from the package:

```sh
echo "@notalib:registry=https://npm.pkg.github.com" >> .npmrc
npm install @notalib/adressevaelger
```

and use `node_modules/@notalib/adressevaelger/dist/adressevaelger.iife.js` and
`adressevaelger.css` directly in your HTML, without any build tools of your own.

Or build them from a checkout:

```sh
npm ci && npm run build     # writes dist/
npm run dev                 # serves the demo page while you work
```

Copy this example into a .html file to quickly test the component:

```html
<!DOCTYPE html>
<html>
    <head>
        <link rel="stylesheet" href"./adressevaelger.css" />
        <script src="./adressevaelger.iife.js"></script>
    </head>
    <body>
        <label for="adressevaelger-input">Søg efter adresser</label>
        <div class="autocomplete-container">
            <input type="search" id="adressevaelger-input" />
        </div>

        <script>
            adressevaelger.adressevaelger(document.getElementById("adressevaelger-input"), {
                select: function (selected) {
                    console.log("Selected address:", selected);
                },
                token: "adressevaelger123",
            });
        </script>
    </body>
</html>
```

## Implementing Adressevaelger

To implement Adressevaelger, [check the implementation guide.](./GUIDE.md)

To migrate from dawa-autocomplete2, [check the migration guide.](./MIGRATION-GUIDE.md)


## Distribution

Adressevaelger is distributed only via this GitHub repository.

It is not available via CDN or npm, and must be included in projects by downloading or copying the required files from the repository.