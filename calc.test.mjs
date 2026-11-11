import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = { console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL("./calc.js", import.meta.url), "utf8"), context);
const {
  HERO_PERKS,
  ZOMBIE_PERKS,
  effectiveInputQty,
  effectiveOutputQty,
  expandTasks,
  mergeRecipes,
  parseCount,
  parseStationCsv,
  stockUsed,
  summarize,
} = context.GK2Calc;

function perkLines(file) {
  return fs.readFileSync(new URL(file, import.meta.url), "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}
assert.deepEqual([...HERO_PERKS], perkLines("./data/hero-perks.txt"));
assert.deepEqual([...ZOMBIE_PERKS], perkLines("./data/zombie-perks.txt"));

const text = `在此制作 (4),,,,
,,,,
原料,产出,精通,耗时,科技点
布料×12,补给：衣服I×1,7,12,3
亚麻×12,地毯×1,5,8,11
蕾丝×20,奢华窗帘×1,8,12,55
亚麻线×8,蕾丝×1,5,6,4
`;

const rows = parseStationCsv(text, "缝纫台");
assert.equal(rows.length, 4);
assert.equal(JSON.stringify(rows[0]), JSON.stringify({
  station: "缝纫台",
  inputs: [{ name: "布料", qty: 12 }],
  outputName: "补给：衣服I",
  outputQty: 1,
  mastery: 7,
  time: 12,
  enabled: true,
}));
assert.equal(rows[1].mastery, 5);
assert.equal("tech" in rows[0], false);

const buildingText = `产出,原料1,原料2,原料3
搬运站（补给仓库）×1,铁钉×8,高级零件×2,抛光的石材×4
"搬运站（葡萄园, 采石场）×1",石块×2,砖块×4,
杜鹃花丛×1,杜鹃花幼苗×1,,
`;
const buildings = parseStationCsv(buildingText, "建筑1");
assert.equal(buildings.length, 3);
assert.equal(buildings[0].outputName, "搬运站（补给仓库）");
assert.equal(buildings[0].outputQty, 1);
assert.equal(JSON.stringify(buildings[0].inputs), JSON.stringify([
  { name: "铁钉", qty: 8 },
  { name: "高级零件", qty: 2 },
  { name: "抛光的石材", qty: 4 },
]));
assert.equal(buildings[0].mastery, null);
assert.equal(buildings[0].time, null);
assert.equal(buildings[0].station, "建筑1");
assert.equal(buildings[1].outputName, "搬运站（葡萄园, 采石场）");
assert.equal(buildings[1].inputs.length, 2);
assert.equal(JSON.stringify(buildings[2].inputs), JSON.stringify([{ name: "杜鹃花幼苗", qty: 1 }]));

const first = mergeRecipes([], rows);
assert.equal(first.added, 4);
const second = mergeRecipes(first.recipes.map((row, index) => ({ ...row, id: index, enabled: index !== 1 })), rows);
assert.equal(second.added, 0);
assert.equal(second.updated, 4);
assert.equal(second.recipes[1].enabled, false);

const state = {
  items: { 亚麻线: { name: "亚麻线", raw: false } },
  recipes: [
    { id: "a", station: "缝纫台", inputs: [{ name: "亚麻线", qty: 8 }], outputName: "蕾丝", outputQty: 1, enabled: true },
    { id: "b", station: "缝纫台", inputs: [{ name: "蕾丝", qty: 20 }], outputName: "奢华窗帘", outputQty: 1, enabled: true },
    { id: "c", station: "缝纫台", inputs: [{ name: "亚麻", qty: 12 }], outputName: "地毯", outputQty: 1, enabled: false },
  ],
  stock: { 亚麻线: 10, 蕾丝: 4 },
};

const planned = expandTasks(state, [
  { id: "low", outputName: "奢华窗帘", qty: 1, recipeId: "b", priority: 0, createdAt: 2 },
  { id: "high", outputName: "蕾丝", qty: 6, recipeId: "a", priority: 5, createdAt: 1 },
]);
const high = planned.find((row) => row.taskId === "high").trees[0];
const low = planned.find((row) => row.taskId === "low").trees[0];
assert.equal(high.have, 4);
assert.equal(high.short, 2);
assert.equal(high.children[0].name, "亚麻线");
assert.equal(high.children[0].gross, 16);
assert.equal(high.children[0].have, 10);
assert.equal(high.children[0].short, 6);
assert.equal(low.have, 0);
assert.equal(low.children[0].have, 0);
assert.equal(low.children[0].short, 20);
assert.equal(low.children[0].children[0].have, 0);
assert.equal(low.depth, 2);

const blocked = expandTasks(state, [
  { id: "rug", outputName: "地毯", qty: 1, recipeId: "c", priority: 0, createdAt: 1 },
]);
assert.equal(blocked[0].trees.length, 0);

const batchState = {
  items: {},
  recipes: [{ id: "pie", station: "烤箱", inputs: [{ name: "浆果", qty: 6 }], outputName: "浆果派", outputQty: 4, enabled: true }],
  stock: {},
};
const pies = expandTasks(batchState, [
  { id: "p", outputName: "浆果派", qty: 5, recipeId: "pie", priority: 0, createdAt: 1 },
]);
assert.equal(pies[0].trees[0].batches, 2);
assert.equal(pies[0].trees[0].children[0].gross, 12);

assert.equal(parseCount("", 1, 4), 4);
assert.equal(parseCount("0", 1, 4), 4);
assert.equal(parseCount("3", 1, 4), 3);
assert.equal(parseCount("-1", 0, 2), 2);
assert.equal(parseCount("2", 0, 0), 2);

const used = stockUsed(high);
assert.equal(used["亚麻线"], 10);
assert.equal(used["蕾丝"], 4);

const totals = summarize(planned);
const thread = totals.byItem.find((row) => row.name === "亚麻线");
assert.ok(thread.gross >= 16);

const spinText = `在此制作 (1),,,,
,,,,
原料,产出,精通,耗时,科技点
亚麻×4,亚麻线× 4 ( 裁缝 +2 ),3,4,1
`;
const spin = parseStationCsv(spinText, "纺车");
assert.equal(spin[0].outputName, "亚麻线");
assert.equal(spin[0].outputQty, 4);
assert.equal(spin[0].inputs[0].qty, 4);
assert.equal(spin[0].bonuses[0].name, "裁缝");
assert.equal(spin[0].bonuses[0].amount, 2);

const threadState = {
  items: {},
  recipes: [{ id: "yarn", station: "纺车", inputs: [{ name: "亚麻", qty: 4 }], outputName: "亚麻线", outputQty: 4, bonuses: [{ name: "裁缝", amount: 2 }], enabled: true, zombie: false }],
  stock: {},
};
const plain = expandTasks(threadState, [
  { id: "y", outputName: "亚麻线", qty: 6, recipeId: "yarn", priority: 0, createdAt: 1 },
]);
assert.equal(plain[0].trees[0].batches, 2);
assert.equal(plain[0].trees[0].children[0].gross, 8);
threadState.recipes[0].zombie = true;
const boosted = expandTasks(threadState, [
  { id: "y", outputName: "亚麻线", qty: 6, recipeId: "yarn", priority: 0, createdAt: 1 },
]);
assert.equal(boosted[0].trees[0].batches, 1);
assert.equal(boosted[0].trees[0].children[0].gross, 4);

const ovenText = `原料,产出,精通,耗时,科技点
面团×4,浆果派× 4 ( 厨师 +2 ),4,6,1
浆果×6,,,,
燃料× 20 ( 节能达人 −10 ),,,,
苹果×5,啤酒× 2 ( 啤酒酿造师 +1 ),1,1,1
燃料× 5 ( 没有的属性 −1 ),,,,
`;
const oven = parseStationCsv(ovenText, "厨房烤箱");
assert.equal(oven[0].outputQty, 4);
assert.equal(oven[0].inputs.length, 3);
assert.equal(oven[0].inputs[2].name, "燃料");
assert.equal(oven[0].inputs[2].qty, 20);
assert.equal(JSON.stringify(oven[0].heroMods), JSON.stringify([
  { name: "厨师", amount: 2, side: "output" },
  { name: "节能达人", amount: -10, side: "input", index: 2 },
]));
assert.equal(oven[0].bonuses, undefined);
assert.equal(oven[1].heroMods[0].name, "啤酒酿造师");
assert.equal(oven[1].bonuses, undefined);
assert.equal(oven[1].inputs[1].qty, 5);

const kitchenText = `原料,产出,精通,耗时,科技点
小麦×16,补给：面粉袋× 1 ( 磨坊主 +1 ),4,10,2
布料×2,,,,
所需扩建： 厨房：磨石,,,,
玻璃容器×1,补给：泡菜I×1,6,8,3
甜菜×12,,,,
所需扩建： 厨房：封口机,,,,
啤酒×12,补给：啤酒×1,3,6,1
`;
const kitchen = parseStationCsv(kitchenText, "厨房I");
assert.equal(kitchen[0].inputs.length, 2);
assert.equal(kitchen[0].inputs[1].name, "布料");
assert.equal(kitchen[0].expansion, "厨房：磨石");
assert.equal(kitchen[0].bonuses[0].name, "磨坊主");
assert.equal(kitchen[0].inputs.some((row) => row.name.startsWith("所需扩建")), false);
assert.equal(kitchen[1].inputs.map((row) => row.name).join(","), "玻璃容器,甜菜");
assert.equal(kitchen[1].expansion, "厨房：封口机");
assert.equal(kitchen[2].expansion, undefined);

const benchText = `原料,产出,精通,耗时,科技点
蜂蜡×3,精美蜡烛×1,3,5,12
亚麻线×1,精美蜡烛×1几率 炼金术士 +0.6 · 亡灵炼金术士 +0.6,,,
酒精×1,僵尸注射液★–★★★×1,8,12,12
防腐剂×1,僵尸注射液★–★★★×1几率 炼金术士 +0.4 · 亡灵炼金术士 +0.4,,,
彗星尾巴×1,,,,
泥炭×2,增产肥料I× 1 ( 堆肥化学家 +1 ),2,3,2
`;
const bench = parseStationCsv(benchText, "配制台");
assert.equal(bench.length, 3);
assert.equal(bench[0].outputName, "精美蜡烛");
assert.equal(bench[0].outputQty, 1);
assert.equal(bench[0].inputs.map((row) => row.name).join(","), "蜂蜡,亚麻线");
assert.equal(bench[0].chance, "炼金术士 +0.6 · 亡灵炼金术士 +0.6");
assert.equal(bench[1].inputs.map((row) => row.name).join(","), "酒精,防腐剂,彗星尾巴");
assert.equal(bench[1].outputQty, 1);
assert.equal(bench[2].outputName, "增产肥料I");
assert.equal(bench[2].heroMods[0].name, "堆肥化学家");
assert.equal(effectiveOutputQty(bench[0], ["炼金术士"]), 1);

const stillText = `原料,产出,精通,耗时,科技点
葡萄酒任意品质×1,酒精× 4 ( 立方体蒸馏 +3 · 亡灵蒸馏师 +3 ),3,8,11
黏土瓮×2,,,,
燃料×20,,,,
杜鹃花×2,香精× 3 ( 立方体蒸馏 +2 · 亡灵蒸馏师 +2 ),2,8,11
`;
const still = parseStationCsv(stillText, "蒸馏立方体");
assert.equal(still.length, 2);
assert.equal(still[0].outputQty, 4);
assert.equal(still[0].inputs.map((row) => row.name).join(","), "葡萄酒任意品质,黏土瓮,燃料");
assert.equal(JSON.stringify(still[0].heroMods), JSON.stringify([{ name: "立方体蒸馏", amount: 3, side: "output" }]));
assert.equal(JSON.stringify(still[0].bonuses), JSON.stringify([{ name: "亡灵蒸馏师", amount: 3 }]));
assert.equal(effectiveOutputQty(still[0], ["立方体蒸馏"]), 7);
const both = { ...still[0], zombie: true };
assert.equal(effectiveOutputQty(both, ["立方体蒸馏"]), 10);
assert.equal(still[1].heroMods[0].amount, 2);
assert.equal(still[1].bonuses[0].amount, 2);

const pie = {
  id: "pie",
  station: "厨房烤箱",
  inputs: oven[0].inputs,
  outputName: "浆果派",
  outputQty: 4,
  heroMods: oven[0].heroMods,
  enabled: true,
  zombie: false,
};
assert.equal(effectiveOutputQty(pie, []), 4);
assert.equal(effectiveInputQty(pie, 2, []), 20);
assert.equal(effectiveOutputQty(pie, ["厨师"]), 6);
assert.equal(effectiveInputQty(pie, 2, ["节能达人"]), 10);
const cold = expandTasks({ items: {}, recipes: [pie], stock: {}, heroOwned: [] }, [
  { id: "p", outputName: "浆果派", qty: 4, recipeId: "pie", priority: 0, createdAt: 1 },
]);
assert.equal(cold[0].trees[0].batches, 1);
assert.equal(cold[0].trees[0].children[2].gross, 20);
const hot = expandTasks({ items: {}, recipes: [pie], stock: {}, heroOwned: ["厨师", "节能达人"] }, [
  { id: "p", outputName: "浆果派", qty: 4, recipeId: "pie", priority: 0, createdAt: 1 },
]);
assert.equal(hot[0].trees[0].batches, 1);
assert.equal(hot[0].trees[0].children[2].gross, 10);
const more = expandTasks({ items: {}, recipes: [pie], stock: {}, heroOwned: ["厨师"] }, [
  { id: "p", outputName: "浆果派", qty: 5, recipeId: "pie", priority: 0, createdAt: 1 },
]);
assert.equal(more[0].trees[0].batches, 1);

const minerText = `原料,产出,精通,耗时,科技点
矿工站,铁矿石×1,1,8,1
,煤×2,,,
,宝石×1几率 喜鹊之眼 +0.1,,,
`;
const miner = parseStationCsv(minerText, "僵尸矿工（需要打通矿场的两条入口）");
assert.equal(miner.length, 3);
assert.equal(miner[0].inputs[0].name, "矿工站");
assert.equal(miner[0].inputs[0].fixed, true);
assert.equal(miner[0].outputName, "铁矿石");
assert.equal(miner[1].outputName, "煤");
assert.equal(miner[1].outputQty, 2);
assert.equal(miner[1].inputs[0].fixed, true);
assert.equal(miner[1].mastery, 1);
assert.equal(miner[2].outputName, "宝石");
assert.equal(miner[2].chance, "喜鹊之眼 +0.1");
const mined = expandTasks({
  items: {},
  recipes: miner.map((row, index) => ({ ...row, id: "m" + index, enabled: true })),
  stock: {},
  heroOwned: [],
}, [
  { id: "ore", outputName: "铁矿石", qty: 10, priority: 0, createdAt: 1 },
]);
assert.equal(mined[0].trees[0].batches, 10);
assert.equal(mined[0].trees[0].children[0].name, "矿工站");
assert.equal(mined[0].trees[0].children[0].gross, 1);

console.log("calc ok");
