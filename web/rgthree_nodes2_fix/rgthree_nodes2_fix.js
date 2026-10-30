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

const BUILD = "2026-10-30.1";
const CATEGORY = "Personal QoL Nodes";
const SECTION = "rgthree Nodes 2.0 fix";

const MASTER_ID = "PersonalQoL.RgthreeFix.Master";
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
    if (isFastGroupRow(widget) && !widget.__qolRow && !widget.element) attachRow(widget, node);
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

function loadCss() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("./rgthree_nodes2_fix.css", import.meta.url).href;
  document.head.appendChild(link);
}

const active = new Map(); // nodeType -> fix function, decided once at start-up.

app.registerExtension({
  name: "PersonalQoL.RgthreeNodes2Fix",
  settings: buildSettings(),
  async setup() {
    if (!HAS_RGTHREE) return;
    if (settingGet(MASTER_ID, true)) {
      for (const f of FIXES) {
        if (settingGet(f.id, true)) active.set(f.nodeType, f.apply);
      }
    }
    if (active.size) loadCss();
    // rgthree registers these nodes itself, so ComfyUI's nodeCreated hook never sees them.
    // Hook each node type's onAdded instead (rgthree's own onAdded still runs first).
    for (const [type, apply] of active) {
      const cls = LiteGraph.registered_node_types?.[type];
      if (!cls || cls.prototype.__qolHooked) continue;
      const proto = cls.prototype;
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
      active.get(node.type)?.(node);
    }
    setTimeout(() => (settingsReady = true), 1500);
    console.log(
      `[Personal QoL] rgthree Nodes 2.0 fix ${BUILD}: ` +
        (active.size ? `on for ${[...active.keys()].join(", ")}` : "off"),
    );
  },
});
