(function () {
const KEY = "gk2-planner-v1";

const DEFAULT_CATEGORIES = ["工作台", "炼金", "其他活计", "在别的页面"];

function emptyLibrary() {
  return { categories: DEFAULT_CATEGORIES.slice(), stations: [] };
}

function emptyState() {
  return {
    items: {},
    recipes: [],
    tasks: [],
    stock: {},
    seq: 1,
    library: emptyLibrary(),
    bonusesOn: {},
    heroOwned: [],
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return {
      items: parsed.items || {},
      recipes: parsed.recipes || [],
      tasks: parsed.tasks || [],
      stock: parsed.stock || {},
      seq: parsed.seq || 1,
      library: parsed.library && parsed.library.categories ? parsed.library : emptyLibrary(),
      bonusesOn: parsed.bonusesOn || {},
      heroOwned: Array.isArray(parsed.heroOwned) ? parsed.heroOwned.filter((name) => typeof name === "string") : [],
    };
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  localStorage.setItem(KEY, JSON.stringify(state));
}

function nextId(state, prefix) {
  const id = `${prefix}-${state.seq}`;
  state.seq += 1;
  return id;
}

function ensureItem(state, name) {
  if (!name) return;
  if (!state.items[name]) state.items[name] = { name, raw: false };
  if (state.stock[name] == null) state.stock[name] = 0;
}

function touchStation(state, name, category) {
  if (!state.library) state.library = emptyLibrary();
  let station = state.library.stations.find((row) => row.name === name);
  if (!station) {
    station = { name, category: category || "工作台", collapsed: false };
    state.library.stations.push(station);
    return station;
  }
  if (category) station.category = category;
  return station;
}

function applyImportedRecipes(state, incoming, category) {
  let added = 0;
  let updated = 0;
  for (const row of incoming) {
    ensureItem(state, row.outputName);
    row.inputs.forEach((input) => ensureItem(state, input.name));
    touchStation(state, row.station, category || "工作台");
    const key = GK2Calc.recipeKey(row);
    const found = state.recipes.find((recipe) => GK2Calc.recipeKey(recipe) === key);
    if (!found) {
      state.recipes.push({
        id: nextId(state, "recipe"),
        station: row.station,
        inputs: row.inputs.map((input) => ({ ...input })),
        outputName: row.outputName,
        outputQty: row.outputQty,
        bonuses: (row.bonuses || []).map((bonus) => ({ ...bonus })),
        heroMods: (row.heroMods || []).map((mod) => ({ ...mod })),
        expansion: row.expansion || "",
        chance: row.chance || "",
        mastery: row.mastery,
        time: row.time,
        enabled: true,
      });
      added++;
      continue;
    }
    found.inputs = row.inputs.map((input) => ({ ...input }));
    found.outputQty = row.outputQty;
    found.bonuses = (row.bonuses || []).map((bonus) => ({ ...bonus }));
    found.heroMods = (row.heroMods || []).map((mod) => ({ ...mod }));
    found.expansion = row.expansion || "";
    found.chance = row.chance || "";
    found.mastery = row.mastery;
    found.time = row.time;
    updated++;
  }
  return { added, updated };
}

function exportLibrary(state) {
  const categories = (state.library && state.library.categories) || DEFAULT_CATEGORIES.slice();
  const stations = ((state.library && state.library.stations) || []).map((station) => ({
    name: station.name,
    category: station.category || "工作台",
    collapsed: Boolean(station.collapsed),
    recipes: state.recipes
      .filter((recipe) => recipe.station === station.name)
      .map((recipe) => ({
        id: recipe.id,
        inputs: recipe.inputs.map((input) => ({ name: input.name, qty: input.qty })),
        outputName: recipe.outputName,
        outputQty: recipe.outputQty,
        bonuses: recipe.bonuses || [],
        heroMods: recipe.heroMods || [],
        expansion: recipe.expansion || "",
        chance: recipe.chance || "",
        mastery: recipe.mastery,
        time: recipe.time,
        enabled: recipe.enabled !== false,
        zombie: Boolean(recipe.zombie),
      })),
  }));
  return { categories, stations };
}

function applyLibrary(state, library) {
  const categories = library.categories && library.categories.length ? library.categories.slice() : DEFAULT_CATEGORIES.slice();
  state.library = { categories, stations: [] };
  state.recipes = [];
  for (const station of library.stations || []) {
    state.library.stations.push({
      name: station.name,
      category: station.category || "工作台",
      collapsed: Boolean(station.collapsed),
    });
    for (const recipe of station.recipes || []) {
      const id = recipe.id || nextId(state, "recipe");
      state.recipes.push({
        id,
        station: station.name,
        inputs: (recipe.inputs || []).map((input) => ({ name: input.name, qty: input.qty })),
        outputName: recipe.outputName,
        outputQty: recipe.outputQty,
        bonuses: recipe.bonuses || [],
        heroMods: recipe.heroMods || [],
        expansion: recipe.expansion || "",
        chance: recipe.chance || "",
        mastery: recipe.mastery ?? null,
        time: recipe.time ?? null,
        enabled: recipe.enabled !== false,
        zombie: Boolean(recipe.zombie),
      });
      ensureItem(state, recipe.outputName);
      (recipe.inputs || []).forEach((input) => ensureItem(state, input.name));
    }
  }
}

function ensureStations(state) {
  if (!state.library) state.library = emptyLibrary();
  for (const recipe of state.recipes) touchStation(state, recipe.station, "工作台");
}

var GK2Root = typeof window !== "undefined" ? window : this;
GK2Root.GK2Store = {
  emptyState,
  loadState,
  saveState,
  nextId,
  ensureItem,
  applyImportedRecipes,
  exportLibrary,
  applyLibrary,
  ensureStations,
  DEFAULT_CATEGORIES,
};
})();
