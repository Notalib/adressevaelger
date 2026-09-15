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

## Releasing

A release is published from a GitHub release, not from a pushed tag:

1. Set the version in `package.json` on `main` — `npm version 5.0.1 --no-git-tag-version`.
2. Draft a release whose tag is `v<version>`, matching it exactly, and publish it.

The workflow builds, tests and then publishes to GitHub Packages. It refuses a
release that is not an ancestor of `main`, whose tag does not start with `v`,
whose tag and `package.json` disagree, or whose version carries `+build`
metadata (npm discards it, so `5.0.0+kb1` would collide with plain `5.0.0` —
use `5.0.1-kb.1` instead).

A version with a prerelease suffix, or a release marked as a prerelease, is
published under the `next` tag, so that `npm install @notalib/adressevaelger`
keeps resolving to the last stable one.

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