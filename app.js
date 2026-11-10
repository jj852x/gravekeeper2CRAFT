const calcApi = window.GK2Calc;
const storeApi = window.GK2Store;
if (!calcApi || !storeApi) {
  throw new Error("配方没有加载。");
}
const {
  expandTasks,
  parseCount,
  parseStationCsv,
  stationFromFilename,
  stockUsed,
  summarize,
  flattenTree,
  effectiveOutputQty,
  effectiveInputQty,
  HERO_PERKS,
} = calcApi;
const {
  applyImportedRecipes,
  ensureItem,
  loadState,
  nextId,
  saveState,
  exportLibrary,
  applyLibrary,
  ensureStations,
  DEFAULT_CATEGORIES,
} = storeApi;

const state = loadState();
if (!state.library) state.library = { categories: DEFAULT_CATEGORIES.slice(), stations: [] };
if (!state.bonusesOn) state.bonusesOn = {};
if (!Array.isArray(state.heroOwned)) state.heroOwned = [];
ensureStations(state);
const ui = {
  selectedId: state.tasks.find((task) => task.status === "active")?.id || null,
  totalsMode: "item",
  pendingConfirmId: null,
  draftGroup: "npc",
  draftNpc: "",
  draftBundle: "0",
  draftStation: "",
  recipeQuery: "",
  draftOrder: "0",
  draftMap: "",
};
let catalog = { npcs: [], maps: [], stations: [], orders: [] };

const taskPanel = document.querySelector("#task-panel");
const treePanel = document.querySelector("#tree-panel");
const stockPanel = document.querySelector("#stock-panel");
const heroPanel = document.querySelector("#hero-panel");
const recipePanel = document.querySelector("#recipe-panel");
const toast = document.querySelector("#toast");
const dialog = document.querySelector("#confirm-dialog");

document.querySelector("#csv-file").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  const text = await file.text();
  importCsv(text, stationFromFilename(file.name));
});

const defaultLibraryDialog = document.querySelector("#default-library-dialog");

document.querySelector("#import-default-library").addEventListener("click", () => {
  defaultLibraryDialog.showModal();
});

defaultLibraryDialog.addEventListener("close", async () => {
  if (defaultLibraryDialog.returnValue !== "yes") return;
  try {
    const response = await fetch("data/library.json", { cache: "no-store" });
    if (!response.ok) throw new Error("默认配方导入失败");
    const library = await response.json();
    if (!library || !Array.isArray(library.stations)) throw new Error("这不是配方库文件");
    applyLibrary(state, library);
    persist();
    showToast("已导入默认配方。");
  } catch (error) {
    showToast(error.message || "默认配方导入失败");
  }
});

document.querySelector("#library-file").addEventListener("change", async (event) => {
  const file = event.target.files && event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const library = JSON.parse(await file.text());
    if (!library || !Array.isArray(library.stations)) throw new Error("这不是配方库文件");
    applyLibrary(state, library);
    persist();
    showToast("配方库已用该文件全部替换。");
  } catch (error) {
    showToast(error.message || "配方库导入失败");
  }
});

document.querySelector("#export-library").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(exportLibrary(state), null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "library.json";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("配方库已导出。");
});

dialog.addEventListener("close", () => {
  const task = state.tasks.find((row) => row.id === ui.pendingConfirmId);
  ui.pendingConfirmId = null;
  if (!task || dialog.returnValue === "cancel" || !dialog.returnValue) return;
  if (dialog.returnValue === "deduct") deductTask(task);
  finishTask(task);
  persist();
});

taskPanel.addEventListener("click", onClick);
treePanel.addEventListener("click", onClick);
stockPanel.addEventListener("click", onClick);
recipePanel.addEventListener("click", onClick);
heroPanel.addEventListener("click", onClick);
heroPanel.addEventListener("change", onChange);
taskPanel.addEventListener("change", onChange);
stockPanel.addEventListener("change", onChange);
recipePanel.addEventListener("change", onChange);
taskPanel.addEventListener("focusout", onCommit);
stockPanel.addEventListener("focusout", onCommit);
taskPanel.addEventListener("input", onRecipeQuery);
taskPanel.addEventListener("submit", (event) => {
  if (event.target.id !== "new-task") return;
  event.preventDefault();
});

function importCategory() {
  const select = document.querySelector("#import-category");
  return (select && select.value) || "工作台";
}

function importCsv(text, station) {
  try {
    const rows = parseStationCsv(text, station);
    const result = applyImportedRecipes(state, rows, importCategory());
    persist();
    showToast(`「${station}」新增 ${result.added} 条，更新 ${result.updated} 条。科技点已跳过。`);
  } catch (error) {
    showToast(error.message || "导入失败");
  }
}

function persist() {
  saveState(state);
  render();
}

function showToast(message) {
  toast.hidden = false;
  toast.textContent = message;
}

function visibleTasks() {
  return state.tasks;
}

function plannedActive() {
  const active = visibleTasks().filter((task) => task.status === "active");
  return expandTasks(state, active);
}

function onClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (!action) return;
  if (action === "select-task") {
    ui.selectedId = button.dataset.id;
    render();
    return;
  }
  if (action === "add-task") return addTask();
  if (action === "step-qty") return stepTaskQty(button.dataset.id, Number(button.dataset.delta));
  if (action === "step-stock") return stepStock(button.dataset.name, Number(button.dataset.delta));
  if (action === "to-pending") return markPending(button.dataset.id);
  if (action === "confirm") return openConfirm(button.dataset.id);
  if (action === "copy") return copyTask(button.dataset.id);
  if (action === "archive") return archiveTask(button.dataset.id);
  if (action === "toggle-recipe") return toggleRecipe(button.dataset.id);
  if (action === "delete-recipe") return deleteRecipe(button.dataset.id);
  if (action === "toggle-raw") return toggleRaw(button.dataset.name);
  if (action === "stop-task") return stopTask(button.dataset.id);
  if (action === "delete-task") return deleteTask(button.dataset.id);
  if (action === "toggle-station") return toggleStation(button.dataset.name);
  if (action === "expand-stations") return setStationsCollapsed(false);
  if (action === "collapse-stations") return setStationsCollapsed(true);
  if (action === "add-category") return addCategory();
  if (action === "clear-hero") {
    state.heroOwned = [];
    persist();
  }
}

function onChange(event) {
  const target = event.target;
  if (target.id === "totals-mode") ui.totalsMode = target.value;
  if (target.dataset.showTask) {
    const task = state.tasks.find((row) => row.id === target.dataset.showTask);
    if (!task) return;
    task.shown = target.checked;
    persist();
    return;
  }
  if (target.dataset.hero) {
    const name = target.dataset.hero;
    if (target.checked) {
      if (!state.heroOwned.includes(name)) state.heroOwned.push(name);
    } else {
      state.heroOwned = state.heroOwned.filter((owned) => owned !== name);
    }
    persist();
    return;
  }
  if (target.dataset.zombie) {
    const recipe = state.recipes.find((row) => row.id === target.dataset.zombie);
    if (!recipe) return;
    recipe.zombie = target.checked;
    persist();
    return;
  }
  if (target.id === "draft-group") {
    ui.draftGroup = target.value;
    render();
    return;
  }
  if (target.id === "draft-npc") {
    ui.draftNpc = target.value;
    ui.draftBundle = "0";
    render();
    return;
  }
  if (target.id === "draft-bundle") {
    ui.draftBundle = target.value;
    return;
  }
  if (target.id === "draft-station") {
    ui.draftStation = target.value;
    render();
    return;
  }
  if (target.id === "draft-order") {
    ui.draftOrder = target.value;
    return;
  }
  if (target.id === "new-map") {
    ui.draftMap = target.value;
    return;
  }
  if (target.id === "totals-mode") render();
}

function onRecipeQuery(event) {
  onTaskQty(event);
  if (event.target.id !== "recipe-query") return;
  ui.recipeQuery = event.target.value;
  const select = document.querySelector("#new-recipe");
  if (!select) return;
  const current = select.value;
  select.innerHTML = recipeOptions(ui.draftStation, ui.recipeQuery);
  if ([...select.options].some((option) => option.value === current)) select.value = current;
}

function onCommit(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.dataset.taskQty) {
    const task = state.tasks.find((row) => row.id === target.dataset.taskQty);
    if (!task) return;
    const next = parseCount(target.value, 1, task.qty);
    if (next === task.qty) return;
    const lines = taskLinesOf(task);
    if (lines.length === 1) {
      lines[0].qty = next;
      task.lines = lines;
    }
    task.qty = next;
    persist();
  }
  if (target.dataset.stock) {
    const name = target.dataset.stock;
    const previous = state.stock[name] || 0;
    const next = parseCount(target.value, 0, previous);
    if (next === previous) return;
    state.stock[name] = next;
    persist();
  }
}

function addTask() {
  const priority = parseCount(document.querySelector("#new-priority").value, 0, 0);
  const map = ui.draftMap;
  let lines = [];
  let npc = "";
  let type = "";
  let urgent = false;
  if (ui.draftGroup === "npc") {
    const person = catalog.npcs.find((row) => row.name === ui.draftNpc);
    const bundle = person && person.tasks[Number(ui.draftBundle)];
    if (!person || !bundle) {
      showToast("这个 NPC 没有可选任务。");
      return;
    }
    lines = bundle.items.map((item) => ({ name: item.name, qty: item.qty }));
    if (!lines.some((line) => enabledRecipe(line.name))) {
      showToast("这些物品都没有启用的配方。");
      return;
    }
    npc = person.name;
    type = "NPC";
  } else if (ui.draftGroup === "station") {
    const recipeId = document.querySelector("#new-recipe").value;
    const recipe = state.recipes.find((row) => row.id === recipeId && row.enabled);
    if (!recipe) {
      showToast("先导入并选择一条启用的配方。");
      return;
    }
    const qty = parseCount(document.querySelector("#new-qty").value, 1, 1);
    lines = [{ name: recipe.outputName, qty, recipeId: recipe.id }];
    type = ui.draftStation || "工作台";
  } else {
    const order = catalog.orders[Number(ui.draftOrder)];
    if (!order) {
      showToast("没有可选订单。");
      return;
    }
    if (!enabledRecipe(order.name)) {
      showToast("没有这条订单的启用配方。");
      return;
    }
    lines = [{ name: order.name, qty: order.qty }];
    type = "订单";
    urgent = order.urgent;
  }
  const task = {
    id: nextId(state, "task"),
    lines,
    outputName: lines[0].name,
    qty: lines[0].qty,
    recipeId: lines[0].recipeId || "",
    map,
    npc,
    type,
    urgent,
    status: "active",
    priority,
    completedCount: 0,
    completedAt: null,
    createdAt: Date.now(),
    shown: true,
  };
  for (const line of lines) ensureItem(state, line.name);
  state.tasks.unshift(task);
  ui.selectedId = task.id;
  persist();
}

function stationLabel(name) {
  if (name === "僵尸矿工（需要打通矿场的两条入口）") return "僵尸矿工";
  return name;
}

function onTaskQty(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !target.dataset.taskQty) return;
  const task = state.tasks.find((row) => row.id === target.dataset.taskQty);
  if (!task || task.status !== "active") return;
  const next = parseCount(target.value, 1, task.qty);
  if (next === task.qty) return;
  const lines = taskLinesOf(task);
  if (lines.length === 1) {
    lines[0].qty = next;
    task.lines = lines;
  }
  task.qty = next;
  saveState(state);
  renderTree();
  renderStock();
}

function enabledRecipe(name) {
  return state.recipes.some((recipe) => recipe.enabled && recipe.outputName === name);
}

function stepTaskQty(id, delta) {
  const task = state.tasks.find((row) => row.id === id);
  if (!task || task.status !== "active") return;
  const lines = taskLinesOf(task);
  if (lines.length !== 1) return;
  lines[0].qty = Math.max(1, lines[0].qty + delta);
  task.qty = lines[0].qty;
  task.lines = lines;
  persist();
}

function stepStock(name, delta) {
  state.stock[name] = Math.max(0, (state.stock[name] || 0) + delta);
  persist();
}

function markPending(id) {
  const task = state.tasks.find((row) => row.id === id);
  if (!task || task.status !== "active") return;
  task.status = "pending";
  persist();
}

function openConfirm(id) {
  const task = state.tasks.find((row) => row.id === id);
  if (!task || task.status !== "pending") return;
  ui.pendingConfirmId = id;
  document.querySelector("#confirm-text").textContent =
    `确认「${taskTitle(task)}」已完成。扣库存只减去这单当前分到的持有量。`;
  dialog.showModal();
}

function finishTask(task) {
  task.status = "done";
  task.completedCount = (task.completedCount || 0) + 1;
  task.completedAt = Date.now();
}

function deductTask(task) {
  const peers = state.tasks.filter((row) => row.status === "active" || row.id === task.id);
  const snapshot = { ...task, status: "active" };
  const planned = expandTasks(state, peers.map((row) => (row.id === task.id ? snapshot : row)));
  const entry = planned.find((row) => row.taskId === task.id);
  const used = {};
  for (const tree of (entry && entry.trees) || []) {
    const part = stockUsed(tree);
    for (const [name, count] of Object.entries(part)) used[name] = (used[name] || 0) + count;
  }
  for (const [name, count] of Object.entries(used)) {
    state.stock[name] = Math.max(0, (state.stock[name] || 0) - count);
  }
}

function copyTask(id) {
  const task = state.tasks.find((row) => row.id === id);
  if (!task || (task.status !== "done" && task.status !== "archived" && task.status !== "stopped")) return;
  const copy = {
    ...task,
    id: nextId(state, "task"),
    status: "active",
    completedAt: null,
    createdAt: Date.now(),
  };
  state.tasks.unshift(copy);
  ui.selectedId = copy.id;
  persist();
}

function stopTask(id) {
  const task = state.tasks.find((row) => row.id === id);
  if (!task || task.status !== "active") return;
  task.status = "stopped";
  persist();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((row) => row.id !== id);
  if (ui.selectedId === id) ui.selectedId = null;
  persist();
}

function toggleStation(name) {
  const station = state.library.stations.find((row) => row.name === name);
  if (!station) return;
  station.collapsed = !station.collapsed;
  persist();
}

function setStationsCollapsed(collapsed) {
  for (const station of state.library.stations) station.collapsed = collapsed;
  persist();
}

function addCategory() {
  const input = document.querySelector("#new-category");
  const name = input.value.trim();
  if (!name || state.library.categories.includes(name)) return;
  state.library.categories.push(name);
  input.value = "";
  persist();
}

function archiveTask(id) {
  const task = state.tasks.find((row) => row.id === id);
  if (!task || task.status !== "done") return;
  task.status = "archived";
  persist();
}

function toggleRecipe(id) {
  const recipe = state.recipes.find((row) => row.id === id);
  if (!recipe) return;
  recipe.enabled = !recipe.enabled;
  persist();
}

function deleteRecipe(id) {
  const recipe = state.recipes.find((row) => row.id === id);
  if (!recipe) return;
  state.recipes = state.recipes.filter((row) => row.id !== id);
  const remains = state.recipes.some((row) => row.station === recipe.station);
  if (!remains) {
    state.library.stations = state.library.stations.filter((row) => row.name !== recipe.station);
  }
  persist();
}

function toggleRaw(name) {
  ensureItem(state, name);
  state.items[name].raw = !state.items[name].raw;
  persist();
}

function render() {
  renderTasks();
  renderTree();
  renderStock();
  renderHero();
  renderRecipes();
}

function signedAmount(amount) {
  return amount >= 0 ? `+${amount}` : `−${Math.abs(amount)}`;
}

function renderHero() {
  heroPanel.innerHTML = `
    <div class="spread">
      <h2>主角属性</h2>
      <button class="ghost" type="button" data-action="clear-hero">一键清空</button>
    </div>
    <div class="perk-grid">
      ${HERO_PERKS.map((name) => `
        <label><input type="checkbox" data-hero="${escapeAttr(name)}" ${state.heroOwned.includes(name) ? "checked" : ""}> ${escapeHtml(name)}</label>
      `).join("")}
    </div>
  `;
}

function renderTasks() {
  const tasks = visibleTasks();
  taskPanel.innerHTML = `
    <h2>任务</h2>
    <form class="stack" id="new-task">
      <label>来源 ${selectHtml("draft-group", ui.draftGroup, [["npc", "NPC"], ["station", "工作台"], ["order", "订单"]])}</label>
      ${draftFields()}
      <div class="row">
        ${ui.draftGroup === "station" ? `<label>数量 <input id="new-qty" type="number" min="1" step="1" value="1" aria-label="需求数量" title="还要做多少个成品"></label>` : ""}
        <label>优先级 <input id="new-priority" inputmode="numeric" value="0" aria-label="优先级" title="数字越大，越先占用库存"></label>
        <label>地图 ${selectHtml("new-map", ui.draftMap, [["", ""], ...catalog.maps.map((row) => [row.name, row.name])])}</label>
      </div>
      <button type="button" data-action="add-task">添加进行中任务</button>
    </form>
    ${renderGroup(tasks.filter((task) => task.status === "active"), "进行中")}
    ${renderGroup(tasks.filter((task) => task.status === "pending"), "待确认")}
    ${renderGroup(tasks.filter((task) => task.status === "done"), "已完成")}
    ${renderGroup(tasks.filter((task) => task.status === "archived"), "已归档")}
    ${renderGroup(tasks.filter((task) => task.status === "stopped"), "已中止")}
  `;
}

function renderGroup(tasks, title) {
  if (!tasks.length) return `<h3 class="group-title">${title}</h3><p class="hint">无</p>`;
  return `<h3 class="group-title">${escapeHtml(title)}</h3>${tasks.map(taskCard).join("")}`;
}

function taskCard(task) {
  const selected = task.id === ui.selectedId ? "selected" : "";
  const lines = taskLinesOf(task);
  const qty = lines.length === 1
    ? (task.status === "active"
      ? `<input class="qty-spin" type="number" min="1" step="1" data-task-qty="${task.id}" value="${lines[0].qty}" aria-label="数量">`
      : `<b>${lines[0].qty}</b>`)
    : "";
  const title = lines.length === 1 ? escapeHtml(lines[0].name) : escapeHtml(taskTitle(task));
  const show = task.status === "active"
    ? `<label><input type="checkbox" data-show-task="${task.id}" ${task.shown === false ? "" : "checked"}> 显示</label>`
    : "";
  const actions = [];
  actions.push(`<button class="link" type="button" data-action="select-task" data-id="${task.id}">查看</button>`);
  if (task.status === "active") {
    actions.push(`<button class="link" type="button" data-action="to-pending" data-id="${task.id}">完成</button>`);
    actions.push(`<button class="link" type="button" data-action="stop-task" data-id="${task.id}">中止</button>`);
  }
  if (task.status === "pending") actions.push(`<button class="link" type="button" data-action="confirm" data-id="${task.id}">确认</button>`);
  if (task.status === "done" || task.status === "archived" || task.status === "stopped") {
    actions.push(`<button class="link" type="button" data-action="copy" data-id="${task.id}">复制</button>`);
  }
  if (task.status === "done") actions.push(`<button class="link" type="button" data-action="archive" data-id="${task.id}">归档</button>`);
  actions.push(`<button class="link" type="button" data-action="delete-task" data-id="${task.id}">删除</button>`);
  const tags = [task.map, task.npc, task.type].filter(Boolean);
  return `
    <div class="task-line ${selected}">
      <div class="task-title"><strong>${title}</strong> ${qty} ${task.urgent ? `<span class="bonus">‼️</span>` : ""} ${show}</div>
      <div class="task-sub">
        <span class="bonus">${tags.map(escapeHtml).join(" · ")}</span>
        <span class="task-actions">${actions.join("")}</span>
      </div>
    </div>
  `;
}

function renderTree() {
  const plans = plannedActive();
  const shown = plans.filter((entry) => {
    const task = state.tasks.find((row) => row.id === entry.taskId);
    return task && task.shown !== false;
  });
  if (!plans.length) {
    treePanel.innerHTML = `<h2>材料树</h2><p class="hint">当前筛选下没有进行中的任务。</p>`;
    return;
  }
  if (!shown.length) {
    treePanel.innerHTML = `<h2>材料树</h2><p class="hint">勾选进行中任务的「显示」后，这里会列出对应的树。没勾上的任务仍占用库存。</p>`;
    return;
  }
  treePanel.innerHTML = `
    <h2>材料树</h2>
    ${shown.map((entry) => {
      const task = state.tasks.find((row) => row.id === entry.taskId);
      return `
        <h3>${escapeHtml(taskTitle(task))}${task.urgent ? ` <span class="bonus">‼️</span>` : ""}</h3>
        ${entry.trees.length ? entry.trees.map((tree) => renderNode(tree, true, { n: 0 })).join("") : `<p class="hint">这些物品没有启用的配方，材料树没有展开。</p>`}
      `;
    }).join("")}
  `;
}

function renderNode(node, isRoot, counter) {
  const stripe = counter.n++ % 2 === 1;
  const bits = [`要做 ${node.gross}`, `已有 ${node.have}`, `还缺 ${node.short}`];
  if (node.batches) bits.push(`做 ${node.batches} 批`);
  if (node.station) bits.push(node.station);
  if (node.cycle) bits.push("配方循环");
  return `
    <div class="tree-node${isRoot ? " root" : ""}${stripe ? " stripe" : ""}">
      <div class="spread">
        <span class="tree-name" style="--indent:${node.depth}"><span class="depth">${node.depth}</span> ${escapeHtml(node.name)}</span>
        <span class="meta">${bits.join(" · ")}</span>
      </div>
      ${node.children.map((child) => renderNode(child, false, counter)).join("")}
    </div>
  `;
}

function renderStock() {
  const plans = plannedActive();
  const summary = summarize(plans);
  const rows = ui.totalsMode === "depth"
    ? summary.byDepth.flatMap((items, depth) => items.map((item) => ({ ...item, depth })))
    : summary.byItem;
  const names = itemNames(plans);
  stockPanel.innerHTML = `
    <h2>库存与合计</h2>
    <label>合计 ${selectHtml("totals-mode", ui.totalsMode, [["item", "按物品"], ["depth", "按深度"]])}</label>
    <table>
      <thead><tr><th>深度</th><th>物品</th><th>要做</th><th>已有</th><th>还缺</th></tr></thead>
      <tbody>
        ${rows.length ? rows.map((row) => `<tr><td>${row.depth}</td><td>${escapeHtml(row.name)}</td><td>${row.gross}</td><td>${row.have}</td><td>${row.short}</td></tr>`).join("") : `<tr><td colspan="5">无</td></tr>`}
      </tbody>
    </table>
    <h3>持有</h3>
    <div class="hold">
      ${names.map((name) => {
        const raw = state.items[name] && state.items[name].raw;
        return `
        <div class="hold-row">
          <span>${escapeHtml(name)}</span>
          ${stepper(`data-stock="${escapeAttr(name)}"`, state.stock[name] || 0, `data-action="step-stock" data-name="${escapeAttr(name)}"`)}
          <button class="raw-toggle${raw ? " on" : ""}" type="button" data-action="toggle-raw" data-name="${escapeAttr(name)}">${raw ? "已当原料" : "当作原料"}</button>
        </div>`;
      }).join("") || `<p class="hint">加上进行中的任务后，这里只列出该任务用到的物品。</p>`}
    </div>
  `;
}

function inputLabel(recipe, input, index) {
  const qty = effectiveInputQty(recipe, index, state.heroOwned);
  return `${escapeHtml(input.name)} × ${qty}`;
}

function yieldLabel(recipe) {
  const qty = effectiveOutputQty(recipe, state.heroOwned);
  const zombieNote = (recipe.bonuses || []).map((bonus) => `${escapeHtml(bonus.name)} ${signedAmount(bonus.amount)}`).join("、");
  const extra = [zombieNote, recipe.chance ? escapeHtml(recipe.chance) : ""].filter(Boolean).join("、");
  return `${qty}${extra ? `<span class="bonus">${extra}</span>` : ""}`;
}

function renderRecipes() {
  syncCategorySelect();
  const blocks = state.library.categories.map((category) => {
    const stations = state.library.stations.filter((station) => station.category === category);
    if (!stations.length) return "";
    const body = stations.map((station) => {
      const recipes = state.recipes.filter((recipe) => recipe.station === station.name);
      const title = `<tr class="station-row"><td colspan="6"><button class="station-toggle" type="button" data-action="toggle-station" data-name="${escapeAttr(station.name)}">${escapeHtml(station.name)}</button></td></tr>`;
      if (station.collapsed) return title;
      return title + recipes.map((recipe) => `
        <tr>
          <td>${recipe.inputs.map((input, index) => inputLabel(recipe, input, index)).join("、")}</td>
          <td>${escapeHtml(recipe.outputName)}${recipe.expansion ? `<span class="bonus">${escapeHtml(recipe.expansion)}</span>` : ""}</td>
          <td>${yieldLabel(recipe)}</td>
          <td>${recipe.mastery ?? ""}</td>
          <td>${recipe.time ?? ""}</td>
          <td>
            <button class="link" type="button" data-action="toggle-recipe" data-id="${recipe.id}">${recipe.enabled ? "停用" : "启用"}</button>
            <button class="link" type="button" data-action="delete-recipe" data-id="${recipe.id}">删除</button>
            ${(recipe.bonuses || []).length ? `<label class="zombie" title="使用僵尸工人时加上灰色附加"><input type="checkbox" data-zombie="${recipe.id}" ${recipe.zombie ? "checked" : ""}>🧟</label>` : ""}
          </td>
        </tr>
      `).join("");
    }).join("");
    return `
      <h3>${escapeHtml(category)}</h3>
      <table class="recipe-table">
        <colgroup>
          <col style="width:28%">
          <col style="width:22%">
          <col style="width:14%">
          <col style="width:10%">
          <col style="width:10%">
          <col style="width:16%">
        </colgroup>
        <thead><tr><th>原料</th><th>产出</th><th>产量</th><th>精通</th><th>耗时</th><th></th></tr></thead>
        <tbody>${body}</tbody>
      </table>
    `;
  }).join("");
  recipePanel.innerHTML = `
    <div class="spread">
      <h2>配方库</h2>
      <span>
        <button class="ghost" type="button" data-action="expand-stations">全部展开</button>
        <button class="ghost" type="button" data-action="collapse-stations">全部折叠</button>
      </span>
    </div>
    <div class="row">
      <input id="new-category" placeholder="新分类">
      <button class="ghost" type="button" data-action="add-category">添加分类</button>
    </div>
    ${blocks || `<p class="hint">还没有配方。</p>`}
  `;
}

function syncCategorySelect() {
  const select = document.querySelector("#import-category");
  if (!select) return;
  const current = select.value || "工作台";
  select.innerHTML = state.library.categories.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join("");
  select.value = state.library.categories.includes(current) ? current : state.library.categories[0];
}

function recipeOptions(station, query) {
  const q = String(query || "").trim().toLowerCase();
  const rows = state.recipes.filter((recipe) => {
    if (!recipe.enabled) return false;
    if (station && recipe.station !== station) return false;
    if (q && !String(recipe.outputName).toLowerCase().includes(q)) return false;
    return true;
  });
  if (!rows.length) return `<option value="">没有匹配的配方</option>`;
  return rows.map((recipe) => `<option value="${recipe.id}">${escapeHtml(recipe.station)} · ${escapeHtml(recipe.outputName)}</option>`).join("");
}

function draftFields() {
  if (ui.draftGroup === "npc") {
    const people = catalog.npcs;
    if (!people.some((row) => row.name === ui.draftNpc) && people[0]) ui.draftNpc = people[0].name;
    const person = people.find((row) => row.name === ui.draftNpc);
    const tasks = (person && person.tasks) || [];
    if (!tasks[Number(ui.draftBundle)]) ui.draftBundle = "0";
    const taskPairs = tasks.length
      ? tasks.map((task, index) => [String(index), task.items.map((item) => `${item.name} × ${item.qty}`).join("，")])
      : [["", "没有任务"]];
    return `
      <label>NPC ${selectHtml("draft-npc", ui.draftNpc, people.map((row) => [row.name, row.name]))}</label>
      <label>任务 ${selectHtml("draft-bundle", ui.draftBundle, taskPairs)}</label>
    `;
  }
  if (ui.draftGroup === "station") {
    const names = catalog.stations.slice();
    for (const station of state.library.stations) {
      if (station.name && !names.includes(station.name)) names.push(station.name);
    }
    return `
      <label>工作台 ${selectHtml("draft-station", ui.draftStation, [["", "全部"], ...names.map((name) => [name, stationLabel(name)])])}</label>
      <input id="recipe-query" placeholder="搜索产出" value="${escapeAttr(ui.recipeQuery)}">
      <select id="new-recipe">${recipeOptions(ui.draftStation, ui.recipeQuery)}</select>
    `;
  }
  const orders = catalog.orders;
  if (!orders[Number(ui.draftOrder)]) ui.draftOrder = "0";
  const pairs = orders.length
    ? orders.map((order, index) => [String(index), `${order.name} × ${order.qty}${order.urgent ? " ‼️" : ""}`])
    : [["", "没有订单"]];
  return `<label>订单 ${selectHtml("draft-order", ui.draftOrder, pairs)}</label>`;
}

function taskLinesOf(task) {
  if (Array.isArray(task.lines) && task.lines.length) {
    return task.lines.map((line) => ({ name: line.name, qty: line.qty, recipeId: line.recipeId || "" }));
  }
  return [{ name: task.outputName, qty: task.qty, recipeId: task.recipeId || "" }];
}

function taskTitle(task) {
  return taskLinesOf(task).map((line) => `${line.name} × ${line.qty}`).join("、");
}

function stepper(inputAttrs, value, buttonAttrs) {
  return `
    <span class="stepper">
      <button class="ghost" type="button" ${buttonAttrs} data-delta="-1">-</button>
      <input ${inputAttrs} inputmode="numeric" value="${value}">
      <button class="ghost" type="button" ${buttonAttrs} data-delta="1">+</button>
    </span>
  `;
}

function selectHtml(id, value, pairs) {
  return `<select id="${id}">${pairs.map(([key, label]) => `<option value="${escapeAttr(key)}"${key === value ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
}

function itemNames(plans) {
  const names = new Set();
  for (const entry of plans) {
    for (const tree of entry.trees || []) {
      for (const node of flattenTree(tree)) names.add(node.name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "zh"));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function applyCatalog(loaded) {
  if (!loaded) return;
  catalog = {
    npcs: loaded.npcs || [],
    maps: loaded.maps || [],
    stations: loaded.stations || [],
    orders: loaded.orders || [],
  };
  if (!ui.draftNpc && catalog.npcs[0]) ui.draftNpc = catalog.npcs[0].name;
}

async function boot() {
  applyCatalog(window.GK2Catalog);
  if (!catalog.orders.length) {
    try {
      const response = await fetch("data/catalog.json", { cache: "no-store" });
      if (response.ok) applyCatalog(await response.json());
    } catch {
      /* 直接打开页面时用 catalog.js */
    }
  }
  try {
    if (!state.recipes.length) {
      const response = await fetch("data/library.json", { cache: "no-store" });
      if (response.ok) {
        const library = await response.json();
        const hasRecipes = (library.stations || []).some((station) => station.recipes && station.recipes.length);
        if (hasRecipes) {
          applyLibrary(state, library);
          persist();
        } else {
          ensureStations(state);
        }
      }
    }
  } catch {
    ensureStations(state);
  }
  try {
    render();
  } catch (error) {
    const message = error && error.message ? error.message : "界面渲染失败";
    if (taskPanel) taskPanel.textContent = message;
    showToast(message);
  }
}

boot();
