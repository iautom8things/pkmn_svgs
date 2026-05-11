import { mkdir, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

const root = new URL("..", import.meta.url);
const dataDir = new URL("../data/", import.meta.url);
const svgDir = new URL("../assets/svg/", import.meta.url);

const treeUrl =
  "https://api.github.com/repos/PokeAPI/sprites/git/trees/master?recursive=1";
const rawBase =
  "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/dream-world/";
const dreamWorldPrefix = "sprites/pokemon/other/dream-world/";

const generationRanges = [
  { generation: 1, region: "Kanto", min: 1, max: 151 },
  { generation: 2, region: "Johto", min: 152, max: 251 },
  { generation: 3, region: "Hoenn", min: 252, max: 386 },
  { generation: 4, region: "Sinnoh", min: 387, max: 493 },
  { generation: 5, region: "Unova", min: 494, max: 649 },
  { generation: 6, region: "Kalos", min: 650, max: 721 },
  { generation: 7, region: "Alola", min: 722, max: 809 },
  { generation: 8, region: "Galar / Hisui", min: 810, max: 905 },
  { generation: 9, region: "Paldea", min: 906, max: 1025 },
];

const pseudoLegendaryFamilyDex = new Set([
  147, 148, 149,
  246, 247, 248,
  371, 372, 373,
  374, 375, 376,
  443, 444, 445,
  633, 634, 635,
  704, 705, 706,
  782, 783, 784,
  885, 886, 887,
  996, 997, 998,
]);

const specialNames = new Map([
  ["nidoran-f", "Nidoran female"],
  ["nidoran-m", "Nidoran male"],
  ["mr-mime", "Mr. Mime"],
  ["mime-jr", "Mime Jr."],
  ["mr-rime", "Mr. Rime"],
  ["ho-oh", "Ho-Oh"],
  ["porygon-z", "Porygon-Z"],
  ["jangmo-o", "Jangmo-o"],
  ["hakamo-o", "Hakamo-o"],
  ["kommo-o", "Kommo-o"],
  ["tapu-koko", "Tapu Koko"],
  ["tapu-lele", "Tapu Lele"],
  ["tapu-bulu", "Tapu Bulu"],
  ["tapu-fini", "Tapu Fini"],
  ["type-null", "Type: Null"],
  ["sirfetchd", "Sirfetch'd"],
  ["farfetchd", "Farfetch'd"],
  ["wo-chien", "Wo-Chien"],
  ["chien-pao", "Chien-Pao"],
  ["ting-lu", "Ting-Lu"],
  ["chi-yu", "Chi-Yu"],
]);

const titleCase = (value) =>
  value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const displayName = (name) => specialNames.get(name) ?? titleCase(name);

const generationFor = (speciesId) =>
  generationRanges.find((range) => speciesId >= range.min && speciesId <= range.max) ?? {
    generation: null,
    region: "Unknown",
  };

const classificationFor = (speciesId, species) => {
  const labels = [];

  if (species?.is_legendary) labels.push("legendary");
  if (species?.is_mythical) labels.push("mythical");
  if (pseudoLegendaryFamilyDex.has(speciesId)) labels.push("pseudo-legendary");

  return labels;
};

const getJson = async (url) => {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "pokemon-svg-picker",
      Accept: "application/vnd.github+json, application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }

  return response.json();
};

const download = async (url, filePath) => {
  const response = await fetch(url, {
    headers: { "User-Agent": "pokemon-svg-picker" },
  });

  if (!response.ok || !response.body) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }

  await mkdir(dirname(filePath), { recursive: true });
  await pipeline(response.body, createWriteStream(filePath));
};

const runPool = async (items, concurrency, worker) => {
  let next = 0;
  let done = 0;

  const runners = Array.from({ length: concurrency }, async () => {
    while (next < items.length) {
      const current = items[next++];
      await worker(current, done);
      done += 1;
      if (done % 50 === 0 || done === items.length) {
        console.log(`${done}/${items.length}`);
      }
    }
  });

  await Promise.all(runners);
};

const parseSvgPath = (path) => {
  const relativePath = path.slice(dreamWorldPrefix.length);
  const basename = relativePath.split("/").pop();
  const folderVariant = relativePath.includes("/") ? relativePath.split("/")[0] : null;
  const match = basename.match(/^(\d+)(?:-(.+))?\.svg$/);
  if (!match) return null;

  const variant = match[2] ?? folderVariant;

  return {
    id: variant ? `${match[1]}-${variant}` : match[1],
    lookupId: Number(match[1]),
    variant,
    file: relativePath,
    url: `${rawBase}${relativePath.split("/").map(encodeURIComponent).join("/")}`,
  };
};

const main = async () => {
  await mkdir(dataDir, { recursive: true });
  await mkdir(svgDir, { recursive: true });

  console.log("Reading PokeAPI sprite tree...");
  const tree = await getJson(treeUrl);
  if (tree.truncated) {
    throw new Error("GitHub returned a truncated tree; cannot safely build a full catalog.");
  }

  const files = tree.tree
    .filter(
      (entry) =>
        entry.type === "blob" &&
        entry.path.startsWith(dreamWorldPrefix) &&
        entry.path.endsWith(".svg"),
    )
    .map((entry) => parseSvgPath(entry.path))
    .filter(Boolean)
    .sort((a, b) => a.lookupId - b.lookupId || String(a.id).localeCompare(String(b.id)));

  console.log(`Found ${files.length} SVGs.`);
  console.log("Reading Pokemon metadata...");

  const pokemonByLookupId = new Map();
  const speciesCache = new Map();
  const lookupIds = [...new Set(files.map((file) => file.lookupId))];

  await runPool(lookupIds, 12, async (lookupId) => {
    const pokemon = await getJson(`https://pokeapi.co/api/v2/pokemon/${lookupId}`);
    pokemonByLookupId.set(lookupId, pokemon);

    const speciesId = Number(pokemon.species.url.match(/\/pokemon-species\/(\d+)\//)?.[1]);
    if (Number.isInteger(speciesId) && !speciesCache.has(speciesId)) {
      speciesCache.set(speciesId, null);
    }
  });

  console.log(`Reading ${speciesCache.size} species records...`);
  await runPool([...speciesCache.keys()], 12, async (speciesId) => {
    const species = await getJson(`https://pokeapi.co/api/v2/pokemon-species/${speciesId}`);
    speciesCache.set(speciesId, species);
  });

  const catalog = files.map((file) => {
    const pokemon = pokemonByLookupId.get(file.lookupId);
    const speciesId = Number(pokemon.species.url.match(/\/pokemon-species\/(\d+)\//)?.[1]);
    const species = speciesCache.get(speciesId);
    const range = generationFor(speciesId);
    const englishName =
      species?.names?.find((entry) => entry.language.name === "en")?.name ??
      displayName(pokemon.species.name);
    const labels = classificationFor(speciesId, species);

    return {
      id: file.id,
      dex: speciesId,
      name: pokemon.name,
      displayName:
        !file.variant && Number(file.id) === speciesId
          ? englishName
          : `${englishName} (${displayName(file.variant ?? pokemon.name.replace(`${pokemon.species.name}-`, ""))})`,
      species: pokemon.species.name,
      speciesDisplayName: englishName,
      generation: range.generation,
      region: range.region,
      types: pokemon.types.map((entry) => entry.type.name),
      labels,
      svg: `assets/svg/${file.file}`,
      sourceUrl: file.url,
    };
  });

  console.log("Reading full species list...");
  const allSpecies = await getJson("https://pokeapi.co/api/v2/pokemon-species?limit=2000");
  const speciesWithSvg = new Set(catalog.map((entry) => entry.dex));
  const missingSpecies = allSpecies.results
    .map((entry) => {
      const dex = Number(entry.url.match(/\/pokemon-species\/(\d+)\//)?.[1]);
      const range = generationFor(dex);

      return {
        dex,
        name: entry.name,
        displayName: displayName(entry.name),
        generation: range.generation,
        region: range.region,
        labels: [],
      };
    })
    .filter((entry) => Number.isInteger(entry.dex) && !speciesWithSvg.has(entry.dex))
    .sort((a, b) => a.dex - b.dex);

  console.log("Downloading SVGs...");
  await runPool(files, 16, async (file) => {
    await download(file.url, join(svgDir.pathname, file.file));
  });

  await writeFile(
    new URL("pokemon.json", dataDir),
    `${JSON.stringify(catalog, null, 2)}\n`,
    "utf8",
  );

  await writeFile(
    new URL("missing-species.json", dataDir),
    `${JSON.stringify(missingSpecies, null, 2)}\n`,
    "utf8",
  );

  await writeFile(
    new URL("sources.json", dataDir),
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        count: catalog.length,
        uniqueSpecies: speciesWithSvg.size,
        totalSpecies: allSpecies.count,
        missingSpecies: missingSpecies.length,
        sources: [
          "https://github.com/PokeAPI/sprites",
          "https://pokeapi.co/",
        ],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  console.log(`Done. Wrote ${catalog.length} SVG entries into ${root.pathname}`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
