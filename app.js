const results = document.querySelector("#results");
const count = document.querySelector("#count");
const template = document.querySelector("#card-template");

const controls = {
  search: document.querySelector("#search"),
  generation: document.querySelector("#generation"),
  region: document.querySelector("#region"),
  type: document.querySelector("#type"),
  label: document.querySelector("#label"),
};

const typeOrder = [
  "normal",
  "fire",
  "water",
  "electric",
  "grass",
  "ice",
  "fighting",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
];

const labelOrder = ["legendary", "mythical", "pseudo-legendary"];

let catalog = [];
let sourceStats = null;

const label = (value) =>
  value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("-");

const option = (value, text) => {
  const node = document.createElement("option");
  node.value = value;
  node.textContent = text;
  return node;
};

const fillSelect = (select, entries, allText) => {
  select.replaceChildren(option("", allText), ...entries.map(([value, text]) => option(value, text)));
};

const normalized = (value) => String(value ?? "").toLowerCase();

const matchesSearch = (pokemon, query) => {
  if (!query) return true;

  const haystack = [
    pokemon.id,
    pokemon.dex,
    pokemon.name,
    pokemon.displayName,
    pokemon.species,
    pokemon.speciesDisplayName,
    pokemon.region,
    `gen ${pokemon.generation}`,
    `generation ${pokemon.generation}`,
    ...pokemon.types,
    ...(pokemon.labels ?? []),
    ...(pokemon.labels ?? []).map((item) => item.replace("-", " ")),
  ]
    .map(normalized)
    .join(" ");

  return haystack.includes(query);
};

const filteredCatalog = () => {
  const query = normalized(controls.search.value.trim());
  const generation = controls.generation.value;
  const region = controls.region.value;
  const type = controls.type.value;
  const selectedLabel = controls.label.value;

  return catalog.filter(
    (pokemon) =>
      matchesSearch(pokemon, query) &&
      (!generation || String(pokemon.generation) === generation) &&
      (!region || pokemon.region === region) &&
      (!type || pokemon.types.includes(type)) &&
      (!selectedLabel || (pokemon.labels ?? []).includes(selectedLabel)),
  );
};

const render = () => {
  const visible = filteredCatalog();
  const speciesText = sourceStats
    ? ` | ${sourceStats.uniqueSpecies.toLocaleString()} of ${sourceStats.totalSpecies.toLocaleString()} species`
    : "";
  count.textContent = `${visible.length.toLocaleString()} of ${catalog.length.toLocaleString()} SVGs${speciesText}`;

  if (visible.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No matching SVGs.";
    results.replaceChildren(empty);
    return;
  }

  const nodes = visible.map((pokemon) => {
    const card = template.content.firstElementChild.cloneNode(true);
    const img = card.querySelector("img");
    const artLink = card.querySelector(".art-link");
    const dex = card.querySelector(".dex");
    const name = card.querySelector("h2");
    const details = card.querySelector(".details");
    const types = card.querySelector(".types");
    const download = card.querySelector(".download");
    const raw = card.querySelector(".raw");

    img.src = pokemon.svg;
    img.alt = pokemon.displayName;
    artLink.href = pokemon.svg;
    dex.textContent = `#${String(pokemon.dex).padStart(4, "0")} | SVG ${pokemon.id}`;
    name.textContent = pokemon.displayName;
    details.textContent = `Generation ${pokemon.generation} | ${pokemon.region}`;
    types.replaceChildren(
      ...pokemon.types.map((type) => {
        const pill = document.createElement("span");
        pill.className = "type-pill";
        pill.textContent = type;
        return pill;
      }),
      ...(pokemon.labels ?? []).map((item) => {
        const pill = document.createElement("span");
        pill.className = "type-pill label-pill";
        pill.textContent = item;
        return pill;
      }),
    );
    download.href = pokemon.svg;
    download.setAttribute("download", `${pokemon.displayName.replaceAll(" ", "-").toLowerCase()}.svg`);
    raw.href = pokemon.sourceUrl;

    return card;
  });

  results.replaceChildren(...nodes);
};

const initFilters = () => {
  const generations = [...new Set(catalog.map((pokemon) => pokemon.generation))]
    .filter(Boolean)
    .sort((a, b) => a - b)
    .map((generation) => [String(generation), `Gen ${generation}`]);

  const regions = [...new Set(catalog.map((pokemon) => pokemon.region))]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b))
    .map((region) => [region, region]);

  const types = typeOrder
    .filter((type) => catalog.some((pokemon) => pokemon.types.includes(type)))
    .map((type) => [type, label(type)]);

  const labels = labelOrder
    .filter((item) => catalog.some((pokemon) => (pokemon.labels ?? []).includes(item)))
    .map((item) => [item, label(item)]);

  fillSelect(controls.generation, generations, "All generations");
  fillSelect(controls.region, regions, "All regions");
  fillSelect(controls.type, types, "All types");
  fillSelect(controls.label, labels, "All labels");

  Object.values(controls).forEach((control) => control.addEventListener("input", render));
};

const main = async () => {
  try {
    const response = await fetch("data/pokemon.json");
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    catalog = await response.json();
    const statsResponse = await fetch("data/sources.json");
    if (statsResponse.ok) sourceStats = await statsResponse.json();
    initFilters();
    render();
  } catch (error) {
    count.textContent = "Catalog not found";
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Run `node scripts/fetch-assets.mjs` from this folder.";
    results.replaceChildren(empty);
    console.error(error);
  }
};

main();
