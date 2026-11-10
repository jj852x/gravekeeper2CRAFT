/** Recipe math and CSV import. No DOM, no storage. */
(function () {
function splitCsvLine(line) {
  const cells = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const HERO_PERKS = ["玻璃工匠", "齿轮大师", "厨师", "厨师II", "堆肥化学家", "焚化工", "斧工", "工程师", "建造者", "节能达人", "立方体蒸馏", "炼金术士", "木匠", "啤酒酿造师", "葡萄酒大师", "切鱼工", "石匠", "司炉工", "淘金者", "铁匠", "造纸匠"];
const ZOMBIE_PERKS = ["挖掘工", "裁缝", "木匠学徒", "伐木工", "采石工", "石匠新手", "木匠大师", "喜鹊之眼", "工厂作业员", "石匠大师", "僵尸矿工", "新手铁匠", "吹制大师", "进阶铁匠", "穿刺者", "盲眼射手", "铁匠大师", "铁皮罐", "活尸坚韧", "农场主I", "磨坊主", "新手渔夫", "肥料专家", "啤酒酿造师", "压榨工", "资深渔夫", "农场主II", "罐头工", "酿酒师", "新手乐手", "亡灵莎士比亚", "亡灵印刷工", "亡灵君王", "娴熟乐手", "幽灵写手", "死亡树社", "亡灵宝石匠", "音乐大师", "亡灵钢笔", "亡灵印刷机", "尸体宝石匠", "亡灵蒸馏师", "亡灵炼金术士", "圣尸", "僵尸炼金术士", "亡灵造墓者", "腐尸蒸馏师", "疯狂死灵化学家", "墓地建筑师"];

function parseMods(inside) {
  return String(inside).split(/[·・]/).map((part) => {
    const match = part.trim().match(/^(.+?)\s*([+\-−－])\s*(\d+)\s*$/);
    if (!match) return null;
    const sign = match[2] === "+" ? 1 : -1;
    return { name: match[1].replace(/\s+/g, ""), amount: sign * Number(match[3]) };
  }).filter(Boolean);
}

function parseOneQty(part) {
  let mods = [];
  let body = part.trim();
  const modMatch = body.match(/^(.*?)[（(]\s*([^()（）]+)\s*[)）]\s*$/);
  if (modMatch) {
    body = modMatch[1].trim();
    mods = parseMods(modMatch[2]);
  }
  const qtyMatch = body.match(/^(.*?)[×xX]\s*(\d+)\s*$/);
  const row = qtyMatch
    ? { name: qtyMatch[1].trim(), qty: Number(qtyMatch[2]) }
    : { name: body, qty: 1 };
  if (mods.length) row.mods = mods;
  return row;
}

function perkKind(name) {
  if (HERO_PERKS.includes(name)) return "hero";
  if (ZOMBIE_PERKS.includes(name)) return "zombie";
  return null;
}

function pushMod(row, mod, side, index) {
  const kind = perkKind(mod.name);
  if (kind === "hero") {
    const entry = { name: mod.name, amount: mod.amount, side };
    if (side === "input") entry.index = index;
    row.heroMods.push(entry);
  } else if (kind === "zombie") {
    row.bonuses.push({ name: mod.name, amount: mod.amount });
  }
}

function ownsPerk(owned, name) {
  if (!owned) return false;
  if (typeof owned.has === "function") return owned.has(name);
  return Array.isArray(owned) && owned.includes(name);
}

function splitQtyParts(text) {
  const parts = [];
  let cur = "";
  let depth = 0;
  for (const ch of String(text)) {
    if (ch === "(" || ch === "（") depth += 1;
    if ((ch === ")" || ch === "）") && depth) depth -= 1;
    if (depth === 0 && (ch === "+" || ch === "、" || ch === "，" || ch === ";" || ch === "；" || ch === "\n")) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function parseQtyCell(text) {
  if (!text || !String(text).trim()) return [];
  return splitQtyParts(text)
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseOneQty)
    .filter((row) => row.name && row.qty > 0);
}

function effectiveOutputQty(recipe, owned) {
  let qty = recipe.outputQty || 1;
  for (const mod of recipe.heroMods || []) {
    if (mod.side === "output" && ownsPerk(owned, mod.name)) qty += mod.amount;
  }
  if (recipe.zombie) {
    qty += (recipe.bonuses || []).reduce((sum, bonus) => sum + bonus.amount, 0);
  }
  return Math.max(1, qty);
}

function effectiveInputQty(recipe, index, owned) {
  const input = recipe.inputs[index];
  let qty = input ? input.qty : 0;
  for (const mod of recipe.heroMods || []) {
    if (mod.side === "input" && mod.index === index && ownsPerk(owned, mod.name)) qty += mod.amount;
  }
  return Math.max(0, qty);
}

function intOrNull(value) {
  if (value == null || String(value).trim() === "") return null;
  const n = Number(String(value).trim());
  return Number.isInteger(n) ? n : null;
}

function stationFromFilename(filename) {
  const base = String(filename || "").replace(/^.*[\\/]/, "");
  return base.replace(/\.csv$/i, "") || "未命名工作台";
}

function parseStationCsv(text, stationName) {
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/);
  let header = -1;
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitCsvLine(lines[i]);
    if (header < 0) {
      if (cells[0] === "原料") header = i;
      continue;
    }
    const chance = chanceLine(cells[1]);
    const previous = rows[rows.length - 1];
    if (chance && previous && chance.name === previous.outputName) {
      appendInputs(previous, parseQtyCell(cells[0]));
      previous.chance = chance.note;
      continue;
    }
    const inputs = parseQtyCell(cells[0]);
    const outputs = parseQtyCell(cells[1] || "");
    if (!outputs.length) {
      const current = rows[rows.length - 1];
      const expansion = expansionNote(cells[0]);
      if (expansion) {
        if (current) current.expansion = expansion;
        continue;
      }
      if (current && inputs.length) appendInputs(current, inputs);
      continue;
    }
    if (!inputs.length) continue;
    const row = {
      station: stationName,
      inputs: [],
      outputName: outputs[0].name,
      outputQty: outputs[0].qty,
      mastery: intOrNull(cells[2]),
      time: intOrNull(cells[3]),
      enabled: true,
      heroMods: [],
      bonuses: [],
    };
    inputs.forEach((input, index) => {
      row.inputs.push({ name: input.name, qty: input.qty });
      for (const mod of input.mods || []) pushMod(row, mod, "input", index);
    });
    for (const mod of outputs[0].mods || []) pushMod(row, mod, "output");
    if (!row.heroMods.length) delete row.heroMods;
    if (!row.bonuses.length) delete row.bonuses;
    rows.push(row);
  }
  if (header < 0) {
    throw new Error("找不到表头「原料,产出,精通,耗时,科技点」");
  }
  return rows;
}

function appendInputs(row, inputs) {
  for (const input of inputs) {
    const index = row.inputs.length;
    row.inputs.push({ name: input.name, qty: input.qty });
    for (const mod of input.mods || []) pushMod(row, mod, "input", index);
  }
}

function chanceLine(text) {
  const match = String(text || "").trim().match(/^(.+?)[×xX]\s*\d+\s*几率\s*(.+)$/);
  if (!match) return null;
  return { name: match[1].trim(), note: match[2].trim() };
}

function expansionNote(text) {
  const match = String(text || "").match(/^所需扩建\s*[:：]\s*(.+)$/);
  return match ? match[1].trim() : "";
}

function recipeKey(recipe) {
  const inputs = [...recipe.inputs]
    .map((row) => row.name)
    .sort()
    .join("|");
  return `${recipe.station}\0${recipe.outputName}\0${inputs}`;
}

function mergeRecipes(recipes, incoming) {
  const next = recipes.map((recipe) => ({
    ...recipe,
    inputs: recipe.inputs.map((row) => ({ ...row })),
  }));
  let added = 0;
  let updated = 0;
  for (const row of incoming) {
    const key = recipeKey(row);
    const found = next.find((recipe) => recipeKey(recipe) === key);
    if (!found) {
      next.push({
        ...row,
        inputs: row.inputs.map((input) => ({ ...input })),
        bonuses: row.bonuses ? row.bonuses.map((bonus) => ({ ...bonus })) : undefined,
        heroMods: row.heroMods ? row.heroMods.map((mod) => ({ ...mod })) : undefined,
      });
      added++;
      continue;
    }
    found.inputs = row.inputs.map((input) => ({ ...input }));
    found.outputQty = row.outputQty;
    found.bonuses = row.bonuses ? row.bonuses.map((bonus) => ({ ...bonus })) : [];
    found.heroMods = row.heroMods ? row.heroMods.map((mod) => ({ ...mod })) : [];
    found.expansion = row.expansion || "";
    found.chance = row.chance || "";
    found.mastery = row.mastery;
    found.time = row.time;
    updated++;
  }
  return { recipes: next, added, updated };
}

function cloneStock(stock) {
  return { ...stock };
}

function pickRecipe(state, itemName) {
  return state.recipes
    .filter((recipe) => recipe.enabled && recipe.outputName === itemName)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))[0] || null;
}

function expand(state, name, qtyNeeded, forcedRecipe, stock, stack) {
  if (stack.has(name)) {
    return {
      name,
      gross: qtyNeeded,
      have: 0,
      short: qtyNeeded,
      depth: 0,
      children: [],
      cycle: true,
    };
  }
  const have = Math.min(stock[name] || 0, Math.max(0, qtyNeeded));
  stock[name] = (stock[name] || 0) - have;
  const remaining = qtyNeeded - have;
  const markedRaw = Boolean(state.items[name] && state.items[name].raw);
  const recipe = markedRaw ? null : forcedRecipe || pickRecipe(state, name);
  if (remaining === 0 || !recipe) {
    return { name, gross: qtyNeeded, have, short: remaining, depth: 0, children: [] };
  }
  stack.add(name);
  const owned = state.heroOwned;
  const yieldQty = effectiveOutputQty(recipe, owned);
  const batches = Math.ceil(remaining / yieldQty);
  const produced = batches * yieldQty;
  stock[name] = (stock[name] || 0) + (produced - remaining);
  const children = recipe.inputs.map((input, index) =>
    expand(state, input.name, effectiveInputQty(recipe, index, owned) * batches, null, stock, stack)
  );
  stack.delete(name);
  const depth = 1 + children.reduce((max, child) => Math.max(max, child.depth), 0);
  return {
    name,
    gross: qtyNeeded,
    have,
    short: remaining,
    depth,
    children,
    batches,
    recipeId: recipe.id,
    station: recipe.station,
  };
}

function taskLines(task) {
  if (Array.isArray(task.lines) && task.lines.length) {
    return task.lines.map((line) => ({
      name: line.name,
      qty: line.qty,
      recipeId: line.recipeId || "",
    }));
  }
  return [{ name: task.outputName, qty: task.qty, recipeId: task.recipeId || "" }];
}

function expandTasks(state, tasks) {
  const ordered = [...tasks].sort((a, b) => {
    const urgent = Number(Boolean(b.urgent)) - Number(Boolean(a.urgent));
    if (urgent) return urgent;
    const priority = (b.priority || 0) - (a.priority || 0);
    if (priority) return priority;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  const stock = cloneStock(state.stock || {});
  return ordered.map((task) => {
    const trees = [];
    for (const line of taskLines(task)) {
      let recipe = null;
      if (line.recipeId) {
        recipe = state.recipes.find((row) => row.id === line.recipeId && row.enabled) || null;
      } else {
        recipe = pickRecipe(state, line.name);
      }
      if (!recipe) continue;
      trees.push(expand(state, line.name, line.qty, recipe, stock, new Set()));
    }
    return { taskId: task.id, trees };
  });
}

function flattenTree(node, bucket = []) {
  bucket.push(node);
  node.children.forEach((child) => flattenTree(child, bucket));
  return bucket;
}

function summarize(trees) {
  const byDepth = [];
  const byItem = new Map();
  for (const entry of trees) {
    const nodes = entry.trees || (entry.tree ? [entry.tree] : []);
    for (const node of nodes.flatMap((tree) => flattenTree(tree))) {
      const depthRow = byDepth[node.depth] || new Map();
      byDepth[node.depth] = depthRow;
      addCount(depthRow, node);
      addCount(byItem, node);
    }
  }
  return {
    byDepth: byDepth.map((map) => [...map.values()]),
    byItem: [...byItem.values()].sort((a, b) => a.name.localeCompare(b.name, "zh")),
  };
}

function addCount(map, node) {
  const prev = map.get(node.name) || { name: node.name, gross: 0, have: 0, short: 0, depth: node.depth };
  prev.gross += node.gross;
  prev.have += node.have;
  prev.short += node.short;
  map.set(node.name, prev);
}

function stockUsed(node, delta = {}) {
  if (node.have) delta[node.name] = (delta[node.name] || 0) + node.have;
  node.children.forEach((child) => stockUsed(child, delta));
  return delta;
}

function parseCount(raw, min, previous) {
  const text = String(raw ?? "").trim();
  if (text === "") return previous;
  if (!/^\d+$/.test(text)) return previous;
  const value = Number(text);
  if (value < min) return previous;
  return value;
}

var GK2Root = typeof window !== "undefined" ? window : this;
GK2Root.GK2Calc = {
  splitCsvLine,
  parseQtyCell,
  stationFromFilename,
  parseStationCsv,
  recipeKey,
  mergeRecipes,
  expandTasks,
  flattenTree,
  summarize,
  stockUsed,
  parseCount,
  effectiveOutputQty,
  effectiveInputQty,
  HERO_PERKS,
  ZOMBIE_PERKS,
};
})();
