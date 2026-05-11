# pkmn_svgs

A simple web dashboard for browsing, filtering, and downloading Pokemon SVG files.

All SVG/image assets in this repository are sourced from the PokeAPI sprite repository:

- https://github.com/PokeAPI/sprites

This project is just a lightweight dashboard around those sourced assets. Metadata is enriched with PokeAPI data so the dashboard can search and filter by name, generation, region, type, and labels such as legendary, mythical, and pseudo-legendary.

## Build the local catalog

```sh
node scripts/fetch-assets.mjs
```

That creates:

- `assets/svg/*.svg`
- `data/pokemon.json`
- `data/missing-species.json`
- `data/sources.json`

## Open the picker

Run a static server from this folder:

```sh
python3 -m http.server 4173
```

Then open:

```text
http://localhost:4173/
```

## Publish on GitHub Pages

This is a static site, so it can be published directly from the repo root with GitHub Pages. Commit these files and folders:

- `index.html`
- `app.js`
- `styles.css`
- `favicon.svg`
- `.nojekyll`
- `assets/`
- `data/`

Then enable Pages in the GitHub repo settings with:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/ root`

The generated site is about 58 MB locally, mostly SVG assets. That is reasonable for GitHub Pages, but avoid committing local files such as `.playwright-cli/` or crash dumps.

## Sources and rights

The SVGs and Pokemon image assets are sourced from:

- https://github.com/PokeAPI/sprites

The dashboard metadata is sourced from:

- https://pokeapi.co/

PokeAPI's sprite repo documents `sprites/pokemon/other/dream-world` as SVGs. This set includes alternate forms, but it does not cover every species with an SVG; see `data/missing-species.json` for the current gaps.

The repo license file also states that image contents are copyright The Pokemon Company and that trademark rights are not waived. Treat these as personal-use party assets unless you separately clear rights for broader use.
