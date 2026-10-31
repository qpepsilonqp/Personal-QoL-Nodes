// rgthree Nodes 2.0 fix (Personal QoL Nodes)
//
// Gives rgthree-comfy nodes proper Nodes 2.0 (Vue node) controls, without changing rgthree's files.
// Only acts while Nodes 2.0 is on; the classic canvas is left exactly as rgthree draws it.
// Each fixed node has its own switch in Settings -> Personal QoL Nodes, plus a master switch.
// Switch changes apply after a page reload.
//
// rgthree-comfy is MIT licensed (c) rgthree. No rgthree code is copied here; this file calls the
// public methods on rgthree's own widgets so behaviour stays identical to the classic canvas.

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const BUILD = "2026-10-30.9";
const CATEGORY = "Personal QoL Nodes";
const SECTION = "rgthree Nodes 2.0 fix";

const MASTER_ID = "PersonalQoL.RgthreeFix.Master";
const PROPS_ID = "PersonalQoL.RgthreeFix.PropertiesMenu";
const FIXES = [
  {
    id: "PersonalQoL.RgthreeFix.FastGroupsBypasser",
    name: "rgthree Fast Groups Bypasser: Nodes 2.0 fix",
    nodeType: "Fast Groups Bypasser (rgthree)",
    apply: fixFastGroups,
  },
  {
    id: "PersonalQoL.RgthreeFix.FastGroupsMuter",
    name: "rgthree Fast Groups Muter: Nodes 2.0 fix",
    nodeType: "Fast Groups Muter (rgthree)",
    apply: fixFastGroups,
  },
  {
    id: "PersonalQoL.RgthreeFix.Seed",
    name: "rgthree Seed: Nodes 2.0 fix",
    nodeType: "Seed (rgthree)",
    apply: fixSeed,
  },
  {
    id: "PersonalQoL.RgthreeFix.Label",
    name: "rgthree Label: Nodes 2.0 fix",
    nodeType: "Label (rgthree)",
    apply: fixLabel,
  },
  {
    id: "PersonalQoL.RgthreeFix.DisplayAny",
    name: "rgthree Display Any: Nodes 2.0 fix",
    nodeType: "Display Any (rgthree)",
    apply: fixDisplayAny,
  },
  {
    id: "PersonalQoL.RgthreeFix.Bookmark",
    name: "rgthree Bookmark: Nodes 2.0 fix",
    nodeType: "Bookmark (rgthree)",
    apply: fixBookmark,
  },
  {
    id: "PersonalQoL.RgthreeFix.ImageComparer",
    name: "rgthree Image Comparer: Nodes 2.0 fix",
    nodeType: "Image Comparer (rgthree)",
    prepare: prepareImageComparer,
    apply: fixImageComparer,
  },
  {
    id: "PersonalQoL.RgthreeFix.PowerLoraLoader",
    name: "rgthree Power Lora Loader: Nodes 2.0 fix",
    nodeType: "Power Lora Loader (rgthree)",
    prepare: preparePowerLora,
    apply: fixPowerLora,
  },
];

// ---------------------------------------------------------------------------------------------
// Is rgthree installed? ComfyUI lists every extension script; rgthree's live under its folder.
// ---------------------------------------------------------------------------------------------
async function rgthreeInstalled() {
  try {
    const res = await api.fetchApi("/extensions");
    const list = await res.json();
    return list.some((p) => /\/extensions\/rgthree-comfy\//i.test(p));
  } catch (e) {
    return false;
  }
}

const HAS_RGTHREE = await rgthreeInstalled();

function settingGet(id, fallback) {
  try {
    const v = app.extensionManager?.setting?.get(id);
    return v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function isNodes2() {
  return !!settingGet("Comfy.VueNodes.Enabled", false);
}

// Safety net: anything that runs while rgthree builds a node goes through this. If our part
// fails (say after a ComfyUI or rgthree update), the widget is put back as rgthree made it, so
// the node still works with rgthree's own drawing, on the classic canvas and in Nodes 2.0.
function safeAttach(attach, widget, node) {
  try {
    attach(widget, node);
  } catch (e) {
    console.warn("[Personal QoL] rgthree fix: falling back to rgthree's own widget", e);
    try {
      widget.element = undefined;
      if (widget.__qolOwnLayout) delete widget.computeLayoutSize;
      for (const k of ["__qolRow", "__qolCmp", "__qolPll", "__qolOwnLayout"]) delete widget[k];
    } catch (e2) {
      /* nothing more we can do */
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Reload prompt. ComfyUI calls onChange once at start-up with the stored value, so prompts are
// only shown for changes made after the page has finished loading.
// ---------------------------------------------------------------------------------------------
let settingsReady = false;
let promptOpen = false;

async function promptReload() {
  if (!settingsReady || promptOpen) return;
  promptOpen = true;
  try {
    const message =
      "This change to the rgthree Nodes 2.0 fix takes effect after the page reloads. Reload now?";
    let yes = false;
    const dialog = app.extensionManager?.dialog;
    if (dialog?.confirm) {
      yes = await dialog.confirm({
        title: "Reload to apply",
        message,
        type: "default",
      });
    } else {
      yes = window.confirm(message);
    }
    if (yes) location.reload();
  } finally {
    promptOpen = false;
  }
}

function buildSettings() {
  if (!HAS_RGTHREE) return []; // Hidden when rgthree isn't installed.
  // While the master is off, the per-node switches are greyed out (they keep their values).
  // Decided at page load, like everything else here.
  const masterOff = settingGet(MASTER_ID, true) === false;
  // Listed in reverse: ComfyUI shows later-registered settings first within a section.
  const perNode = FIXES.map((f) => ({
    id: f.id,
    category: [CATEGORY, SECTION, f.nodeType],
    name: f.name,
    tooltip:
      "Switch off to go back to rgthree's own drawing for this node in Nodes 2.0. " +
      "Does nothing while the master switch is off. Applies after a page reload.",
    type: "boolean",
    defaultValue: true,
    attrs: { disabled: masterOff },
    onChange: () => {
      void promptReload(); // Not awaited: the setting saves straight away.
    },
  })).reverse();
  return [
    ...perNode,
    {
      id: PROPS_ID,
      category: [CATEGORY, SECTION, " Properties"],
      name: "rgthree Properties menu in Nodes 2.0 (all rgthree nodes)",
      tooltip:
        "Adds Node Properties ▸ to every rgthree node's right-click menu in Nodes 2.0 (under " +
        "Extensions), with the same settings as on the classic canvas. Does nothing while the " +
        "master switch is off. Applies after a page reload.",
      type: "boolean",
      defaultValue: true,
      attrs: { disabled: masterOff },
      onChange: () => {
        void promptReload(); // Not awaited: the setting saves straight away.
      },
    },
    {
      id: MASTER_ID,
      category: [CATEGORY, SECTION, " Master"],
      name: "rgthree Nodes 2.0 fix (master switch, all nodes)",
      tooltip:
        "Switch off to turn the whole fix off; every rgthree node goes back to rgthree's own " +
        "behaviour. The per-node switches keep their settings. Applies after a page reload.",
      type: "boolean",
      defaultValue: true,
      onChange: () => {
      void promptReload(); // Not awaited: the setting saves straight away.
    },
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Fast Groups Bypasser / Muter
//
// rgthree draws one "toggle and nav" row per group onto the canvas. In Nodes 2.0, a widget that
// carries an `element` is shown as that element instead of a picture, so each row gets its own
// element, offered only while Nodes 2.0 is on. Clicks go straight to rgthree's widget methods.
// ---------------------------------------------------------------------------------------------
let rowCounter = 0;

function fixFastGroups(node) {
  if (node.__qolFastGroupsFixed) return;
  node.__qolFastGroupsFixed = true;

  // Rows must carry their element and a unique name *before* ComfyUI registers them, because
  // Nodes 2.0 decides how to show a widget at that moment. So catch rgthree's rows as they're added.
  const originalAdd = node.addCustomWidget;
  node.addCustomWidget = function (widget, ...rest) {
    if (isFastGroupRow(widget) && !widget.__qolRow && !widget.element) safeAttach(attachRow, widget, node);
    return originalAdd.call(this, widget, ...rest);
  };

  // rgthree refreshes the rows regularly (labels, on/off, order); redraw ours after each refresh.
  const originalRefresh = node.refreshWidgets;
  node.refreshWidgets = function (...args) {
    const ret = originalRefresh.apply(this, args);
    try {
      syncFastGroupRows(this);
    } catch (e) {
      console.warn("[Personal QoL] rgthree fix: row sync failed", e);
    }
    return ret;
  };

  // Rows that existed before the fix arrived (rare) can't be converted after registration, so
  // remove them; rgthree recreates any missing row on its next refresh, and they're caught then.
  const stale = (node.widgets || []).filter((w) => isFastGroupRow(w) && !w.__qolRow && !w.element);
  if (stale.length) {
    for (const w of stale) node.removeWidget(w);
    node.refreshWidgets();
  }
}

function isFastGroupRow(w) {
  return !!w && typeof w.toggle === "function" && !!w.group;
}

function syncFastGroupRows(node) {
  for (const w of node.widgets || []) {
    if (w.__qolRow) renderRow(w, node);
  }
}

function attachRow(w, node) {
  const row = createRow();
  w.__qolRow = row;
  // Unique name per row: Nodes 2.0 finds a row's element by widget name, and rgthree gives
  // every row the same one. rgthree only matches rows by label, so this is safe.
  w.name = `RGTHREE_TOGGLE_AND_NAV_${++rowCounter}`;
  w.element = row.el;

  row.el.addEventListener("click", (e) => {
    e.stopPropagation();
    if (row.nav.contains(e.target)) {
      goToGroup(w.group);
      return;
    }
    w.toggle();
    // Restrictions such as "max one" can change other rows, so redraw them all.
    syncFastGroupRows(node);
    node.setDirtyCanvas?.(true, true);
  });
  renderRow(w, node);
}

function createRow() {
  const el = document.createElement("div");
  el.className = "qol-rg-row";
  el.innerHTML =
    '<span class="qol-rg-label"></span>' +
    '<span class="qol-rg-state"></span>' +
    '<span class="qol-rg-switch" role="switch"><span class="qol-rg-knob"></span></span>' +
    '<button class="qol-rg-nav" type="button" title="Go to group" aria-label="Go to group">' +
    '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">' +
    '<path d="M3 8h8M8 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.8" ' +
    'stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
  return {
    el,
    label: el.querySelector(".qol-rg-label"),
    state: el.querySelector(".qol-rg-state"),
    sw: el.querySelector(".qol-rg-switch"),
    nav: el.querySelector(".qol-rg-nav"),
  };
}

function renderRow(w, node) {
  const row = w.__qolRow;
  if (!row) return;
  const on = !!w.toggled;
  const label = w.label || "";
  if (row.label.textContent !== label) {
    row.label.textContent = label;
    row.label.title = label;
  }
  const stateText = on ? w.options?.on || "yes" : w.options?.off || "no";
  if (row.state.textContent !== stateText) row.state.textContent = stateText;
  row.el.classList.toggle("is-on", on);
  row.sw.setAttribute("aria-checked", on ? "true" : "false");
  row.nav.hidden = node.properties?.showNav === false;
}

// Same as rgthree's nav arrow: centre on the group and zoom out (never in) to fit it.
// Unlike the classic canvas, it also works when zoomed far out, since the button is always shown.
function goToGroup(group) {
  const canvas = app.canvas;
  if (!canvas || !group) return;
  canvas.centerOnNode(group);
  const zoomCurrent = canvas.ds?.scale || 1;
  const size = group._size || group.size;
  const zoomX = canvas.canvas.width / size[0] - 0.02;
  const zoomY = canvas.canvas.height / size[1] - 0.02;
  canvas.setZoom(Math.min(zoomCurrent, zoomX, zoomY), [
    canvas.canvas.width / 2,
    canvas.canvas.height / 2,
  ]);
  canvas.setDirty(true, true);
}

// ---------------------------------------------------------------------------------------------
// Seed
//
// rgthree removes ComfyUI's "control after generate" widget from the node and uses its own seed
// modes (-1 random, -2 increment, -3 decrement), but the seed box still links to the removed
// widget. Nodes 2.0 sees that link and shows a "Randomize Value" button that claims to be on and
// does nothing. The classic canvas shows no such control, so the link is dropped.
// ---------------------------------------------------------------------------------------------
function fixSeed(node) {
  const seed = (node.widgets || []).find((w) => w.name === "seed");
  if (!seed || !Array.isArray(seed.linkedWidgets)) return;
  const present = new Set(node.widgets || []);
  seed.linkedWidgets = seed.linkedWidgets.filter(
    (w) => !(w?.name === "control_after_generate" && !present.has(w)),
  );
}

// ---------------------------------------------------------------------------------------------
// Display Any
//
// rgthree makes the output box read-only by locking the classic text box directly. Nodes 2.0
// draws its own text box, which only checks the widget's `read_only` option, so you could type
// into it there. Setting that option locks it in Nodes 2.0 too (classic was already locked).
// ---------------------------------------------------------------------------------------------
function fixDisplayAny(node) {
  const w = node.showValueWidget || (node.widgets || []).find((x) => x.name === "output");
  if (!w) return;
  w.options = w.options || {};
  w.options.read_only = true;
}

// ---------------------------------------------------------------------------------------------
// Bookmark
//
// On the classic canvas, clicking the shortcut_key box opens a prompt with the old key selected,
// so pressing a key replaces it. In Nodes 2.0 it's an inline box and the click puts the cursor at
// the end, so typing "B" over "1" gives "1B" and the shortcut stops working. So the first click
// into that box selects the whole shortcut, as in classic; clicks after that work as normal.
// ---------------------------------------------------------------------------------------------
function fixBookmark(node) {
  node.__qolBookmark = true;
  hookBookmarkInputs();
}

let bookmarkHooked = false;
function hookBookmarkInputs() {
  if (bookmarkHooked) return;
  bookmarkHooked = true;
  document.addEventListener(
    "focusin",
    (e) => {
      const input = e.target;
      if (!isNodes2() || !(input instanceof HTMLInputElement)) return;
      const root = input.closest("[data-node-id]");
      const node = root && app.canvas?.graph?.getNodeById?.(root.getAttribute("data-node-id"));
      if (!node?.__qolBookmark) return;
      // The shortcut is the first text box; leave the zoom box alone.
      if (root.querySelector("input") !== input) return;
      input.select();
      // Stop the mouse-up that ends this click from undoing the selection.
      const keep = (ev) => ev.preventDefault();
      input.addEventListener("mouseup", keep, { once: true });
      setTimeout(() => input.removeEventListener("mouseup", keep), 500);
    },
    true,
  );
}

// ---------------------------------------------------------------------------------------------
// Image Comparer
//
// rgthree draws both images onto the canvas from its widget, using the canvas's own mouse
// tracking for the slider. In Nodes 2.0 the widget is squeezed into a 20 px strip and the canvas
// never hears about the mouse over the node, so nothing shows at all. So the widget gets its own
// element in Nodes 2.0: the two images stacked, with the same Slide and Click behaviour and the
// same A1/A2/B1 picker when there are several images. The images and choices still live in
// rgthree's widget, so saving, loading and the right-click image options are unchanged.
// ---------------------------------------------------------------------------------------------
function prepareImageComparer(proto) {
  // rgthree adds its widget while the node is being built, before onAdded, so catch it here.
  const prevAdd = proto.addCustomWidget;
  proto.addCustomWidget = function (widget, ...rest) {
    if (widget?.name === "rgthree_comparer" && !widget.__qolCmp && !widget.element) {
      safeAttach(attachComparer, widget, this);
    }
    return prevAdd.call(this, widget, ...rest);
  };
}

function fixImageComparer(node) {
  if (node.__qolCmpFixed) return;
  node.__qolCmpFixed = true;
  const w = (node.widgets || []).find((x) => x.name === "rgthree_comparer");
  if (!w?.__qolCmp) return;
  for (const name of ["onExecuted", "onConfigure"]) {
    const prev = node[name];
    node[name] = function (...args) {
      const r = prev?.apply(this, args);
      try {
        renderComparer(w, node);
      } catch (e) {
        console.warn("[Personal QoL] rgthree fix: comparer render failed", e);
      }
      return r;
    };
  }
  renderComparer(w, node);
}

function attachComparer(w, node) {
  const el = document.createElement("div");
  el.className = "qol-rg-cmp";
  el.innerHTML =
    '<div class="qol-rg-cmp-picks"></div>' +
    '<div class="qol-rg-cmp-stage">' +
    '<img class="qol-rg-cmp-a" alt="" draggable="false">' +
    '<img class="qol-rg-cmp-b" alt="" draggable="false">' +
    '<div class="qol-rg-cmp-line"></div>' +
    '<div class="qol-rg-cmp-empty">Run the workflow to compare images</div>' +
    "</div>";
  const ui = {
    el,
    picks: el.querySelector(".qol-rg-cmp-picks"),
    stage: el.querySelector(".qol-rg-cmp-stage"),
    a: el.querySelector(".qol-rg-cmp-a"),
    b: el.querySelector(".qol-rg-cmp-b"),
    line: el.querySelector(".qol-rg-cmp-line"),
    empty: el.querySelector(".qol-rg-cmp-empty"),
    over: false,
    down: false,
    x: 0,
  };
  w.__qolCmp = ui;
  w.element = el;
  // Let the comparer grow with the node in Nodes 2.0, like ComfyUI's own image previews.
  w.computeLayoutSize = () => ({ minHeight: 120, minWidth: 0 });
  w.__qolOwnLayout = true;

  const mode = () => (node.properties?.comparer_mode === "Click" ? "Click" : "Slide");
  ui.stage.addEventListener("pointerenter", () => {
    ui.over = true;
    renderComparer(w, node);
  });
  ui.stage.addEventListener("pointerleave", () => {
    ui.over = false;
    ui.down = false;
    node.imageIndex = 0;
    updateComparerView(w, node);
  });
  ui.stage.addEventListener("pointermove", (e) => {
    const r = ui.stage.getBoundingClientRect();
    ui.over = true;
    ui.x = Math.max(0, Math.min(r.width, (e.clientX - r.left) * (ui.stage.offsetWidth / r.width)));
    // As in rgthree: the right-click image options use the image on the side under the mouse.
    if (mode() === "Slide") node.imageIndex = ui.x > ui.stage.offsetWidth / 2 ? 1 : 0;
    updateComparerView(w, node);
  });
  ui.stage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    ui.down = true;
    if (mode() === "Click") node.imageIndex = 1;
    updateComparerView(w, node);
  });
  // Capture phase: Nodes 2.0 stops pointerup inside the node before it bubbles up to window.
  window.addEventListener(
    "pointerup",
    () => {
      if (!ui.down) return;
      ui.down = false;
      if (mode() === "Click") node.imageIndex = 0;
      updateComparerView(w, node);
    },
    true,
  );
  ui.a.addEventListener("load", () => updateComparerView(w, node));
  ui.b.addEventListener("load", () => updateComparerView(w, node));
}

function comparerSelection(w) {
  const images = w.value?.images || [];
  const sel = Array.isArray(w.selected) && w.selected.length ? w.selected : images.filter((d) => d.selected);
  return { images, a: sel[0], b: sel[1] };
}

function renderComparer(w, node) {
  const ui = w.__qolCmp;
  if (!ui) return;
  const { images, a, b } = comparerSelection(w);

  // Picker row, only when there are more than two images (as in rgthree).
  const key = images.map((d) => `${d.name}:${d.selected ? 1 : 0}`).join(",");
  if (ui.picksKey !== key) {
    ui.picksKey = key;
    ui.picks.replaceChildren();
    ui.picks.hidden = images.length <= 2;
    if (images.length > 2) {
      for (const d of images) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = d.name;
        btn.className = "qol-rg-cmp-pick" + (d.selected ? " is-on" : "");
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const { a: curA, b: curB } = comparerSelection(w);
          const next = [curA, curB];
          if (d.name.startsWith("A")) next[0] = d;
          else if (d.name.startsWith("B")) next[1] = d;
          w.setSelected(next.filter(Boolean));
          renderComparer(w, node);
          node.setDirtyCanvas?.(true, true);
        });
        ui.picks.appendChild(btn);
      }
    }
  }

  const srcA = a?.url || "";
  const srcB = b?.url || "";
  if (ui.a.getAttribute("src") !== srcA) srcA ? ui.a.setAttribute("src", srcA) : ui.a.removeAttribute("src");
  if (ui.b.getAttribute("src") !== srcB) srcB ? ui.b.setAttribute("src", srcB) : ui.b.removeAttribute("src");
  ui.empty.hidden = !!(srcA || srcB);
  updateComparerView(w, node);
}

// Where the image actually sits inside the stage (object-fit: contain).
function containedRect(img, boxW, boxH) {
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  if (!nw || !nh || !boxW || !boxH) return null;
  const scale = Math.min(boxW / nw, boxH / nh);
  const w = nw * scale;
  const h = nh * scale;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

function updateComparerView(w, node) {
  const ui = w.__qolCmp;
  if (!ui) return;
  const hasB = !!ui.b.getAttribute("src");
  const click = node.properties?.comparer_mode === "Click";
  const W = ui.stage.offsetWidth;
  const H = ui.stage.offsetHeight;
  ui.line.hidden = true;
  if (!hasB) {
    ui.b.style.visibility = "hidden";
    return;
  }
  if (click) {
    // Click mode: image B shows while the mouse button is held down over the images.
    ui.b.style.clipPath = "none";
    ui.b.style.visibility = ui.down ? "visible" : "hidden";
    return;
  }
  // Slide mode: image B shows to the left of the mouse, with a line where they meet.
  if (!ui.over) {
    ui.b.style.visibility = "hidden";
    return;
  }
  ui.b.style.visibility = "visible";
  ui.b.style.clipPath = `inset(0 ${Math.max(0, W - ui.x)}px 0 0)`;
  const r = containedRect(ui.b, W, H) || containedRect(ui.a, W, H);
  if (r && ui.x >= r.x && ui.x <= r.x + r.w) {
    ui.line.hidden = false;
    ui.line.style.left = `${ui.x}px`;
    ui.line.style.top = `${r.y}px`;
    ui.line.style.height = `${r.h}px`;
  }
}

// ---------------------------------------------------------------------------------------------
// Power Lora Loader
//
// rgthree draws the header, every LoRA row and the Add Lora button on the canvas. In Nodes 2.0
// each is squeezed into its own strip narrower than rgthree draws for, so the right-hand ▶
// strength arrow is cut off, and right-clicking a row shows the general node menu instead of
// rgthree's row menu, so a LoRA can't be removed or moved. So each gets its own element in
// Nodes 2.0. Every action calls rgthree's own methods, and the values stay in rgthree's widgets,
// so saving, loading and running are unchanged.
// ---------------------------------------------------------------------------------------------
const PLL_SHOW_STRENGTHS = "Show Strengths";
const PLL_SEPARATE = "Separate Model & Clip";
const isPllRow = (w) => typeof w?.name === "string" && w.name.startsWith("lora_");
const isPllHeader = (w) => w?.name === "PowerLoraLoaderHeaderWidget";
const isPllAdd = (w) => typeof w?.name === "string" && w.name.includes("Add Lora");

function preparePowerLora(proto) {
  const prevAdd = proto.addCustomWidget;
  proto.addCustomWidget = function (widget, ...rest) {
    if (!widget?.element && !widget?.__qolPll) {
      if (isPllRow(widget)) safeAttach(attachPllRow, widget, this);
      else if (isPllHeader(widget)) safeAttach(attachPllHeader, widget, this);
      else if (isPllAdd(widget)) safeAttach(attachPllAdd, widget, this);
    }
    const r = prevAdd.call(this, widget, ...rest);
    if (widget?.__qolPll) {
      // Draw new rows (and refresh the header's Toggle All) once rgthree has placed them.
      const node = this;
      queueMicrotask(() => renderPll(node));
    }
    return r;
  };
}

function fixPowerLora(node) {
  if (node.__qolPllFixed) return;
  node.__qolPllFixed = true;
  for (const name of ["onConfigure", "onPropertyChanged"]) {
    const prev = node[name];
    node[name] = function (...args) {
      const r = prev?.apply(this, args);
      queueMicrotask(() => renderPll(this)); // e.g. "Show Strengths" changed in the properties panel
      return r;
    };
  }
  renderPll(node);
}

function pllSeparate(node) {
  return node.properties?.[PLL_SHOW_STRENGTHS] === PLL_SEPARATE;
}

// rgthree updates this from draw(), which Nodes 2.0 never calls for our rows. It decides whether
// the clip strength is saved, so keep it in step the same way.
function pllSyncShowModelAndClip(w, node) {
  const now = pllSeparate(node);
  if (w.showModelAndClip !== now) {
    const old = w.showModelAndClip;
    w.showModelAndClip = now;
    if (now) {
      if (old != null) w.value.strengthTwo = w.value.strength ?? 1;
    } else {
      w.value.strengthTwo = null;
    }
  }
}

function renderPll(node) {
  for (const w of node.widgets || []) {
    if (!w.__qolPll) continue;
    try {
      w.__qolPll.render();
    } catch (e) {
      console.warn("[Personal QoL] rgthree fix: Power Lora render failed", e);
    }
  }
  node.setDirtyCanvas?.(true, true);
}

function pllChanged(node) {
  renderPll(node);
  node.graph?.change?.();
}

function makeToggle(on, mixed = false) {
  const t = document.createElement("span");
  t.className = "qol-rg-switch qol-rg-pll-toggle";
  t.setAttribute("role", "switch");
  t.innerHTML = '<span class="qol-rg-knob"></span>';
  t.classList.toggle("is-on", !!on);
  t.classList.toggle("is-mixed", !!mixed);
  return t;
}

function makeStrength(get, set, node) {
  const box = document.createElement("span");
  box.className = "qol-rg-pll-num";
  box.innerHTML =
    '<button type="button" class="qol-rg-pll-step" aria-label="Decrease">−</button>' +
    '<span class="qol-rg-pll-val" title="Click to type a value, or drag left/right"></span>' +
    '<button type="button" class="qol-rg-pll-step" aria-label="Increase">+</button>';
  const [dec, val, inc] = box.children;
  const step = (dir) => {
    // Same as rgthree's stepStrength: 0.05 per click, rounded to 2 places.
    set(Math.round(((get() ?? 1) + 0.05 * dir) * 100) / 100);
    pllChanged(node);
  };
  dec.addEventListener("click", (e) => (e.stopPropagation(), step(-1)));
  inc.addEventListener("click", (e) => (e.stopPropagation(), step(1)));
  // Drag left/right to change, and click without dragging to type a value: as rgthree.
  val.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    let moved = false;
    let lastX = e.clientX;
    val.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const dx = ev.clientX - lastX;
      lastX = ev.clientX;
      if (!dx) return;
      moved = true;
      set((get() ?? 1) + dx * 0.05);
      val.textContent = Number(get() ?? 1).toFixed(2);
    };
    const up = (ev) => {
      val.removeEventListener("pointermove", move);
      val.removeEventListener("pointerup", up);
      val.removeEventListener("pointercancel", up);
      if (moved) {
        pllChanged(node);
        return;
      }
      app.canvas.prompt(
        "Value",
        get(),
        (v) => {
          set(Number(v));
          pllChanged(node);
        },
        ev,
      );
    };
    val.addEventListener("pointermove", move);
    val.addEventListener("pointerup", up);
    val.addEventListener("pointercancel", up);
  });
  return {
    el: box,
    render() {
      val.textContent = Number(get() ?? 1).toFixed(2);
    },
  };
}

function attachPllRow(w, node) {
  const el = document.createElement("div");
  el.className = "qol-rg-pll-row";
  const toggleSlot = document.createElement("span");
  const name = document.createElement("span");
  name.className = "qol-rg-pll-name";
  name.title = "Click to choose a LoRA. Right-click for more options.";
  const info = document.createElement("button");
  info.type = "button";
  info.className = "qol-rg-pll-info";
  info.textContent = "i";
  info.title = "Show info";
  const one = makeStrength(
    () => w.value.strength,
    (v) => (w.value.strength = v),
    node,
  );
  const two = makeStrength(
    () => w.value.strengthTwo,
    (v) => (w.value.strengthTwo = v),
    node,
  );
  one.el.title = "Model strength";
  two.el.title = "Clip strength";
  el.append(toggleSlot, name, info, one.el, two.el);

  toggleSlot.addEventListener("click", (e) => {
    e.stopPropagation();
    w.value.on = !w.value.on;
    pllChanged(node);
  });
  name.addEventListener("click", (e) => {
    e.stopPropagation();
    // rgthree's chooser; same callback as its own onLoraClick.
    node.showLoraChooser(e, (value) => {
      w.value.lora = value;
      w.loraInfo = null;
      w.getLoraInfo?.();
      pllChanged(node);
    });
  });
  info.addEventListener("click", (e) => {
    e.stopPropagation();
    w.showLoraInfoDialog();
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showPllRowMenu(w, node, e);
  });

  w.__qolPll = {
    render() {
      pllSyncShowModelAndClip(w, node);
      const sep = pllSeparate(node);
      const on = !!w.value.on;
      toggleSlot.replaceChildren(makeToggle(on));
      el.classList.toggle("is-off", !on);
      const lora = w.value.lora && w.value.lora !== "None" ? w.value.lora : "None";
      if (name.textContent !== lora) name.textContent = lora;
      info.disabled = lora === "None";
      one.render();
      two.el.hidden = !sep;
      if (sep) two.render();
    },
  };
  w.element = el;
}

// The same menu rgthree shows for a row on the classic canvas.
function showPllRowMenu(w, node, event) {
  const rows = () => node.widgets || [];
  const index = rows().indexOf(w);
  const canMoveUp = isPllRow(rows()[index - 1]);
  const canMoveDown = isPllRow(rows()[index + 1]);
  const move = (to) => {
    const arr = node.widgets;
    arr.splice(to, 0, arr.splice(arr.indexOf(w), 1)[0]);
    pllChanged(node);
  };
  new LiteGraph.ContextMenu(
    [
      { content: "ℹ️ Show Info", callback: () => w.showLoraInfoDialog() },
      null,
      {
        content: `${w.value.on ? "⚫" : "🟢"} Toggle ${w.value.on ? "Off" : "On"}`,
        callback: () => {
          w.value.on = !w.value.on;
          pllChanged(node);
        },
      },
      { content: "⬆️ Move Up", disabled: !canMoveUp, callback: () => move(index - 1) },
      { content: "⬇️ Move Down", disabled: !canMoveDown, callback: () => move(index + 1) },
      {
        content: "🗑️ Remove",
        callback: () => {
          if (typeof node.removeWidget === "function") node.removeWidget(w);
          else node.widgets.splice(node.widgets.indexOf(w), 1);
          pllChanged(node);
        },
      },
    ],
    { title: "LORA WIDGET", event },
  );
}

function attachPllHeader(w, node) {
  const el = document.createElement("div");
  el.className = "qol-rg-pll-head";
  const toggleSlot = document.createElement("span");
  const label = document.createElement("span");
  label.className = "qol-rg-pll-name";
  label.textContent = "Toggle All";
  const cols = document.createElement("span");
  cols.className = "qol-rg-pll-cols";
  el.append(toggleSlot, label, cols);
  toggleSlot.addEventListener("click", (e) => {
    e.stopPropagation();
    node.toggleAllLoras();
    pllChanged(node);
  });
  w.__qolPll = {
    render() {
      const has = node.hasLoraWidgets?.();
      el.classList.toggle("is-empty", !has);
      const state = node.allLorasState?.(); // true / false / null (mixed)
      toggleSlot.replaceChildren(makeToggle(state === true, state == null));
      const sep = pllSeparate(node);
      cols.innerHTML = sep
        ? '<span class="qol-rg-pll-col">Model</span><span class="qol-rg-pll-col">Clip</span>'
        : '<span class="qol-rg-pll-col">Strength</span>';
    },
  };
  w.element = el;
}

function attachPllAdd(w, node) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "qol-rg-pll-add";
  el.textContent = "➕ Add Lora";
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    // Same as rgthree's Add Lora button.
    node.showLoraChooser(e, (value) => {
      if (value.includes("Power Lora Chooser") || value === "NONE") return;
      node.addNewLoraWidget(value);
      const computed = node.computeSize();
      node.size[1] = Math.max(node._tempHeight ?? 15, computed[1]);
      pllChanged(node);
    });
  });
  w.__qolPll = { render() {} };
  w.element = el;
}

// ---------------------------------------------------------------------------------------------
// Label
//
// rgthree draws the label on the canvas (that part works in Nodes 2.0). But Nodes 2.0 also puts
// an invisible node box over it, at least 225 px wide plus a title strip, which catches clicks
// well outside the text and ignores rgthree's "pinned labels let clicks through". So that box
// ignores the mouse, and a click area matching the drawn label sits inside it. Clicks on the
// click area still reach Nodes 2.0 (select, drag, right-click). Pinned: the click area is off.
// ---------------------------------------------------------------------------------------------
function fixLabel(node) {
  node.__qolLabel = true;
}

let labelDrawHooked = false;
function hookLabelDrawing() {
  if (labelDrawHooked || typeof LGraphCanvas === "undefined") return;
  labelDrawHooked = true;
  const prev = LGraphCanvas.prototype.drawNode;
  LGraphCanvas.prototype.drawNode = function (node, ctx) {
    const r = prev.apply(this, arguments);
    if (node?.__qolLabel) {
      try {
        syncLabelHitArea(node);
      } catch (e) {
        /* never break canvas drawing */
      }
    }
    return r;
  };
}

function syncLabelHitArea(node) {
  const root = isNodes2() ? document.querySelector(`[data-node-id="${node.id}"]`) : null;
  if (!root) return;
  root.classList.add("qol-rg-label-node");
  let hit = root.querySelector(":scope > .qol-rg-label-hit");
  if (!hit) {
    hit = document.createElement("div");
    hit.className = "qol-rg-label-hit";
    root.appendChild(hit);
  }
  // The node box is placed in graph units by a translate(); the label is drawn at node.pos.
  const m = /translate\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(root.style.transform || "");
  const boxX = m ? parseFloat(m[1]) : node.pos[0];
  const boxY = m ? parseFloat(m[2]) : node.pos[1];
  const left = `${node.pos[0] - boxX}px`;
  const top = `${node.pos[1] - boxY}px`;
  const width = `${Math.max(node.size[0], 4)}px`;
  const height = `${Math.max(node.size[1], 4)}px`;
  if (hit.style.left !== left) hit.style.left = left;
  if (hit.style.top !== top) hit.style.top = top;
  if (hit.style.width !== width) hit.style.width = width;
  if (hit.style.height !== height) hit.style.height = height;
  hit.classList.toggle("is-pinned", !!node.flags?.pinned);

}

// ---------------------------------------------------------------------------------------------
// Properties menu (all rgthree nodes)
//
// rgthree keeps every node setting in the node's Properties (Show Strengths, Fast Groups sort and
// filters, Label font and colours, comparer mode, seed range...). The classic right-click menu
// has a Properties ▸ submenu for them; the Nodes 2.0 menu has none, so they can't be changed
// there. So rgthree nodes get the same submenu in Nodes 2.0, built by LiteGraph's own code, so
// editing works exactly as on the classic canvas.
// ---------------------------------------------------------------------------------------------
let propsMenuOn = false;
let lastMenuEvent = null;
document.addEventListener("contextmenu", (e) => (lastMenuEvent = e), true);

function isRgthreeNode(node) {
  const t = String(node?.type || node?.constructor?.type || "");
  return /\(rgthree\)\s*$/.test(t);
}

let lastPointer = [200, 200];
let lastPointerTarget = null;
document.addEventListener(
  "pointerdown",
  (e) => {
    lastPointer = [e.clientX, e.clientY];
    lastPointerTarget = e.target;
  },
  true,
);

// ComfyUI's nine group colours, as rgthree's matchColors understands them (names or hex).
const COMFY_COLOURS = ["red", "brown", "green", "blue", "pale_blue", "cyan", "purple", "yellow", "black"];
const colourLabel = (c) => c.replace(/_/g, " ").replace(/^./, (m) => m.toUpperCase());
const COMMON_FONTS = [
  "Arial", "Helvetica", "Verdana", "Tahoma", "Trebuchet MS", "Segoe UI", "Inter", "Roboto",
  "Georgia", "Times New Roman", "Garamond", "Courier New", "Consolas", "Monaco", "Impact",
  "Comic Sans MS", "sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui",
];

function propInfo(node, key) {
  return node.getPropertyInfo?.(key) || {};
}
function propPrintable(node, key) {
  let v = node.properties[key];
  if (v === undefined || v === null || v === "") return "—";
  if (typeof v === "object") v = JSON.stringify(v);
  const info = propInfo(node, key);
  if ((info.type === "enum" || info.type === "combo") && LGraphCanvas.getPropertyPrintableValue) {
    v = LGraphCanvas.getPropertyPrintableValue(v, info.values);
  }
  v = String(v).replace(/\s+/g, " ");
  return v.length > 40 ? v.slice(0, 39) + "…" : v;
}
function propLabel(node, key) {
  return `${propInfo(node, key).label || key}: ${propPrintable(node, key)}`;
}
function propChoices(node, key) {
  const info = propInfo(node, key);
  if (info.type === "enum" || info.type === "combo") {
    const vals = typeof info.values === "function" ? info.values() : info.values;
    if (Array.isArray(vals)) return vals.map((v) => ({ label: String(v), value: v }));
    if (vals && typeof vals === "object") {
      return Object.entries(vals).map(([k, v]) => ({ label: String(v), value: k }));
    }
  }
  if (info.type === "boolean" || typeof node.properties[key] === "boolean") {
    return [
      { label: "On", value: true },
      { label: "Off", value: false },
    ];
  }
  return null; // typed
}

function setProp(node, key, value) {
  node.setProperty(key, value);
  node.setDirtyCanvas?.(true, true);
  node.graph?.change?.();
}

// The matchColors value as a list of lower-case names/hex codes.
function matchColourList(node) {
  return String(node.properties.matchColors || "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean);
}
function groupColourOf(name) {
  return LGraphCanvas.node_colors?.[name]?.groupcolor?.toLowerCase() || null;
}

function subMenu(entries, event, parentMenu, node) {
  new LiteGraph.ContextMenu(entries, { event: event || lastMenuEvent, parentMenu, node });
  return false;
}

function settingEntry(node, key) {
  const label = propLabel(node, key);
  if (key === "matchColors") {
    return {
      content: label,
      has_submenu: true,
      callback: (v, o, event, parentMenu) => {
        const chosen = new Set(matchColourList(node));
        const isOn = (c) => chosen.has(c) || chosen.has(groupColourOf(c) || "\u0000");
        const write = (list) => setProp(node, key, list.join(","));
        const entries = [
          {
            content: `${chosen.size ? "" : "✓ "}Any colour`,
            callback: () => write([]),
          },
          null,
          ...COMFY_COLOURS.map((c) => ({
            content: `${isOn(c) ? "✓ " : ""}${colourLabel(c)}`,
            callback: () => {
              const list = matchColourList(node).filter((x) => x !== c && x !== groupColourOf(c));
              write(isOn(c) ? list : [...list, c]);
            },
          })),
          null,
          {
            content: "Custom…",
            callback: () => openTypePanel(node, key, { kind: "colours" }),
          },
        ];
        return subMenu(entries, event, parentMenu, node);
      },
    };
  }
  const choices = propChoices(node, key);
  if (choices) {
    return {
      content: label,
      has_submenu: true,
      callback: (v, o, event, parentMenu) => {
        const cur = node.properties[key];
        return subMenu(
          choices.map((c) => ({
            content: `${String(c.value) === String(cur) ? "✓ " : ""}${c.label}`,
            callback: () => setProp(node, key, c.value),
          })),
          event,
          parentMenu,
          node,
        );
      },
    };
  }
  // Typed: our panel opens where a submenu would.
  return { content: label, callback: () => openTypePanel(node, key) };
}

function propertiesMenuItems(node) {
  if (!propsMenuOn || !isNodes2() || !isRgthreeNode(node)) return [];
  const keys = Object.keys(node.properties || {});
  if (!keys.length) return [];
  return [
    {
      __qolProps: true,
      // Not "Properties": Nodes 2.0 hides extension items with that exact name.
      content: "Node Properties",
      has_submenu: true,
      callback: (value, options, event, parentMenu) =>
        subMenu(
          keys.map((key) => settingEntry(node, key)),
          event,
          parentMenu,
          node,
        ),
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Type-in panel: a text box with suggestions, opened beside the menu where a submenu would be.
// ---------------------------------------------------------------------------------------------
function typeSuggestions(node, key, kind) {
  if (kind === "colours") {
    // Custom matchColors entry: colours used by groups in this workflow, and the named ones.
    const used = new Set();
    for (const g of app.graph?._groups || []) if (g.color) used.add(g.color.toLowerCase());
    return [...used, ...COMFY_COLOURS].map((v) => ({ value: v, hint: "" }));
  }
  if (key === "matchTitle") {
    const titles = new Set();
    for (const g of app.graph?._groups || []) if (g.title) titles.add(g.title);
    for (const g of app.canvas?.graph?._groups || []) if (g.title) titles.add(g.title);
    return [...titles].map((v) => ({ value: v, hint: "group" }));
  }
  if (key === "fontFamily") return COMMON_FONTS.map((v) => ({ value: v, hint: "" }));
  if (key === "fontColor" || key === "backgroundColor") {
    const list = [{ value: "transparent", hint: "" }, { value: "#ffffff", hint: "white" }, { value: "#000000", hint: "black" }];
    for (const c of COMFY_COLOURS) {
      const nc = LGraphCanvas.node_colors?.[c];
      if (nc?.bgcolor) list.push({ value: nc.bgcolor, hint: colourLabel(c) });
      if (nc?.color) list.push({ value: nc.color, hint: `${colourLabel(c)} (title)` });
    }
    return list;
  }
  return [];
}

let typePanel = null;
function closeTypePanel() {
  typePanel?.remove();
  typePanel = null;
}

function openTypePanel(node, key, opts = {}) {
  // Where the menu entry was: the submenu would open to its right.
  const item = lastPointerTarget?.closest?.("[role=menuitem], li, .litemenu-entry");
  const r = item?.getBoundingClientRect?.() || { right: lastPointer[0], top: lastPointer[1] };
  setTimeout(() => {
    closeTypePanel();
    const info = propInfo(node, key);
    const isNumber = info.type === "number" || typeof node.properties[key] === "number";
    const panel = document.createElement("div");
    panel.className = "qol-rg-type";
    const title = document.createElement("div");
    title.className = "qol-rg-type-title";
    title.textContent = opts.kind === "colours" ? "Custom colour (hex), added to the list" : info.label || key;
    const input = document.createElement("input");
    input.type = "text";
    input.spellcheck = false;
    input.className = "qol-rg-type-input";
    input.value = opts.kind === "colours" ? "" : node.properties[key] ?? "";
    if (opts.kind === "colours") input.placeholder = "#a4d399";
    const list = document.createElement("div");
    list.className = "qol-rg-type-list";
    const hint = document.createElement("div");
    hint.className = "qol-rg-type-hint";
    hint.textContent = "Enter to apply · Esc to cancel";
    panel.append(title, input, list, hint);
    document.body.appendChild(panel);
    typePanel = panel;

    // Place beside the menu entry, kept on screen.
    const pw = panel.offsetWidth || 260;
    let x = r.right + 2;
    if (x + pw > window.innerWidth - 8) x = Math.max(8, (r.left ?? x) - pw - 2);
    let y = Math.min(r.top, window.innerHeight - panel.offsetHeight - 8);
    panel.style.left = `${x}px`;
    panel.style.top = `${Math.max(8, y)}px`;

    const all = typeSuggestions(node, key, opts.kind);
    let shown = [];
    let active = -1;
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      shown = all.filter((s) => !q || String(s.value).toLowerCase().includes(q) || s.hint.toLowerCase().includes(q)).slice(0, 12);
      list.replaceChildren(
        ...shown.map((s, i) => {
          const row = document.createElement("div");
          row.className = "qol-rg-type-opt" + (i === active ? " is-active" : "");
          row.textContent = String(s.value);
          if (s.hint) {
            const h = document.createElement("span");
            h.textContent = s.hint;
            row.appendChild(h);
          }
          row.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            input.value = String(s.value);
            apply();
          });
          return row;
        }),
      );
      list.hidden = !shown.length;
    };
    const apply = () => {
      let v = input.value;
      if (opts.kind === "colours") {
        v = v.trim().toLowerCase();
        if (!v) return closeTypePanel();
        const listNow = matchColourList(node).filter((x) => x !== v);
        setProp(node, key, [...listNow, v].join(","));
      } else if (isNumber) {
        const n = Number(v);
        if (v.trim() === "" || !Number.isFinite(n)) {
          input.classList.add("is-bad");
          return;
        }
        setProp(node, key, n);
      } else {
        setProp(node, key, v);
      }
      closeTypePanel();
    };
    input.addEventListener("input", () => {
      active = -1;
      input.classList.remove("is-bad");
      draw();
    });
    input.addEventListener("keydown", (e) => {
      e.stopPropagation(); // keep keys away from the canvas (Delete, Ctrl+A, letters...)
      if (e.key === "Escape") return closeTypePanel();
      if (e.key === "ArrowDown" && shown.length) {
        e.preventDefault();
        active = (active + 1) % shown.length;
        draw();
      } else if (e.key === "ArrowUp" && shown.length) {
        e.preventDefault();
        active = (active - 1 + shown.length) % shown.length;
        draw();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (active >= 0 && shown[active]) input.value = String(shown[active].value);
        apply();
      }
    });
    panel.addEventListener("pointerdown", (e) => e.stopPropagation());
    const outside = (e) => {
      if (!typePanel || panel.contains(e.target)) return;
      document.removeEventListener("pointerdown", outside, true);
      closeTypePanel();
    };
    document.addEventListener("pointerdown", outside, true);
    draw();
    input.focus();
    input.select();
  }, 0);
}

// ---------------------------------------------------------------------------------------------
// Settings gear: the same list as Node Properties, from a gear at the node's bottom-right (level
// with ComfyUI's "frontend_only" / "rgthree-comfy" badge, clear of the resize corner). Only on
// rgthree nodes that have settings (not Labels), only in Nodes 2.0.
// ---------------------------------------------------------------------------------------------
const GEAR_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" ' +
  'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>' +
  '<circle cx="12" cy="12" r="3"/></svg>';

function openSettingsFromGear(node, event) {
  const keys = Object.keys(node.properties || {});
  if (!keys.length) return;
  new LiteGraph.ContextMenu(
    keys.map((key) => settingEntry(node, key)),
    { event, title: "Node Properties", node },
  );
}

function ensureGears() {
  if (!propsMenuOn || !isNodes2()) return;
  const graph = app.canvas?.graph;
  if (!graph) return;
  for (const root of document.querySelectorAll("[data-node-id]")) {
    try {
      const node = graph.getNodeById?.(root.getAttribute("data-node-id"));
      // Not on Labels (Jeff's choice): they keep Node Properties in the right-click menu only.
      const wanted =
        node &&
        isRgthreeNode(node) &&
        node.type !== "Label (rgthree)" &&
        Object.keys(node.properties || {}).length > 0;
      let gear = root.querySelector(":scope > .qol-rg-gear");
      if (!wanted) {
        gear?.remove();
        continue;
      }
      if (!gear) {
        gear = document.createElement("button");
        gear.type = "button";
        gear.className = "qol-rg-gear";
        gear.title = "Node Properties";
        gear.setAttribute("aria-label", "Node Properties");
        gear.innerHTML = GEAR_SVG;
        // Keep the press to ourselves, so it doesn't select or drag the node.
        gear.addEventListener("pointerdown", (e) => e.stopPropagation());
        gear.addEventListener("click", (e) => {
          e.stopPropagation();
          const n = app.canvas?.graph?.getNodeById?.(root.getAttribute("data-node-id"));
          if (n) openSettingsFromGear(n, e);
        });
        root.appendChild(gear);
      }
      gear.hidden = !!node.flags?.collapsed;
    } catch (e) {
      /* never break the canvas */
    }
  }
}

let gearsQueued = false;
function startGears() {
  const queue = () => {
    if (gearsQueued) return;
    gearsQueued = true;
    requestAnimationFrame(() => {
      gearsQueued = false;
      ensureGears();
    });
  };
  // Nodes 2.0 adds, removes and rebuilds node elements as you work (and when you switch modes or
  // open a subgraph), so check whenever the page's elements change.
  new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  queue();
}

// The Nodes 2.0 menu lists each node's "extra" menu options (under Extensions), so add the item
// there, once per rgthree node type. Only in Nodes 2.0: the classic menu already has Properties.
function hookPropertiesMenus() {
  for (const [type, cls] of Object.entries(LiteGraph.registered_node_types || {})) {
    if (!/\(rgthree\)\s*$/.test(type) || !cls?.prototype) continue;
    const proto = cls.prototype;
    if (Object.prototype.hasOwnProperty.call(proto, "__qolPropsHooked")) continue;
    const prev = proto.getExtraMenuOptions;
    proto.getExtraMenuOptions = function (canvas, options, ...rest) {
      const r = prev?.call(this, canvas, options, ...rest);
      try {
        if (Array.isArray(options) && !options.some((o) => o?.__qolProps)) {
          options.push(...propertiesMenuItems(this));
        }
      } catch (e) {
        /* never break the menu */
      }
      return r;
    };
    proto.__qolPropsHooked = true;
  }
}

// ---------------------------------------------------------------------------------------------

function loadCss() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./rgthree_nodes2_fix.css", import.meta.url).href;
  document.head.appendChild(link);
}

const active = new Map(); // nodeType -> fix function, decided once at start-up.
const prepares = new Map(); // nodeType -> one-off class-level hook, run at start-up.

app.registerExtension({
  name: "PersonalQoL.RgthreeNodes2Fix",
  settings: buildSettings(),
  async setup() {
    if (!HAS_RGTHREE) return;
    if (settingGet(MASTER_ID, true)) {
      propsMenuOn = settingGet(PROPS_ID, true) !== false;
      if (propsMenuOn) {
        try {
          hookPropertiesMenus();
          startGears();
        } catch (e) {
          console.warn("[Personal QoL] rgthree fix: Node Properties menu unavailable", e);
        }
      }
      for (const f of FIXES) {
        if (settingGet(f.id, true)) {
          active.set(f.nodeType, f.apply);
          if (f.prepare) prepares.set(f.nodeType, f.prepare);
        }
      }
    }
    if (active.size) loadCss();
    if (active.has("Label (rgthree)")) hookLabelDrawing();
    // rgthree registers these nodes itself, so ComfyUI's nodeCreated hook never sees them.
    // Hook each node type's onAdded instead (rgthree's own onAdded still runs first).
    for (const [type, apply] of active) {
      const cls = LiteGraph.registered_node_types?.[type];
      if (!cls || cls.prototype.__qolHooked) continue;
      const proto = cls.prototype;
      try {
        prepares.get(type)?.(proto);
      } catch (e) {
        console.warn("[Personal QoL] rgthree fix: could not prepare", type, e);
      }
      const prevOnAdded = proto.onAdded;
      proto.onAdded = function (...args) {
        const r = prevOnAdded?.apply(this, args);
        try {
          apply(this);
        } catch (e) {
          console.warn("[Personal QoL] rgthree fix failed for", type, e);
        }
        return r;
      };
      proto.__qolHooked = true;
    }
    // Fix nodes that already exist (e.g. a workflow restored before setup ran).
    for (const node of app.graph?._nodes || []) {
      try {
        active.get(node.type)?.(node);
      } catch (e) {
        console.warn("[Personal QoL] rgthree fix failed for", node.type, e);
      }
    }
    setTimeout(() => (settingsReady = true), 1500);
    console.log(
      `[Personal QoL] rgthree Nodes 2.0 fix ${BUILD}: ` +
        (active.size ? `on for ${[...active.keys()].join(", ")}` : "off"),
    );
  },
});
