# pkmn_svgs

A simple web dashboard for browsing, filtering, and downloading Pokemon SVG files.

Most SVG assets in this repository come from the PokeAPI sprite repository:

- https://github.com/PokeAPI/sprites

PokeAPI has no Dream World SVG for 83 Gen 6 to 8 species. Those 83 are traced here from Dream World artwork PNGs, so every species from 1 to 1025 has an SVG. See "Sources and rights" below.

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

The script keeps the traced SVGs listed in `data/traced-art.json`. It adds a catalog row for each one, with `artSource: "traced-dream-world-artwork"`, as long as upstream still has no SVG for that species. Once PokeAPI ships a real SVG for one of them, the upstream file replaces the traced one on the next run.

To rebuild the traced SVGs from their source PNGs, install potrace (`brew install potrace`), then run:

```sh
npm install --no-save --no-package-lock sharp@0.35 svgo@4
node scripts/trace-art.mjs        # all traced species
node scripts/trace-art.mjs 660    # one species
```

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

PokeAPI's sprite repo documents `sprites/pokemon/other/dream-world` as SVGs. This set includes alternate forms. Its Gen 6 to 9 SVGs came from a Google Drive archive in September 2025 ([PokeAPI/sprites#178](https://github.com/PokeAPI/sprites/pull/178)), and that archive has no SVG for 83 species.

Those 83 species are traced, not original vector files. Each one starts from the official Dream World style artwork as a PNG:

- 69 come from the Bulbagarden Archives category of Dream World artwork: https://archives.bulbagarden.net/wiki/Category:Pok%C3%A9mon_Dream_World_artwork
- 14 come from the "Non-SVG" folder of the same Google Drive archive that PokeAPI's SVGs came from: https://drive.google.com/drive/folders/121i6SuB-peAm57GKh6moQ_tQSw7orjys. For these species, Bulbagarden's main Dream World file is only 150 to 380 px wide, and the Drive folder has a larger copy of the same artwork. `sameArtAs` in `data/traced-art.json` links the Bulbagarden file each one matches.

`scripts/trace-art.mjs` turns each PNG into a flat color SVG with potrace. The outline shape follows the PNG's alpha channel exactly, so silhouettes match the artwork. Fine detail and gradients are simplified to a few dozen flat colors, and close up the curves are less clean than hand-made vectors. Their catalog rows carry `artSource: "traced-dream-world-artwork"`, and `sourceUrl` points at the PNG that was traced. `data/traced-art.json` lists the source file and page for every traced species.

The repo license file also states that image contents are copyright The Pokemon Company and that trademark rights are not waived. The Dream World artwork behind the traced SVGs is also The Pokemon Company's, and Bulbagarden hosts it as fair use. Treat all of these as personal-use party assets unless you separately clear rights for broader use.
