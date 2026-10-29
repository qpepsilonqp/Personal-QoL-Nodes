// Super-Power Lora Loader — frontend widget.
// A DOM widget so it renders natively in Nodes 2.0 (Vue nodes) as well as the classic canvas.

import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const NODE_TYPE = "SuperPowerLoraLoader";
const WIDGET_TYPE = "SUPER_POWER_LORA";
const ROW_H = 26;
const STEP = 0.05;
const MAX_STRENGTH = 100;
const MIN_WIDTH = 240; // narrowest the node can be drawn
const DEFAULT_WIDTH = 400; // a new node's width
const NARROW_AT = 360; // below this width the node switches to its compact (narrow) layout
const BUILD = "phase 14 · 29 Oct 2026"; // shown in Settings, to check which version the browser loaded
const SORT_MODES = ["az", "za", "new", "old"];
const SETTINGS_TABS = [
  { id: "sources", label: "Sources" }, { id: "display", label: "Display" }, { id: "lists", label: "Lists" },
  { id: "favs", label: "Favourites" }, { id: "info", label: "Info" }, { id: "file", label: "Layout file" },
];
const OUTSIDE_CLOSES = new Set(["menu", "color", "move", "settings", "unlisted", "sort"]); // closed by a click outside the node
const TEXT_CTX = {}; // canvases for measuring text and reading colours
const HOLD_OUT_MS = 3500; // a clicked result's highlight: fades for 3 s, flashes once, then it's gone
const FADE_MS = 5000; // how long a switched-off LoRA can be brought back from ENABLED
const ACTIVE_MAX_ROWS = 8;
const FAV_SORTS = { az: "A to Z", za: "Z to A", new: "Newest added", old: "Oldest added", custom: "Custom" }; // the Active section scrolls beyond this
const HOLD_MS = 300; // press-and-hold time before a drag starts
const BULK_PAUSE_MS = 1200; // pause between Civitai requests during a bulk fetch
const GROUP_DEAD_ZONE = 8; // px around a group's search box and ⋯ button where clicks do nothing
const PALETTE = [
  "#e05252", "#e0864a", "#d9b440", "#7cb84a", "#3fae8c",
  "#3f9fd6", "#5b6fd9", "#9a5bd9", "#d65bb0", "#8a8a8a",
];

const controllers = new Set();
const declinedFolders = new Set(); // folders the user said "no" to creating, this session
const scanCache = new Map(); // request body -> { t, data }
let promptChain = Promise.resolve(); // serialises folder prompts across nodes

// ---------------------------------------------------------------- styles
(function loadCss() {
  if (document.getElementById("spll-css")) return;
  const link = document.createElement("link");
  link.id = "spll-css";
  link.rel = "stylesheet";
  link.href = new URL("./super_power_lora.css", import.meta.url).href;
  document.head.appendChild(link);
})();

// ---------------------------------------------------------------- wheel guard
// Nodes 2.0 captures wheel events above the nodes and turns them into canvas zoom/pan.
// Over one of our scrollable lists the wheel should scroll the list instead, so we stop the
// event at the window (capture phase, before the canvas sees it). The browser still scrolls
// the list natively. Ctrl/Cmd+wheel is left alone so zooming over the node still works.
(function installWheelGuard() {
  if (window.__spllWheelGuard) return;
  window.__spllWheelGuard = true;
  window.addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) return;
    let n = e.target instanceof Element ? e.target : null;
    while (n && !n.classList?.contains("spll")) {
      if (n.classList?.contains("spll-scroll") && n.scrollHeight > n.clientHeight + 1) {
        e.stopPropagation();
        return;
      }
      n = n.parentElement;
    }
  }, { capture: true, passive: true });
})();

// ---------------------------------------------------------------- helpers
const uid = () => "g" + Math.random().toString(36).slice(2, 10);
// LoRA and folder keys name which loras folder they're in: "b1:styles/anime/x.safetensors", "b1:styles", "b1:" (that loras folder itself).
// Plain relative paths (no ":") are still handled the same way, for the folder picker.
const dirname = (p) => {
  const i = p.lastIndexOf("/");
  if (i >= 0) return p.slice(0, i);
  const c = p.indexOf(":");
  return c >= 0 ? p.slice(0, c + 1) : "";
};
const basename = (p) => p.slice(Math.max(p.lastIndexOf("/"), p.indexOf(":")) + 1);
const relOf = (k) => k.slice(k.indexOf(":") + 1);
const baseOf = (k) => k.slice(0, Math.max(0, k.indexOf(":")));
const mkKey = (b, rel) => `${b}:${rel}`;
const isBaseKey = (k) => k.endsWith(":");
const stripExt = (n) => n.replace(/\.[^.]+$/, "");
const round2 = (v) => Math.round(v * 100) / 100;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (v) => round2(v).toFixed(2);
/** Narrow mode: two digits at most, rounded, no minus sign (negatives are shown in red). */
function compactStrength(v) {
  const a = Math.abs(v);
  if (a >= 9.95) return String(Math.round(a));
  if (a >= 0.995) return (Math.round(a * 10) / 10).toFixed(1);
  if (a < 0.005) return "0";
  return (Math.round(a * 100) / 100).toFixed(2).replace(/^0/, "");
}
const clone = (o) => JSON.parse(JSON.stringify(o));
/** Is p inside folder f (or f itself)? Works on keys ("b1:styles") and plain relative paths. */
const under = (p, f) => {
  if (f === "" || f === undefined || f === null) return true;
  if (isBaseKey(f)) return p.startsWith(f);
  return p === f || p.startsWith(f + "/");
};
const lorasLabel = (f) => { const r = f.includes(":") ? relOf(f) : f; return r ? `loras/${r}` : "loras"; };
const UNGROUPED = "__ungrouped";
/** The folder a LoRA sits in, as shown to people ("styles/anime", or "loras" for the top). */
const folderText = (p) => relOf(dirname(p)) || "loras";
const isTextInput = (el) =>
  !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") {
        for (const [sk, sv] of Object.entries(v)) {
          if (sv === null || sv === undefined) continue;
          if (sk.startsWith("--")) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      }
      else if (k === "text") el.textContent = v;
      else if (k in el && typeof v !== "string") el[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

async function getJson(url) {
  const res = await api.fetchApi(url);
  return res.json();
}
async function postJson(url, body) {
  const res = await api.fetchApi(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function confirmDialog(title, message, items) {
  const dlg = app.extensionManager?.dialog;
  if (dlg?.confirm) {
    try {
      const r = await dlg.confirm({ title, message, itemList: items || [], key: "spll-confirm" });
      return r === true;
    } catch (e) {
      console.warn("[Super-Power Lora Loader] dialog failed, falling back", e);
    }
  }
  const list = items?.length ? "\n\n" + items.join("\n") : "";
  return window.confirm(`${title}\n\n${message}${list}`);
}

/** Ask for a line of text (ComfyUI's own prompt when it has one). Resolves to the text, or null. */
async function promptText(title, message, value = "") {
  const dlg = app.extensionManager?.dialog;
  if (dlg?.prompt) {
    try {
      const r = await dlg.prompt({ title, message, defaultValue: value });
      return typeof r === "string" ? r.trim() || null : null;
    } catch (e) { /* fall back */ }
  }
  const r = window.prompt(`${title}\n\n${message}`, value);
  return r === null ? null : r.trim() || null;
}

/**
 * A page-level question with several answers (and optionally a list to pick one item from).
 * Resolves to the button's value, or { button, option } when there's a list. Escape = the first button.
 * It doesn't close on outside clicks: these are the rare, serious questions.
 */
function choiceDialog({ title, message, options = null, selected = null, buttons }) {
  return new Promise((resolve) => {
    let pick = selected ?? options?.[0]?.value ?? null;
    const back = h("div", { class: "spll spll-modal-backdrop spll-choice-backdrop" });
    const box = h("div", { class: "spll-choice", role: "dialog", "aria-label": title });
    back.append(box);
    box.append(h("div", { class: "spll-choice-title", text: title }));
    if (message) box.append(h("div", { class: "spll-choice-msg", text: message }));
    if (options) {
      const list = h("div", { class: "spll-choice-list" });
      for (const o of options) {
        const lab = h("label", { class: "spll-choice-opt" },
          h("input", { type: "radio", name: "spll-choice", value: o.value, checked: o.value === pick }),
          o.tier ? tierDot(o.tier) : o.color ? h("span", { class: "spll-tier-dot", style: { background: o.color } }) : null,
          h("span", { text: o.label, style: { color: o.color || null } }));
        lab.querySelector("input").addEventListener("change", () => { pick = o.value; });
        list.append(lab);
      }
      box.append(list);
    }
    const row = h("div", { class: "spll-pop-buttons" });
    const done = (value) => {
      document.removeEventListener("keydown", onKey, true);
      back.remove();
      resolve(options ? (value === null ? null : { button: value, option: pick }) : value);
    };
    for (const b of buttons) {
      const btn = h("button", { class: "spll-btn" + (b.primary ? " is-primary" : "") + (b.danger ? " is-danger" : ""), text: b.label });
      btn.addEventListener("click", () => done(b.value));
      row.append(btn);
    }
    box.append(row);
    const onKey = (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); done(buttons[0].value); }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.append(back);
    (row.querySelector(".is-primary") || row.lastChild)?.focus();
  });
}

function toast(kind, title, detail) {
  const t = app.extensionManager?.toast;
  try {
    if (t && typeof t[kind] === "function") return void t[kind](title, { description: detail });
    if (t?.add) {
      const severity = { warning: "warn", error: "error", success: "success", info: "info" }[kind] || "info";
      return void t.add({ severity, summary: title, detail, life: 5000 });
    }
  } catch (e) { /* fall through */ }
  console.log(`[Super-Power Lora Loader] ${title}${detail ? ": " + detail : ""}`);
}

// Civitai API key: kept in ComfyUI's user settings (never in workflows)
const KEY_SETTING = "SuperPowerLoraLoader.CivitaiApiKey";
function getApiKey() {
  try {
    const v = app.extensionManager?.setting?.get?.(KEY_SETTING);
    if (typeof v === "string") return v;
  } catch { /* */ }
  try { return localStorage.getItem(KEY_SETTING) || ""; } catch { return ""; }
}
function setApiKey(v) {
  try {
    if (app.extensionManager?.setting?.set) return void app.extensionManager.setting.set(KEY_SETTING, v);
  } catch { /* */ }
  try { localStorage.setItem(KEY_SETTING, v); } catch { /* */ }
}

// copy text, falling back to a select-and-copy box when the browser blocks the clipboard
async function copyText(text) {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (ok) return true;
  } catch { /* */ }
  return false;
}

/** Trigger words that count for the T button: Civitai's (and rgthree user-added), then your own. */
function triggersFrom(payload) {
  const out = [];
  for (const w of payload?.info?.trainedWords || []) {
    if (w && (w.civitai || w.user) && typeof w.word === "string" && !out.includes(w.word)) out.push(w.word);
  }
  for (const w of payload?.side?.triggers || []) if (typeof w === "string" && !out.includes(w)) out.push(w);
  return out;
}

// ---------------------------------------------------------------- colours
const HL_DEFAULTS = { accent: "#3f9fd6", on: "#4caf7a", fade: "#f5c542", flash: "#3f9fd6", result: null, mix: "#d9822b" };
function hexRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbHex(c) { return "#" + c.map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, "0")).join(""); }
/** Blend two #rrggbb colours (t = how much of b). */
function mixHex(a, b, t) { const x = hexRgb(a), y = hexRgb(b); return rgbHex(x.map((v, i) => v + (y[i] - v) * t)); }
const shineOf = (c) => mixHex(c, "#ffffff", 0.6); // a default shine for a tier colour
const outlineOf = (t) => t.outline || mixHex(t.color, "#000000", 0.45); // automatic: a darker shade of the main colour
/** The cartoon-metal look for a tier: main colour, shine, outline. */
function metalStyle(t) {
  const dark = mixHex(t.color, "#000000", 0.3);
  return {
    "--st-a": t.color, "--st-b": t.shine || shineOf(t.color), "--st-o": outlineOf(t), "--st-d": dark,
  };
}
const tierDot = (t) => h("span", { class: "spll-tier-dot is-metal", style: metalStyle(t) });

// ---------------------------------------------------------------- state
const COLL_DEPTH = 3; // collections can nest this deep inside a tier
const MAX_TIERS = 10;
function defaultTiers() {
  return [
    { id: "t1", name: "Gold", color: "#d4af37", shine: "#fff1a6", outline: null },
    { id: "t2", name: "Silver", color: "#b9c0ca", shine: "#ffffff", outline: null },
    { id: "t3", name: "Bronze", color: "#cd7f32", shine: "#ffcf9e", outline: null },
  ];
}

function defaultState() {
  return {
    v: 2,
    setup: false, // false until something has been added (shows the setup picker)
    bases: {}, // loras-folder id -> its full path, as last resolved ("b1": "D:/ComfyUI/models/loras")
    sources: { folders: [], loras: [] }, // folders: [{ key, flat }]; loras: [key] added one by one
    settings: {
      dropdownRows: 8,
      listHeight: 12, // rows per group; 0 = unlimited
      blur: false, // blur Civitai previews until clicked
      colorMode: "individual", // or "alternating"
      colorA: "#3f9fd6",
      colorB: "#9a5bd9",
      historyLength: 30, // 0 = history off
      favRows: 8, // rows the Favourites menu shows before it scrolls
      histRows: 8, // rows the History menu shows before it scrolls
      favSort: "custom", // "custom" | "az" | "za" | "new" | "old"
      favMenuOnClick: true, // a left-click on ☆ also opens the tier/collection menu
      favDefaultTier: null, // tier a left-click on ☆ adds to (null = the top tier)
      hl: { ...HL_DEFAULTS }, // highlight colours (so a colour scheme can't hide them)
      groupsCollapsed: false, // the whole GROUPS (or DISABLED) section folded away
      groupsHeight: null, // node height before GROUPS was collapsed, restored when it opens
      tierSubmenus: "auto", // "auto": tier submenus only once a favourite is outside the top tier; "always"
      flatList: false, // GROUPS shows one plain list of every LoRA instead of the groups
      flatSort: "az", // the plain list's order: "az" | "za" | "new" | "old"
      ungroupedCollapsed: false,
    },
    groups: [], // { id, name, color, parent, folder, collapsed }; array order = sibling order
    knownFolders: [], // folders already turned into groups once
    placements: {}, // lora path -> group id, only where it differs from its folder's group
    active: [], // [{ path, strength }] or a mix [{ mix: id, on, since }], in apply order
    mixes: [], // [{ id, name, items: [{ path, strength, off? }], added }]: saved mixes
    mixDrafts: {}, // mix id -> items: edits made in its box that aren't saved yet
    mixPrefer: {}, // lora path -> mix id: "Use this mix's copy" when two switched-on mixes share a LoRA
    strengths: {}, // lora path -> strength for switched-off LoRAs that aren't 1.0
    ids: {}, // lora path -> { h: sha256, m: Civitai model id, v: version id, z: size }, for active (and missing) LoRAs only
    favourites: [], // lora keys, in custom order (new ones go first)
    favAdded: {}, // lora key -> when it was starred (ms), for the newest / oldest sorts
    tiers: defaultTiers(), // [{ id, name, color }], top = most important
    favTier: {}, // lora key -> tier id (every favourite has one)
    favColl: {}, // lora key -> collection id (missing = loose in its tier)
    collections: [], // [{ id, name, tier, parent, added }], up to COLL_DEPTH levels inside a tier
    history: [], // lora paths switched off, newest first (active ones never appear)
    unlisted: { loras: [], groups: [] }, // hidden until relisted from the gear menu
    sorts: {}, // group id ("" = top level) -> "az" (soft A to Z, the default) | "za" | "new" | "old"
    order: {}, // "l:<group id>" -> LoRA keys, "g:<parent id>" -> group ids: your arrangement for soft A to Z
  };
}

/** Phase 1-3 nodes had one root folder; it becomes one added folder, and every path gets the "b1:" prefix. */
function migrateV1(s) {
  if (s.root === null || s.root === undefined || typeof s.root !== "string") {
    return { ...s, v: 2, setup: false, bases: {}, sources: { folders: [], loras: [] } };
  }
  const k = (p) => (typeof p === "string" ? `b1:${p}` : p);
  const keys = (o) => Object.fromEntries(Object.entries(o || {}).map(([p, v]) => [k(p), v]));
  const root = s.root.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return {
    ...s,
    v: 2,
    setup: true,
    bases: { b1: typeof s.base === "string" ? s.base : "" },
    // the old root keeps its old layout: its subfolders stay top-level groups and its own files stay in "Unsorted"
    sources: { folders: [{ key: `b1:${root}`, flat: true }], loras: [] },
    groups: (s.groups || []).map((g) => (g && typeof g.folder === "string" ? { ...g, folder: k(g.folder) } : g)),
    knownFolders: (s.knownFolders || []).map(k),
    placements: keys(s.placements),
    active: (s.active || []).map((a) => (a && typeof a === "object" ? { ...a, path: k(a.path) } : a)),
    strengths: keys(s.strengths),
    ids: keys(s.ids),
    favourites: (s.favourites || []).map(k),
    history: (s.history || []).map(k),
    unlisted: { loras: (s.unlisted?.loras || []).map(k), groups: s.unlisted?.groups || [] },
  };
}

function sanitize(v) {
  let s = v;
  if (typeof s === "string") { try { s = JSON.parse(s); } catch { s = null; } }
  const d = defaultState();
  if (!s || typeof s !== "object" || Array.isArray(s)) return d;
  const str = (x) => typeof x === "string";
  const num = (x, def) => (typeof x === "number" && isFinite(x) ? x : def);

  if (!s.sources && ("root" in s || "base" in s)) s = migrateV1(s);
  const isKey = (k) => str(k) && /^[A-Za-z0-9_]{1,16}:/.test(k);
  for (const [b, path] of Object.entries(s.bases || {})) if (/^[A-Za-z0-9_]{1,16}$/.test(b)) d.bases[b] = str(path) ? path : "";
  const seenF = new Set();
  d.sources.folders = (Array.isArray(s.sources?.folders) ? s.sources.folders : [])
    .map((f) => (str(f) ? { key: f, flat: false } : f))
    .filter((f) => f && isKey(f.key) && d.bases[baseOf(f.key)] !== undefined && !seenF.has(f.key) && seenF.add(f.key))
    .map((f) => ({ key: f.key.replace(/\/+$/, ""), flat: !!f.flat }));
  d.sources.loras = [...new Set((Array.isArray(s.sources?.loras) ? s.sources.loras : []).filter((k) => isKey(k) && d.bases[baseOf(k)] !== undefined))];
  d.setup = !!s.setup || d.sources.folders.length > 0 || d.sources.loras.length > 0;
  if (s.settings && typeof s.settings === "object") {
    d.settings.dropdownRows = clamp(Math.round(num(s.settings.dropdownRows, 8)), 1, 50);
    const lh = num(s.settings.listHeight, 12);
    d.settings.listHeight = lh === 0 ? 0 : clamp(Math.round(lh), 1, 200);
    d.settings.blur = !!s.settings.blur;
    d.settings.colorMode = s.settings.colorMode === "alternating" ? "alternating" : "individual";
    for (const k of ["colorA", "colorB"]) {
      if (str(s.settings[k]) && /^#[0-9a-fA-F]{6}$/.test(s.settings[k])) d.settings[k] = s.settings[k];
    }
    d.settings.historyLength = clamp(Math.round(num(s.settings.historyLength, 30)), 0, 500);
    d.settings.favRows = clamp(Math.round(num(s.settings.favRows, 8)), 1, 50);
    d.settings.histRows = clamp(Math.round(num(s.settings.histRows, 8)), 1, 50);
    if (["custom", "az", "za", "new", "old"].includes(s.settings.favSort)) d.settings.favSort = s.settings.favSort;
    d.settings.ungroupedCollapsed = !!s.settings.ungroupedCollapsed;
  }
  const uniq = (a) => [...new Set((Array.isArray(a) ? a : []).filter(str))];
  d.favourites = uniq(s.favourites);
  for (const [k, t] of Object.entries(s.favAdded || {})) if (d.favourites.includes(k) && typeof t === "number") d.favAdded[k] = t;
  // older favourites have no time: treat list order (newest first) as the order they were added
  d.favourites.forEach((k, i) => { if (d.favAdded[k] === undefined) d.favAdded[k] = 1000 + (d.favourites.length - i); });
  d.history = uniq(s.history).slice(0, d.settings.historyLength);
  // favourite tiers and collections
  if (Array.isArray(s.tiers) && s.tiers.length) {
    const seenT = new Set();
    const t = s.tiers.filter((x) => x && str(x.id) && !seenT.has(x.id) && seenT.add(x.id)).slice(0, MAX_TIERS)
      .map((x) => {
        const hex = (v) => str(v) && /^#[0-9a-fA-F]{6}$/.test(v);
        const color = hex(x.color) ? x.color : "#d4af37";
        return { id: x.id, name: (str(x.name) && x.name.trim() ? x.name.trim() : "Tier").slice(0, 40), color,
          shine: hex(x.shine) ? x.shine : shineOf(color), outline: hex(x.outline) ? x.outline : null };
      });
    if (t.length) d.tiers = t;
  }
  const tierIds = new Set(d.tiers.map((x) => x.id));
  if (s.settings) {
    d.settings.favMenuOnClick = s.settings.favMenuOnClick !== false;
    d.settings.favDefaultTier = tierIds.has(s.settings.favDefaultTier) ? s.settings.favDefaultTier : null;
    d.settings.tierSubmenus = s.settings.tierSubmenus === "always" ? "always" : "auto";
    d.settings.flatList = !!s.settings.flatList;
    if (SORT_MODES.includes(s.settings.flatSort)) d.settings.flatSort = s.settings.flatSort;
    d.settings.groupsCollapsed = !!s.settings.groupsCollapsed;
    for (const k of Object.keys(HL_DEFAULTS)) {
      const v = s.settings.hl?.[k];
      if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) d.settings.hl[k] = v;
      else if (k === "result" && v === null) d.settings.hl.result = null;
    }
    d.settings.groupsHeight = typeof s.settings.groupsHeight === "number" && isFinite(s.settings.groupsHeight) ? s.settings.groupsHeight : null;
  }
  const favSet = new Set(d.favourites);
  // every favourite has an explicit tier (older ones, and unknown tiers, go to the top tier)
  for (const k of d.favourites) { const t = s.favTier?.[k]; d.favTier[k] = tierIds.has(t) ? t : d.tiers[0].id; }
  const seenC = new Set();
  d.collections = (Array.isArray(s.collections) ? s.collections : [])
    .filter((c) => c && str(c.id) && str(c.name) && tierIds.has(c.tier) && !seenC.has(c.id) && seenC.add(c.id))
    .map((c) => ({ id: c.id, name: c.name.slice(0, 80), tier: c.tier, parent: str(c.parent) ? c.parent : null, added: num(c.added, 0) }));
  const cById = new Map(d.collections.map((c) => [c.id, c]));
  for (const c of d.collections) {
    const p = c.parent && cById.get(c.parent);
    if (!p || p.tier !== c.tier) c.parent = null;
  }
  for (const c of d.collections) { // break cycles, and keep within COLL_DEPTH levels
    const seen = new Set([c.id]);
    let cur = c.parent, depth = 1;
    while (cur) {
      if (seen.has(cur) || ++depth > COLL_DEPTH) { c.parent = null; break; }
      seen.add(cur);
      cur = cById.get(cur)?.parent ?? null;
    }
  }
  for (const [k, cid] of Object.entries(s.favColl || {})) {
    const c = cById.get(cid);
    if (favSet.has(k) && c && c.tier === d.favTier[k]) d.favColl[k] = cid;
  }
  d.unlisted = { loras: uniq(s.unlisted?.loras), groups: uniq(s.unlisted?.groups) };
  for (const [k, m] of Object.entries(s.sorts || {})) if (str(k) && SORT_MODES.includes(m)) d.sorts[k] = m;
  for (const [k, list] of Object.entries(s.order || {})) if (/^[lg]:/.test(k) && Array.isArray(list)) d.order[k] = uniq(list);
  for (const [k, v] of Object.entries(s.ids || {})) {
    if (!v || typeof v !== "object") continue;
    const e = {};
    if (str(v.h) && /^[0-9a-fA-F]{64}$/.test(v.h)) e.h = v.h.toLowerCase();
    if (Number.isInteger(v.m)) e.m = v.m;
    if (Number.isInteger(v.v)) e.v = v.v;
    if (Number.isInteger(v.z)) e.z = v.z;
    if (Object.keys(e).length) d.ids[k] = e;
  }
  const seen = new Set();
  d.groups = (Array.isArray(s.groups) ? s.groups : [])
    .filter((g) => g && str(g.id) && str(g.name) && !seen.has(g.id) && seen.add(g.id))
    .map((g) => ({
      id: g.id,
      name: g.name.slice(0, 200),
      color: str(g.color) && /^#[0-9a-fA-F]{6}$/.test(g.color) ? g.color : null,
      parent: str(g.parent) ? g.parent : null,
      folder: str(g.folder) ? g.folder : null,
      collapsed: !!g.collapsed,
    }));
  // break dangling parents and cycles
  const ids = new Map(d.groups.map((g) => [g.id, g]));
  for (const g of d.groups) {
    if (g.parent && !ids.has(g.parent)) g.parent = null;
    const visited = new Set([g.id]);
    let cur = g.parent;
    while (cur) {
      if (visited.has(cur)) { g.parent = null; break; }
      visited.add(cur);
      cur = ids.get(cur)?.parent ?? null;
    }
  }
  d.knownFolders = (Array.isArray(s.knownFolders) ? s.knownFolders : []).filter(isKey);
  for (const [k, gid] of Object.entries(s.placements || {})) if (str(gid)) d.placements[k] = gid;
  // mixes
  const strengthOk = (x) => clamp(round2(num(x, 1)), -MAX_STRENGTH, MAX_STRENGTH);
  const mixItems = (list) => {
    const seenP = new Set();
    return (Array.isArray(list) ? list : []).filter((it) => it && str(it.path) && !seenP.has(it.path) && seenP.add(it.path))
      .map((it) => (it.off ? { path: it.path, strength: strengthOk(it.strength), off: true } : { path: it.path, strength: strengthOk(it.strength) }));
  };
  const seenM = new Set();
  d.mixes = (Array.isArray(s.mixes) ? s.mixes : [])
    .filter((m) => m && str(m.id) && !seenM.has(m.id) && seenM.add(m.id))
    .map((m) => ({ id: m.id, name: (str(m.name) && m.name.trim() ? m.name.trim() : "Mix").slice(0, 80), items: mixItems(m.items), added: num(m.added, 0),
      color: str(m.color) && /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : null, collapsed: !!m.collapsed }));
  for (const [id, list] of Object.entries(s.mixDrafts || {})) if (seenM.has(id) && Array.isArray(list)) d.mixDrafts[id] = mixItems(list);
  for (const [p, id] of Object.entries(s.mixPrefer || {})) if (seenM.has(id)) d.mixPrefer[p] = id;
  const act = new Set();
  d.active = (Array.isArray(s.active) ? s.active : [])
    .filter((a) => a && (a.mix !== undefined
      ? str(a.mix) && seenM.has(a.mix) && !act.has("m:" + a.mix) && act.add("m:" + a.mix)
      : str(a.path) && !act.has(a.path) && act.add(a.path)))
    .map((a) => (a.mix !== undefined ? { mix: a.mix, on: !!a.on, since: num(a.since, 0) } : { path: a.path, strength: strengthOk(a.strength) }));
  for (const [k, val] of Object.entries(s.strengths || {})) {
    if (typeof val === "number" && isFinite(val) && !act.has(k)) d.strengths[k] = clamp(round2(val), -MAX_STRENGTH, MAX_STRENGTH);
  }
  return d;
}

// ---------------------------------------------------------------- controller
class Controller {
  constructor(node, el) {
    this.node = node;
    this.el = el;
    this.state = defaultState();
    this.files = new Map(); // path -> { path, nickname?, hasSidecar }
    this.folders = new Set();
    this.missing = new Set();
    this.missingFolders = new Set(); // added folders that aren't on disk
    this.resolved = {}; // loras-folder id -> full path on this machine
    this.scanned = false;
    this.loading = false;
    this.scanToken = 0;
    this.error = null;

    this.mainQuery = "";
    this.mainOpen = false;
    this.groupQueries = new Map(); // gid -> query
    this.gOpen = null; // group whose search results are showing
    this.footerOpen = false; // Nodes 2.0: Search Files slid out
    this.armed = new Set(); // open search boxes the mouse has been over (only these close when it leaves)
    this.closeTimers = new Map();
    this.freshSearch = new Set(); // search boxes (by data-fkey) whose next click selects the term again
    this.hold = null; // { key, slot, start }: the search result you clicked, highlighted in the groups
    this.released = new Map(); // key -> when its highlight started fading
    this.overlay = null; // { kind, ... }
    this.editing = null; // { path, where }
    this.highlight = null; // { key, until }
    this.dragging = null;
    this.picker = null; // { bases, sel: { base, rel }, expanded, filter, message, loading }
    this.pickerScroll = 0;
    this.lastHeight = 0;
    this.m = null; // derived model
    this.boxScroll = new Map(); // group id -> scroll position of its LoRA box
    this.busy = new Set(); // LoRAs being hashed / looked up
    this.session = new Map(); // path -> { trig, ids } for info fetched this session but not saved

    this.build();
    controllers.add(this);
  }

  // ----- widget plumbing
  getState() { return clone(this.state); }

  setState(v) {
    this.state = sanitize(v);
    this.scanned = false;
    this.overlay = null;
    this.editing = null;
    this.groupQueries.clear();
    this.refresh();
  }

  promptValue() {
    // Only what execution needs, so the queued prompt stays small.
    const s = this.state;
    const bases = {};
    for (const b of Object.keys(s.bases)) bases[b] = this.basePath(b);
    return {
      setup: s.setup,
      bases,
      loras: this.loadList(),
    };
  }

  notify() {
    try { this.node.setDirtyCanvas?.(true, true); } catch { /* */ }
    const ct = app.extensionManager?.workflow?.activeWorkflow?.changeTracker;
    try {
      if (typeof ct?.captureCanvasState === "function") ct.captureCanvasState();
      else ct?.checkState?.();
    } catch { /* */ }
  }

  commit(fn) {
    fn?.(this.state);
    this.reconcile();
    this.render();
    this.notify();
    if (PageMenu.current?.c === this && !PageMenu.current.drag) PageMenu.current.refresh({ keepFocused: true });
  }

  // ----- sources and loras folders
  /** Full path of one of this node's loras folders, as resolved on this machine. */
  basePath(b) { return this.resolved?.[b] || this.state.bases[b] || ""; }

  /** The node's id for a loras folder (by full path), adding one if it's new. */
  baseIdFor(path, st = this.state) {
    for (const [b, p] of Object.entries(st.bases)) if ((this.resolved?.[b] || p) === path || p === path) return b;
    let n = 1;
    while (st.bases[`b${n}`] !== undefined) n++;
    st.bases[`b${n}`] = path;
    this.resolved = { ...(this.resolved || {}), [`b${n}`]: path };
    return `b${n}`;
  }

  /** Request fields for a LoRA or folder key: which loras folder, and the path inside it. */
  q(k) { return { base: this.basePath(baseOf(k)), root: "", path: relOf(k) }; }
  qs(k) { return `base=${encodeURIComponent(this.basePath(baseOf(k)))}&root=&path=${encodeURIComponent(relOf(k))}`; }

  /** Keys grouped by loras folder, for routes that take one folder at a time. */
  byBase(keys) {
    const out = new Map();
    for (const k of keys) {
      const b = baseOf(k);
      if (!out.has(b)) out.set(b, []);
      out.get(b).push(k);
    }
    return out;
  }

  folderSource(f) { return this.state.sources.folders.find((x) => x.key === f) || null; }

  /** The added folder a key sits in (the deepest one), or null. */
  sourceOf(k) {
    let best = null;
    for (const f of this.state.sources.folders) if (under(k, f.key) && (!best || f.key.length > best.key.length)) best = f;
    return best;
  }

  /** Is this LoRA part of the node (inside an added folder, or added on its own)? */
  inNode(p) { return this.state.sources.loras.includes(p) || !!this.sourceOf(p); }

  hasFolders() { return this.state.sources.folders.length > 0; }

  // ----- data
  async refresh({ force = false, promptFolders = true } = {}) {
    const s = this.state;
    if (!s.setup) {
      this.scanned = false;
      this.render();
      if (!this.picker) this.openPicker();
      return;
    }
    const body = { bases: { ...s.bases }, folders: s.sources.folders.map((f) => f.key), loras: s.sources.loras };
    for (const b of Object.keys(body.bases)) body.bases[b] = this.basePath(b);
    const key = JSON.stringify(body);
    const token = ++this.scanToken;
    this.loading = true;
    this.render();
    let data;
    try {
      const hit = scanCache.get(key);
      if (!force && hit && Date.now() - hit.t < 4000) data = hit.data;
      else {
        data = await postJson("/spll/sources", body);
        if (!data.error) scanCache.set(key, { t: Date.now(), data });
      }
    } catch (e) {
      data = { error: String(e?.message || e) };
    }
    if (token !== this.scanToken) return;
    this.loading = false;
    if (data.error) {
      this.error = data.error;
      this.render();
      return;
    }
    this.error = null;
    this.sep = data.sep || "/";
    this.resolved = {};
    for (const [b, path] of Object.entries(data.bases || {})) {
      if (path) { this.resolved[b] = path; if (s.bases[b] !== path) s.bases[b] = path; } // resolved on this machine
    }
    this.files = new Map();
    this.folders = new Set();
    this.missingFolders = new Set();
    for (const [fk, r] of Object.entries(data.folders || {})) {
      if (!r.exists) { this.missingFolders.add(fk); continue; }
      for (const f of r.folders) this.folders.add(f);
      for (const l of r.loras) this.files.set(l.path, l);
    }
    for (const [lk, l] of Object.entries(data.loras || {})) if (l) this.files.set(lk, l);
    // renamed or moved files are matched up first, so an active one stays switched on
    const renames = await this.findRenames();
    if (token !== this.scanToken) return;
    for (const [o, n] of renames) this.reattach(this.state, o, n);
    this.scanned = true;
    const switchedOff = this.reconcile({ fromScan: true });
    if (renames.size) {
      toast("success", `Found ${renames.size} renamed or moved LoRA${renames.size > 1 ? "s" : ""}`,
        [...renames].map(([o, n]) => `${basename(o)} → ${relOf(n)}`).join("; "));
      this.notify();
    }
    this.render();
    if (switchedOff.length) {
      toast(
        "warning",
        `${switchedOff.length} enabled LoRA${switchedOff.length > 1 ? "s are" : " is"} missing`,
        `Disabled: ${switchedOff.map(basename).join(", ")}`
      );
      this.notify();
    }
    if (promptFolders) await this.checkMissingFolders();
  }

  /** Bring the group tree in line with the files on disk. Returns keys of enabled LoRAs disabled because they're missing. */
  reconcile({ fromScan = false } = {}) {
    const s = this.state;
    const switchedOff = [];
    if (!this.scanned) { this.m = this.model(); return switchedOff; }

    const byId = new Map(s.groups.map((g) => [g.id, g]));
    const byFolder = new Map();
    for (const g of s.groups) if (g.folder !== null && !byFolder.has(g.folder)) byFolder.set(g.folder, g);
    const known = new Set(s.knownFolders);

    // the nearest group above a folder, inside the added folder it belongs to
    const parentGroupFor = (folder) => {
      const src = this.sourceOf(folder);
      if (!src || folder === src.key) return null;
      let cur = dirname(folder);
      while (under(cur, src.key)) {
        if (cur === src.key && src.flat) return null; // a flat folder's subfolders are top-level groups
        const g = byFolder.get(cur);
        if (g) return g.id;
        if (cur === src.key) return null;
        const next = dirname(cur);
        if (next === cur) break;
        cur = next;
      }
      return null;
    };
    const makeFolderGroup = (folder) => {
      const src = this.folderSource(folder);
      const g = {
        id: uid(),
        name: src?.flat ? "Unsorted" : basename(folder) || "loras",
        color: null,
        parent: src ? null : parentGroupFor(folder),
        folder,
        collapsed: true,
      };
      s.groups.push(g);
      byId.set(g.id, g);
      byFolder.set(folder, g);
      known.add(folder);
      return g;
    };

    // 1. Added folders and their subfolders become groups (once; deleted groups aren't brought back for empty folders).
    //    A flat folder's own group ("Unsorted") is only made when it has LoRAs of its own.
    for (const f of this.folders) {
      const src = this.sourceOf(f);
      if (!src || (src.flat && f === src.key)) continue;
      if (byFolder.has(f)) { known.add(f); continue; }
      if (known.has(f)) continue;
      makeFolderGroup(f);
    }

    // 2. Every LoRA in an added folder has a group: its placement, else its folder's group (recreated if deleted).
    //    LoRAs added on their own stay ungrouped unless you put them in a group.
    for (const p of this.files.keys()) {
      const gid = s.placements[p];
      if (gid === UNGROUPED || (gid && byId.has(gid))) continue;
      if (gid) delete s.placements[p];
      if (!this.sourceOf(p)) continue;
      const f = dirname(p);
      if (!byFolder.has(f)) makeFolderGroup(f);
    }

    // 3. Missing LoRAs: part of this node and referenced by its layout, but not on disk
    this.missing = new Set();
    const referenced = new Set([
      ...s.active.filter((a) => a.path).map((a) => a.path),
      ...this.mixPaths(),
      ...Object.keys(s.strengths),
      ...Object.keys(s.placements),
      ...Object.keys(s.ids),
      ...s.favourites,
      ...s.sources.loras,
    ]);
    for (const p of referenced) {
      if (!this.inNode(p) || this.files.has(p)) continue;
      this.missing.add(p);
      const gid = s.placements[p];
      if (gid && gid !== UNGROUPED && !byId.has(gid)) delete s.placements[p];
      const src = this.sourceOf(p);
      if (!s.placements[p] && src?.flat && !byFolder.has(dirname(p)) && !byFolder.has(src.key)) makeFolderGroup(src.key);
    }
    if (fromScan) {
      s.active = s.active.filter((a) => {
        if (a.mix || !this.missing.has(a.path)) return true;
        s.strengths[a.path] = a.strength; // kept even at 1.0, so the missing LoRA stays listed
        switchedOff.push(a.path);
        return false;
      });
    }

    for (const g of s.groups) if (g.parent && !byId.has(g.parent)) g.parent = null;
    s.knownFolders = [...known];
    // Civitai ids are only kept for enabled LoRAs and missing ones (so a missing LoRA can still be found)
    const activeSet = new Set([...s.active.map((a) => a.path), ...this.mixPaths()]); // mixes keep theirs too
    for (const k of Object.keys(s.ids)) if (!activeSet.has(k) && !this.missing.has(k)) delete s.ids[k];
    this.m = this.model();
    return switchedOff;
  }

  groupIdOf(p, byId, byFolder) {
    const gid = this.state.placements[p];
    if (gid === UNGROUPED || (gid && byId.has(gid))) return gid;
    const src = this.sourceOf(p);
    if (src) {
      const f = dirname(p);
      if (byFolder.has(f)) return byFolder.get(f).id;
      if (src.flat && byFolder.has(src.key)) return byFolder.get(src.key).id; // missing LoRA whose folder group is gone
    }
    return UNGROUPED;
  }

  model() {
    const s = this.state;
    const byId = new Map(s.groups.map((g) => [g.id, g]));
    const byFolder = new Map();
    for (const g of s.groups) if (g.folder !== null && !byFolder.has(g.folder)) byFolder.set(g.folder, g);
    // unlisted groups hide everything inside them
    const hiddenGroups = new Set();
    const unlistedG = new Set(s.unlisted.groups);
    for (const g of s.groups) {
      let cur = g;
      const seen = new Set();
      while (cur && !seen.has(cur.id)) {
        if (unlistedG.has(cur.id)) { hiddenGroups.add(g.id); break; }
        seen.add(cur.id);
        cur = cur.parent ? byId.get(cur.parent) : null;
      }
    }
    const unlistedL = new Set(s.unlisted.loras);
    const childGroups = new Map();
    for (const g of s.groups) {
      if (hiddenGroups.has(g.id)) continue;
      const key = g.parent && byId.has(g.parent) ? g.parent : "";
      if (!childGroups.has(key)) childGroups.set(key, []);
      childGroups.get(key).push(g);
    }
    const lorasIn = new Map();
    const groupOfLora = new Map();
    const hiddenLoras = new Set();
    const paths = new Set([...[...this.files.keys()].filter((p) => this.inNode(p)), ...this.missing]);
    for (const p of paths) {
      const gid = this.groupIdOf(p, byId, byFolder);
      groupOfLora.set(p, gid);
      if (unlistedL.has(p) || hiddenGroups.has(gid)) { hiddenLoras.add(p); continue; }
      if (!lorasIn.has(gid)) lorasIn.set(gid, []);
      lorasIn.get(gid).push(p);
    }
    // each group's LoRAs and subgroups in the order its sort gives (soft A to Z by default)
    const loraName = (p) => this.displayName(p);
    const loraTime = (p) => this.files.get(p)?.t || 0;
    for (const [gid, list] of lorasIn) lorasIn.set(gid, this.ordered(gid === UNGROUPED ? "" : gid, `l:${gid}`, list, loraName, loraTime));
    for (const [key, list] of childGroups) {
      const byGid = new Map(list.map((g) => [g.id, g]));
      let ids = this.ordered(key, `g:${key}`, [...byGid.keys()], (id) => byGid.get(id).name, null);
      // "Unsorted" (LoRAs sitting directly in an added folder) stays last until you move it yourself
      if (!s.order[`g:${key}`]?.length) {
        const flat = new Set(s.sources.folders.filter((f) => f.flat).map((f) => f.key));
        ids = [...ids.filter((id) => !flat.has(byGid.get(id).folder)), ...ids.filter((id) => flat.has(byGid.get(id).folder))];
      }
      childGroups.set(key, ids.map((id) => byGid.get(id)));
    }
    const dupes = new Set(); // LoRAs whose name clashes with another in the same group
    for (const list of lorasIn.values()) {
      const seen = new Map();
      for (const p of list) {
        const n = this.displayName(p).toLowerCase();
        if (seen.has(n)) { dupes.add(p); dupes.add(seen.get(n)); } else seen.set(n, p);
      }
    }
    const counts = new Map();
    const count = (gid) => {
      if (counts.has(gid)) return counts.get(gid);
      let n = (lorasIn.get(gid) || []).length;
      for (const c of childGroups.get(gid) || []) n += count(c.id);
      counts.set(gid, n);
      return n;
    };
    for (const g of s.groups) count(g.id);
    const hasGroups = (childGroups.get("") || []).length > 0;
    return { byId, byFolder, childGroups, lorasIn, groupOfLora, counts, dupes, hiddenGroups, hiddenLoras, hasGroups };
  }

  displayName(p) {
    return this.files.get(p)?.nickname || stripExt(basename(p));
  }

  // ----- order inside groups
  /**
   * Items (LoRA keys or group ids) of one group in its sort's order. Soft A to Z (the default) keeps the
   * arrangement you've dragged into and slots anything new in alphabetically; Z to A and the file-date sorts
   * are computed (groups have no file dates, so they stay soft A to Z under those).
   */
  ordered(container, orderKey, items, nameOf, timeOf) {
    const mode = this.state.sorts[container] || "az";
    const cmp = (a, b) => nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true, sensitivity: "base" });
    if (mode === "za") return items.slice().sort((a, b) => cmp(b, a));
    if ((mode === "new" || mode === "old") && timeOf) {
      const sign = mode === "new" ? -1 : 1;
      return items.slice().sort((a, b) => sign * (timeOf(a) - timeOf(b)) || cmp(a, b));
    }
    const alpha = items.slice().sort(cmp);
    const saved = this.state.order[orderKey];
    if (!saved?.length) return alpha;
    const have = new Set(items);
    const out = saved.filter((x) => have.has(x));
    const placed = new Set(out);
    for (const x of alpha) {
      if (placed.has(x)) continue;
      const i = out.findIndex((y) => cmp(y, x) > 0);
      out.splice(i < 0 ? out.length : i, 0, x);
    }
    return out;
  }

  /** Keys of a group's LoRAs and subgroups as shown now (for saving an arrangement). */
  shownOrder(container) {
    return {
      loras: [...(this.m.lorasIn.get(container === "" ? UNGROUPED : container) || [])],
      groups: (this.m.childGroups.get(container) || []).map((g) => g.id),
    };
  }

  /** Save a new arrangement for one group's LoRAs or subgroups. Dragging under another sort switches it to soft A to Z. */
  setArrangement(container, kind, list) {
    const shown = this.shownOrder(container);
    this.commit((s) => {
      if (s.sorts[container] && s.sorts[container] !== "az") {
        // keep what you see for the other kind too, so switching to soft A to Z doesn't reshuffle it
        s.order[`l:${container === "" ? UNGROUPED : container}`] = shown.loras;
        s.order[`g:${container}`] = shown.groups;
        delete s.sorts[container];
      }
      s.order[kind === "lora" ? `l:${container === "" ? UNGROUPED : container}` : `g:${container}`] = list;
    });
  }

  /** Move a LoRA before another in its group (null = to the end). No confirmation: it's only order. */
  moveLoraWithin(p, beforePath) {
    const gid = this.m.groupOfLora.get(p);
    if (!gid) return;
    const list = (this.m.lorasIn.get(gid) || []).filter((x) => x !== p);
    const i = beforePath ? list.indexOf(beforePath) : -1;
    list.splice(i < 0 ? list.length : i, 0, p);
    this.setArrangement(gid === UNGROUPED ? "" : gid, "lora", list);
  }

  moveGroupWithin(gid, beforeGid) {
    const g = this.m.byId.get(gid);
    if (!g) return;
    const parent = g.parent && this.m.byId.has(g.parent) ? g.parent : "";
    const list = (this.m.childGroups.get(parent) || []).map((x) => x.id).filter((x) => x !== gid);
    const i = beforeGid ? list.indexOf(beforeGid) : -1;
    list.splice(i < 0 ? list.length : i, 0, gid);
    this.setArrangement(parent, "group", list);
  }

  /** Pick a sort for a group ("" = top level), optionally for everything inside it too. "strict" re-sorts A to Z and forgets your moves. */
  setSort(container, mode, withSubgroups) {
    const targets = [container, ...(withSubgroups ? (container === "" ? this.state.groups.map((g) => g.id) : [...this.descendants(container)]) : [])];
    this.commit((s) => {
      for (const c of targets) {
        if (mode === "strict") {
          delete s.sorts[c];
          delete s.order[`l:${c === "" ? UNGROUPED : c}`];
          delete s.order[`g:${c}`];
        } else if (mode === "az") delete s.sorts[c];
        else s.sorts[c] = mode;
      }
    });
  }

  colorOf(gid) {
    const st = this.state.settings;
    if (st.colorMode === "alternating" && this.m) {
      // alternate among siblings at each level, so colours don't shift when groups open or close
      const g = this.m.byId.get(gid);
      if (!g) return null;
      const key = g.parent && this.m.byId.has(g.parent) ? g.parent : "";
      const i = (this.m.childGroups.get(key) || []).indexOf(g);
      return i % 2 === 0 ? st.colorA : st.colorB;
    }
    let g = this.m?.byId.get(gid);
    while (g) {
      if (g.color) return g.color;
      g = g.parent ? this.m.byId.get(g.parent) : null;
    }
    return null;
  }

  groupPath(gid) {
    if (gid === UNGROUPED) return "Ungrouped";
    const names = [];
    let g = this.m?.byId.get(gid);
    while (g) {
      names.unshift(g.name);
      g = g.parent ? this.m.byId.get(g.parent) : null;
    }
    return names.join(" / ");
  }

  descendants(gid) {
    const out = new Set();
    const walk = (id) => {
      for (const c of this.m.childGroups.get(id) || []) { out.add(c.id); walk(c.id); }
    };
    walk(gid);
    return out;
  }

  isActive(p) { return this.state.active.some((a) => a.path === p); }

  // ----- mixes: a named set of LoRAs with their own strengths, loaded as one box in ENABLED
  mixById(id) { return this.state.mixes.find((m) => m.id === id) || null; }
  /** What the mix's box shows: its unsaved edits, or what's saved. */
  mixItems(id) { return this.state.mixDrafts[id] || this.mixById(id)?.items || []; }
  mixDirty(id) { return !!this.state.mixDrafts[id]; }
  mixEntry(id) { return this.state.active.find((a) => a.mix === id) || null; }
  /** Every LoRA any mix holds (saved or unsaved). */
  mixPaths() {
    const s = this.state;
    const out = new Set();
    for (const m of s.mixes) for (const it of m.items) out.add(it.path);
    for (const list of Object.values(s.mixDrafts)) for (const it of list) out.add(it.path);
    return out;
  }
  /** Not on disk (or no longer part of this node): greyed wherever it shows. */
  unavailable(p) { return this.missing.has(p) || (this.scanned && !this.files.has(p)); }

  /**
   * Which switched-on mix loads each LoRA when two share one: the copy already loaded stays (the mix switched on
   * first), unless "Use this mix's copy" picked another. A LoRA switched on by itself is never loaded by a mix.
   */
  mixOwners() {
    const s = this.state;
    const loose = new Set(s.active.filter((a) => a.path).map((a) => a.path));
    const on = s.active.filter((a) => a.mix && a.on).sort((a, b) => a.since - b.since);
    const owners = new Map();
    for (const a of on) for (const it of this.mixItems(a.mix)) if (!loose.has(it.path) && !owners.has(it.path)) owners.set(it.path, a.mix);
    for (const [p, id] of Object.entries(s.mixPrefer)) {
      if (owners.has(p) && on.some((a) => a.mix === id) && this.mixItems(id).some((it) => it.path === p)) owners.set(p, id);
    }
    return owners;
  }

  /** The switched-on mix that loads this LoRA, if any. */
  mixLoading(p) { return this.mixOwners().get(p) || null; }

  /** What the workflow loads, in ENABLED's order: LoRAs on their own and the LoRAs of switched-on mixes. */
  loadList() {
    const s = this.state;
    const owners = this.mixOwners();
    const out = [];
    const seen = new Set();
    const add = (path, strength) => { if (!seen.has(path) && !this.unavailable(path)) { seen.add(path); out.push({ path, strength }); } };
    for (const a of s.active) {
      if (a.path) add(a.path, a.strength);
      else if (a.on) for (const it of this.mixItems(a.mix)) if (!it.off && owners.get(it.path) === a.mix) add(it.path, it.strength);
    }
    return out;
  }

  newId(prefix, taken) {
    let n = 1;
    while (taken.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }

  /** Change one LoRA in a mix's box: the change is unsaved until Save (and goes away again if it matches what's saved). */
  editMixItem(id, p, fn) {
    const m = this.mixById(id);
    if (!m) return;
    this.commit((s) => {
      const list = clone(this.mixItems(id));
      const it = list.find((x) => x.path === p);
      if (!it) return;
      fn(it);
      if (!it.off) delete it.off;
      if (JSON.stringify(list) === JSON.stringify(m.items)) delete s.mixDrafts[id];
      else s.mixDrafts[id] = list;
    });
  }

  setMixStrength(id, p, v) {
    if (!isFinite(v)) return this.render();
    v = clamp(round2(v), -MAX_STRENGTH, MAX_STRENGTH);
    this.editMixItem(id, p, (it) => { it.strength = v; });
  }

  /** The strength a row shows: a mix's own, or the LoRA's. */
  rowStrength(row) { return row?.dataset.mix ? this.mixStrengthOf(row.dataset.mix, row.dataset.path) : this.strengthOf(row?.dataset.path); }

  mixStrengthOf(id, p) { return this.mixItems(id).find((x) => x.path === p)?.strength ?? 1; }

  toggleMixItem(id, p) {
    if (this.unavailable(p)) return;
    this.editMixItem(id, p, (it) => { it.off = !it.off; });
  }

  saveMix(id) {
    if (!this.mixDirty(id)) return;
    this.commit((s) => {
      const m = this.mixById(id);
      if (m) m.items = s.mixDrafts[id];
      delete s.mixDrafts[id];
    });
  }

  revertMix(id) { this.commit((s) => { delete s.mixDrafts[id]; }); }

  /** Swatches, Custom and "Use the default mix colour": the same picker as a group's (used in the node and in Mixes ▸). */
  mixColorEl(m, pickAct, customAct, attr = "data-act") {
    const wrap = h("div", { class: "spll-mix-color" });
    const grid = h("div", { class: "spll-swatches" });
    for (const c of PALETTE) grid.append(h("button", { class: "spll-swatch-btn" + (m?.color === c ? " is-on" : ""), style: { background: c }, [attr]: pickAct, "data-color": c, title: c }));
    wrap.append(grid,
      h("div", { class: "spll-pop-row" },
        h("label", { class: "spll-label", text: "Custom" }),
        h("input", { type: "color", class: "spll-color-input", value: m?.color || this.state.settings.hl.mix, [attr]: customAct })),
      h("button", { class: "spll-btn spll-mix-default" + (m?.color ? "" : " is-current"), [attr]: pickAct, "data-color": "", text: "Use the default mix colour" }));
    return wrap;
  }

  toggleMixCollapsed(id) {
    const m = this.mixById(id);
    if (m) this.commit(() => { m.collapsed = !m.collapsed; });
  }

  /** A mix's own highlight colour (null = the shared mix colour from Settings). */
  setMixColor(id, color) {
    const m = this.mixById(id);
    if (m) this.commit(() => { m.color = color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null; });
  }

  /** Add a LoRA to a mix at a strength; saved straight away (into the unsaved edits too, if it has any). */
  addToMix(id, p, strength = this.strengthOf(p)) {
    const m = this.mixById(id);
    if (!m) return;
    this.commit((s) => {
      for (const list of [m.items, s.mixDrafts[id]]) if (list && !list.some((x) => x.path === p)) list.push({ path: p, strength });
      this.rememberIds(p);
    });
  }

  /** Take a LoRA out of a mix; it leaves what's saved and the unsaved edits alike. */
  removeFromMix(id, p) {
    const m = this.mixById(id);
    if (!m) return;
    this.commit((s) => {
      m.items = m.items.filter((x) => x.path !== p);
      if (s.mixDrafts[id]) {
        s.mixDrafts[id] = s.mixDrafts[id].filter((x) => x.path !== p);
        if (JSON.stringify(s.mixDrafts[id]) === JSON.stringify(m.items)) delete s.mixDrafts[id];
      }
      if (s.mixPrefer[p] === id) delete s.mixPrefer[p];
    });
  }

  /** "New mix…": name it, and it starts with this LoRA, at the bottom of ENABLED (switched off until you switch it on). */
  async newMix(p, strength = this.strengthOf(p)) {
    PageMenu.current?.close();
    this.overlay = null;
    this.render();
    const name = await promptText("New mix", "Name for the new mix:", "");
    if (!name) return;
    this.commit((s) => {
      const id = this.newId("m", new Set(s.mixes.map((m) => m.id)));
      s.mixes.push({ id, name: name.slice(0, 80), items: p ? [{ path: p, strength }] : [], added: Date.now(), color: null, collapsed: false });
      s.active.push({ mix: id, on: false, since: 0 });
      if (p) this.rememberIds(p);
    });
  }

  async renameMix(id) {
    const m = this.mixById(id);
    if (!m) return;
    PageMenu.current?.close();
    const name = await promptText("Rename mix", "New name:", m.name);
    if (name && name !== m.name) this.commit(() => { m.name = name.slice(0, 80); });
  }

  async deleteMix(id) {
    const m = this.mixById(id);
    if (!m) return;
    PageMenu.current?.close();
    const ok = await confirmDialog("Delete mix?", `Delete the mix “${m.name}”? The LoRAs in it aren't touched.`, []);
    if (!ok) return;
    this.commit((s) => {
      s.mixes = s.mixes.filter((x) => x.id !== id);
      delete s.mixDrafts[id];
      s.active = s.active.filter((a) => a.mix !== id);
      for (const [p, mid] of Object.entries(s.mixPrefer)) if (mid === id) delete s.mixPrefer[p];
    });
  }

  /**
   * Switch a mix on (adding it to the bottom of ENABLED if it isn't there). LoRAs it holds that are already switched
   * on by themselves are listed first: Yes switches them off and loads the mix, No leaves everything as it was.
   */
  async setMixOn(id, on) {
    const m = this.mixById(id);
    if (!m) return false;
    const s = this.state;
    if (!on) {
      this.commit((st) => {
        const a = this.mixEntry(id);
        if (a) a.on = false;
        for (const [p, mid] of Object.entries(st.mixPrefer)) if (mid === id) delete st.mixPrefer[p];
      });
      return true;
    }
    const loose = new Set(s.active.filter((a) => a.path).map((a) => a.path));
    const clash = this.mixItems(id).filter((it) => !it.off && loose.has(it.path)).map((it) => it.path);
    if (clash.length) {
      PageMenu.current?.close();
      await new Promise((r) => setTimeout(r, 60)); // let the click finish before the dialog opens
      const ok = await confirmDialog("Switch these off and load the mix?",
        `“${m.name}” holds ${clash.length === 1 ? "a LoRA that's" : `${clash.length} LoRAs that are`} already switched on by ${clash.length === 1 ? "itself" : "themselves"}:`,
        clash.map((p) => this.displayName(p)));
      if (!ok) return false;
    }
    this.commit((st) => {
      for (const p of clash) this.switchOffLoose(st, p);
      let a = this.mixEntry(id);
      if (!a) { a = { mix: id, on: false, since: 0 }; st.active.push(a); }
      a.on = true;
      a.since = Date.now();
    });
    return true;
  }

  /** Switch off a LoRA that's on by itself (no 5-second undo): its strength is kept and it goes into History. */
  switchOffLoose(s, p) {
    const i = s.active.findIndex((x) => x.path === p);
    if (i < 0) return;
    const [a] = s.active.splice(i, 1);
    if (a.strength !== 1) s.strengths[p] = a.strength;
    if (s.settings.historyLength > 0) s.history = [p, ...s.history.filter((x) => x !== p)].slice(0, s.settings.historyLength);
  }

  /** Mixes ▸: clicking a mix adds it to ENABLED and switches it on; clicking it again takes it out. */
  toggleMixInEnabled(id) {
    if (this.mixEntry(id)) return this.removeMixFromEnabled(id);
    return this.setMixOn(id, true);
  }

  removeMixFromEnabled(id) {
    this.commit((s) => {
      s.active = s.active.filter((a) => a.mix !== id); // unsaved edits are kept
      for (const [p, mid] of Object.entries(s.mixPrefer)) if (mid === id) delete s.mixPrefer[p];
    });
  }

  /**
   * "Add these LoRAs to ENABLED on their own": each LoRA in the box (as shown, unsaved edits included) is switched on
   * by itself at the mix's strength, which also becomes its group strength. The mix switches off.
   */
  applyMixAsRegular(id) {
    if (!this.mixById(id)) return;
    PageMenu.current?.close();
    const items = this.mixItems(id).filter((it) => !it.off && !this.unavailable(it.path));
    this.commit((s) => {
      const a = this.mixEntry(id);
      if (a) a.on = false;
      for (const [p, mid] of Object.entries(s.mixPrefer)) if (mid === id) delete s.mixPrefer[p];
      for (const it of items) {
        const cur = s.active.find((x) => x.path === it.path);
        if (cur) { cur.strength = it.strength; continue; } // already on: just takes the mix's strength
        s.active.push({ path: it.path, strength: it.strength });
        delete s.strengths[it.path];
        this.rememberIds(it.path);
        s.history = s.history.filter((x) => x !== it.path);
      }
    });
  }

  /** A greyed LoRA (another switched-on mix loads it): load this mix's copy instead. */
  useMixCopy(id, p) { this.commit((s) => { s.mixPrefer[p] = id; }); }

  /** "Add to mix ▸": every mix (✓ where it's already in), then New mix…. Clicking a ticked mix takes it out again. */
  addToMixItems(p, strength) {
    return () => [
      ...this.state.mixes.map((m) => {
        const inIt = this.mixItems(m.id).some((x) => x.path === p) || m.items.some((x) => x.path === p);
        return { label: m.name, check: inIt, keep: true, run: () => (inIt ? this.removeFromMix(m.id, p) : this.addToMix(m.id, p, strength ?? this.strengthOf(p))) };
      }),
      this.state.mixes.length ? "-" : null,
      { label: "New mix…", run: () => this.newMix(p, strength ?? this.strengthOf(p)) },
    ].filter(Boolean);
  }

  strengthOf(p) {
    const a = this.state.active.find((x) => x.path === p);
    return a ? a.strength : this.state.strengths[p] ?? 1;
  }

  // ----- mutations
  setStrength(p, v) {
    if (this.missing.has(p) || !isFinite(v)) return this.render();
    v = clamp(round2(v), -MAX_STRENGTH, MAX_STRENGTH);
    this.commit((s) => {
      const a = s.active.find((x) => x.path === p);
      if (a) a.strength = v;
      else if (v === 1) delete s.strengths[p];
      else s.strengths[p] = v;
    });
  }

  setActive(p, on) {
    if (this.missing.has(p)) return;
    if (on && this.fading?.has(p)) return this.undoFade(p); // back where it was
    this.commit((s) => {
      const i = s.active.findIndex((x) => x.path === p);
      if (on && i < 0) {
        s.active.push({ path: p, strength: s.strengths[p] ?? 1 });
        delete s.strengths[p];
        this.rememberIds(p);
        s.history = s.history.filter((x) => x !== p); // active LoRAs never show in history
      } else if (!on && i >= 0) {
        const [a] = s.active.splice(i, 1);
        if (a.strength !== 1) s.strengths[p] = a.strength;
        delete s.ids[p];
        this.startFade(p, i, a.strength);
        if (s.settings.historyLength > 0) {
          s.history = [p, ...s.history.filter((x) => x !== p)].slice(0, s.settings.historyLength);
        }
      }
    });
  }

  // ----- 5-second undo: a LoRA switched off stays in ENABLED for 5 s (already off), click it to bring it back
  startFade(p, index, strength) {
    this.fading ||= new Map();
    this.stopFade(p, false);
    const f = { p, index, strength, left: FADE_MS, since: Date.now(), timer: null, paused: false };
    this.fading.set(p, f);
    this.runFade(f);
  }

  runFade(f) {
    clearTimeout(f.timer);
    f.since = Date.now();
    f.timer = setTimeout(() => this.stopFade(f.p, true), f.left);
  }

  pauseFade(p, pause) {
    const f = this.fading?.get(p);
    if (!f || f.paused === pause) return;
    f.paused = pause;
    if (pause) { clearTimeout(f.timer); f.left = Math.max(0, f.left - (Date.now() - f.since)); }
    else this.runFade(f);
  }

  fadeElapsed(f) { return FADE_MS - (f.paused ? f.left : Math.max(0, f.left - (Date.now() - f.since))); }

  stopFade(p, rerender) {
    const f = this.fading?.get(p);
    if (!f) return;
    clearTimeout(f.timer);
    this.fading.delete(p);
    if (rerender && this.el?.isConnected) this.render();
  }

  undoFade(p) {
    const f = this.fading?.get(p);
    if (!f) return;
    this.stopFade(p, false);
    this.commit((s) => {
      if (s.active.some((x) => x.path === p)) return;
      const at = clamp(f.index, 0, s.active.length);
      s.active.splice(at, 0, { path: p, strength: f.strength });
      delete s.strengths[p];
      this.rememberIds(p);
      s.history = s.history.filter((x) => x !== p);
    });
  }

  /** ENABLED rows in order, with fading rows slotted back in at the place they left. */
  enabledRows() {
    const out = this.state.active.map((a) => ({ a }));
    const fades = [...(this.fading?.values() || [])].filter((f) => !this.isActive(f.p)).sort((x, y) => x.index - y.index);
    for (const f of fades) out.splice(clamp(f.index, 0, out.length), 0, { f });
    return out;
  }

  isFav(p) { return this.state.favourites.includes(p); }

  /** Favourites in the order the chosen sort shows them. */
  sortedFavourites(sort = this.state.settings.favSort) {
    const s = this.state;
    const list = [...s.favourites];
    const name = (p) => this.displayName(p).toLowerCase();
    const at = (p) => s.favAdded[p] ?? 0;
    if (sort === "az") list.sort((a, b) => name(a).localeCompare(name(b), undefined, { numeric: true }));
    else if (sort === "za") list.sort((a, b) => name(b).localeCompare(name(a), undefined, { numeric: true }));
    else if (sort === "new") list.sort((a, b) => at(b) - at(a));
    else if (sort === "old") list.sort((a, b) => at(a) - at(b));
    return list;
  }

  setFavSort(k) {
    this.commit((s) => {
      // Custom starts from whatever order was showing
      if (k === "custom" && s.settings.favSort !== "custom") s.favourites = this.sortedFavourites();
      s.settings.favSort = k;
    });
  }

  /** A new order for the favourites shown; hidden ones (unlisted, not in this node) keep their place after them. */
  setFavOrder(shown) {
    this.commit((s) => {
      const set = new Set(shown);
      const rest = this.sortedFavourites().filter((p) => !set.has(p));
      s.favourites = [...shown.filter((p) => s.favourites.includes(p)), ...rest];
      s.settings.favSort = "custom";
    });
  }

  /** Hidden by "Unlist" (itself, or a group it sits in). */
  isUnlisted(p) { return !!this.m?.hiddenLoras.has(p); }

  unlistLora(p) {
    this.commit((s) => {
      const i = s.active.findIndex((x) => x.path === p);
      if (i >= 0) {
        const [a] = s.active.splice(i, 1);
        if (a.strength !== 1) s.strengths[p] = a.strength;
      }
      if (!s.unlisted.loras.includes(p)) s.unlisted.loras.push(p);
    });
    toast("info", "Unlisted", `${this.displayName(p)} is hidden. Relist it from Settings → Unlisted.`);
  }

  unlistGroup(gid) {
    const g = this.m.byId.get(gid);
    if (!g) return;
    const inside = new Set([gid, ...this.descendants(gid)]);
    this.commit((s) => {
      s.active = s.active.filter((a) => {
        if (!inside.has(this.m.groupOfLora.get(a.path))) return true;
        if (a.strength !== 1) s.strengths[a.path] = a.strength;
        return false;
      });
      if (!s.unlisted.groups.includes(gid)) s.unlisted.groups.push(gid);
    });
    toast("info", "Group unlisted", `“${g.name}” and everything in it are hidden. Relist from Settings → Unlisted.`);
  }

  relist(kind, key) {
    this.commit((s) => {
      if (kind === "group") s.unlisted.groups = s.unlisted.groups.filter((x) => x !== key);
      else s.unlisted.loras = s.unlisted.loras.filter((x) => x !== key);
    });
  }

  toggleFav(p) {
    if (this.isFav(p)) this.removeFav(p);
    else this.addFav(p);
  }

  // ----- favourite tiers and collections
  tierById(id) { return this.state.tiers.find((t) => t.id === id) || null; }
  defaultTier() { return this.tierById(this.state.settings.favDefaultTier) || this.state.tiers[0]; }
  /** The tier a favourite sits in (null if it isn't one). */
  tierOf(p) { return this.isFav(p) ? this.tierById(this.state.favTier[p]) || this.state.tiers[0] : null; }
  collById(id) { return this.state.collections.find((c) => c.id === id) || null; }
  collDepth(id) { let d = 0; for (let c = this.collById(id); c; c = c.parent ? this.collById(c.parent) : null) d++; return d; }
  collHeight(id) { return 1 + Math.max(0, ...this.state.collections.filter((c) => c.parent === id).map((c) => this.collHeight(c.id))); }
  collDescendants(id) {
    const out = new Set();
    const walk = (x) => { for (const c of this.state.collections) if (c.parent === x && !out.has(c.id)) { out.add(c.id); walk(c.id); } };
    walk(id);
    return out;
  }
  visibleFav(p) { return this.inNode(p) && !this.isUnlisted(p); }

  /** Favourites loose in a tier (coll null) or in a collection, in the chosen sort. */
  favsIn(tier, coll) {
    const s = this.state;
    return this.sortedFavourites().filter((p) => this.visibleFav(p) && (s.favTier[p] || s.tiers[0].id) === tier && (s.favColl[p] || null) === (coll || null));
  }

  /** Collections directly inside a tier (parent null) or a collection, in the chosen sort. */
  collsIn(tier, parent) {
    const list = this.state.collections.filter((c) => c.tier === tier && (c.parent || null) === (parent || null));
    const mode = this.state.settings.favSort;
    const name = (c) => c.name.toLowerCase();
    if (mode === "az") list.sort((a, b) => name(a).localeCompare(name(b), undefined, { numeric: true }));
    else if (mode === "za") list.sort((a, b) => name(b).localeCompare(name(a), undefined, { numeric: true }));
    else if (mode === "new") list.sort((a, b) => b.added - a.added);
    else if (mode === "old") list.sort((a, b) => a.added - b.added);
    return list;
  }

  /** How many (visible) favourites a tier or collection holds, collections inside included. */
  favCount(tier, coll = null) {
    let n = this.favsIn(tier, coll).length;
    for (const c of this.collsIn(tier, coll)) n += this.favCount(tier, c.id);
    return n;
  }

  /** Tier submenus show once anything sits outside the top tier (or always, if set). */
  tierMode() {
    const s = this.state;
    if (s.settings.tierSubmenus === "always") return true;
    const top = s.tiers[0].id;
    return s.favourites.some((p) => (s.favTier[p] || top) !== top) || s.collections.some((c) => c.tier !== top);
  }

  addFav(p, tier = this.defaultTier().id, coll = null) {
    this.commit((s) => {
      if (!s.favourites.includes(p)) {
        s.favourites = [p, ...s.favourites]; // new favourites go on top of the custom order
        s.favAdded[p] = Date.now();
      }
      s.favTier[p] = tier;
      if (coll) s.favColl[p] = coll; else delete s.favColl[p];
    });
  }

  removeFav(p) {
    this.commit((s) => {
      s.favourites = s.favourites.filter((x) => x !== p);
      delete s.favAdded[p];
      delete s.favTier[p];
      delete s.favColl[p];
    });
  }

  /** The order you see, saved as the custom order (dragging switches the sort to Custom). */
  materialiseFavOrder(s) {
    if (s.settings.favSort === "custom") return;
    s.favourites = this.sortedFavourites();
    const all = [];
    const walk = (tier, parent) => { for (const c of this.collsIn(tier, parent)) { all.push(c); walk(tier, c.id); } };
    for (const t of s.tiers) walk(t.id, null);
    s.collections = [...all, ...s.collections.filter((c) => !all.includes(c))];
    s.settings.favSort = "custom";
  }

  /** Put a favourite (adding it if needed) loose in a tier or into a collection; before another favourite if given. */
  setFavPlace(p, tier, coll = null, before = undefined) {
    this.commit((s) => {
      if (!s.favourites.includes(p)) { s.favourites.unshift(p); s.favAdded[p] = Date.now(); }
      s.favTier[p] = tier;
      if (coll) s.favColl[p] = coll; else delete s.favColl[p];
      if (before !== undefined) {
        this.materialiseFavOrder(s);
        const list = s.favourites.filter((x) => x !== p);
        const i = before ? list.indexOf(before) : -1;
        // no "before": the end of that container
        if (i >= 0) list.splice(i, 0, p);
        else {
          const last = list.reduce((acc, x, j) => ((s.favTier[x] === tier && (s.favColl[x] || null) === (coll || null)) ? j : acc), -1);
          list.splice(last + 1, 0, p);
        }
        s.favourites = list;
      }
    });
  }

  /** Reorder favourites inside one tier or collection (only the ones shown move). */
  reorderFavs(shown) {
    this.commit((s) => {
      this.materialiseFavOrder(s);
      const set = new Set(shown);
      const slots = s.favourites.map((k, i) => (set.has(k) ? i : -1)).filter((i) => i >= 0);
      slots.forEach((pos, j) => { s.favourites[pos] = shown[j]; });
    });
  }

  /** Can collection `id` move into `parent` (null = the tier itself) without going deeper than COLL_DEPTH? */
  canNestColl(id, parent) {
    if (!parent) return true;
    if (parent === id || this.collDescendants(id).has(parent)) return false;
    return this.collDepth(parent) + this.collHeight(id) <= COLL_DEPTH;
  }

  /** Move a collection (with everything in it) into another collection or a tier; optionally before a sibling. */
  moveColl(id, tier, parent = null, before = undefined) {
    if (!this.canNestColl(id, parent)) return toast("warning", "Too deep", `Collections can only go ${COLL_DEPTH} levels deep.`);
    this.commit((s) => {
      const c = s.collections.find((x) => x.id === id);
      if (!c) return;
      const moved = new Set([id, ...this.collDescendants(id)]);
      c.parent = parent || null;
      if (c.tier !== tier) {
        for (const x of s.collections) if (moved.has(x.id)) x.tier = tier;
        for (const [k, cid] of Object.entries(s.favColl)) if (moved.has(cid)) s.favTier[k] = tier;
      }
      if (before !== undefined) {
        this.materialiseFavOrder(s);
        const list = s.collections.filter((x) => x.id !== id);
        const i = before ? list.findIndex((x) => x.id === before) : -1;
        list.splice(i < 0 ? list.length : i, 0, s.collections.find((x) => x.id === id));
        s.collections = list;
      }
    });
  }

  async newCollection(tier, parent = null, withFav = null) {
    if (parent && this.collDepth(parent) >= COLL_DEPTH) return toast("warning", "Too deep", `Collections can only go ${COLL_DEPTH} levels deep.`);
    const name = await promptText("New collection", "Name for the new collection:", "");
    if (!name) return;
    const id = "c" + Math.random().toString(36).slice(2, 9);
    this.commit((s) => {
      s.collections.push({ id, name: name.slice(0, 80), tier, parent: parent || null, added: Date.now() });
      if (withFav) {
        if (!s.favourites.includes(withFav)) { s.favourites.unshift(withFav); s.favAdded[withFav] = Date.now(); }
        s.favTier[withFav] = tier;
        s.favColl[withFav] = id;
      }
    });
  }

  async renameColl(id) {
    const c = this.collById(id);
    if (!c) return;
    const name = await promptText("Rename collection", "New name:", c.name);
    if (name) this.commit((s) => { const x = s.collections.find((y) => y.id === id); if (x) x.name = name.slice(0, 80); });
  }

  /** Delete a collection: its contents move up to its parent, or are removed from favourites (asked twice). */
  async deleteColl(id) {
    const c = this.collById(id);
    if (!c) return;
    const inner = this.collDescendants(id);
    const all = new Set([id, ...inner]);
    const favs = this.state.favourites.filter((p) => all.has(this.state.favColl[p]));
    let choice = "up";
    if (favs.length || inner.size) {
      const parentName = c.parent ? this.collById(c.parent)?.name : this.tierById(c.tier)?.name;
      choice = await choiceDialog({
        title: `Delete collection “${c.name}”?`,
        message: `It holds ${favs.length} favourite${favs.length === 1 ? "" : "s"}${inner.size ? ` and ${inner.size} collection${inner.size === 1 ? "" : "s"}` : ""}.`,
        buttons: [
          { label: "Cancel", value: null },
          { label: "Delete the contents too", value: "delete", danger: true },
          { label: `Move them up to “${parentName}”`, value: "up", primary: true },
        ],
      });
      if (!choice) return;
      if (choice === "delete" && !(await confirmDialog("Remove from favourites?", `Remove ${favs.length} favourite${favs.length === 1 ? "" : "s"} from favourites? This can't be undone.`, []))) return;
    }
    this.commit((s) => {
      if (choice === "delete") {
        const gone = new Set(favs);
        s.favourites = s.favourites.filter((p) => !gone.has(p));
        for (const p of gone) { delete s.favTier[p]; delete s.favColl[p]; delete s.favAdded[p]; }
        s.collections = s.collections.filter((x) => !all.has(x.id));
      } else {
        for (const x of s.collections) if (x.parent === id) x.parent = c.parent;
        for (const [p, cid] of Object.entries(s.favColl)) if (cid === id) { if (c.parent) s.favColl[p] = c.parent; else delete s.favColl[p]; }
        s.collections = s.collections.filter((x) => x.id !== id);
      }
    });
  }

  // ----- tiers
  async renameTier(id, name) {
    if (name === undefined) {
      const t = this.tierById(id);
      name = await promptText("Rename tier", "New name:", t?.name || "");
    }
    name = (name || "").trim();
    if (name) this.commit((s) => { const t = s.tiers.find((x) => x.id === id); if (t) t.name = name.slice(0, 40); });
  }

  setTierColor(id, color, which = "color") {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    const t = this.state.tiers.find((x) => x.id === id);
    if (!t) return;
    t[which] = color;
    this.render(); // not commit(): keeps a colour picker in a menu open while you drag
    this.notify();
    PageMenu.current?.c === this && PageMenu.current.refresh({ keepFocused: true });
  }

  addTier() {
    if (this.state.tiers.length >= MAX_TIERS) return;
    const n = this.state.tiers.length + 1;
    let i = n;
    while (this.state.tiers.some((t) => t.id === `t${i}`)) i++;
    const palette = ["#7fb3d5", "#a3d39c", "#f4a6c1", "#c39bd3", "#f7dc6f", "#85c1c1", "#e59866"];
    const color = palette[(n - 4 + palette.length) % palette.length];
    this.commit((s) => { s.tiers.push({ id: `t${i}`, name: `Tier ${n}`, color, shine: shineOf(color), outline: null }); });
  }

  reorderTiers(ids) {
    this.commit((s) => {
      const by = new Map(s.tiers.map((t) => [t.id, t]));
      s.tiers = [...ids.map((id) => by.get(id)).filter(Boolean), ...s.tiers.filter((t) => !ids.includes(t.id))];
    });
  }

  /** Remove tiers one at a time; for each that holds anything, ask where its favourites go (or remove them, asked twice). */
  async removeTiers(ids) {
    for (const id of ids) {
      const s = this.state;
      if (s.tiers.length <= 1) return toast("info", "Last tier", "There has to be at least one tier.");
      const t = this.tierById(id);
      if (!t) continue;
      const favs = s.favourites.filter((p) => (s.favTier[p] || s.tiers[0].id) === id);
      const colls = s.collections.filter((c) => c.tier === id);
      let target = null, drop = false;
      if (favs.length || colls.length) {
        const others = s.tiers.filter((x) => x.id !== id);
        const i = s.tiers.findIndex((x) => x.id === id);
        const above = s.tiers[i - 1] || others[0];
        const r = await choiceDialog({
          title: `Remove tier “${t.name}”?`,
          message: `It holds ${favs.length} favourite${favs.length === 1 ? "" : "s"}${colls.length ? ` and ${colls.length} collection${colls.length === 1 ? "" : "s"}` : ""}. Move them to:`,
          options: others.map((x) => ({ value: x.id, label: x.name, color: x.color, tier: x })),
          selected: above.id,
          buttons: [
            { label: "Cancel", value: null },
            { label: "Remove them from favourites", value: "delete", danger: true },
            { label: "Move", value: "move", primary: true },
          ],
        });
        if (!r?.button) return;
        if (r.button === "delete") {
          if (!(await confirmDialog("Remove from favourites?", `Remove ${favs.length} favourite${favs.length === 1 ? "" : "s"} from favourites? This can't be undone.`, []))) return;
          drop = true;
        } else target = r.option;
      }
      this.commit((st) => {
        if (drop) {
          const gone = new Set(favs);
          st.favourites = st.favourites.filter((p) => !gone.has(p));
          for (const p of gone) { delete st.favTier[p]; delete st.favColl[p]; delete st.favAdded[p]; }
          st.collections = st.collections.filter((c) => c.tier !== id);
        } else if (target) {
          for (const p of favs) st.favTier[p] = target; // collections and their contents move along unchanged
          for (const c of st.collections) if (c.tier === id) c.tier = target;
        }
        st.tiers = st.tiers.filter((x) => x.id !== id);
        if (st.settings.favDefaultTier === id) st.settings.favDefaultTier = null;
      });
    }
  }

  async setTierCount(n) {
    n = clamp(n, 1, MAX_TIERS);
    while (this.state.tiers.length < n) this.addTier();
    if (this.state.tiers.length > n) await this.removeTiers(this.state.tiers.slice(n).map((t) => t.id).reverse());
  }

  async resetTiers() {
    const d = defaultTiers();
    const extra = this.state.tiers.slice(3).map((t) => t.id).reverse();
    if (extra.length) await this.removeTiers(extra);
    if (this.state.tiers.length > 3) return; // cancelled
    this.commit((s) => {
      s.tiers.forEach((t, i) => { t.name = d[i].name; t.color = d[i].color; t.shine = d[i].shine; t.outline = null; });
      while (s.tiers.length < 3) { const x = d[s.tiers.length]; s.tiers.push(s.tiers.some((t) => t.id === x.id) ? { ...x, id: x.id + "b" } : { ...x }); }
    });
  }

  moveLora(p, gid) {
    this.commit((s) => {
      const f = dirname(p);
      const folderGroup = this.sourceOf(p) ? this.m.byFolder.get(f) : null;
      if (folderGroup && folderGroup.id === gid) delete s.placements[p];
      else if (gid === UNGROUPED && !this.sourceOf(p)) delete s.placements[p]; // added on its own: ungrouped by default
      else s.placements[p] = gid;
      if (gid === UNGROUPED) s.settings.ungroupedCollapsed = false;
      const g = this.m.byId.get(gid);
      if (g) this.expandTo(gid, true);
    });
  }

  moveGroup(gid, parentId) {
    if (parentId && (parentId === gid || this.descendants(gid).has(parentId))) return;
    this.commit((s) => {
      const g = s.groups.find((x) => x.id === gid);
      if (!g) return;
      g.parent = parentId || null;
      // move to end of its new siblings
      s.groups.splice(s.groups.indexOf(g), 1);
      s.groups.push(g);
      if (parentId) this.expandTo(parentId, true);
    });
  }

  /** Move an ENABLED entry (a LoRA's path, or "m:<id>" for a mix's box) to just before another (null = the end). */
  reorderActive(p, beforePath) {
    const k = (x) => (x.mix ? `m:${x.mix}` : x.path);
    this.commit((s) => {
      const i = s.active.findIndex((x) => k(x) === p);
      if (i < 0) return;
      const [a] = s.active.splice(i, 1);
      const j = beforePath ? s.active.findIndex((x) => k(x) === beforePath) : -1;
      if (j < 0) s.active.push(a);
      else s.active.splice(j, 0, a);
    });
  }

  deleteGroup(gid) {
    const g = this.m.byId.get(gid);
    if (!g) return;
    const members = this.m.lorasIn.get(gid) || [];
    this.commit((s) => {
      // LoRAs move to the parent group, or out of the groups when it was a top-level group
      const target = g.parent || UNGROUPED;
      for (const p of members) {
        if (target === UNGROUPED && !this.sourceOf(p)) delete s.placements[p]; // added on its own: ungrouped by default
        else s.placements[p] = target;
      }
      for (const c of s.groups) if (c.parent === gid) c.parent = g.parent;
      if (g.folder !== null && !s.knownFolders.includes(g.folder)) s.knownFolders.push(g.folder);
      s.groups = s.groups.filter((x) => x.id !== gid);
      for (const [p, id] of Object.entries(s.placements)) if (id === gid) s.placements[p] = target;
    });
  }

  removeMissing(p) {
    this.commit((s) => {
      delete s.placements[p];
      delete s.strengths[p];
      delete s.ids[p];
      s.active = s.active.filter((a) => a.path !== p);
      for (const m of s.mixes) m.items = m.items.filter((x) => x.path !== p);
      for (const [id, list] of Object.entries(s.mixDrafts)) s.mixDrafts[id] = list.filter((x) => x.path !== p);
      s.favourites = s.favourites.filter((k) => k !== p);
      s.history = s.history.filter((k) => k !== p);
      s.sources.loras = s.sources.loras.filter((k) => k !== p);
    });
  }

  expandTo(gid, includeSelf) {
    let g = this.m?.byId.get(gid);
    if (g && !includeSelf) g = g.parent ? this.m.byId.get(g.parent) : null;
    while (g) {
      g.collapsed = false;
      g = g.parent ? this.m.byId.get(g.parent) : null;
    }
  }

  /** Full path on disk for a key ("b1:styles/x.safetensors"), or for a relative path inside a given loras folder. */
  fullPath(k, base) {
    let rel = k;
    if (base === undefined) { base = this.basePath(baseOf(k)); rel = relOf(k); }
    if (!base) return lorasLabel(rel);
    const sep = this.sep || (base.includes("\\") ? "\\" : "/");
    return rel ? base.replace(/[\\/]+$/, "") + sep + rel.split("/").join(sep) : base;
  }

  /** The same LoRA's key in another node (which may number its loras folders differently). */
  keyIn(c, k) {
    const path = this.basePath(baseOf(k));
    for (const b of Object.keys(c.state.bases)) if (c.basePath(b) === path) return mkKey(b, relOf(k));
    return null;
  }

  async saveNickname(p, nickname) {
    const info = this.files.get(p);
    if (!info) return;
    nickname = (nickname || "").trim();
    const current = info.nickname || "";
    if (nickname === current) return this.render();
    if (!nickname && !info.hasSidecar) return this.render();
    if (!info.hasSidecar) {
      const ok = await confirmDialog(
        "Save nickname?",
        "Nicknames are saved in a small file next to the LoRA, so they show up in every workflow. This creates:",
        [this.fullPath(p) + ".spll.json"]
      );
      if (!ok) return this.render();
    }
    try {
      const r = await postJson("/spll/nickname", { ...this.q(p), nickname });
      if (r.error) throw new Error(r.error);
      info.nickname = r.nickname || undefined;
      info.hasSidecar = true;
      scanCache.clear();
      for (const c of controllers) {
        if (c === this) continue;
        const k = this.keyIn(c, p);
        const f = k && c.files.get(k);
        if (f) { f.nickname = info.nickname; f.hasSidecar = true; c.reconcile(); c.render(); }
      }
    } catch (e) {
      toast("error", "Couldn't save nickname", String(e.message || e));
    }
    this.reconcile();
    this.render();
  }

  /** Folders this node expects (added folders and the folders its groups come from) that aren't on disk: offer to create them. */
  async checkMissingFolders() {
    const run = async () => {
      const s = this.state;
      if (!s.setup) return;
      const wanted = new Set();
      for (const f of s.sources.folders) if (this.missingFolders.has(f.key) && !isBaseKey(f.key)) wanted.add(f.key);
      for (const g of s.groups) {
        if (g.folder === null || isBaseKey(g.folder)) continue;
        const src = this.sourceOf(g.folder);
        if (src && !this.missingFolders.has(src.key) && !this.folders.has(g.folder)) wanted.add(g.folder);
      }
      let missing = [...wanted].filter((f) => !declinedFolders.has(this.fullPath(f)));
      if (!missing.length) return;
      // another node may have created them in the meantime
      try {
        const still = [];
        for (const [b, keys] of this.byBase(missing)) {
          const r = await postJson("/spll/exists", { base: this.basePath(b), root: "", folders: keys.map(relOf) });
          for (const k of keys) if (!r.exists?.[relOf(k)]) still.push(k);
        }
        missing = still;
      } catch { /* */ }
      if (!missing.length) return this.refresh({ force: true, promptFolders: false });
      missing.sort();
      const ok = await confirmDialog(
        "Create missing LoRA folders?",
        "This workflow's Super-Power Lora Loader expects these folders inside your loras folder. Create them now? They'll be empty until you add LoRAs.",
        missing.map((f) => this.fullPath(f))
      );
      if (!ok) {
        missing.forEach((f) => declinedFolders.add(this.fullPath(f)));
        return;
      }
      const created = [];
      const failed = [];
      for (const [b, keys] of this.byBase(missing)) {
        try {
          const r = await postJson("/spll/mkdirs", { base: this.basePath(b), root: "", folders: keys.map(relOf) });
          if (r.error) throw new Error(r.error);
          for (const c of r.created || []) created.push(mkKey(b, c));
          for (const f of r.failed || []) failed.push(`${f.folder}: ${f.error}`);
        } catch (e) {
          failed.push(String(e.message || e));
        }
      }
      if (created.length) toast("success", `Created ${created.length} folder${created.length > 1 ? "s" : ""}`, created.map((f) => this.fullPath(f)).join(", "));
      if (failed.length) toast("error", "Some folders couldn't be created", failed.join("; "));
      scanCache.clear();
      await this.refresh({ force: true, promptFolders: false });
    };
    promptChain = promptChain.then(run, run);
    return promptChain;
  }

  // ----- adding and removing folders and LoRAs
  /** The setup / "Add folders or LoRAs" picker: every loras folder as a tree, tick folders and LoRAs to add. */
  async openPicker(message) {
    this.pickerScroll = 0;
    this.picker = { bases: null, sel: new Set(), expanded: new Set(), filter: "", message: message || null, loading: true };
    this.render();
    try {
      const r = await getJson("/spll/tree");
      if (r.error) throw new Error(r.error);
      if (!this.picker) return;
      this.picker.bases = r.bases;
      this.picker.loading = false;
      if (r.bases.length === 1) this.picker.expanded.add(`${r.bases[0].path}|`);
    } catch (e) {
      if (!this.picker) return;
      this.picker.loading = false;
      this.picker.error = String(e.message || e);
    }
    this.render();
  }

  /** Is this folder (by full loras-folder path + relative path) already added? */
  isFolderAdded(basePath, rel) {
    return this.state.sources.folders.some((f) => this.basePath(baseOf(f.key)) === basePath && relOf(f.key) === rel);
  }
  isLoraAdded(basePath, rel) {
    return this.state.sources.loras.some((k) => this.basePath(baseOf(k)) === basePath && relOf(k) === rel);
  }
  /** Already part of the node, either way (folder or on its own). */
  covers(basePath, rel) {
    return this.state.sources.folders.some((f) => this.basePath(baseOf(f.key)) === basePath && under(rel, relOf(f.key) || "")) ||
      this.isLoraAdded(basePath, rel);
  }

  /** Add folders and LoRAs: items are { base: full path of a loras folder, rel, kind: "folder" | "lora" }. */
  async addSources(items) {
    if (!items.length) return;
    const s = this.state;
    const firstTime = !s.setup;
    let added = 0;
    this.commit((st) => {
      for (const it of items) {
        const b = this.baseIdFor(it.base, st);
        const key = mkKey(b, it.rel);
        if (it.kind === "folder") {
          if (st.sources.folders.some((f) => f.key === key)) continue;
          // a loras folder itself keeps the classic layout: subfolders as top-level groups, its own files in "Unsorted"
          st.sources.folders.push({ key, flat: it.rel === "" });
          // individually added LoRAs now covered by this folder no longer need to be listed separately
          st.sources.loras = st.sources.loras.filter((k) => !under(k, key));
          added++;
        } else {
          if (st.sources.loras.includes(key) || st.sources.folders.some((f) => under(key, f.key))) continue;
          st.sources.loras.push(key);
          added++;
        }
      }
      st.setup = true;
    });
    this.picker = null;
    this.overlay = null;
    scanCache.clear();
    await this.refresh({ force: true });
    if (firstTime) { this.lastHeight = 0; this.fitDefault(); }
    this.notify();
    if (added && !firstTime) toast("success", `Added ${added} item${added > 1 ? "s" : ""}`);
  }

  /** Take an added folder off the node (its layout goes too). Files aren't touched. */
  async removeFolder(fkey) {
    const src = this.folderSource(fkey);
    if (!src) return;
    await new Promise((r) => setTimeout(r, 120));
    const ok = await confirmDialog(
      "Remove folder from node?",
      `Remove ${lorasLabel(fkey)} from this node? Its groups, and the LoRAs inside it, leave this node (LoRAs you also added on their own stay). Files on disk are not touched.`,
      [this.fullPath(fkey)]
    );
    if (!ok) return;
    this.commit((st) => {
      st.sources.folders = st.sources.folders.filter((f) => f.key !== fkey);
      const stillIn = (p) => st.sources.loras.includes(p) || st.sources.folders.some((f) => under(p, f.key));
      const gone = (p) => under(p, fkey) && !stillIn(p);
      st.active = st.active.filter((a) => a.mix || !gone(a.path)); // mixes keep theirs, greyed
      for (const o of [st.strengths, st.placements, st.ids]) for (const k of Object.keys(o)) if (gone(k)) delete o[k];
      st.favourites = st.favourites.filter((k) => !gone(k));
      st.history = st.history.filter((k) => !gone(k));
      st.unlisted.loras = st.unlisted.loras.filter((k) => !gone(k));
      // groups that came from this folder go; groups you made inside them move up
      const drop = new Set(st.groups.filter((g) => g.folder !== null && under(g.folder, fkey) && !st.sources.folders.some((f) => under(g.folder, f.key))).map((g) => g.id));
      const byId = new Map(st.groups.map((g) => [g.id, g]));
      const survivor = (id) => { let cur = id; while (cur && drop.has(cur)) cur = byId.get(cur)?.parent ?? null; return cur; };
      for (const g of st.groups) if (g.parent && drop.has(g.parent)) g.parent = survivor(g.parent);
      for (const [k, gid] of Object.entries(st.placements)) if (drop.has(gid)) delete st.placements[k];
      st.groups = st.groups.filter((g) => !drop.has(g.id));
      st.unlisted.groups = st.unlisted.groups.filter((id) => !drop.has(id));
      st.knownFolders = st.knownFolders.filter((f) => !under(f, fkey) || st.sources.folders.some((x) => under(f, x.key)));
      if (!st.sources.folders.some((f) => baseOf(f.key) === baseOf(fkey)) && !st.sources.loras.some((k) => baseOf(k) === baseOf(fkey))) {
        delete st.bases[baseOf(fkey)];
      }
    });
    scanCache.clear();
    await this.refresh({ force: true, promptFolders: false });
  }

  /** Take a LoRA you added on its own off the node. The file isn't touched. */
  removeLora(p) {
    this.commit((st) => {
      st.sources.loras = st.sources.loras.filter((k) => k !== p);
      st.active = st.active.filter((a) => a.path !== p);
      for (const o of [st.strengths, st.placements, st.ids]) delete o[p];
      st.favourites = st.favourites.filter((k) => k !== p);
      delete st.favAdded[p];
      st.history = st.history.filter((k) => k !== p);
      st.unlisted.loras = st.unlisted.loras.filter((k) => k !== p);
    });
    this.files.delete(p);
    this.reconcile();
    this.render();
  }

  // ----- search
  search(query, scopeGid) {
    const q = query.trim().toLowerCase();
    if (!q || !this.m) return { groups: [], loras: [] };
    let groupIds;
    if (scopeGid) groupIds = [scopeGid, ...this.descendants(scopeGid)];
    else groupIds = [...this.state.groups.filter((g) => !this.m.hiddenGroups.has(g.id)).map((g) => g.id), UNGROUPED];
    const groups = [];
    const loras = [];
    for (const gid of groupIds) {
      const g = this.m.byId.get(gid);
      if (gid !== scopeGid && g && g.name.toLowerCase().includes(q)) groups.push(gid);
      for (const p of this.m.lorasIn.get(gid) || []) {
        const nick = (this.files.get(p)?.nickname || "").toLowerCase();
        const file = basename(p).toLowerCase();
        if (nick.includes(q) || file.includes(q)) loras.push(p);
      }
    }
    const byName = (a, b) => a.localeCompare(b);
    groups.sort((a, b) => byName(this.m.byId.get(a).name.toLowerCase(), this.m.byId.get(b).name.toLowerCase()));
    loras.sort((a, b) => byName(this.displayName(a).toLowerCase(), this.displayName(b).toLowerCase()));
    return { groups: groups.slice(0, 300), loras: loras.slice(0, 1000) };
  }

  /** Expand everything above a group or LoRA, scroll the tree to it and flash it. */
  reveal({ gid, path }, opts = {}) {
    if (this.state.settings.groupsCollapsed) this.toggleGroupsCollapsed(true); // showing it needs GROUPS open
    const flat = this.isFlat();
    if (path) {
      gid = this.m.groupOfLora.get(path);
      if (gid && !flat) this.expandTo(gid, true);
      if (flat) gid = "__flat";
    } else if (gid && flat) {
      this.commit((s) => { s.settings.flatList = false; }); // a group: show the groups
      this.expandTo(gid, true);
    } else if (gid) {
      this.expandTo(gid, true);
    }
    const key = path ? `l:${path}` : `g:${gid}`;
    if (opts.hold) this.setHold(key, opts.hold); // from a search result
    else {
      this.highlight = { key, until: Date.now() + 1600 };
      this.mainOpen = false;
    }
    this.render();
    this.notify();
    const viewH = this.treeEl.clientHeight;
    let target = null;
    if (path) {
      const bi = this.flat.findIndex((r) => r.key === `b:${gid}`);
      if (bi >= 0) {
        const box = this.flat[bi];
        const idx = box.paths.indexOf(path);
        let inner = idx * ROW_H;
        if (this.state.settings.listHeight !== 0 && !box.flat) {
          // centre the LoRA inside its group's own scroll box
          const boxH = box.h - 2;
          const st = clamp(idx * ROW_H - boxH / 2 + ROW_H / 2, 0, Math.max(0, box.paths.length * ROW_H - boxH));
          this.boxScroll.set(gid, st);
          inner -= st;
        }
        target = this.offsets[bi] + inner;
      }
    } else {
      const i = this.flat.findIndex((r) => r.key === key);
      if (i >= 0) target = this.offsets[i];
    }
    if (target !== null) this.treeEl.scrollTop = Math.max(0, this.revealScroll(target, viewH, opts.hold));
    this.renderTreeWindow(true);
    this.placeGroupDrop();
    if (!opts.hold) setTimeout(() => { if (this.highlight?.key === key) { this.highlight = null; } }, 1700);
  }


  // ----- search boxes
  // Every search box (the top one, each group's, DISABLED's and Search Files) shows its results while the
  // mouse is over the box or the results: hovering a box that has a term opens them after 0.15 s, and they
  // close 0.3 s after the mouse leaves both. Typing opens them too. Clicking into a box selects its term
  // (so typing replaces it), or puts the cursor at the end if you click to the right of the text.

  /** Which search box the element is in: "main", "dis", "fs" or "g:<group id>". */
  slotAt(t) {
    if (!t?.closest || !this.el.contains(t)) return null;
    if (t.closest(".spll-search-wrap")) return "main";
    const gw = t.closest(".spll-gsearch-wrap");
    if (gw) { const gid = gw.closest(".spll-row")?.dataset.gid; return gid ? `g:${gid}` : null; }
    if (this.disSearchEl.contains(t)) return "dis";
    if (this.fsZone.contains(t)) return "fs";
    return null;
  }

  slotTerm(id) {
    if (id === "main") return this.mainQuery.trim();
    if (id === "dis") return this.disInput.value.trim();
    if (id === "fs") return this.fsInput.value.trim();
    if (id?.startsWith("g:")) return (this.groupQueries.get(id.slice(2)) || "").trim();
    return "";
  }

  slotIsOpen(id) {
    if (id === "main") return this.fileMode ? this.fileSearches.main.isOpen : this.mainOpen;
    if (id === "dis") return this.fileSearches.dis.isOpen;
    if (id === "fs") return this.footerOpen;
    if (id?.startsWith("g:")) return this.gOpen === id.slice(2);
    return false;
  }

  openSlots() { return ["main", "dis", "fs", this.gOpen ? `g:${this.gOpen}` : null].filter((id) => id && this.slotIsOpen(id)); }

  /** The box and its results: the mouse being over either keeps the results open. */
  slotZones(id) {
    if (id === "main") return [this.headerEl.querySelector(".spll-search-wrap"), this.fileMode ? this.fileSearches.main.el : this.dropdownEl];
    if (id === "dis") return [this.disSearchEl, this.fileSearches.dis.el];
    if (id === "fs") return [this.fsZone, this.fileSearches.footer.el];
    if (id?.startsWith("g:")) return [this.groupSearchWrap(id.slice(2)), this.gDropEl];
    return [];
  }

  openSlot(id, armed = false) {
    if (armed) this.armed.add(id); else this.armed.delete(id);
    this.clearCloseTimer(id);
    if (id === "main") {
      if (this.fileMode) this.fileSearches.main.setQuery(this.mainQuery);
      else { this.mainOpen = true; this.renderDropdown(); }
    } else if (id === "dis") this.fileSearches.dis.setQuery(this.disInput.value);
    else if (id === "fs") this.openFooterSearch();
    else if (id.startsWith("g:")) {
      if (this.gOpen && this.gOpen !== id.slice(2)) this.closeSlot(`g:${this.gOpen}`);
      this.gOpen = id.slice(2);
      this.groupSearchWrap(this.gOpen)?.classList.add("is-open");
      this.renderGroupDrop();
    }
  }

  closeSlot(id, { keepFocus = false } = {}) {
    this.clearCloseTimer(id);
    this.markSearchFresh(id);
    this.armed.delete(id);
    this.peek(null);
    if (id === "main") { this.mainOpen = false; this.fileSearches.main.close(); this.renderDropdown(); }
    else if (id === "dis") this.fileSearches.dis.close();
    else if (id === "fs") this.closeFooterSearch();
    else if (id.startsWith("g:")) {
      const wrap = this.groupSearchWrap(id.slice(2));
      if (!keepFocus) {
        this.gsFocus = null;
        wrap?.classList.remove("is-open");
        if (wrap?.contains(document.activeElement)) document.activeElement.blur(); // the box slides back
      }
      if (this.gOpen === id.slice(2)) { this.gOpen = null; this.renderGroupDrop(); }
    }
    if (this.hold?.slot === id) this.releaseHold(); // the result you clicked fades once its results close
  }

  clearCloseTimer(id) {
    clearTimeout(this.closeTimers.get(id));
    this.closeTimers.delete(id);
  }

  onSearchPointerMove(e) {
    if (this.dragging || !this.el.isConnected) return;
    const t = e.target;
    for (const id of this.openSlots()) {
      const inside = this.slotZones(id).some((z) => z && z.contains(t));
      if (inside) { this.armed.add(id); this.clearCloseTimer(id); }
      else if (this.armed.has(id) && !this.closeTimers.has(id)) {
        this.closeTimers.set(id, setTimeout(() => { this.closeTimers.delete(id); this.closeSlot(id); }, id === "fs" ? 450 : 300));
      }
    }
    const id = this.slotAt(t);
    if (id === this.hoverSlot) return;
    clearTimeout(this.hoverTimer);
    this.hoverSlot = id;
    // Search Folders slides out after a short hover over its button (a click opens it at once)
    if (id === "fs" && !this.footerOpen && !this.overlay && !this.picker && t.closest?.(".spll-fs-btn")) {
      this.hoverTimer = setTimeout(() => { if (this.hoverSlot === "fs" && !this.footerOpen) this.openSlot("fs", true); }, 300);
      return;
    }
    if (!id || id === "fs" || this.slotIsOpen(id) || !this.slotTerm(id) || this.overlay || this.picker) return;
    this.hoverTimer = setTimeout(() => {
      if (this.hoverSlot === id && this.slotTerm(id) && !this.slotIsOpen(id)) this.openSlot(id, true);
    }, 150);
  }

  /** A click anywhere outside an open search box and its results closes them. */
  onSearchOutsideDown(e) {
    this.onOutsideDown(e);
    for (const id of this.openSlots()) {
      if (!this.slotZones(id).some((z) => z && z.contains(e.target))) this.closeSlot(id);
    }
  }

  /**
   * Clicking outside the node (the canvas, another node, the page) closes this node's menus and
   * popups. Boxes you type into stay open so you can copy text in from elsewhere (clicking on the node
   * closes them), and serious questions (replacing favourites and history on import) never close this way.
   */
  onOutsideDown(e) {
    const t = e.target;
    if (!t?.closest || this.el.contains(t)) return;
    this.lastOutsideDown = Date.now();
    // our own page-level panels, tooltips and ComfyUI's dialogs aren't "outside"
    if (t.closest(".spll-fs-results, .spll-pmenu-layer, .spll-modal-backdrop, .spll-tip, [role=dialog]")) return;
    if (this.overlay && OUTSIDE_CLOSES.has(this.overlay.kind)) {
      this.overlay = null;
      this.render();
    }
  }

  /**
   * First click into a search box selects its whole term, wherever you click (so typing replaces it; End or
   * a second click to add to it). Phase 5's "click right of the text = cursor at end" was dropped in phase 7:
   * in a wide box with a short term almost every click landed right of the text. "First" means the box wasn't in use: it didn't have the cursor,
   * or its results had closed since you last clicked in it (the cursor often stays in a box after you move
   * away, because clicking the canvas or a row doesn't take it). After that, clicks work as normal.
   * Decided on pointerdown and applied on mousedown and again on click, in case ComfyUI swallows one of them.
   */
  isSearchInput(t) {
    return !!t?.matches?.("input.spll-search, input.spll-gsearch, input[data-act=picker-filter], input[data-act=move-filter]");
  }

  onSearchPointerDown(e) {
    const t = e.target;
    if (e.button !== 0 || !this.isSearchInput(t)) return;
    const key = t.dataset.fkey || "";
    const fresh = document.activeElement !== t || this.freshSearch.has(key);
    this.freshSearch.delete(key);
    // phase 7: the first click always selects the whole search (End or a second click to add to it)
    t._spllPending = fresh ? "all" : null;
  }

  onSearchPress(e) {
    const t = e.target;
    if (!t?._spllPending) return;
    e.preventDefault(); // no native caret placement or drag-select on this click
    this.applySearchClick(t);
  }

  onSearchClick(e) {
    const t = e.target;
    if (!t?._spllPending) return;
    this.applySearchClick(t);
    t._spllPending = null;
    // and once more after everything else has handled this click, so nothing can undo the selection
    setTimeout(() => { if (document.activeElement === t && !t._spllPending) t.select(); }, 0);
  }

  applySearchClick(t) {
    if (document.activeElement !== t) t.focus({ preventScroll: true });
    const len = t.value.length;
    if (t._spllPending === "end") t.setSelectionRange(len, len);
    else t.select();
  }

  /** Mark a search box so the next click into it selects its term again. */
  markSearchFresh(slot) {
    const key = slot === "main" ? "main-search" : slot === "dis" ? "dis-input" : slot === "fs" ? "fs-input" : slot?.startsWith("g:") ? `gs:${slot.slice(2)}` : null;
    if (key) this.freshSearch.add(key);
  }

  /** Where the typed text ends on screen (canvas zoom included). */
  textEndX(t) {
    const r = t.getBoundingClientRect();
    const k = t.offsetWidth ? r.width / t.offsetWidth : 1;
    const cs = getComputedStyle(t);
    const ctx = (TEXT_CTX.c ||= document.createElement("canvas").getContext("2d"));
    ctx.font = cs.font || `${cs.fontSize} ${cs.fontFamily}`;
    const w = ctx.measureText(t.value).width;
    return r.left + (parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) + w - t.scrollLeft) * k;
  }

  // ----- a group's search results: drawn over the list, opening upwards (everything a group
  // search can find sits inside that group, below its bar, so the results never cover it)
  groupSearchWrap(gid) {
    const row = this.treeEl.querySelector(`.spll-group[data-gid="${CSS.escape(gid)}"]`);
    if (!row) return null;
    const r = row.getBoundingClientRect();
    const tr = this.treeEl.getBoundingClientRect();
    if (r.bottom <= tr.top + 2 || r.top >= tr.bottom - 2) return null; // scrolled out of view
    return row.querySelector(".spll-gsearch-wrap");
  }

  renderGroupDrop() {
    const el = this.gDropEl;
    const gid = this.gOpen;
    const q = gid ? (this.groupQueries.get(gid) || "").trim() : "";
    const keep = el.querySelector(".spll-results-inner")?.scrollTop || 0;
    el.innerHTML = "";
    if (!gid || !q || !this.groupSearchWrap(gid)) {
      el.hidden = true;
      if (gid && !q) this.gOpen = null;
      return;
    }
    const res = this.search(q, gid);
    const box = this.resultsBox(res, { color: this.colorOf(gid) });
    box.classList.add("spll-gresults");
    el.append(box);
    el.hidden = false;
    this.placeGroupDrop();
    const inner = box.querySelector(".spll-results-inner");
    if (inner) inner.scrollTop = keep;
  }

  placeGroupDrop() {
    const el = this.gDropEl;
    if (el.hidden || !this.gOpen) return;
    const wrap = this.groupSearchWrap(this.gOpen);
    if (!wrap) return void this.closeSlot(`g:${this.gOpen}`); // its group scrolled away
    const root = this.el.getBoundingClientRect();
    const k = this.el.offsetWidth ? root.width / this.el.offsetWidth : 1;
    const bar = wrap.closest(".spll-group").getBoundingClientRect();
    const top = (bar.top - root.top) / k;
    const bottom = (bar.bottom - root.top) / k;
    const inner = el.querySelector(".spll-results-inner");
    const want = inner ? parseFloat(inner.dataset.h || inner.style.maxHeight) || 0 : 0;
    if (inner && !inner.dataset.h) inner.dataset.h = String(want);
    const above = top - 6;
    const below = this.el.offsetHeight - bottom - 6;
    const up = above >= Math.min(want + 8, 3 * ROW_H + 8) || above >= below;
    const room = Math.max(ROW_H, (up ? above : below) - 8);
    if (inner) inner.style.maxHeight = Math.min(want, room) + "px";
    if (up) { el.style.top = ""; el.style.bottom = this.el.offsetHeight - top + 2 + "px"; }
    else { el.style.bottom = ""; el.style.top = bottom + 2 + "px"; }
    el.classList.toggle("is-up", up);
  }

  // ----- Nodes 2.0: Search Files and the tools on the node-name strip
  /** ComfyUI's strip under the widgets that shows the node's name badge, if there is one. */
  badgeStrip() {
    const w = this.el.closest(".lg-node-widgets");
    const n = w?.nextElementSibling;
    if (!n || n.offsetHeight < 12 || n.offsetHeight > 40 || n.contains(this.el)) return null;
    return n;
  }

  /** This node's highlight colours, on the node and on anything it draws over the page (menus, results, info). */
  applyColorVars(el) {
    const hl = this.state.settings.hl || HL_DEFAULTS;
    el.style.setProperty("--spll-accent", hl.accent);
    el.style.setProperty("--spll-on", hl.on);
    el.style.setProperty("--spll-fade", hl.fade);
    el.style.setProperty("--spll-flash", hl.flash);
    el.style.setProperty("--spll-mix", hl.mix);
  }

  /** Below NARROW_AT the node uses its compact layout (all of it is CSS, keyed on .is-narrow). */
  checkNarrow() {
    const w = this.el.offsetWidth;
    if (!w) return;
    const narrow = w < NARROW_AT;
    if (narrow !== this.el.classList.contains("is-narrow")) {
      this.el.classList.toggle("is-narrow", narrow);
      this.hideTip();
    }
  }

  /** Classic and Nodes 2.0 draw the node in different places; redraw when it moves from one to the other. */
  checkMode() {
    if (!this.el?.isConnected) return false;
    const vue = !!this.el.closest("[data-node-id]");
    if (vue === this.vue) return false;
    this.closeSlot("fs");
    this.render();
    return true;
  }

  placeStrip() {
    const s = this.footerEl;
    if (!s) return;
    if (this.checkMode()) return; // render() places the strip again
    if (this.node?.size && this.node.size[0] < MIN_WIDTH) { this.node.setSize([MIN_WIDTH, this.node.size[1]]); this.node.setDirtyCanvas?.(true, true); }
    this.checkNarrow();
    this.fitFavButton();
    const was = !!this.stripFloating;
    const host = this.vue && !s.hidden ? this.badgeStrip() : null;
    this.stripFloating = !!host;
    this.el.classList.toggle("has-strip", this.stripFloating);
    s.classList.toggle("is-floating", this.stripFloating);
    this.stripRoom = null;
    if (host) {
      const root = this.el.getBoundingClientRect();
      const k = this.el.offsetWidth ? root.width / this.el.offsetWidth : 1;
      const hr = host.getBoundingClientRect();
      const H = 24;
      s.style.top = (hr.top + hr.height / 2 - root.top) / k - H / 2 + "px";
      s.style.right = (root.right - hr.right) / k + 22 + "px"; // stays clear of the resize corner
      const badge = [...host.children].find((c) => c.offsetWidth > 0);
      const left = (hr.left - root.left) / k + 8;
      this.stripRoom = { left, badgeRight: badge ? (badge.getBoundingClientRect().right - root.left) / k + 8 : left };
    } else {
      s.style.top = s.style.right = "";
    }
    this.sizeFsWrap();
    if (was !== this.stripFloating) { this.lastHeight = 0; this.syncSize(); }
  }

  /** How far Search Files slides out: up to ComfyUI's name badge, or over it when the node is too narrow. */
  sizeFsWrap() {
    const w = this.fsWrap;
    if (!this.footerOpen) { w.style.width = "0px"; return; }
    const s = this.footerEl;
    // the button and the tools beside it (gaps included)
    const others = this.fsButton.offsetWidth + [...s.children].filter((c) => c !== this.fsZone).reduce((a, c) => a + c.offsetWidth, 0) + 3 * (s.children.length + 1);
    let avail;
    if (this.stripFloating && this.stripRoom) {
      const right = this.el.offsetWidth - parseFloat(s.style.right || "0");
      avail = right - others - this.stripRoom.badgeRight;
      if (avail < 160) avail = right - others - this.stripRoom.left;
    } else {
      avail = this.el.offsetWidth - others - 12;
    }
    w.style.width = Math.max(120, Math.floor(avail)) + "px";
  }

  openFooterSearch() {
    this.footerOpen = true;
    this.footerEl.classList.add("is-open");
    this.hideTip();
    this.sizeFsWrap();
    if (this.fsInput.value) this.fileSearches.footer.setQuery(this.fsInput.value);
  }

  // ----- highlights from search results
  /** Clicking a result: its row flashes, then stays highlighted until its results close or you click another. */
  setHold(key, slot) {
    if (this.hold && this.hold.key !== key) this.releaseHold();
    this.released.delete(key);
    this.hold = { key, slot, start: Date.now() };
    this.refreshHolds();
  }

  releaseHold() {
    const hd = this.hold;
    if (!hd) return;
    this.hold = null;
    const at = Date.now();
    this.released.set(hd.key, at);
    setTimeout(() => { if (this.released.get(hd.key) === at) { this.released.delete(hd.key); this.refreshHolds(); } }, HOLD_OUT_MS + 60);
    this.refreshHolds();
  }

  refreshHolds() {
    for (const el of this.treeEl.querySelectorAll(".spll-group[data-gid], .spll-lora[data-where=tree]")) {
      this.applyHold(el, el.dataset.gid ? `g:${el.dataset.gid}` : `l:${el.dataset.path}`);
    }
  }

  applyHold(el, key) {
    const now = Date.now();
    const on = this.hold?.key === key;
    const out = !on && this.released.has(key);
    const was = el.classList.contains("is-hold") ? "hold" : el.classList.contains("is-unhold") ? "unhold" : "";
    const want = on ? "hold" : out ? "unhold" : "";
    if (was === want && !want) return el;
    el.classList.toggle("is-hold", on);
    el.classList.toggle("is-unhold", out);
    if (!want) { el.style.animationDelay = ""; el.style.removeProperty("--spll-hold"); return el; }
    // the animations run on the clock, so a row drawn again part-way through carries on where it was
    el.style.animationDelay = `-${now - (on ? this.hold.start : this.released.get(key))}ms`;
    el.style.setProperty("--spll-hold", this.holdColor(key));
    return el;
  }

  /** The opposite of the row's colour (its group's colour, or the node's background). */
  holdColor(key) {
    if (this.state.settings.hl?.result) return this.state.settings.hl.result; // a fixed colour you picked
    const gid = key.startsWith("g:") ? key.slice(2) : this.m?.groupOfLora.get(key.slice(2));
    let c = (gid && this.colorOf(gid)) || getComputedStyle(this.el).getPropertyValue("--spll-bg").trim() || "#1f1f23";
    const ctx = (TEXT_CTX.h ||= document.createElement("canvas").getContext("2d"));
    ctx.fillStyle = "#000";
    ctx.fillStyle = c;
    c = ctx.fillStyle; // now "#rrggbb" or "rgba(…)"
    let rgb;
    if (c[0] === "#") rgb = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    else rgb = (c.match(/[\d.]+/g) || [0, 0, 0]).slice(0, 3).map(Number);
    return `rgb(${rgb.map((v) => 255 - Math.round(v)).join(",")})`;
  }

  /** Hovering a result: outline that LoRA or group wherever it's on screen in the node (nothing scrolls). */
  peek(target) {
    for (const el of this.peeked || []) el.classList.remove("is-peek");
    this.peeked = [];
    if (!target) return;
    const sel = target.path
      ? `.spll-tree .spll-lora[data-path="${CSS.escape(target.path)}"], .spll-active-list .spll-lora[data-path="${CSS.escape(target.path)}"]`
      : `.spll-tree .spll-group[data-gid="${CSS.escape(target.gid)}"]`;
    for (const el of this.el.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      let vis = r.height > 0;
      for (let p = el.parentElement; vis && p && p !== this.el; p = p.parentElement) {
        if (p.classList.contains("spll-scroll") || p.classList.contains("spll-tree")) {
          const pr = p.getBoundingClientRect();
          vis = r.bottom > pr.top + 2 && r.top < pr.bottom - 2;
        }
      }
      if (!vis) continue;
      el.classList.add("is-peek");
      this.peeked.push(el);
    }
  }

  peekFromResult(t) {
    const res = t?.closest?.(".spll-result");
    if (!res || res.classList.contains("spll-empty")) return this.peek(null);
    if (res.dataset.path) this.peek({ path: res.dataset.path });
    else if (res.dataset.gid) this.peek({ gid: res.dataset.gid });
  }

  /** Which open results (if any) cover part of the group list, so a revealed row can be put beside them. */
  coveringResults() {
    const els = [this.mainOpen && !this.dropdownEl.hidden ? this.dropdownEl : null, this.fileSearches.main.el, this.fileSearches.footer.el, this.fileSearches.dis.el];
    return els.find((x) => x && x.isConnected && x.offsetHeight) || null;
  }

  /** Where to scroll the group list so a revealed row is in view and not under open search results. */
  revealScroll(target, viewH, slot) {
    let top = target - viewH / 2 + ROW_H / 2;
    if (slot?.startsWith("g:")) {
      // a group's results open above its bar: keep the bar on screen if the row still fits
      const gi = this.flat.findIndex((r) => r.key === slot);
      if (gi >= 0) {
        const keepBar = Math.min(top, this.offsets[gi]);
        if (target + ROW_H <= keepBar + viewH) top = keepBar;
      }
      return top;
    }
    const cov = slot ? this.coveringResults() : null;
    if (!cov) return top;
    const tr = this.treeEl.getBoundingClientRect();
    const k = this.treeEl.offsetHeight ? tr.height / this.treeEl.offsetHeight : 1;
    const cr = cov.getBoundingClientRect();
    const a = clamp((cr.top - tr.top) / k, 0, viewH);
    const b = clamp((cr.bottom - tr.top) / k, 0, viewH);
    if (b - a < 4) return top;
    // centre it in the larger part of the list the results leave uncovered
    const [lo, hi] = a >= viewH - b ? [0, a] : [b, viewH];
    if (hi - lo < ROW_H) return top;
    return target - (lo + hi) / 2 + ROW_H / 2;
  }

  // ----- layout
  /** Smallest height the widget needs; the node can be made taller and the group list fills the rest. */
  height() {
    const s = this.state;
    if (!s.setup || this.picker) return 540;
    const header = 40 + (this.bulk ? 30 : 0) + (this.vue && !this.stripFloating ? 34 : 0) + (this.m && !this.m.hasGroups ? 36 : 0);
    const entries = s.active.reduce((n, a) => n + (a.mix ? 1 + (this.mixById(a.mix)?.collapsed ? 0 : Math.max(1, this.mixItems(a.mix).length)) : 1), 0); // a mix: its name row and its LoRAs
    const activeRows = Math.min(Math.max(1, entries + (this.fading?.size || 0)), ACTIVE_MAX_ROWS);
    const activeH = 24 + activeRows * ROW_H + 6;
    const treeTitle = 24;
    let total = header + activeH + treeTitle + (s.settings.groupsCollapsed ? 4 : 3 * ROW_H + 14);
    if (s.settings.groupsCollapsed) total -= this.m && !this.m.hasGroups ? 36 : 0; // no DISABLED search box either
    if (this.overlay?.kind === "settings") total = Math.max(total, 380);
    return Math.ceil(total);
  }

  /** Height for a brand-new node: room for 12 rows of groups. */
  defaultHeight() {
    return this.height() - 3 * ROW_H + 12 * ROW_H;
  }

  /** Size the node so its group list shows about 12 rows (used once, when a new node gets its root). */
  fitDefault() {
    const node = this.node;
    try {
      const sz = node.computeSize?.();
      if (!sz) return;
      const chrome = Math.max(0, sz[1] - this.height());
      node.setSize([Math.max(node.size?.[0] ?? DEFAULT_WIDTH, DEFAULT_WIDTH), chrome + this.defaultHeight()]);
      node.setDirtyCanvas?.(true, true);
      // then measure the list and correct, since node chrome differs between renderers
      setTimeout(() => {
        const have = this.treeEl.clientHeight;
        const want = 12 * ROW_H;
        if (have > 0 && Math.abs(have - want) > 2) {
          node.setSize([node.size[0], node.size[1] + (want - have)]);
          node.setDirtyCanvas?.(true, true);
        }
      }, 120);
    } catch { /* */ }
  }

  syncSize() {
    const node = this.node;
    const min = this.height();
    if (min === this.lastHeight) return;
    this.lastHeight = min;
    try {
      const sz = node.computeSize?.();
      if (sz && node.size && (node.size[1] < sz[1] || node.size[0] < MIN_WIDTH)) {
        node.setSize([Math.max(node.size[0], MIN_WIDTH), Math.max(node.size[1], sz[1])]);
      }
    } catch { /* */ }
    node.setDirtyCanvas?.(true, true);
  }

  // ----- DOM
  build() {
    const el = this.el;
    el.classList.add("spll");
    el.innerHTML = "";

    this.searchInput = h("input", {
      class: "spll-search",
      type: "text",
      placeholder: "Search LoRAs and groups…",
      spellcheck: "false",
      "data-fkey": "main-search",
    });
    this.searchClear = h("button", { class: "spll-icon spll-search-clear", title: "Clear search", "data-act": "clear-main", text: "×" });
    // classic canvas: tools sit in the header, and a toggle switches the search between this node and all files
    this.filesToggle = h("button", { class: "spll-icon spll-hdr-tool spll-files-toggle", "data-act": "files-toggle", "data-tip": "filetoggle" }, icon("folderSearch"));
    const tools = () => [
      h("button", { class: "spll-icon", "data-act": "new-group", "data-tip": "plain", "data-tiptext": "New group", text: "+" }),
      h("button", { class: "spll-icon spll-gear", "data-act": "settings", "data-tip": "plain", "data-tiptext": "Settings", text: "⚙" }),
      h("button", { class: "spll-icon spll-rescan", "data-act": "rescan", "data-tip": "rescan", text: "↻" }),
    ];
    // classic, narrow mode: Search Folders and the tools fold behind ⋮ and open over the search bar on hover
    this.headerEl = h("div", { class: "spll-header" },
      h("div", { class: "spll-search-wrap" }, this.searchInput, this.searchClear),
      h("div", { class: "spll-hdr-more spll-hdr-tool" },
        h("span", { class: "spll-hdr-handle", text: "⋮" }),
        h("div", { class: "spll-hdr-pack" }, this.filesToggle, h("div", { class: "spll-hdr-tools" }, ...tools()))),
    );
    // Nodes 2.0: Search Files and the tools sit together on the right of ComfyUI's node-name strip
    this.fsInput = h("input", { class: "spll-search spll-fs-input", type: "text", placeholder: "Search folders and LoRAs…", spellcheck: "false", "data-fkey": "fs-input", "data-act": "fs-input" });
    this.fsClear = h("button", { class: "spll-icon spll-search-clear spll-fs-clear", "data-act": "files-clear", title: "Clear search", text: "×", hidden: true });
    this.fsWrap = h("div", { class: "spll-fs-wrap" }, this.fsInput, this.fsClear);
    this.fsButton = h("button", { class: "spll-icon spll-fs-btn", "data-act": "files-open", "data-tip": "searchfiles" }, icon("folderSearch"));
    this.fsZone = h("div", { class: "spll-fs-zone" }, this.fsWrap, this.fsButton);
    this.footerEl = h("div", { class: "spll-strip" }, this.fsZone,
      h("div", { class: "spll-strip-more" },
        h("span", { class: "spll-strip-handle", text: "⋮" }),
        h("div", { class: "spll-strip-pack" }, ...tools())));
    // DISABLED mode (no groups): a box under the list for adding more
    this.disInput = h("input", { class: "spll-search spll-dis-input", type: "text", placeholder: "Add LoRAs or folders…", spellcheck: "false", "data-fkey": "dis-input", "data-act": "dis-input" });
    this.disClear = h("button", { class: "spll-icon spll-search-clear", "data-act": "dis-clear", title: "Clear search", text: "×", hidden: true });
    this.disSearchEl = h("div", { class: "spll-dis-search", hidden: true }, icon("folderSearch", "spll-dis-icon"), this.disInput, this.disClear);
    this.fileSearches = {
      footer: new FileSearch(this, this.fsInput, "up", "fs"),
      dis: new FileSearch(this, this.disInput, "up", "dis"),
      main: new FileSearch(this, this.searchInput, "down", "main"),
    };
    this.fileMode = false; // classic: is the top search searching all files?
    this.dropdownEl = h("div", { class: "spll-dropdown spll-scroll", hidden: true });
    this.gDropEl = h("div", { class: "spll-dropdown spll-gdrop", hidden: true }); // a group's search results
    this.activeEl = h("div", { class: "spll-active" });
    this.treeTitleEl = h("div", { class: "spll-section-title spll-tree-title" });
    this.treeEl = h("div", { class: "spll-tree spll-scroll" });
    this.spacerEl = h("div", { class: "spll-spacer" });
    this.treeEl.append(this.spacerEl);
    this.bodyEl = h("div", { class: "spll-body" }, this.activeEl, this.treeTitleEl, this.treeEl, this.disSearchEl);
    this.overlayEl = h("div", { class: "spll-overlay" });
    this.statusEl = h("div", { class: "spll-status", hidden: true });
    this.bulkEl = h("div", { class: "spll-bulk", hidden: true });
    this.tipEl = h("div", { class: "spll-tip", hidden: true });
    el.append(this.headerEl, this.dropdownEl, this.statusEl, this.bulkEl, this.bodyEl, this.footerEl, this.gDropEl, this.overlayEl, this.tipEl);
    this.rowEls = new Map();

    this.treeEl.addEventListener("scroll", () => { this.renderTreeWindow(); this.placeGroupDrop(); }, { passive: true });
    this.fsWrap.addEventListener("transitionend", () => this.fileSearches.footer.place());
    this.bindEvents();
  }

  bindEvents() {
    const el = this.el;

    // Keep keystrokes in our text boxes away from ComfyUI's canvas shortcuts (Delete, Ctrl+A, letters…)
    for (const type of ["keydown", "keyup", "keypress"]) {
      el.addEventListener(type, (e) => {
        if (isTextInput(e.target)) e.stopPropagation();
        if (type === "keydown" && e.key === "Escape" && (this.overlay || this.picker || this.mainOpen)) {
          e.stopPropagation();
        }
      });
    }
    for (const type of ["copy", "cut", "paste"]) {
      el.addEventListener(type, (e) => { if (isTextInput(e.target)) e.stopPropagation(); });
    }
    // (mouse wheel over our lists is handled by one window-level listener, see installWheelGuard)
    // Don't let right-clicks open the canvas/node menu
    el.addEventListener("contextmenu", (e) => this.onContextMenu(e));
    el.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    el.addEventListener("pointerdown", (e) => this.onSearchPointerDown(e), true);
    el.addEventListener("mousedown", (e) => this.onSearchPress(e), true);
    el.addEventListener("click", (e) => this.onSearchClick(e), true);
    el.addEventListener("focusout", (e) => {
      if (!this.isSearchInput(e.target)) return;
      // a box redrawn while you type gets the cursor straight back; only really leaving it counts
      const key = e.target.dataset.fkey || "";
      setTimeout(() => {
        if (document.activeElement?.dataset?.fkey === key) return;
        this.freshSearch.add(key);
        if (key.startsWith("gs:") && this.gsFocus === key.slice(3) && this.gOpen !== key.slice(3)) {
          this.gsFocus = null;
          this.groupSearchWrap(key.slice(3))?.classList.remove("is-open");
        }
      }, 0);
    }, true);
    el.addEventListener("mouseout", (e) => { if (!e.relatedTarget || !e.relatedTarget.closest?.(".spll-result")) this.peek(null); });
    // search boxes open and close with the mouse (one listener for the whole page, removed in destroy)
    this.onWinMove = (e) => this.onSearchPointerMove(e);
    this.onWinDown = (e) => this.onSearchOutsideDown(e);
    window.addEventListener("pointermove", this.onWinMove, { capture: true, passive: true });
    window.addEventListener("pointerdown", this.onWinDown, true);
    // Nodes 2.0: keep the strip lined up with ComfyUI's node-name row as the node changes size
    try {
      this.stripObserver = new ResizeObserver(() => this.placeStrip());
      this.stripObserver.observe(el);
    } catch { /* */ }
    el.addEventListener("click", (e) => this.onClick(e));
    el.addEventListener("dblclick", (e) => this.onDblClick(e));
    el.addEventListener("input", (e) => this.onInput(e));
    el.addEventListener("keydown", (e) => this.onKeyDown(e));
    el.addEventListener("focusout", (e) => this.onFocusOut(e));
    el.addEventListener("focusin", (e) => this.onFocusIn(e));
    el.addEventListener("mouseup", (e) => this.onMouseUp(e));
    el.addEventListener("mouseover", (e) => this.onHover(e));
    el.addEventListener("mouseleave", () => this.hideTip());
    el.addEventListener("scroll", () => this.hideTip(), { capture: true, passive: true });
    el.addEventListener("wheel", () => this.hideTip(), { passive: true });
    // native browser dragging is off; drags start with a press-and-hold (see onDragPress)
    el.addEventListener("dragstart", (e) => { if (!isTextInput(e.target)) e.preventDefault(); });
  }

  // focus survives re-renders via data-fkey
  captureFocus() {
    const a = document.activeElement;
    if (!a || !this.el.contains(a) || !a.dataset?.fkey) return null;
    return { key: a.dataset.fkey, start: a.selectionStart, end: a.selectionEnd };
  }
  restoreFocus(f) {
    if (!f) return;
    const t = this.el.querySelector(`[data-fkey="${CSS.escape(f.key)}"]`);
    if (t && document.activeElement !== t) {
      t.focus({ preventScroll: true });
      try { t.setSelectionRange(f.start, f.end); } catch { /* */ }
    }
  }

  render() {
    const focus = this.captureFocus();
    const s = this.state;
    if (!this.m) this.m = this.model();

    const needPicker = !s.setup || !!this.picker;
    this.vue = !!this.el.closest("[data-node-id]"); // Nodes 2.0 draws nodes as page elements with a node id
    this.el.classList.toggle("is-vue", this.vue);
    this.checkNarrow();
    this.applyColorVars(this.el);
    this.headerEl.hidden = needPicker;
    this.bodyEl.hidden = needPicker;
    this.footerEl.hidden = needPicker || !this.vue;
    this.fsClear.hidden = !this.fsInput.value;
    this.disClear.hidden = !this.disInput.value;
    this.disSearchEl.hidden = needPicker || !!this.m?.hasGroups || !!s.settings.groupsCollapsed;
    this.treeEl.hidden = !needPicker && !!s.settings.groupsCollapsed;
    const noFolders = !this.hasFolders();
    for (const b of this.el.querySelectorAll(".spll-rescan")) {
      b.classList.toggle("is-disabled", noFolders);
      b.setAttribute("aria-disabled", noFolders ? "true" : "false");
    }
    this.filesToggle.classList.toggle("is-on", this.fileMode);
    this.searchInput.placeholder = this.fileMode ? "Search all folders and LoRAs to add…" : "Search LoRAs and groups…";
    this.searchClear.hidden = !this.mainQuery;
    if (this.searchInput.value !== this.mainQuery) this.searchInput.value = this.mainQuery;

    // status line
    let status = null;
    if (!needPicker) {
      if (this.error) status = `Couldn't read the LoRA folder: ${this.error}`;
      else if (this.loading && !this.scanned) status = "Scanning LoRAs…";
      else if (this.scanned && !s.sources.folders.length && !s.sources.loras.length) status = this.vue ? "Nothing added yet. Use Search Folders (bottom right) to add folders or LoRAs." : "Nothing added yet. Switch the search to Search Folders (folder button) to add folders or LoRAs.";
      else if (this.scanned && this.files.size === 0 && this.missing.size === 0) status = "No LoRAs found in this node's folders.";
    }
    this.statusEl.hidden = !status;
    this.statusEl.textContent = status || "";
    const b = this.bulk;
    this.bulkEl.hidden = !b || needPicker;
    if (b) {
      this.bulkEl.innerHTML = "";
      this.bulkEl.append(
        h("span", { class: "spll-spinner" }),
        h("span", { class: "spll-bulk-text", text: `Fetching info ${Math.min(b.done + 1, b.total)} of ${b.total}${b.current ? `: ${this.displayName(b.current)}` : ""}` }),
        h("button", { class: "spll-btn spll-btn-sm", "data-act": "bulk-cancel", disabled: b.cancel, text: b.cancel ? "Stopping…" : "Cancel" }),
      );
    }

    if (!needPicker) {
      this.renderActive();
      this.renderTree();
      this.renderDropdown();
      this.renderGroupDrop();
    } else {
      this.dropdownEl.hidden = true;
      this.gDropEl.hidden = true;
    }
    this.renderOverlay();
    this.placeStrip();
    this.syncSize();
    this.restoreFocus(focus);
  }

  // --- rows
  /** A LoRA's row. In a mix's box, `mix` is { id, item, on (the mix), owner (the mix that loads it) }. */
  loraRow(p, where, depth = 0, mix = null) {
    const missing = mix ? this.unavailable(p) : this.missing.has(p);
    const active = mix ? !mix.item.off : this.isActive(p);
    const gid = this.m.groupOfLora.get(p);
    const color = gid ? this.colorOf(gid) : null;
    const key = `l:${p}`;
    const editing = !mix && this.editing && this.editing.path === p && this.editing.where === where;
    const name = this.displayName(p);
    const strength = mix ? mix.item.strength : this.strengthOf(p);
    const fk = mix ? `mix-${mix.id}` : where;
    // in a mix: greyed while another switched-on mix loads this LoRA (or it's switched on by itself)
    const other = mix && mix.on && mix.owner !== mix.id;
    const row = h("div", {
      class: "spll-row spll-lora" + (missing ? " is-missing" : "") + (active ? " is-on" : "") +
        (other ? " is-other" : "") + (this.highlight?.key === key && where === "tree" ? " is-flash" : ""),
      "data-path": p,
      "data-where": where,
      "data-mix": mix?.id || null,
      style: { paddingLeft: 6 + depth * 14 + "px", "--spll-color": color || "transparent" },
    });
    if (other) {
      row.dataset.tip = "plain";
      row.dataset.tiptext = mix.owner
        ? `Loading from the mix “${this.mixById(mix.owner)?.name}”. Right-click → Use this mix's copy.`
        : "Switched on by itself, so this copy doesn't load.";
    }
    row.append(
      h("button", {
        class: "spll-switch" + (active ? " on" : ""),
        title: missing ? "LoRA file missing" : active ? "Switch off" : "Switch on",
        disabled: missing,
        "data-act": "toggle",
        "aria-pressed": active ? "true" : "false",
      }, h("span")),
    );
    if (editing) {
      row.append(h("input", {
        class: "spll-name-edit",
        type: "text",
        value: this.files.get(p)?.nickname || "",
        placeholder: stripExt(basename(p)),
        "data-fkey": `nick:${where}:${p}`,
        "data-act": "nick-input",
        spellcheck: "false",
      }));
    } else {
      row.append(h("span", {
        class: "spll-name" + (where === "active" || where === "mix" ? " is-link" : ""),
        "data-tip": "lora",
        "data-act": where === "active" || where === "mix" ? "reveal-lora" : null,
      }, name, (this.m.dupes.has(p) || where === "active" || where === "mix") && relOf(dirname(p))
        ? h("span", { class: "spll-name-folder", text: folderText(p) })
        : null));
    }
    // narrow mode: the strength and the ⋮ tools share one zone; once i/T/☆ slide out (pushing the strength along),
    // they stay out while the pointer is anywhere in the zone, so you can move on to the strength
    const zkey = `${where}|${mix?.id || ""}|${p}`; // kept across redraws (a click on − or + redraws the row)
    const zone = h("div", { class: "spll-rz" + (this.rzOpen === zkey ? " is-tools" : "") });
    row.append(zone);
    zone.addEventListener("pointerleave", () => { zone.classList.remove("is-tools"); if (this.rzOpen === zkey) this.rzOpen = null; });
    zone.append(
      // narrow mode shows a two-digit strength; hovering it opens the full −/number/+ control
      h("div", { class: "spll-strength-wrap" },
      h("span", { class: "spll-num-compact" + (strength < 0 ? " is-neg" : ""), text: compactStrength(strength) }),
      h("div", { class: "spll-strength" + (missing ? " is-disabled" : "") },
        h("button", { class: "spll-step", "data-act": "dec", title: `−${STEP}`, disabled: missing, text: "−" }),
        h("input", {
          class: "spll-num",
          type: "text",
          inputmode: "decimal",
          value: fmt(strength),
          disabled: missing,
          "data-fkey": `str:${fk}:${p}`,
          "data-act": "strength",
          title: "Strength — click to type a value",
          spellcheck: "false",
        }),
        h("button", { class: "spll-step", "data-act": "inc", title: `+${STEP}`, disabled: missing, text: "+" }),
      ),
      ),
      // i, T and ☆; in narrow mode they fold behind a ⋮ handle that slides them out on hover
      h("div", { class: "spll-rt" },
      h("span", { class: "spll-rt-handle", text: "⋮", onpointerenter: () => { zone.classList.add("is-tools"); this.rzOpen = zkey; } }),
      h("div", { class: "spll-rt-tools" },
      h("button", {
        class: "spll-icon spll-info" + (missing ? " is-lit" : ""),
        "data-act": "info",
        "data-tip": "info",
        text: "i",
      }),
      h("button", {
        class: "spll-icon spll-trig is-" + this.trigState(p),
        "aria-disabled": missing ? "true" : null,
        "data-act": "trigger",
        "data-tip": "trig",
        text: "T",
      }),
      h("button", {
        class: "spll-icon spll-star" + (this.isFav(p) ? " is-on" : ""),
        "data-act": "fav",
        "data-tip": "fav",
      }, this.isFav(p)
        ? h("span", { class: "spll-star-glyph is-metal", style: metalStyle(this.tierOf(p)), text: "★" }) // its tier's metal
        : h("span", { class: "spll-star-glyph", text: "☆" })),
      )),
    );
    if (where === "tree") this.applyHold(row, key);
    return row;
  }

  groupRow(g, depth) {
    if (this.selectMode) return this.selGroupRow(g);
    const color = this.colorOf(g.id);
    const key = `g:${g.id}`;
    const n = g.id === UNGROUPED ? (this.m.lorasIn.get(UNGROUPED) || []).length : this.m.counts.get(g.id) || 0;
    const q = this.groupQueries.get(g.id) || "";
    return this.applyHold(h("div", {
      class: "spll-row spll-group" + (g.collapsed ? " is-collapsed" : "") +
        (this.highlight?.key === key ? " is-flash" : ""),
      "data-gid": g.id,
      style: { "--spll-color": color || "transparent" },
    },
      h("button", { class: "spll-caret", "data-act": "collapse", title: g.collapsed ? "Expand" : "Collapse", text: g.collapsed ? "▸" : "▾" }),
      h("span", { class: "spll-gname", "data-tip": "group", text: g.name }),
      h("span", { class: "spll-count", text: String(n) }),
      // a magnifying glass; hovering it opens the search box (lit while this group has a search)
      h("div", { class: "spll-gsearch-wrap" + (q ? " has-term" : "") + (this.gOpen === g.id || this.gsFocus === g.id ? " is-open" : "") },
        h("span", { class: "spll-gsearch-box" },
          h("input", {
            class: "spll-gsearch",
            type: "text",
            placeholder: `Search ${g.name}`,
            value: q,
            "data-fkey": `gs:${g.id}`,
            "data-act": "gsearch",
            spellcheck: "false",
          }),
          q ? h("button", { class: "spll-icon spll-search-clear spll-gsearch-clear", "data-act": "gsearch-clear", title: "Clear search", text: "×" }) : null,
        ),
        h("span", { class: "spll-gsearch-icon", "data-tip": "plain", "data-tiptext": q ? `Searching “${q}” in ${g.name}` : `Search ${g.name}` }, icon("search")),
      ),
      g.virtual
        ? h("span", { class: "spll-icon spll-gmenu-blank" })
        : h("button", { class: "spll-icon", "data-act": "gmenu", title: "Group options", text: "⋯" }),
    ), key);
  }

  renderActive() {
    const s = this.state;
    const el = this.activeEl;
    // keep the list where you'd scrolled it (changing a strength used to jump back to the top)
    const old = el.querySelector(".spll-active-list");
    if (old) this.activeScroll = old.scrollTop;
    el.innerHTML = "";
    el.append(h("div", { class: "spll-section-title" },
      h("span", { text: `Enabled · ${this.loadList().length}` }),
      h("button", { class: "spll-fav-menu-btn", "data-act": "active-menu", "data-tip": "favmenu" },
        h("span", { class: "spll-fmb-text", text: "Quick Menu" }),
        icon("bolt", "spll-fmb-icon")),
    ));
    const list = h("div", { class: "spll-active-list spll-scroll", "data-zone": "active", style: { maxHeight: ACTIVE_MAX_ROWS * ROW_H + 2 + "px" } });
    const rows = this.enabledRows();
    if (!rows.length) list.append(h("div", { class: "spll-empty", text: "No LoRAs enabled" }));
    // ENABLED always alternates with the two alternating colours, at the same strength as group bars; the
    // coloured line on the left (the LoRA's group colour) shows only when groups use individual colours
    const st = s.settings;
    const owners = this.mixOwners();
    let i = 0;
    const stripe = (row) => {
      row.classList.add("spll-en-row");
      row.style.setProperty("--spll-stripe", i++ % 2 ? st.colorB : st.colorA);
      if (st.colorMode === "alternating") row.style.setProperty("--spll-color", "transparent");
      return row;
    };
    for (const r of rows) {
      if (r.a?.mix) { list.append(this.mixBox(r.a, owners, stripe)); continue; }
      const row = stripe(r.a ? this.loraRow(r.a.path, "active") : this.fadeRow(r.f));
      if (r.a) row.dataset.akey = r.a.path;
      list.append(row);
    }
    el.append(list);
    this.fitFavButton();
    list.scrollTop = this.activeScroll || 0;
    list.addEventListener("scroll", () => { this.activeScroll = list.scrollTop; }, { passive: true });
  }

  /** A mix in ENABLED: its name row (switch, Saved/Unsaved, Save), then its LoRAs at the mix's own strengths. */
  mixBox(a, owners, stripe) {
    const m = this.mixById(a.mix);
    const dirty = this.mixDirty(m.id);
    const items = this.mixItems(m.id);
    const box = h("div", {
      class: "spll-mix-box" + (a.on ? " is-on" : " is-off") + (dirty ? " is-dirty" : "") + (m.collapsed ? " is-collapsed" : ""),
      "data-akey": `m:${m.id}`, "data-mixid": m.id, style: { "--spll-mix": m.color || null },
    });
    box.append(h("div", { class: "spll-row spll-mix-head", "data-mixid": m.id },
      h("button", { class: "spll-caret", "data-act": "mix-collapse", title: m.collapsed ? "Expand" : "Collapse", text: m.collapsed ? "▸" : "▾" }),
      h("button", {
        class: "spll-switch spll-mix-switch" + (a.on ? " on" : " is-red"),
        title: a.on ? "Switch the mix off" : "Switch the mix on",
        "data-act": "mix-toggle",
        "aria-pressed": a.on ? "true" : "false",
      }, h("span")),
      h("span", { class: "spll-mix-name", text: `Mix: ${m.name}`, "data-tip": "plain",
        "data-tiptext": `Mix · ${items.length} LoRA${items.length === 1 ? "" : "s"}${a.on ? "" : " · switched off (not loading)"}. Hold to drag; right-click for options.` }),
      m.collapsed ? h("span", { class: "spll-count", text: String(items.length) }) : null,
      h("span", { class: "spll-mix-state", text: dirty ? "Unsaved" : "Saved" }),
      h("button", { class: "spll-mix-save", "data-act": "mix-save", disabled: !dirty, title: dirty ? "Save these strengths and switches into the mix" : "Nothing to save", text: "Save" }),
    ));
    if (m.collapsed) return box;
    if (!items.length) box.append(h("div", { class: "spll-empty spll-mix-empty", text: "Empty mix. Right-click a LoRA → Add to mix." }));
    for (const it of items) {
      box.append(stripe(this.loraRow(it.path, "mix", 0, { id: m.id, item: it, on: a.on, owner: owners.get(it.path) || null })));
    }
    return box;
  }

  /** "Quick Menu" as text, or just ⚡ in narrow mode (or when it doesn't fit). */
  fitFavButton() {
    const title = this.activeEl.querySelector(".spll-section-title");
    if (!title) return;
    // narrow mode always shows the ⚡ icon; otherwise only when the text doesn't fit
    const w = this.el.offsetWidth;
    title.classList.toggle("is-narrow", !!w && w < NARROW_AT);
    if (!title.classList.contains("is-narrow") && title.scrollWidth > title.clientWidth + 1) title.classList.add("is-narrow");
  }

  fadeRow(f) {
    const el = h("div", {
      class: "spll-row spll-fading" + (f.paused ? " is-paused" : ""),
      "data-fpath": f.p,
      style: { animationDelay: `-${this.fadeElapsed(f)}ms` },
    },
      h("span", { class: "spll-fade-undo", text: "↶" }),
      h("span", { class: "spll-name", text: this.displayName(f.p) }),
      h("span", { class: "spll-fade-note", text: "Switched off · click to undo" }),
      h("span", { class: "spll-fade-str", text: fmt(f.strength) }),
    );
    el.addEventListener("pointerenter", () => { this.pauseFade(f.p, true); el.classList.add("is-paused"); });
    el.addEventListener("pointerleave", () => { this.pauseFade(f.p, false); el.classList.remove("is-paused"); });
    return el;
  }

  flatten() {
    // Outer list items: group headers, group-search results, and one box per open group holding
    // that group's own LoRAs (up to "rows per group", then it scrolls by itself).
    const rows = [];
    const m = this.m;
    const N = this.state.settings.listHeight; // 0 = unlimited
    if (this.selectMode) {
      // every group at every level, bars only, whatever is open now
      const all = (parentKey, depth) => {
        for (const g of m.childGroups.get(parentKey) || []) {
          rows.push({ type: "group", key: `g:${g.id}`, g, depth, h: ROW_H });
          all(g.id, depth + 1);
        }
      };
      all("", 0);
      if (this.selectMode.all.has(UNGROUPED)) rows.push({ type: "group", key: `g:${UNGROUPED}`, g: this.ungroupedGroup(), depth: 0, h: ROW_H });
      return rows;
    }
    if (this.isFlat()) {
      // the plain list: every listed LoRA in one box, in its own sort (scrolls with the section)
      const paths = this.flatPaths();
      if (paths.length) rows.push({ type: "box", key: "b:__flat", g: { id: "__flat", virtual: true }, depth: 0, paths, flat: true, h: paths.length * ROW_H + 2 });
      return rows;
    }
    const walk = (parentKey, depth) => {
      for (const g of m.childGroups.get(parentKey) || []) {
        rows.push({ type: "group", key: `g:${g.id}`, g, depth, h: ROW_H });
        if (!g.collapsed) {
          walk(g.id, depth + 1); // subgroups first, like folders
          const paths = m.lorasIn.get(g.id) || [];
          if (paths.length) {
            const visible = N === 0 ? paths.length : Math.min(N, paths.length);
            rows.push({ type: "box", key: `b:${g.id}`, g, depth: depth + 1, paths, h: visible * ROW_H + 2 });
          }
        }
      }
    };
    walk("", 0);
    // LoRAs in no group (added on their own, or taken out of every group)
    const ung = m.lorasIn.get(UNGROUPED) || [];
    const vg = this.ungroupedGroup();
    if (m.hasGroups) {
      if (ung.length) {
        rows.push({ type: "group", key: `g:${UNGROUPED}`, g: vg, depth: 0, h: ROW_H });
        if (!vg.collapsed) {
          const visible = N === 0 ? ung.length : Math.min(N, ung.length);
          rows.push({ type: "box", key: `b:${UNGROUPED}`, g: vg, depth: 1, paths: ung, h: visible * ROW_H + 2 });
        }
      }
    } else {
      // no groups: the list is DISABLED, the LoRAs that aren't switched on
      const dis = ung.filter((p) => !this.isActive(p));
      if (dis.length) {
        const visible = N === 0 ? dis.length : Math.min(Math.max(N, 12), dis.length);
        rows.push({ type: "box", key: `b:${UNGROUPED}`, g: vg, depth: 0, paths: dis, h: visible * ROW_H + 2 });
      }
    }
    return rows;
  }

  /** GROUPS is showing the plain list (only when there are groups; DISABLED is already a plain list). */
  isFlat() { return !!this.state.settings.flatList && !!this.m?.hasGroups; }

  /** Every listed LoRA (unlisted ones stay hidden), in the plain list's sort. */
  flatPaths() {
    const all = [...this.m.lorasIn.values()].flat();
    const mode = this.state.settings.flatSort;
    const name = (p) => this.displayName(p);
    const cmp = (a, b) => name(a).localeCompare(name(b), undefined, { numeric: true, sensitivity: "base" });
    const time = (p) => this.files.get(p)?.t || 0;
    if (mode === "za") return all.sort((a, b) => cmp(b, a));
    if (mode === "new") return all.sort((a, b) => time(b) - time(a) || cmp(a, b));
    if (mode === "old") return all.sort((a, b) => time(a) - time(b) || cmp(a, b));
    return all.sort(cmp);
  }

  /** The "Ungrouped" section behaves like a group in the list, but isn't one. */
  ungroupedGroup() {
    return { id: UNGROUPED, name: "Ungrouped", parent: null, folder: null, color: null, collapsed: this.state.settings.ungroupedCollapsed, virtual: true };
  }

  resultsLines(res) {
    const R = this.state.settings.dropdownRows;
    let lines = res.loras.length;
    for (const gid of res.groups) lines += 1 + Math.min(R, Math.max(1, (this.m.lorasIn.get(gid) || []).length));
    return Math.max(1, lines);
  }
  resultsHeight(res) {
    return Math.min(this.state.settings.dropdownRows, this.resultsLines(res)) * ROW_H;
  }

  /** The GROUPS line: title, the expand / collapse / select / sort buttons, and what the node loads. In select mode, the select bar. */
  renderSelBar() {
    const s = this.state;
    const el = this.treeTitleEl;
    el.innerHTML = "";
    el.classList.toggle("is-selecting", !!this.selectMode);
    const sm = this.selectMode;
    if (sm) {
      el.classList.remove("is-narrow");
      const btn = (act, icon, label, extra = {}) => h("button", { class: "spll-btn spll-btn-sm spll-sel-btn" + (extra.primary ? " is-primary" : ""), "data-act": act, title: label },
        h("span", { class: "spll-sel-icon", text: icon }), h("span", { class: "spll-sel-label", text: label }));
      el.append(
        h("span", { class: "spll-sel-count", text: `${sm.ticks.size} of ${sm.all.size} ticked` }),
        h("div", { class: "spll-sel-tools" },
          sm.ticks.size ? btn("sel-all", "☐", "Untick all") : btn("sel-all", "☑", "Tick all"),
          btn("sel-invert", "⇄", "Invert"),
          btn("sel-apply", "✓", "Apply", { primary: true }),
          btn("sel-cancel", "✕", "Cancel"),
        ),
      );
      // icons only when the labels don't fit on one line
      if (el.scrollWidth > el.clientWidth + 1) el.classList.add("is-narrow");
      return;
    }
    const tool = (act, iconName, tip) => h("button", { class: "spll-icon spll-title-tool", "data-act": act, "data-tip": "plain", "data-tiptext": tip }, icon(iconName));
    const nf = s.sources.folders.length;
    const nl = s.sources.loras.length;
    // clicking the title line (not its buttons) folds the whole section away
    const collapsed = !!s.settings.groupsCollapsed;
    el.classList.add("is-collapsible");
    el.classList.toggle("is-collapsed", collapsed);
    el.append(
      h("span", { class: "spll-title-caret", text: collapsed ? "▸" : "▾" }),
      h("span", { class: "spll-title-text", text: this.isFlat() ? `All LoRAs · ${this.flatPaths().length}`
        : this.m.hasGroups ? `Groups · ${(this.m.childGroups.get("") || []).length}` : `Disabled · ${(this.m.lorasIn.get(UNGROUPED) || []).filter((p) => !this.isActive(p)).length}` }),
      this.m.hasGroups
        ? h("div", { class: "spll-title-tools" },
            this.isFlat() ? null : tool("expand-all", "expandAll", "Expand all groups"),
            this.isFlat() ? null : tool("collapse-all", "collapseAll", "Collapse all groups"),
            this.isFlat() ? null : tool("select-groups", "selectGroups", "Select groups: tick the ones to have open, then Apply"),
            tool("groups-sort", "sortAz", this.isFlat() ? "Sort the list" : "Sort the top-level groups"),
            (() => { const b = tool("flat-toggle", "flatList", this.isFlat() ? "Show the groups" : "Show every LoRA as one plain list"); b.classList.toggle("is-on", this.isFlat()); return b; })(),
          )
        : null,
      h("span", { class: "spll-root-label", title: s.sources.folders.map((f) => this.fullPath(f.key)).join("\n") || "No folders added",
        text: [nf ? `Folder trees: ${nf}` : "", nl ? `Single LoRAs: ${nl}` : ""].filter(Boolean).join(" · ") }),
      h("div", { class: "spll-top-drop", "data-zone": "top", text: "Drop here for top level" }),
    );
  }

  /** Fold the GROUPS section away (the node shrinks to fit) or bring it back (at the height it had). */
  toggleGroupsCollapsed(open = null) {
    const node = this.node;
    const collapse = open === null ? !this.state.settings.groupsCollapsed : !open;
    if (collapse === !!this.state.settings.groupsCollapsed) return;
    const before = node.size?.[1];
    this.commit((s) => {
      if (collapse && before) s.settings.groupsHeight = before;
      s.settings.groupsCollapsed = collapse;
    });
    try {
      const min = node.computeSize?.()?.[1];
      if (min) {
        const target = collapse ? min : Math.max(min, this.state.settings.groupsHeight || min);
        node.setSize([node.size[0], target]);
        node.setDirtyCanvas?.(true, true);
      }
    } catch { /* */ }
    this.lastHeight = 0;
    this.syncSize();
    if (!collapse) requestAnimationFrame(() => this.renderTreeWindow(true));
  }

  /** A group's bar in select mode: a tick, its name and count, and "All inside" if it has subgroups. */
  selGroupRow(g) {
    const sm = this.selectMode;
    const on = sm.ticks.has(g.id);
    const parentOff = g.id !== UNGROUPED && this.ancestors(g.id).some((a) => !sm.ticks.has(a));
    const kids = g.id === UNGROUPED ? 0 : (this.m.childGroups.get(g.id) || []).length;
    const n = g.id === UNGROUPED ? (this.m.lorasIn.get(UNGROUPED) || []).length : this.m.counts.get(g.id) || 0;
    return h("div", {
      class: "spll-row spll-group spll-sel-row" + (on ? " is-ticked" : "") + (parentOff ? " is-under-closed" : ""),
      "data-gid": g.id,
      style: { "--spll-color": this.colorOf(g.id) || "transparent" },
      title: parentOff ? "Its parent is unticked, so it stays hidden either way" : "",
    },
      h("input", { type: "checkbox", class: "spll-sel-check", checked: on, tabindex: "-1" }),
      h("span", { class: "spll-gname", text: g.name }),
      h("span", { class: "spll-count", text: String(n) }),
      kids ? h("button", { class: "spll-btn spll-btn-sm spll-sel-inside", "data-act": "sel-inside", title: "Tick or untick this group and everything inside it", text: "All inside" }) : null,
    );
  }

  renderTree() {
    const s = this.state;
    this.renderSelBar();
    this.flat = this.flatten();
    this.offsets = [];
    let y = 0;
    for (const r of this.flat) { this.offsets.push(y); y += r.h; }
    this.flatHeight = y;
    this.spacerEl.style.height = y + "px";
    this.renderTreeWindow(true);
  }

  renderTreeWindow(force) {
    if (!this.flat) return;
    const focus = force ? null : this.captureFocus();
    const top = this.treeEl.scrollTop;
    const viewH = this.treeEl.clientHeight || 12 * ROW_H;
    const over = 6 * ROW_H;
    let first = 0;
    while (first < this.flat.length && this.offsets[first] + this.flat[first].h < top - over) first++;
    let last = first;
    while (last < this.flat.length && this.offsets[last] < top + viewH + over) last++;
    const range = `${first}:${last}`;
    if (!force && range === this.lastRange) return;
    this.lastRange = range;
    // On a plain scroll, items that stay in view are kept (so clicks and focus aren't interrupted);
    // after a data change (force) everything is rebuilt.
    const next = new Map();
    if (!this.flat.length) {
      const empty = h("div", { class: "spll-row spll-empty spll-abs", style: { top: "0px" }, text: this.scanned ? "No groups yet" : "" });
      this.treeEl.append(empty);
      next.set("empty", empty);
    }
    for (let i = first; i < last; i++) {
      const r = this.flat[i];
      let el = force ? null : this.rowEls.get(r.key);
      if (!el) {
        let inner;
        if (r.type === "group") inner = this.groupRow(r.g, 0);
        else if (r.type === "box") inner = this.loraBox(r);
        else inner = this.resultsBox(r.res, { scopeGid: r.g.id, depth: 0, color: this.colorOf(r.g.id) });
        el = h("div", { class: "spll-item spll-abs", style: { "--d": String(r.depth) } }, inner);
        this.treeEl.append(el);
        inner._spllMounted?.();
      }
      el.style.top = this.offsets[i] + "px";
      el.style.height = r.h + "px";
      next.set(r.key, el);
    }
    for (const [key, el] of this.rowEls) if (next.get(key) !== el) el.remove();
    this.rowEls = next;
    this.restoreFocus(focus);
  }

  /** A group's own LoRAs: shows up to "rows per group" rows, then scrolls by itself (only visible rows are drawn). */
  loraBox(r) {
    const g = r.g;
    const paths = r.paths;
    const unlimited = r.flat || this.state.settings.listHeight === 0;
    const innerH = r.h - 2;
    const box = h("div", { class: "spll-box", "data-box": g.id, style: { "--spll-color": this.colorOf(g.id) || "transparent" } });
    const sc = h("div", { class: "spll-box-scroll" + (unlimited ? "" : " spll-scroll"), style: { height: innerH + "px" } });
    sc.append(h("div", { style: { height: paths.length * ROW_H + "px" } }));
    box.append(sc);
    let rows = new Map();
    let lastRange = "";
    const renderWindow = (force) => {
      const focus = force ? null : this.captureFocus();
      const top = unlimited ? 0 : sc.scrollTop;
      const first = unlimited ? 0 : Math.max(0, Math.floor(top / ROW_H) - 4);
      const last = unlimited ? paths.length : Math.min(paths.length, Math.ceil((top + innerH) / ROW_H) + 4);
      const range = `${first}:${last}`;
      if (!force && range === lastRange) return;
      lastRange = range;
      const next = new Map();
      for (let i = first; i < last; i++) {
        const p = paths[i];
        let row = force ? null : rows.get(p);
        if (!row) {
          row = this.loraRow(p, "tree", 0);
          row.classList.add("spll-abs");
          sc.append(row);
        }
        row.style.top = i * ROW_H + "px";
        next.set(p, row);
      }
      for (const [p, row] of rows) if (next.get(p) !== row) row.remove();
      rows = next;
      this.restoreFocus(focus);
    };
    sc.addEventListener("scroll", () => {
      this.boxScroll.set(g.id, sc.scrollTop);
      renderWindow(false);
    }, { passive: true });
    // scrollTop can only be restored once the box is in the page
    box._spllMounted = () => {
      if (!unlimited) sc.scrollTop = this.boxScroll.get(g.id) || 0;
      renderWindow(true);
    };
    return box;
  }

  /** Search results: groups (with their LoRAs in a nested box) then LoRAs. */
  resultsBox(res, { scopeGid = null, depth = 0, color = null } = {}) {
    const R = this.state.settings.dropdownRows;
    const box = h("div", {
      class: "spll-results" + (scopeGid ? " spll-gresults" : ""),
      style: { paddingLeft: scopeGid ? 10 + depth * 14 + "px" : null, "--spll-color": color || "transparent" },
    });
    const inner = h("div", { class: "spll-results-inner spll-scroll", style: { maxHeight: this.resultsHeight(res) + "px" } });
    box.append(inner);
    if (!res.groups.length && !res.loras.length) {
      inner.append(h("div", { class: "spll-result spll-empty", text: "No matches" }));
      return box;
    }
    for (const gid of res.groups) {
      const g = this.m.byId.get(gid);
      inner.append(h("div", { class: "spll-result spll-result-group", "data-act": "reveal-group", "data-gid": gid, "data-tip": "plain", "data-tiptext": `Group: ${this.groupPath(gid)}` },
        h("span", { class: "spll-swatch", style: { background: this.colorOf(gid) || "var(--spll-muted)" } }),
        h("span", { class: "spll-result-name", text: g.name }),
        h("span", { class: "spll-result-path", text: this.groupPath(g.parent || "") || "top level" }),
        h("span", { class: "spll-count", text: String(this.m.counts.get(gid) || 0) }),
      ));
      const members = this.m.lorasIn.get(gid) || [];
      const nested = h("div", {
        class: "spll-nested spll-scroll",
        style: { maxHeight: Math.min(R, Math.max(1, members.length)) * ROW_H + "px" },
      });
      if (!members.length) nested.append(h("div", { class: "spll-result spll-empty", text: "No LoRAs directly in this group" }));
      for (const p of members) nested.append(this.resultLora(p, false));
      inner.append(nested);
    }
    for (const p of res.loras) inner.append(this.resultLora(p, true));
    return box;
  }

  resultLora(p, showPath) {
    const missing = this.missing.has(p);
    return h("div", {
      class: "spll-result spll-result-lora" + (missing ? " is-missing" : "") + (this.isActive(p) ? " is-on" : ""),
      "data-act": "reveal-lora",
      "data-path": p,
      "data-tip": "lora",
    },
      h("button", {
        class: "spll-switch spll-switch-sm" + (this.isActive(p) ? " on" : ""),
        "data-act": "toggle",
        disabled: missing,
        title: missing ? "LoRA file missing" : this.isActive(p) ? "Switch off" : "Switch on",
      }, h("span")),
      h("span", { class: "spll-result-name", text: this.displayName(p) }),
      showPath ? h("span", { class: "spll-result-path", text: folderText(p) }) : null,
    );
  }

  renderDropdown() {
    const q = this.mainQuery.trim();
    const show = !!q && this.mainOpen && !this.fileMode;
    this.dropdownEl.hidden = !show;
    const keepScroll = this.dropdownEl.querySelector(".spll-results-inner")?.scrollTop || 0;
    this.dropdownEl.innerHTML = "";
    if (!show) return;
    const res = this.search(q, null);
    const box = this.resultsBox(res);
    this.dropdownEl.append(box);
    const inner = box.querySelector(".spll-results-inner");
    if (inner) inner.scrollTop = keepScroll; // toggling a result keeps your place
    this.dropdownEl.style.top = this.headerEl.offsetTop + this.headerEl.offsetHeight + "px";
  }

  // --- overlays (menus, popups, settings, picker)
  renderOverlay() {
    const o = this.overlay;
    if (o) this.hideTip();
    const el = this.overlayEl;
    el.innerHTML = "";
    el.hidden = !o && !this.picker && this.state.setup;
    if (!this.state.setup || this.picker) {
      el.hidden = false;
      el.append(this.pickerSheet());
      const list = el.querySelector(".spll-picker-list");
      if (list && this.pickerScroll) list.scrollTop = this.pickerScroll;
      list?.addEventListener("scroll", () => { this.pickerScroll = list.scrollTop; }, { passive: true });
      return;
    }
    if (!o) return;
    if (o.kind === "settings") return void el.append(this.settingsSheet());
    if (o.kind === "unlisted") return void el.append(this.unlistedSheet());
    if (o.kind === "favhist") return void el.append(this.favHistSheet());
    const pop = h("div", { class: "spll-pop" });
    if (o.kind === "menu") {
      if (o.title) pop.append(h("div", { class: "spll-pop-title", text: o.title }));
      o.items.forEach((it, i) => {
        if (it === "-") return void pop.append(h("div", { class: "spll-sep" }));
        pop.append(h("button", { class: "spll-menu-item" + (it.danger ? " is-danger" : ""), "data-act": "menu", "data-i": i, text: it.label }));
      });
    } else if (o.kind === "prompt") {
      pop.append(
        h("div", { class: "spll-pop-title", text: o.title }),
        h("input", { class: "spll-pop-input", type: "text", value: o.value || "", "data-fkey": "prompt", "data-act": "prompt-input", spellcheck: "false", placeholder: o.placeholder || "" }),
        h("div", { class: "spll-pop-buttons" },
          h("button", { class: "spll-btn", "data-act": "close", text: "Cancel" }),
          h("button", { class: "spll-btn is-primary", "data-act": "prompt-ok", text: o.okLabel || "OK" }),
        ),
      );
      queueMicrotask(() => {
        const inp = pop.querySelector(".spll-pop-input");
        if (inp && document.activeElement !== inp && !o.focused) { o.focused = true; inp.focus(); inp.select(); }
      });
    } else if (o.kind === "color") {
      const g = this.m.byId.get(o.gid);
      pop.append(h("div", { class: "spll-pop-title", text: `Colour for “${g?.name}”` }));
      const grid = h("div", { class: "spll-swatches" });
      for (const c of PALETTE) {
        grid.append(h("button", { class: "spll-swatch-btn" + (g?.color === c ? " is-on" : ""), style: { background: c }, "data-act": "pick-color", "data-color": c, title: c }));
      }
      pop.append(grid,
        h("div", { class: "spll-pop-row" },
          h("label", { class: "spll-label", text: "Custom" }),
          h("input", { type: "color", class: "spll-color-input", value: g?.color || "#3f9fd6", "data-act": "custom-color" }),
        ),
        h("div", { class: "spll-pop-buttons" },
          h("button", { class: "spll-btn", "data-act": "pick-color", "data-color": "", text: g?.parent ? "Use parent's colour" : "No colour" }),
          h("button", { class: "spll-btn is-primary", "data-act": "close", text: "Done" }),
        ),
      );
    } else if (o.kind === "triggers") {
      pop.classList.add("spll-pop-wide");
      const st = this.trigState(o.path);
      const words = this.triggersOf(o.path);
      pop.append(h("div", { class: "spll-pop-title", text: `Trigger words · ${this.displayName(o.path)}` }));
      if (words.length) {
        // pick the words you want; nothing picked means "all"
        const chips = h("div", { class: "spll-chips" });
        for (const w of words) {
          chips.append(h("button", { class: "spll-chip" + (o.sel.includes(w) ? " is-sel" : ""), "data-act": "trig-chip", "data-word": w, text: w }));
        }
        pop.append(chips, h("div", { class: "spll-pop-buttons" },
          h("button", { class: "spll-btn", "data-act": "close", text: "Close" }),
          h("button", { class: "spll-btn is-primary", "data-act": "trig-copy", text: o.sel.length ? `Copy Selected (${o.sel.length})` : "Copy All" }),
        ));
      } else {
        pop.append(
          h("input", { class: "spll-pop-input spll-trig-input", type: "text", placeholder: "Add your own, e.g. my style, soft light", "data-fkey": "trig-input", "data-act": "trig-input", spellcheck: "false" }),
          h("label", { class: "spll-check spll-notrig" },
            h("input", { type: "checkbox", checked: st === "notrig", "data-act": "trig-notrig" }),
            " No trigger words (stop showing red)"),
          h("div", { class: "spll-pop-buttons" },
            h("button", { class: "spll-btn", "data-act": "close", text: "Cancel" }),
            h("button", { class: "spll-btn is-primary", "data-act": "trig-save", text: "Save" }),
          ),
        );
        queueMicrotask(() => {
          const inp = pop.querySelector(".spll-trig-input");
          if (inp && !o.focused) { o.focused = true; inp.focus(); }
        });
      }
    } else if (o.kind === "copy") {
      pop.classList.add("spll-pop-wide");
      pop.append(
        h("div", { class: "spll-pop-title", text: "Your browser blocked copying here. Press Ctrl+C to copy:" }),
        h("textarea", { class: "spll-pop-input spll-copy-text", rows: "3", "data-act": "copy-text", readonly: true, spellcheck: "false" }, o.text),
        h("div", { class: "spll-pop-buttons" }, h("button", { class: "spll-btn", "data-act": "copy-close", text: "Done" })),
      );
      queueMicrotask(() => {
        const ta = pop.querySelector("textarea");
        if (ta && !o.focused) { o.focused = true; ta.focus(); ta.select(); }
      });
    } else if (o.kind === "mixcolor") {
      const m = this.mixById(o.mixId);
      pop.append(h("div", { class: "spll-pop-title", text: `Colour for “Mix: ${m?.name}”` }), this.mixColorEl(m, "mix-pick-color", "mix-custom-color"));
      pop.append(h("div", { class: "spll-pop-buttons" }, h("button", { class: "spll-btn is-primary", "data-act": "close", text: "Done" })));
    } else if (o.kind === "flatsort") {
      const cur = this.state.settings.flatSort;
      pop.append(h("div", { class: "spll-pop-title", text: "Sort the list" }));
      for (const [k, label] of [["az", "A to Z"], ["za", "Z to A"], ["new", "Newest file first"], ["old", "Oldest file first"]]) {
        pop.append(h("button", { class: "spll-menu-item spll-sort-opt" + (k === cur ? " is-current" : ""), "data-act": "flat-sort-pick", "data-mode": k },
          h("span", { class: "spll-tick", text: k === cur ? "✓" : "" }), h("span", { text: label })));
      }
    } else if (o.kind === "sort") {
      const cur = this.state.sorts[o.container] || "az";
      const own = o.container === "" ? "the top-level groups (and Ungrouped)" : `“${this.groupPath(o.container)}”`;
      pop.append(h("div", { class: "spll-pop-title", text: `Sort ${own}` }));
      const opts = [
        ["az", "A to Z (keeps your moves)"], ["za", "Z to A"], ["new", "Newest file first"], ["old", "Oldest file first"],
      ];
      for (const [k, label] of opts) {
        pop.append(h("button", { class: "spll-menu-item spll-sort-opt" + (k === cur ? " is-current" : ""), "data-act": "sort-pick", "data-mode": k },
          h("span", { class: "spll-tick", text: k === cur ? "✓" : "" }), h("span", { text: label })));
      }
      pop.append(h("div", { class: "spll-sep" }),
        h("button", { class: "spll-menu-item spll-sort-opt", "data-act": "sort-pick", "data-mode": "strict", title: "Re-sort everything A to Z and forget the order you dragged into" },
          h("span", { class: "spll-tick" }), h("span", { text: "Strict A to Z (forget my moves)" })),
        h("label", { class: "spll-check spll-sort-sub" },
          h("input", { type: "checkbox", checked: !!o.sub, "data-act": "sort-sub" }), o.container === "" ? " Also apply to every group" : " Also apply to subgroups"),
        h("div", { class: "spll-hint", text: "Groups inside are kept A to Z by name; the file-date sorts apply to LoRAs. Drag to rearrange: under another sort, that switches back to A to Z with your moves kept." }),
      );
    } else if (o.kind === "move") {
      pop.classList.add("spll-pop-wide");
      pop.append(
        h("div", { class: "spll-pop-title", text: o.title }),
        h("input", { class: "spll-pop-input", type: "text", placeholder: "Filter groups…", value: o.filter || "", "data-fkey": "move-filter", "data-act": "move-filter", spellcheck: "false" }),
      );
      const list = h("div", { class: "spll-move-list spll-scroll" });
      const f = (o.filter || "").toLowerCase();
      const excluded = o.gid ? new Set([o.gid, ...this.descendants(o.gid)]) : new Set();
      if (o.gid && !f) list.append(h("button", { class: "spll-menu-item", "data-act": "move-to", "data-target": "", text: "⤒ Top level" }));
      if (o.path && !f && o.current !== UNGROUPED) list.append(h("button", { class: "spll-menu-item", "data-act": "move-to", "data-target": UNGROUPED, text: "Ungrouped (no group)" }));
      const walk = (key, depth) => {
        for (const g of this.m.childGroups.get(key) || []) {
          if (excluded.has(g.id)) continue;
          const path = this.groupPath(g.id);
          if (!f || path.toLowerCase().includes(f)) {
            list.append(h("button", {
              class: "spll-menu-item" + (g.id === o.current ? " is-current" : ""),
              "data-act": "move-to", "data-target": g.id,
              style: { paddingLeft: 8 + (f ? 0 : depth * 12) + "px" },
              title: path,
            }, h("span", { class: "spll-swatch", style: { background: this.colorOf(g.id) || "var(--spll-muted)" } }), f ? path : g.name));
          }
          walk(g.id, depth + 1);
        }
      };
      walk("", 0);
      pop.append(list, h("div", { class: "spll-pop-buttons" }, h("button", { class: "spll-btn", "data-act": "close", text: "Cancel" })));
      queueMicrotask(() => {
        const inp = pop.querySelector(".spll-pop-input");
        if (inp && !o.focused) { o.focused = true; inp.focus(); }
      });
    }
    el.append(pop);
    // position near the click, kept inside the node
    const W = this.el.clientWidth;
    const Ht = this.el.clientHeight;
    pop.style.left = "0px";
    pop.style.top = "0px";
    requestAnimationFrame(() => {
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let x = o.x === undefined ? (W - pw) / 2 : o.alignRight ? o.x - pw : o.x;
      // under its button if it fits, else above it, else beside it, so the button that opened it stays clickable
      let y = o.y ?? 40;
      if (o.above !== undefined && y + ph > Ht - 4) {
        if (o.above - ph >= 4) y = o.above - ph;
        else x = o.left - pw;
      }
      pop.style.left = clamp(x, 4, Math.max(4, W - pw - 4)) + "px";
      pop.style.top = clamp(y, 4, Math.max(4, Ht - ph - 4)) + "px";
    });
  }

  settingsSheet() {
    const s = this.state;
    const unlimited = s.settings.listHeight === 0;
    const tab = SETTINGS_TABS.some((t) => t.id === this.settingsTab) ? this.settingsTab : "sources";
    const field = (label, ...kids) => h("div", { class: "spll-field" }, label ? h("label", { class: "spll-label", text: label }) : null, ...kids);
    const body = [];
    if (tab === "sources") {
      body.push(field("What this node loads",
        ...s.sources.folders.map((f) => h("div", { class: "spll-field-row spll-source-row", title: this.fullPath(f.key) },
          h("span", { class: "spll-picker-icon", text: "📁" }),
          h("code", { class: "spll-code", text: lorasLabel(f.key) }),
          this.missingFolders.has(f.key) ? h("span", { class: "spll-tag is-warn", text: "missing" }) : null,
          h("span", { class: "spll-hint spll-source-path", text: this.basePath(baseOf(f.key)) }),
          h("button", { class: "spll-btn spll-btn-sm", "data-act": "remove-folder", "data-key": f.key, text: "Remove" }),
        )),
        s.sources.loras.length
          ? h("div", { class: "spll-hint", text: `${s.sources.loras.length} LoRA${s.sources.loras.length > 1 ? "s" : ""} added on their own (right-click one → Remove from node).` })
          : null,
        h("div", { class: "spll-field-row" }, h("button", { class: "spll-btn", "data-act": "change-root", text: "Add folders or LoRAs…" })),
      ));
    } else if (tab === "display") {
      body.push(
        field("Rows per group",
          h("div", { class: "spll-field-row" },
            h("input", { class: "spll-num-input", type: "number", min: "1", max: "200", value: String(unlimited ? 12 : s.settings.listHeight), disabled: unlimited, "data-act": "set-list-height", "data-fkey": "set-lh" }),
            h("label", { class: "spll-check" }, h("input", { type: "checkbox", checked: unlimited, "data-act": "set-unlimited" }), " Unlimited"),
          ),
          h("span", { class: "spll-hint", text: "Rows each open group shows before it scrolls by itself. Unlimited shows every LoRA in a group. Resize the node to show more or fewer groups." }),
        ),
        field("Dropdown rows",
          h("div", { class: "spll-field-row" },
            h("input", { class: "spll-num-input", type: "number", min: "1", max: "50", value: String(s.settings.dropdownRows), "data-act": "set-dropdown-rows", "data-fkey": "set-dd" }),
            h("span", { class: "spll-hint", text: "Rows a search dropdown shows before it scrolls" }),
          ),
        ),
        field("Group colours",
          h("div", { class: "spll-field-row" },
            h("label", { class: "spll-check" },
              h("input", { type: "radio", name: `spll-cm-${this.node.id}`, value: "individual", checked: s.settings.colorMode === "individual", "data-act": "set-color-mode" }), " Individual"),
            h("label", { class: "spll-check" },
              h("input", { type: "radio", name: `spll-cm-${this.node.id}`, value: "alternating", checked: s.settings.colorMode === "alternating", "data-act": "set-color-mode" }), " Alternating"),
          ),
          s.settings.colorMode === "alternating"
            ? h("span", { class: "spll-hint", text: "Groups alternate between the two colours below among their siblings at each level." })
            : h("span", { class: "spll-hint", text: "Set each group's colour from its ⋯ menu." }),
        ),
        field("Alternating colours",
          h("div", { class: "spll-field-row" },
            h("input", { type: "color", class: "spll-color-input", value: s.settings.colorA, "data-act": "set-color-a", title: "First colour" }),
            h("input", { type: "color", class: "spll-color-input", value: s.settings.colorB, "data-act": "set-color-b", title: "Second colour" }),
          ),
          h("span", { class: "spll-hint", text: "Always used for ENABLED; for groups when Alternating is chosen." }),
        ),
        field(null, h("label", { class: "spll-check" },
          h("input", { type: "checkbox", checked: s.settings.blur, "data-act": "set-blur" }), " Blur example images and videos until clicked")),
        this.hlSettingsEl(),
      );
    } else if (tab === "lists") {
      const list = h("div", { class: "spll-unlisted-list" });
      for (const gid of s.unlisted.groups) {
        const g = this.m.byId.get(gid);
        if (!g) continue;
        list.append(h("div", { class: "spll-unlisted-item" },
          h("span", { class: "spll-tag", text: "Group" }),
          h("span", { class: "spll-picker-name", text: this.groupPath(gid) }),
          h("button", { class: "spll-btn spll-btn-sm", "data-act": "relist", "data-kind": "group", "data-key": gid, text: "Relist" })));
      }
      for (const p of s.unlisted.loras) {
        list.append(h("div", { class: "spll-unlisted-item", title: this.fullPath(p) },
          h("span", { class: "spll-tag", text: "LoRA" }),
          h("span", { class: "spll-picker-name", text: this.displayName(p) }),
          h("span", { class: "spll-picker-path", text: folderText(p) }),
          h("button", { class: "spll-btn spll-btn-sm", "data-act": "relist", "data-kind": "lora", "data-key": p, text: "Relist" })));
      }
      if (!list.childElementCount) list.append(h("div", { class: "spll-hint", text: "Nothing is unlisted. Right-click a LoRA or use a group's ⋯ menu to unlist it." }));
      body.push(
        field("History",
          h("div", { class: "spll-field-row" },
            h("input", { class: "spll-num-input", type: "number", min: "1", max: "500", value: String(s.settings.historyLength || 30), disabled: !s.settings.historyLength, "data-act": "set-history-length", "data-fkey": "set-hl" }),
            h("span", { class: "spll-hint", text: "entries" }),
            h("label", { class: "spll-check" }, h("input", { type: "checkbox", checked: !s.settings.historyLength, "data-act": "set-history-off" }), " Off"),
            h("button", { class: "spll-btn", "data-act": "clear-history", disabled: !s.history.length, text: `Clear history (${s.history.length})` }),
          ),
          h("span", { class: "spll-hint", text: "LoRAs you switch off. Right-click ENABLED (or press ★ there) for Favourites and History." }),
        ),
        field(`Unlisted LoRAs and groups (${s.unlisted.loras.length + s.unlisted.groups.length})`,
          h("span", { class: "spll-hint", text: "Hidden from the list, search, favourites and history. Relisting puts them back where they were." }),
          list,
        ),
      );
    } else if (tab === "favs") {
      body.push(this.tierSettingsEl());
    } else if (tab === "info") {
      body.push(
        field("Civitai API key (optional)",
          h("div", { class: "spll-field-row" },
            h("input", { class: "spll-pop-input spll-key-input", type: "password", value: getApiKey(), placeholder: "Only needed for some models", autocomplete: "off", "data-act": "set-api-key", "data-fkey": "set-key", spellcheck: "false" }),
          ),
          h("span", { class: "spll-hint", text: "Saved in your ComfyUI user settings, never in workflows." }),
        ),
        field("Trigger words",
          h("div", { class: "spll-field-row" },
            h("button", { class: "spll-btn", "data-act": "no-trigger-all", text: "No Trigger All" }),
            h("span", { class: "spll-hint", text: "Marks every LoRA with a red T as having no trigger words." }),
          ),
        ),
      );
    } else if (tab === "file") {
      body.push(field("Layout file",
        h("div", { class: "spll-field-row" },
          h("button", { class: "spll-btn", "data-act": "export-layout", text: "Export layout…" }),
          h("button", { class: "spll-btn", "data-act": "import-layout", text: "Import layout…" }),
        ),
        h("span", { class: "spll-hint", text: "Groups, colours, order, nicknames, unlisted items, favourites and history, to reuse in another workflow." }),
      ));
    }
    // the title, × and tabs stay put; only the tab's contents scroll
    return h("div", { class: "spll-sheet spll-settings" },
      h("div", { class: "spll-sheet-title" },
        h("span", { text: "Settings" }),
        h("span", { class: "spll-build", text: BUILD }),
        h("button", { class: "spll-icon", "data-act": "close", title: "Close", text: "×" })),
      h("div", { class: "spll-tabs spll-scroll", role: "tablist" },
        ...SETTINGS_TABS.map((t) => h("button", { class: "spll-tab" + (t.id === tab ? " is-on" : ""), role: "tab", "data-act": "settings-tab", "data-tab": t.id, text: t.label }))),
      h("div", { class: "spll-settings-body spll-scroll" }, ...body),
    );
  }

  unlistedSheet() {
    const s = this.state;
    const list = h("div", { class: "spll-picker-list spll-scroll" });
    for (const gid of s.unlisted.groups) {
      const g = this.m.byId.get(gid);
      if (!g) continue;
      list.append(h("div", { class: "spll-unlisted-item" },
        h("span", { class: "spll-tag", text: "Group" }),
        h("span", { class: "spll-picker-name", text: this.groupPath(gid) }),
        h("button", { class: "spll-btn spll-btn-sm", "data-act": "relist", "data-kind": "group", "data-key": gid, text: "Relist" })));
    }
    for (const p of s.unlisted.loras) {
      list.append(h("div", { class: "spll-unlisted-item", title: this.fullPath(p) },
        h("span", { class: "spll-tag", text: "LoRA" }),
        h("span", { class: "spll-picker-name", text: this.displayName(p) }),
        h("span", { class: "spll-picker-path", text: folderText(p) }),
        h("button", { class: "spll-btn spll-btn-sm", "data-act": "relist", "data-kind": "lora", "data-key": p, text: "Relist" })));
    }
    if (!list.childElementCount) list.append(h("div", { class: "spll-empty", text: "Nothing is unlisted. Right-click a LoRA or use a group's ⋯ menu to unlist it." }));
    return h("div", { class: "spll-sheet" },
      h("div", { class: "spll-sheet-title" }, h("span", { text: "Unlisted" }), h("button", { class: "spll-icon", "data-act": "back-settings", title: "Back", text: "×" })),
      h("div", { class: "spll-hint", text: "Unlisted LoRAs and groups are hidden from the list, search, favourites and history. Relisting puts them back where they were." }),
      list,
      h("div", { class: "spll-pop-buttons" }, h("button", { class: "spll-btn", "data-act": "back-settings", text: "Back to settings" })),
    );
  }

  favHistSheet() {
    const o = this.overlay;
    return h("div", { class: "spll-sheet spll-sheet-center" },
      h("div", { class: "spll-sheet-title" }, h("span", { text: "Favourites and history" })),
      h("div", { class: "spll-hint spll-big", text: `The layout file also has ${o.favs} favourite${o.favs === 1 ? "" : "s"} and ${o.hist} history entr${o.hist === 1 ? "y" : "ies"}. Replace this node's favourites and history with the file's?` }),
      h("div", { class: "spll-hint", text: "No keeps this node's own favourites and history; everything else from the file is imported either way." }),
      h("div", { class: "spll-pop-buttons" },
        h("button", { class: "spll-btn", "data-act": "import-favhist", "data-answer": "no", text: "No, keep mine" }),
        h("button", { class: "spll-btn is-primary", "data-act": "import-favhist", "data-answer": "yes", text: "Yes, replace" }),
      ),
    );
  }

  pickerModel(b) {
    this._pickerModels ??= new WeakMap();
    let m = this._pickerModels.get(b);
    if (m) return m;
    const children = new Map(); // folder -> [subfolder]
    const files = new Map(); // folder -> [file]
    const counts = new Map();
    for (const fo of b.folders) {
      counts.set(fo.path, fo.count);
      if (!fo.path) continue;
      const parent = dirname(fo.path);
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(fo.path);
    }
    for (const f of b.files) {
      const d = dirname(f);
      if (!files.has(d)) files.set(d, []);
      files.get(d).push(f);
    }
    m = { children, files, counts };
    this._pickerModels.set(b, m);
    return m;
  }

  pickerSheet() {
    const p = this.picker || { bases: null, loading: true, expanded: new Set(), filter: "", sel: new Set() };
    const adding = this.state.setup;
    const sheet = h("div", { class: "spll-sheet spll-picker" },
      h("div", { class: "spll-sheet-title" },
        h("span", { text: adding ? "Add folders or LoRAs" : "What should this node load?" }),
        adding ? h("button", { class: "spll-icon", "data-act": "picker-cancel", title: "Cancel", text: "×" }) : null,
      ),
      h("div", { class: "spll-hint", text: p.message || "Tick whole folders (their subfolders become groups, and new LoRAs in them show up automatically) or just the LoRAs you want. Click + to open a folder." }),
      h("input", { class: "spll-pop-input", type: "text", placeholder: "Filter folders and LoRAs…", value: p.filter || "", "data-fkey": "picker-filter", "data-act": "picker-filter", spellcheck: "false" }),
    );
    const list = h("div", { class: "spll-picker-list spll-scroll" });
    const INDENT = 16;
    const selKey = (b, kind, rel) => `${kind}|${b.path}|${rel}`;
    const tick = (b, kind, rel) => {
      const already = kind === "folder" ? this.isFolderAdded(b.path, rel) : this.covers(b.path, rel);
      const inside = !already && [...p.sel].some((k) => {
        const [kk, kb, kr] = k.split("|");
        return kk === "folder" && kb === b.path && kr !== rel && under(rel, kr || "");
      });
      return h("input", {
        type: "checkbox",
        class: "spll-picker-check",
        "data-act": "picker-tick", "data-sel": selKey(b, kind, rel),
        checked: already || inside || p.sel.has(selKey(b, kind, rel)),
        disabled: already || inside,
        title: already ? "Already in this node" : inside ? "Included with a ticked folder" : kind === "folder" ? "Add this whole folder" : "Add this LoRA",
      });
    };
    const folderRow = (b, rel, depth, { hasKids, label, showPath, flat } = {}) => {
      const key = `${b.path}|${rel}`;
      const open = p.expanded.has(key);
      const count = this.pickerModel(b).counts.get(rel) ?? 0;
      return h("div", {
        class: "spll-picker-item" + (rel ? "" : " is-base"),
        role: "button",
        "data-act": "picker-expand", "data-key": key,
        style: { paddingLeft: 4 + depth * INDENT + "px" },
        title: this.fullPath(rel, b.path),
      },
        hasKids && !flat
          ? h("button", { class: "spll-expander", "data-act": "picker-expand", "data-key": key, title: open ? "Close" : "Open", text: open ? "−" : "+" })
          : h("span", { class: "spll-expander is-blank" }),
        tick(b, "folder", rel),
        h("span", { class: "spll-picker-icon", text: "📁" }),
        h("span", { class: "spll-picker-name", text: label }),
        showPath ? h("span", { class: "spll-picker-path", text: b.path }) : null,
        h("span", { class: "spll-count", text: count ? `${count} LoRA${count === 1 ? "" : "s"}` : "empty" }),
      );
    };
    const fileRow = (b, f, depth, flat) => h("label", {
      class: "spll-picker-file",
      style: { paddingLeft: 4 + depth * INDENT + 22 + "px" },
      title: this.fullPath(f, b.path),
    },
      tick(b, "lora", f),
      h("span", { class: "spll-picker-name", text: flat ? f : stripExt(basename(f)) }),
    );

    if (p.loading) list.append(h("div", { class: "spll-empty", text: "Loading folders…" }));
    else if (p.error) list.append(h("div", { class: "spll-empty", text: `Couldn't list folders: ${p.error}` }));
    else {
      const f = (p.filter || "").trim().toLowerCase();
      const multi = p.bases.length > 1;
      let shown = 0;
      for (const b of p.bases) {
        const m = this.pickerModel(b);
        if (f) {
          // flat matches, folders first then LoRA files
          for (const fo of b.folders) {
            if (fo.path && fo.path.toLowerCase().includes(f)) {
              list.append(folderRow(b, fo.path, 0, { label: lorasLabel(fo.path), showPath: multi, flat: true })); shown++;
            }
          }
          for (const file of b.files) {
            if (basename(file).toLowerCase().includes(f)) { list.append(fileRow(b, file, 0, true)); shown++; }
          }
          continue;
        }
        const walk = (rel, depth) => {
          const kids = m.children.get(rel) || [];
          const files = m.files.get(rel) || [];
          const hasKids = kids.length > 0 || files.length > 0;
          list.append(folderRow(b, rel, depth, { hasKids, label: rel ? basename(rel) : "loras", showPath: !rel }));
          shown++;
          if (!hasKids || !p.expanded.has(`${b.path}|${rel}`)) return;
          for (const k of kids) walk(k, depth + 1); // folders first
          for (const file of files) list.append(fileRow(b, file, depth + 1, false));
        };
        walk("", 0);
      }
      if (!shown) list.append(h("div", { class: "spll-empty", text: "No matches" }));
    }
    const nf = [...p.sel].filter((k) => k.startsWith("folder|")).length;
    const nl = p.sel.size - nf;
    const what = [nf ? `${nf} folder${nf > 1 ? "s" : ""}` : "", nl ? `${nl} LoRA${nl > 1 ? "s" : ""}` : ""].filter(Boolean).join(" and ");
    sheet.append(list,
      h("div", { class: "spll-picker-foot" },
        h("span", { class: "spll-hint spll-picker-selpath", text: what ? `Selected: ${what}` : "Tick folders or LoRAs" }),
        h("div", { class: "spll-pop-buttons" },
          adding ? h("button", { class: "spll-btn", "data-act": "picker-cancel", text: "Cancel" }) : null,
          h("button", { class: "spll-btn is-primary", "data-act": "picker-use", disabled: p.loading || !!p.error || !p.sel.size, text: what ? `Add ${what}` : "Add" }),
        ),
      ),
    );
    return sheet;
  }

  closeOverlay() {
    if (!this.overlay) return;
    this.overlay = null;
    this.render();
  }

  /** Just under a button, lined up with its right edge, so the button stays visible (and can close what it opened). */
  belowButton(t) {
    const r = this.el.getBoundingClientRect();
    const k = r.width / (this.el.offsetWidth || r.width || 1);
    const b = t.getBoundingClientRect();
    return { x: (b.right - r.left) / k, y: (b.bottom - r.top) / k + 2, above: (b.top - r.top) / k - 2, left: (b.left - r.left) / k - 4, alignRight: true };
  }

  posFromEvent(e) {
    const r = this.el.getBoundingClientRect();
    const scale = r.width / (this.el.offsetWidth || r.width || 1);
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  }

  // ----- info and trigger words (phase 2)
  /** "missing" | "busy" | "none" (info not loaded) | "empty" (loaded, no triggers) | "ready" */
  trigState(p) {
    if (this.missing.has(p)) return "missing";
    if (this.busy.has(p)) return "busy";
    const f = this.files.get(p);
    const s = f?.s || {};
    const sess = this.session.get(p);
    const trig = sess ? sess.trig : s.trig || [];
    if (trig.length) return "ready";
    if (s.unchecked && !sess) return "unchecked"; // saved info with no answer from Civitai
    if (s.noTrig) return "notrig"; // you marked it as having no trigger words
    return s.info || sess ? "empty" : "none";
  }

  triggersOf(p) {
    const sess = this.session.get(p);
    return sess ? sess.trig : this.files.get(p)?.s?.trig || [];
  }

  /** Keep the hash and Civitai ids for an active LoRA, so it can be found again if it goes missing. */
  rememberIds(p) {
    const f = this.files.get(p);
    const src = this.session.get(p)?.ids || f?.s || {};
    const e = {};
    if (Number.isInteger(f?.z)) e.z = f.z;
    if (src.h) e.h = src.h;
    if (Number.isInteger(src.m)) e.m = src.m;
    if (Number.isInteger(src.v)) e.v = src.v;
    if (Object.keys(e).length) this.state.ids[p] = e;
  }

  /** Apply what the server now knows about a LoRA to the list (and any other node showing it). */
  applyPayload(p, payload) {
    const trig = triggersFrom(payload);
    const civ = payload.info?.raw?.civitai || {};
    const ids = {};
    if (payload.info?.sha256) ids.h = payload.info.sha256;
    if (Number.isInteger(civ.modelId)) ids.m = civ.modelId;
    if (Number.isInteger(civ.id)) ids.v = civ.id;
    for (const c0 of controllers) {
      const c = c0;
      const pk = c === this ? p : this.keyIn(c, p);
      const f = pk && c.files.get(pk);
      if (!f) continue;
      const failed = payload.lookup === "failed";
      f.s = failed
        ? { ...(payload.summary || {}) } // a failed lookup changes nothing in the list
        : { ...(payload.summary || {}), trig: payload.saved ? payload.summary?.trig || trig : trig, info: !!payload.info };
      f.hasSidecar = payload.hasSidecar;
      f.nickname = payload.side?.nickname || undefined;
      if (payload.info && !failed) c.session.set(pk, { trig, ids });
      else if (!failed) c.session.delete(pk);
      if (c.isActive(pk)) { c.rememberIds(pk); }
      c.reconcile();
      c.render();
    }
    scanCache.clear();
  }

  /** Hash + Civitai lookup (nothing written), then offer to save the info next to the LoRA. */
  async fetchInfo(p, { onProgress, askToSave = true } = {}) {
    if (this.busy.has(p)) return null;
    this.busy.add(p);
    this.render();
    const q = this.q(p);
    let timer = null;
    if (onProgress) {
      timer = setInterval(async () => {
        try {
          const r = await getJson(`/spll/progress?${this.qs(p)}`);
          onProgress(r.progress);
        } catch { /* */ }
      }, 400);
    }
    let payload = null;
    try {
      payload = await postJson("/spll/fetch", { ...q, apiKey: getApiKey() });
      if (payload.error) throw new Error(payload.error);
    } catch (e) {
      toast("error", "Couldn't fetch LoRA info", String(e.message || e));
      payload = null;
    } finally {
      clearInterval(timer);
      this.busy.delete(p);
    }
    if (!payload) { this.render(); return null; }
    this.applyPayload(p, payload);
    if (payload.lookup === "failed") {
      // never offered for saving: a blocked or unreachable Civitai isn't "no trigger words"
      if (!onProgress) toast("warning", "Couldn't reach Civitai", `${payload.lookupError || ""}. If Civitai is blocked where you are, turn on your VPN and try again.`);
      return payload;
    }
    // refreshing info that's already saved overwrites it; a new file is only written after asking
    if (payload.unsaved && (askToSave || payload.saved)) payload = await this.saveInfo(p, payload);
    return payload;
  }

  /** Write fetched info next to the LoRA: asks first when that creates a new file. */
  async saveInfo(p, payload) {
    if (!payload.saved) {
      const ok = await confirmDialog(
        "Save LoRA info?",
        "Save this info next to the LoRA so it loads instantly next time, in every workflow (and in rgthree's Power Lora Loader). Cancel keeps it for this session only.",
        [payload.full + ".rgthree-info.json"]
      );
      if (!ok) return payload;
    }
    try {
      const r = await postJson("/spll/saveinfo", this.q(p));
      if (r.error) throw new Error(r.error);
      this.applyPayload(p, r);
      return r;
    } catch (e) {
      toast("error", "Couldn't save LoRA info", String(e.message || e));
      return payload;
    }
  }

  /** Save nickname / your trigger words / your note to the LoRA's own small file (asks the first time). */
  async saveSide(p, fields, hasSidecar) {
    if (!hasSidecar) {
      const what = Object.keys(fields).map((k) => ({ nickname: "nickname", triggers: "trigger words", note: "note" }[k])).join(" and ");
      const ok = await confirmDialog(
        "Save to a file next to the LoRA?",
        `Your ${what} will be saved in a small file next to the LoRA, so it shows up in every workflow. This creates:`,
        [this.fullPath(p) + ".spll.json"]
      );
      if (!ok) return null;
    }
    try {
      const r = await postJson("/spll/side", { ...this.q(p), ...fields });
      if (r.error) throw new Error(r.error);
      this.applyPayload(p, r);
      return r;
    } catch (e) {
      toast("error", "Couldn't save", String(e.message || e));
      return null;
    }
  }

  /** T: one trigger word is copied straight away; otherwise (or with `box`, from a right-click) the trigger-word box opens. */
  async onTrigger(p, btn, { box = false } = {}) {
    const state = this.trigState(p);
    if (state === "missing" || state === "busy") return;
    if (state === "none" || state === "unchecked") {
      await this.fetchInfo(p);
      return;
    }
    if (!box && state === "ready") {
      const words = this.triggersOf(p);
      if (words.length === 1) return this.copyWords(words, this.posFromElement(btn));
    }
    // ready: pick words to copy; empty / notrig: add your own or mark "no trigger words"
    const pos = this.posFromElement(btn.closest(".spll-row") || btn);
    this.overlay = { kind: "triggers", path: p, x: 8, y: pos.y + ROW_H, sel: [] };
    this.render();
  }

  /** Copy words, or show them selected for manual copying when the browser blocks the clipboard. */
  async copyWords(words, anchorPos) {
    const text = words.join(", ");
    if (!text) return;
    if (await copyText(text)) return void toast("success", "Copied trigger words", text);
    this.overlay = { kind: "copy", text, x: (anchorPos?.x ?? 40) - 40, y: (anchorPos?.y ?? 40) + 4 };
    this.render();
  }

  async setNoTrigger(p, on) {
    const f = this.files.get(p);
    await this.saveSide(p, { noTrigger: !!on }, !!f?.hasSidecar);
  }

  /** "No Trigger All": mark every LoRA under the root that's currently red. */
  async noTriggerAll() {
    const reds = [...this.files.keys()].filter((p) => this.inNode(p) && !this.isUnlisted(p) && this.trigState(p) === "empty");
    if (!reds.length) return toast("info", "Nothing to mark", "No LoRAs here have a red T right now.");
    const needFiles = reds.filter((p) => !this.files.get(p)?.hasSidecar).length;
    const ok = await confirmDialog(
      "Mark as “No trigger words”?",
      `Mark ${reds.length} LoRA${reds.length > 1 ? "s" : ""} with no trigger words, so their T stops showing red? This is saved in the small .spll.json file next to each LoRA${needFiles ? ` (creating ${needFiles} new file${needFiles > 1 ? "s" : ""})` : ""}, so it applies in every workflow. You can still add trigger words to any of them later.`,
      reds.slice(0, 12).map((p) => this.fullPath(p)).concat(reds.length > 12 ? [`…and ${reds.length - 12} more`] : [])
    );
    if (!ok) return;
    try {
      const r = { done: [], failed: [] };
      for (const [b, keys] of this.byBase(reds)) {
        const part = await postJson("/spll/side-bulk", { base: this.basePath(b), root: "", paths: keys.map(relOf), noTrigger: true });
        if (part.error) throw new Error(part.error);
        r.done.push(...part.done.map((rel) => mkKey(b, rel)));
        r.failed.push(...(part.failed || []));
        for (const [rel, sm] of Object.entries(part.summaries || {})) {
          const k = mkKey(b, rel);
          for (const c of controllers) {
            const ck = c === this ? k : this.keyIn(c, k);
            const f = ck && c.files.get(ck);
            if (f) { f.s = { ...f.s, ...sm }; f.hasSidecar = true; }
          }
        }
      }
      scanCache.clear();
      for (const c of controllers) { c.reconcile(); c.render(); }
      toast("success", `Marked ${r.done.length} LoRA${r.done.length === 1 ? "" : "s"}`, r.failed?.length ? `${r.failed.length} couldn't be written.` : "");
    } catch (e) {
      toast("error", "Couldn't mark LoRAs", String(e.message || e));
    }
  }

  async saveTriggersFromPopover() {
    const o = this.overlay;
    if (!o || o.kind !== "triggers") return;
    const value = this.overlayEl.querySelector(".spll-trig-input")?.value || "";
    const words = value.split(",").map((w) => w.trim()).filter(Boolean);
    this.overlay = null;
    this.render();
    if (!words.length) return;
    const f = this.files.get(o.path);
    await new Promise((r) => setTimeout(r, 150)); // let the click finish before a dialog opens
    await this.saveSide(o.path, { triggers: words }, !!f?.hasSidecar);
  }

  posFromElement(elm) {
    const r = this.el.getBoundingClientRect();
    const scale = r.width / (this.el.offsetWidth || r.width || 1);
    const b = elm.getBoundingClientRect();
    return { x: (b.left - r.left) / scale, y: (b.top - r.top) / scale };
  }

  openInfo(p) {
    if (!p) return;
    new InfoPanel(this, p).open();
  }

  // ----- layout export / import
  exportLayout() {
    const s = this.state;
    const placements = {};
    for (const [p, gid] of this.m.groupOfLora) placements[p] = gid; // every LoRA's group, so the file is complete
    const nicknames = {};
    const ids = {};
    for (const [p, f] of this.files) {
      if (!this.inNode(p)) continue;
      if (f.nickname) nicknames[p] = f.nickname;
      const sm = f.s || {};
      const e = {};
      if (sm.h) e.h = sm.h;
      if (Number.isInteger(sm.m)) e.m = sm.m;
      if (Number.isInteger(sm.v)) e.v = sm.v;
      if (Number.isInteger(f.z)) e.z = f.z;
      if (Object.keys(e).length) ids[p] = e;
    }
    for (const [p, e] of Object.entries(s.ids)) ids[p] = { ...e, ...(ids[p] || {}) };
    const st = s.settings;
    const bases = {};
    for (const b of Object.keys(s.bases)) bases[b] = this.basePath(b);
    const data = {
      type: "super-power-lora-layout",
      version: 2,
      exported: new Date().toISOString(),
      bases,
      sources: s.sources,
      settings: {
        colorMode: st.colorMode, colorA: st.colorA, colorB: st.colorB, listHeight: st.listHeight, dropdownRows: st.dropdownRows,
        historyLength: st.historyLength, favRows: st.favRows, histRows: st.histRows, favSort: st.favSort,
      },
      groups: s.groups,
      knownFolders: s.knownFolders,
      placements,
      unlisted: s.unlisted,
      nicknames,
      ids,
      favourites: s.favourites,
      favAdded: s.favAdded,
      tiers: s.tiers,
      favTier: s.favTier,
      favColl: s.favColl,
      collections: s.collections,
      sorts: s.sorts,
      order: s.order,
      history: s.history,
      mixes: s.mixes, // as saved (unsaved edits stay in the workflow)
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const name = s.sources.folders.length === 1 ? lorasLabel(s.sources.folders[0].key) : "loras";
    a.download = `super-power-lora-layout-${name.replace(/[\\/:]+/g, "_")}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("success", "Layout exported", a.download);
  }

  pickLayoutFile() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json,application/json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 20 * 1024 * 1024) return toast("error", "Layout file too big");
      this.importLayout(await file.text());
    });
    input.click();
  }

  /** A layout file in this node's terms: phase 1-3 files converted, and its loras-folder ids matched to this node's. */
  readLayout(d) {
    if (!d.sources) {
      const m = migrateV1({ root: d.root, base: d.base, groups: d.groups, knownFolders: d.knownFolders, placements: d.placements,
        unlisted: d.unlisted, ids: d.ids, favourites: d.favourites, history: d.history });
      d = { ...d, ...m, nicknames: Object.fromEntries(Object.entries(d.nicknames || {}).map(([p, n]) => [`b1:${p}`, n])) };
    }
    const s = this.state;
    const map = {};
    for (const [fb, path] of Object.entries(d.bases || {})) {
      const mine = Object.keys(s.bases).find((b) => this.basePath(b) === path);
      if (mine) { map[fb] = mine; continue; }
      let n = 1;
      while (s.bases[`b${n}`] !== undefined || Object.values(map).includes(`b${n}`)) n++;
      map[fb] = `b${n}`;
    }
    const rk = (k) => (typeof k === "string" && k.includes(":") && map[baseOf(k)] ? mkKey(map[baseOf(k)], relOf(k)) : k);
    const rkeys = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [rk(k), v]));
    const bases = {};
    for (const [fb, path] of Object.entries(d.bases || {})) bases[map[fb]] = path;
    return {
      bases,
      sources: {
        folders: (d.sources?.folders || []).map((f) => (typeof f === "string" ? { key: rk(f), flat: false } : { ...f, key: rk(f.key) })),
        loras: (d.sources?.loras || []).map(rk),
      },
      settings: d.settings,
      groups: (d.groups || []).map((g) => (g && typeof g.folder === "string" ? { ...g, folder: rk(g.folder) } : g)),
      knownFolders: (d.knownFolders || []).map(rk),
      placements: rkeys(d.placements),
      unlisted: { loras: (d.unlisted?.loras || []).map(rk), groups: d.unlisted?.groups || [] },
      ids: rkeys(d.ids),
      nicknames: rkeys(d.nicknames),
      favourites: (d.favourites || []).map(rk),
      favAdded: rkeys(d.favAdded),
      tiers: d.tiers,
      favTier: rkeys(d.favTier),
      favColl: rkeys(d.favColl),
      collections: d.collections,
      history: (d.history || []).map(rk),
      mixes: (Array.isArray(d.mixes) ? d.mixes : []).map((m) => (m && Array.isArray(m.items) ? { ...m, items: m.items.map((it) => (it ? { ...it, path: rk(it.path) } : it)) } : m)),
      sorts: d.sorts || {},
      // LoRA lists hold keys with a loras-folder id; group lists hold group ids
      order: Object.fromEntries(Object.entries(d.order || {}).map(([k, list]) => [k, k.startsWith("l:") && Array.isArray(list) ? list.map(rk) : list])),
    };
  }

  async importLayout(text) {
    let raw;
    try { raw = JSON.parse(text); } catch { return toast("error", "Couldn't read that file", "It isn't valid JSON."); }
    if (!raw || raw.type !== "super-power-lora-layout") return toast("error", "Not a layout file", "Choose a file exported from a Super-Power Lora Loader.");
    const d = this.readLayout(raw);
    this.overlay = null;
    this.render();
    const nf = d.sources.folders.length, nl = d.sources.loras.length;
    const ok = await confirmDialog(
      "Import layout?",
      `Replace this node's groups, colours, unlisted items and what it loads (${nf} folder${nf === 1 ? "" : "s"}${nl ? `, ${nl} LoRA${nl === 1 ? "" : "s"}` : ""}) with the layout in the file? Enabled LoRAs and strengths stay where they still apply. Nothing on disk changes without asking.`,
      d.sources.folders.map((f) => `${lorasLabel(f.key)}   (${d.bases[baseOf(f.key)] || "loras"})`)
    );
    if (!ok) return;
    const cur = this.state;
    const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && k in o).map((k) => [k, o[k]]));
    const next = sanitize({
      ...cur,
      setup: true,
      bases: { ...cur.bases, ...d.bases },
      sources: d.sources,
      settings: { ...cur.settings, ...pick(d.settings, ["colorMode", "colorA", "colorB", "listHeight", "dropdownRows", "historyLength", "favRows", "histRows", "favSort"]) },
      groups: d.groups,
      knownFolders: d.knownFolders,
      placements: d.placements,
      unlisted: d.unlisted,
      ids: { ...d.ids, ...cur.ids },
      sorts: d.sorts,
      order: d.order,
    });
    const keep = (p) => next.sources.loras.includes(p) || next.sources.folders.some((f) => under(p, f.key));
    next.active = next.active.filter((a) => a.mix || keep(a.path));
    for (const k of Object.keys(next.strengths)) if (!keep(k)) delete next.strengths[k];
    next.favourites = cur.favourites.filter(keep);
    next.favAdded = Object.fromEntries(Object.entries(cur.favAdded).filter(([k]) => keep(k)));
    next.history = cur.history.filter(keep);
    // mixes in the file join this node's; one with the same name as a mix here is left out (yours stays)
    const names = new Set(next.mixes.map((m) => m.name.toLowerCase()));
    const taken = new Set(next.mixes.map((m) => m.id));
    for (const m of sanitize({ mixes: d.mixes }).mixes) {
      if (names.has(m.name.toLowerCase())) continue;
      const id = this.newId("m", taken);
      taken.add(id);
      names.add(m.name.toLowerCase());
      next.mixes.push({ ...m, id });
    }
    // drop bases nothing uses any more
    for (const b of Object.keys(next.bases)) {
      if (!next.sources.folders.some((f) => baseOf(f.key) === b) && !next.sources.loras.some((k) => baseOf(k) === b)) delete next.bases[b];
    }
    // placements that just repeat a LoRA's folder group aren't needed in the workflow
    const byFolder = new Map();
    for (const g of next.groups) if (g.folder !== null && !byFolder.has(g.folder)) byFolder.set(g.folder, g.id);
    for (const [p, gid] of Object.entries(next.placements)) {
      if (byFolder.get(dirname(p)) === gid) delete next.placements[p];
      else if (gid === UNGROUPED && !next.sources.folders.some((f) => under(p, f.key))) delete next.placements[p];
    }
    this.state = next;
    this.resolved = {};
    this.scanned = false;
    this.groupQueries.clear();
    this.notify();
    await this.refresh({ force: true }); // also asks before creating any folders the layout needs
    this.notify();

    // favourites and history: asked inside the node, only when both sides have some
    const fh = sanitize({ settings: { ...next.settings, ...(d.settings || {}) }, favourites: d.favourites, favAdded: d.favAdded, history: d.history,
      tiers: d.tiers, favTier: d.favTier, favColl: d.favColl, collections: d.collections });
    // the file's tiers and collections come with its favourites
    this.pendingFavExtra = { tiers: fh.tiers, favTier: fh.favTier, favColl: fh.favColl, collections: fh.collections,
      favMenuOnClick: fh.settings.favMenuOnClick, favDefaultTier: fh.settings.favDefaultTier, tierSubmenus: fh.settings.tierSubmenus };
    const fileFavs = fh.favourites.filter(keep);
    const fileHist = fh.history.filter(keep);
    this.pendingFavAdded = fh.favAdded;
    this.importNicknames = d.nicknames && typeof d.nicknames === "object" ? d.nicknames : null;
    if (fileFavs.length || fileHist.length) {
      if (next.favourites.length || next.history.length) {
        this.pendingFavHist = { favs: fileFavs, hist: fileHist };
        this.overlay = { kind: "favhist", favs: fileFavs.length, hist: fileHist.length };
        return this.render(); // continues in finishImportFavHist
      }
      this.commit((s) => { s.favourites = fileFavs; s.favAdded = { ...this.pendingFavAdded }; s.history = fileHist; this.applyFavExtra(s); });
    }
    await this.importNicknamesStep();
  }

  /** Tiers, collections and where each favourite sits, from an imported layout (re-checked against what's here). */
  applyFavExtra(s) {
    const x = this.pendingFavExtra;
    if (!x) return;
    const clean = sanitize({ favourites: s.favourites, tiers: x.tiers, favTier: x.favTier, favColl: x.favColl, collections: x.collections,
      settings: { favMenuOnClick: x.favMenuOnClick, favDefaultTier: x.favDefaultTier, tierSubmenus: x.tierSubmenus } });
    s.tiers = clean.tiers;
    s.favTier = clean.favTier;
    s.favColl = clean.favColl;
    s.collections = clean.collections;
    s.settings.favMenuOnClick = clean.settings.favMenuOnClick;
    s.settings.favDefaultTier = clean.settings.favDefaultTier;
    s.settings.tierSubmenus = clean.settings.tierSubmenus;
  }

  async finishImportFavHist(yes) {
    const fh = this.pendingFavHist;
    this.pendingFavHist = null;
    this.overlay = null;
    if (fh && yes) this.commit((s) => { s.favourites = fh.favs; s.favAdded = { ...(this.pendingFavAdded || {}) }; s.history = fh.hist; this.applyFavExtra(s); });
    else this.render();
    await new Promise((r) => setTimeout(r, 150));
    await this.importNicknamesStep();
  }

  /** Nicknames in a layout file are applied only to LoRAs without one here (the one next to the LoRA wins), after asking. */
  async importNicknamesStep() {
    const nn = this.importNicknames;
    this.importNicknames = null;
    if (!nn) return toast("success", "Layout imported");
    const todo = Object.entries(nn).filter(([p, n]) => typeof n === "string" && n.trim() && this.files.has(p) && !this.files.get(p).nickname);
    if (!todo.length) return toast("success", "Layout imported");
    const ok = await confirmDialog(
      "Apply nicknames from the file?",
      `The layout has nicknames for ${todo.length} LoRA${todo.length > 1 ? "s" : ""} that don't have one here. Nicknames are saved in a small .spll.json file next to each LoRA (LoRAs that already have a nickname keep theirs).`,
      todo.slice(0, 12).map(([p, n]) => `${n}  ←  ${basename(p)}`).concat(todo.length > 12 ? [`…and ${todo.length - 12} more`] : [])
    );
    if (ok) {
      let done = 0;
      for (const [p, n] of todo) {
        try {
          const r = await postJson("/spll/side", { ...this.q(p), nickname: n });
          if (!r.error) { done++; const f = this.files.get(p); f.nickname = r.side?.nickname; f.hasSidecar = true; }
        } catch { /* */ }
      }
      scanCache.clear();
      this.reconcile();
      this.render();
      toast("success", "Layout imported", `${done} nickname${done === 1 ? "" : "s"} applied.`);
    } else toast("success", "Layout imported", "Nicknames from the file were skipped.");
  }

  // ----- bulk info fetch
  async bulkFetch(gid) {
    if (this.bulk) return toast("info", "Already fetching", "Wait for the current fetch to finish, or cancel it.");
    const inside = [gid, ...this.descendants(gid)];
    const todo = [];
    for (const g of inside) for (const p of this.m.lorasIn.get(g) || []) {
      if (!this.missing.has(p) && !this.files.get(p)?.s?.info) todo.push(p);
    }
    const name = this.m.byId.get(gid)?.name || "this group";
    if (!todo.length) return toast("info", "Nothing to fetch", `Every LoRA in “${name}” already has info.`);
    await new Promise((r) => setTimeout(r, 120));
    const ok = await confirmDialog(
      `Fetch info for ${todo.length} LoRA${todo.length > 1 ? "s" : ""}?`,
      `Each LoRA in “${name}” without info is hashed and looked up on Civitai, one at a time with a short pause between requests, and the result is saved next to it (${todo.length} new .rgthree-info.json file${todo.length > 1 ? "s" : ""}). It stops if Civitai can't be reached. You can cancel at any time.`,
      []
    );
    if (!ok) return;
    this.bulk = { total: todo.length, done: 0, saved: 0, notFound: 0, failed: 0, cancel: false, current: null };
    this.render();
    let stopped = null;
    for (const p of todo) {
      if (this.bulk.cancel) break;
      this.bulk.current = p;
      this.busy.add(p);
      this.render();
      try {
        const r = await postJson("/spll/fetch", { ...this.q(p), apiKey: getApiKey() });
        if (r.error) throw new Error(r.error);
        if (r.lookup === "failed") { stopped = r.lookupError || "Couldn't reach Civitai"; this.busy.delete(p); break; }
        const saved = await postJson("/spll/saveinfo", this.q(p));
        this.busy.delete(p);
        if (saved.error) throw new Error(saved.error);
        this.applyPayload(p, saved);
        this.bulk.saved++;
        if (saved.lookup === "notfound") this.bulk.notFound++;
      } catch {
        this.busy.delete(p);
        this.bulk.failed++;
      }
      this.bulk.done++;
      this.render();
      if (!this.bulk.cancel) await new Promise((r) => setTimeout(r, BULK_PAUSE_MS));
    }
    const b = this.bulk;
    this.bulk = null;
    this.render();
    const parts = [`${b.saved} saved`];
    if (b.notFound) parts.push(`${b.notFound} not on Civitai`);
    if (b.failed) parts.push(`${b.failed} failed`);
    if (stopped) toast("warning", "Stopped: couldn't reach Civitai", `${stopped}. ${parts.join(", ")}. If Civitai is blocked where you are, turn on your VPN and run it again; LoRAs already done are skipped.`);
    else toast(b.cancel ? "info" : "success", b.cancel ? "Fetch cancelled" : "Fetch finished", parts.join(", "));
  }

  // ----- renamed or moved files
  /** A LoRA this layout uses that's gone from disk, whose hash matches a file new to the layout, is the same file renamed or moved. */
  async findRenames() {
    const s = this.state;
    const referenced = new Set([...s.active.filter((a) => a.path).map((a) => a.path), ...this.mixPaths(), ...Object.keys(s.strengths), ...Object.keys(s.placements),
      ...s.favourites, ...s.history, ...s.unlisted.loras, ...Object.keys(s.ids), ...s.sources.loras]);
    const gone = [...referenced].filter((p) => this.inNode(p) && !this.files.has(p) && s.ids[p]?.h);
    if (!gone.length) return new Map();
    const fresh = [...this.files.keys()].filter((p) => !referenced.has(p));
    const matches = new Map(); // old -> new
    const taken = new Set();
    const needHash = [];
    for (const m of gone) {
      const e = s.ids[m];
      const known = fresh.find((p) => !taken.has(p) && this.files.get(p)?.s?.h === e.h);
      if (known) { matches.set(m, known); taken.add(known); continue; }
      if (Number.isInteger(e.z)) for (const p of fresh) if (this.files.get(p)?.z === e.z && !this.files.get(p)?.s?.h) needHash.push([m, p]);
    }
    if (needHash.length) {
      try {
        const paths = [...new Set(needHash.map((x) => x[1]))].slice(0, 20);
        const hashes = {};
        for (const [b, keys] of this.byBase(paths)) {
          const r = await postJson("/spll/hashes", { base: this.basePath(b), root: "", paths: keys.map(relOf) });
          for (const [rel, h] of Object.entries(r.hashes || {})) hashes[mkKey(b, rel)] = h;
        }
        for (const [m, p] of needHash) {
          if (!matches.has(m) && !taken.has(p) && hashes[p] === s.ids[m].h) { matches.set(m, p); taken.add(p); }
        }
      } catch { /* */ }
    }
    return matches;
  }

  /** Move everything this layout knows about a LoRA from its old path to its new one. */
  reattach(st, o, n) {
    for (const a of st.active) if (a.path === o) a.path = n;
    for (const list of [...st.mixes.map((m) => m.items), ...Object.values(st.mixDrafts)]) {
      for (const it of list) if (it.path === o && !list.some((x) => x.path === n)) it.path = n;
    }
    const move = (obj) => { if (o in obj) { obj[n] = obj[o]; delete obj[o]; } };
    move(st.mixPrefer);
    move(st.strengths);
    move(st.placements); // a group you placed it in is kept; otherwise it follows its new folder
    move(st.ids);
    const swap = (arr) => arr.map((x) => (x === o ? n : x));
    st.favourites = [...new Set(swap(st.favourites))];
    st.history = [...new Set(swap(st.history))];
    st.unlisted.loras = [...new Set(swap(st.unlisted.loras))];
    st.sources.loras = [...new Set(swap(st.sources.loras))];
    if (o in st.favAdded) { st.favAdded[n] = st.favAdded[o]; delete st.favAdded[o]; }
    move(st.favTier);
    move(st.favColl);
  }

  // ----- hover tooltip (name, file name and full path on disk)
  onHover(e) {
    this.checkMode();
    if (e.target.closest?.(".spll-dropdown")) this.peekFromResult(e.target);
    const t = e.target.closest?.("[data-tip]");
    if (t === this.tipTarget) return;
    this.hideTip();
    if (!t || this.dragging || this.overlay || this.picker) return; // no tooltips over an open popup
    this.tipTarget = t;
    this.tipTimer = setTimeout(() => this.showTip(t), 350);
  }

  hideTip() {
    clearTimeout(this.tipTimer);
    this.tipTarget = null;
    if (this.tipEl && !this.tipEl.hidden) this.tipEl.hidden = true;
  }

  showTip(t) {
    if (!t.isConnected || this.tipTarget !== t) return;
    const tip = this.tipEl;
    tip.innerHTML = "";
    if (t.dataset.tip === "lora") {
      const p = t.closest("[data-path]")?.dataset.path;
      if (!p) return;
      const nick = this.files.get(p)?.nickname;
      tip.append(h("div", { class: "spll-tip-title", text: this.displayName(p) }));
      if (nick) tip.append(h("div", { class: "spll-tip-line", text: basename(p) }));
      const gid = this.m?.groupOfLora.get(p);
      if (gid) tip.append(h("div", { class: "spll-tip-line", text: `Group: ${this.groupPath(gid)}` }));
      tip.append(h("div", { class: "spll-tip-path", text: this.fullPath(p) }));
      if (this.missing.has(p)) tip.append(h("div", { class: "spll-tip-warn", text: "File missing on disk" }));
    } else if (t.dataset.tip === "trig") {
      const p = t.closest("[data-path]")?.dataset.path;
      const st = this.trigState(p);
      const words = this.triggersOf(p);
      const text = {
        missing: "LoRA file missing",
        busy: "Fetching info…",
        none: "Trigger words: info not loaded yet. Click to fetch it.",
        unchecked: "Trigger words: Civitai wasn't checked (it may have been unreachable). Click to try again.",
        empty: "Trigger words: none found. Click to add your own, or mark it as having none.",
        notrig: "No trigger words (you marked this). Click to add your own.",
        ready: words.length === 1 ? "Click to copy the trigger word (right-click to edit):" : "Click to pick trigger words to copy:",
      }[st];
      tip.append(h("div", { class: st === "ready" ? "spll-tip-title" : "spll-tip-line", text }));
      if (st === "ready") tip.append(h("div", { class: "spll-tip-words", text: words.join(", ") }));
    } else if (t.dataset.tip === "searchfiles") {
      tip.append(h("div", { class: "spll-tip-line", text: "Search Folders" }));
    } else if (t.dataset.tip === "filetoggle") {
      tip.append(h("div", { class: "spll-tip-line", text: this.fileMode ? "Search Folders is on: the search box looks through every loras folder. Click to search this node again." : "Search Folders: switch the search box to look through every loras folder, to add folders or LoRAs" }));
    } else if (t.dataset.tip === "rescan") {
      tip.append(h("div", { class: "spll-tip-line", text: this.hasFolders()
        ? "Rescan Folders"
        : "Rescan Folders: you need to add a folder to rescan. The file search always reads every loras folder and its subfolders live." }));
    } else if (t.dataset.tip === "plain") {
      tip.append(h("div", { class: "spll-tip-line", text: t.dataset.tiptext || "" }));
    } else if (t.dataset.tip === "fav") {
      const p = t.closest("[data-path]")?.dataset.path;
      const tier = this.isFav(p) ? this.tierOf(p) : null;
      tip.append(h("div", { class: "spll-tip-line", text: tier ? `Favourite · ${tier.name}. Click or right-click for tiers and collections.` : `Add to favourites (${this.defaultTier().name}). Right-click for tiers and collections.` }));
    } else if (t.dataset.tip === "favmenu") {
      const narrow = this.activeEl.querySelector(".spll-section-title")?.classList.contains("is-narrow");
      tip.append(h("div", { class: "spll-tip-line", text: narrow ? "Quick Menu: Favourites, History & Mixes." : "Favourites, History & Mixes" }));
    } else if (t.dataset.tip === "info") {
      const p = t.closest("[data-path]")?.dataset.path;
      tip.append(h("div", { class: "spll-tip-line", text: this.missing.has(p) ? "LoRA file missing. Click for download details." : "LoRA info" }));
    } else if (t.dataset.tip === "group") {
      const gid = t.closest("[data-gid]")?.dataset.gid;
      const g = this.m.byId.get(gid);
      if (!g) return;
      tip.append(h("div", { class: "spll-tip-title", text: this.groupPath(gid) }));
      tip.append(h("div", { class: "spll-tip-line", text: `${this.m.counts.get(gid) || 0} LoRAs` }));
      if (g.folder !== null) tip.append(h("div", { class: "spll-tip-path", text: this.fullPath(g.folder) }));
      else tip.append(h("div", { class: "spll-tip-line", text: "Your own group (not a folder)" }));
    } else return;
    tip.hidden = false;
    // place it under the hovered text, kept inside the node (layout coordinates, so canvas zoom doesn't matter)
    const r = this.el.getBoundingClientRect();
    const scale = r.width / (this.el.offsetWidth || r.width || 1);
    const tr = t.getBoundingClientRect();
    const x = (tr.left - r.left) / scale;
    const yBelow = (tr.bottom - r.top) / scale + 4;
    const yAbove = (tr.top - r.top) / scale - 4;
    const W = this.el.clientWidth, H = this.el.clientHeight;
    tip.style.left = "0px";
    tip.style.top = "0px";
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = clamp(x, 4, Math.max(4, W - tw - 4)) + "px";
    tip.style.top = (yBelow + th > H - 4 ? Math.max(4, yAbove - th) : yBelow) + "px";
  }

  /** Is this the button that opened the popup that's showing? */
  isOverlayToggler(t) {
    const o = this.overlay;
    const act = t.dataset.act;
    if (act === "settings") return o.kind === "settings" || o.kind === "unlisted";
    if (act === "gmenu") return o.kind === "menu" && !!o.gid && o.gid === t.closest(".spll-row")?.dataset.gid;
    return false;
  }

  // ----- events
  onPointerDown(e) {
    this.hideTip();
    this.onDragPress(e);
    // the button that opened a popup closes it again on its own click (so don't close it here first)
    const toggler = this.overlay && e.target.closest("[data-act]");
    const isToggler = toggler && this.isOverlayToggler(toggler);
    // click outside an open popup closes it
    if (this.overlay && !isToggler && !e.target.closest(".spll-pop, .spll-sheet") && this.overlay.kind !== "favhist") {
      this.overlay = null;
      this.render();
    }
    // an inline nickname edit left open by a click outside the node saves on a click elsewhere on the node
    if (this.editing && !e.target.closest("[data-act=nick-input]")) {
      const inp = this.el.querySelector("[data-act=nick-input]");
      if (inp) this.finishNick(inp);
    }
  }

  onContextMenu(e) {
    e.preventDefault();
    e.stopPropagation();
    if (this.selectMode) return;
    const star = e.target.closest(".spll-star");
    if (star) { const p = star.closest("[data-path]")?.dataset.path; if (p) return this.openStarMenu(p, star); }
    const trig = e.target.closest(".spll-trig");
    if (trig) { const p = trig.closest("[data-path]")?.dataset.path; if (p) return this.onTrigger(p, trig, { box: true }); } // always the box
    if (e.target.closest(".spll-active")) {
      const loraEl = e.target.closest(".spll-lora");
      const mixEl = e.target.closest(".spll-mix-box");
      return this.openActiveMenu(e.clientX, e.clientY, loraEl ? { path: loraEl.dataset.path, pos: this.posFromEvent(e) } : null, mixEl?.dataset.mixid || null, this.posFromEvent(e));
    }
    const groupEl = e.target.closest(".spll-group");
    const loraEl = e.target.closest(".spll-lora, .spll-result-lora");
    const pos = this.posFromEvent(e);
    if (groupEl) this.openGroupMenu(groupEl.dataset.gid, pos);
    else if (loraEl) this.openLoraMenu(loraEl.dataset.path, loraEl.dataset.where, pos);
  }

  openSort(container, pos) {
    this.overlay = { kind: "sort", container, sub: false, ...pos };
    this.render();
  }

  // ----- select groups mode: tick the groups to have open, then Apply
  startSelect() {
    const ticks = new Set();
    for (const g of this.state.groups) if (!this.m.hiddenGroups.has(g.id)) ticks.add(g.id); // everything starts ticked
    if ((this.m.lorasIn.get(UNGROUPED) || []).length) ticks.add(UNGROUPED);
    this.overlay = null;
    this.selectMode = { ticks, all: new Set(ticks) };
    this.onSelKey = (e) => {
      if (e.key !== "Escape" || !this.selectMode) return;
      if (document.querySelector("[role=dialog]:not(.spll-modal)")) return;
      e.preventDefault();
      e.stopPropagation();
      this.selCancel();
    };
    window.addEventListener("keydown", this.onSelKey, true);
    this.render();
  }

  endSelect() {
    window.removeEventListener("keydown", this.onSelKey, true);
    this.selectMode = null;
  }

  ancestors(gid) {
    const out = [];
    let g = this.m.byId.get(gid);
    while (g?.parent && this.m.byId.has(g.parent)) { out.push(g.parent); g = this.m.byId.get(g.parent); }
    return out;
  }

  /** A ticked subgroup needs its parents open too. */
  tickWithParents(gid) {
    const t = this.selectMode.ticks;
    t.add(gid);
    for (const a of this.ancestors(gid)) t.add(a);
  }

  selToggle(gid) {
    const t = this.selectMode.ticks;
    if (t.has(gid)) t.delete(gid);
    else this.tickWithParents(gid);
    this.renderTree();
    this.renderSelBar();
  }

  /** The "all inside" button: tick or untick a group and everything inside it. */
  selInside(gid) {
    const t = this.selectMode.ticks;
    const all = [gid, ...this.descendants(gid)];
    if (all.every((id) => t.has(id))) for (const id of all) t.delete(id);
    else { for (const id of all) t.add(id); this.tickWithParents(gid); }
    this.renderTree();
    this.renderSelBar();
  }

  selAll() {
    const sm = this.selectMode;
    if (sm.ticks.size) sm.ticks.clear();
    else sm.ticks = new Set(sm.all);
    this.renderTree();
    this.renderSelBar();
  }

  selInvert() {
    const sm = this.selectMode;
    const next = new Set([...sm.all].filter((id) => !sm.ticks.has(id)));
    sm.ticks = next;
    for (const id of [...next]) if (id !== UNGROUPED) this.tickWithParents(id);
    this.renderTree();
    this.renderSelBar();
  }

  selApply() {
    const t = this.selectMode.ticks;
    this.endSelect();
    this.commit((s) => {
      for (const g of s.groups) if (!this.m.hiddenGroups.has(g.id)) g.collapsed = !t.has(g.id);
      s.settings.ungroupedCollapsed = !t.has(UNGROUPED);
    });
  }

  selCancel() {
    this.endSelect();
    this.render();
  }

  openGroupMenu(gid, pos) {
    const g = this.m.byId.get(gid);
    if (!g) return;
    this.overlay = {
      kind: "menu", gid, ...pos, title: g.name,
      items: [
        { label: "Rename…", run: () => this.promptRename(gid, pos) },
        this.state.settings.colorMode === "individual"
          ? { label: "Colour…", run: () => { this.overlay = { kind: "color", gid, ...pos }; this.render(); } }
          : null,
        { label: "New subgroup…", run: () => this.promptNewGroup(gid, pos) },
        { label: "Move to…", run: () => { this.overlay = { kind: "move", gid, current: g.parent, title: `Move “${g.name}” to…`, ...pos }; this.render(); } },
        g.parent ? { label: "Move to top level", run: () => this.moveGroup(gid, null) } : null,
        "-",
        { label: "Expand all inside", run: () => this.commit(() => { g.collapsed = false; for (const id of this.descendants(gid)) this.m.byId.get(id).collapsed = false; }) },
        // the group stays open, showing its subgroups closed
        { label: "Collapse all inside", run: () => this.commit(() => { g.collapsed = false; for (const id of this.descendants(gid)) this.m.byId.get(id).collapsed = true; }) },
        { label: "Sort…", run: () => this.openSort(gid, pos) },
        { label: "Fetch info for all LoRAs in this group…", run: () => this.bulkFetch(gid) },
        { label: "Unlist group", run: () => this.unlistGroup(gid) },
        this.folderSource(g.folder) ? { label: "Remove folder from node…", danger: true, run: () => this.removeFolder(g.folder) } : null,
        "-",
        { label: "Delete group…", danger: true, run: () => this.confirmDeleteGroup(gid) },
      ].filter(Boolean),
    };
    this.render();
  }

  /** The Active section's menu: Favourites ▸ and History ▸ first, then the LoRA's own options. */
  openActiveMenu(x, y, lora, mixId = null, at = null) {
    this.hideTip();
    const s = this.state;
    const items = [
      { label: "Favourites", sub: () => this.favRootSpec() },
      { label: s.settings.historyLength ? "History" : "History (off)", sub: () => ({ type: "hist" }) },
      s.mixes.length ? { label: "Mixes", sub: () => ({ type: "mixes" }) } : null, // once there's a mix
    ].filter(Boolean);
    if (mixId && this.mixById(mixId)) {
      items.push("-");
      for (const it of this.mixBoxMenuItems(mixId, lora?.path || null, at)) items.push(it);
    } else if (lora) {
      items.push("-");
      for (const it of this.loraMenuItems(lora.path, "active", lora.pos)) items.push(it);
    }
    new PageMenu(this, x, y, { type: "items", items }).open();
  }

  /** Right-click inside a mix's box: options for the LoRA under the pointer (if any), then for the mix. */
  mixBoxMenuItems(id, p, pos = null) {
    const m = this.mixById(id);
    const dirty = this.mixDirty(id);
    const items = [];
    if (p) {
      const owner = this.mixLoading(p);
      const a = this.mixEntry(id);
      if (a?.on && owner && owner !== id) items.push({ label: "Use this mix's copy", run: () => this.useMixCopy(id, p) });
      items.push({ label: "Add to mix", sub: () => ({ type: "items", items: this.addToMixItems(p, this.mixStrengthOf(id, p)) }) });
      items.push({ label: "Show in groups", run: () => this.reveal({ path: p }) });
      items.push({ label: "Remove from mix", danger: true, run: () => this.removeFromMix(id, p) });
      items.push("-");
    }
    items.push(
      { label: "Save", disabled: !dirty, run: () => this.saveMix(id) },
      { label: "Revert", disabled: !dirty, run: () => this.revertMix(id) },
      { label: "Rename mix…", run: () => this.renameMix(id) },
      { label: "Colour…", run: () => { this.overlay = { kind: "mixcolor", mixId: id, ...(pos || { x: 20, y: 40 }) }; this.render(); } },
      { label: "Add these LoRAs on their own", run: () => this.applyMixAsRegular(id) },
      { label: "Remove from ENABLED", run: () => this.removeMixFromEnabled(id) },
      "-",
      { label: "Delete mix…", danger: true, run: () => this.deleteMix(id) },
    );
    return items;
  }

  /** Right-click a mix in Mixes ▸. */
  mixMenuItems(id) {
    return [
      { label: "Rename…", run: () => this.renameMix(id) },
      { label: "Apply as regular LoRAs", run: () => this.applyMixAsRegular(id) },
      "-",
      { label: "Delete…", danger: true, run: () => this.deleteMix(id) },
    ];
  }

  /** Favourites ▸: the tiers once more than one is in use, else the top tier's contents directly (quick mode). */
  favRootSpec() {
    return this.tierMode() ? { type: "tiers" } : { type: "favs", tier: this.state.tiers[0].id, coll: null, root: true };
  }

  // ----- the ☆ on a LoRA row
  onStarClick(p, btn) {
    btn._where = btn.closest("[data-where]")?.dataset.where; // remembered before the row is redrawn
    if (!this.isFav(p)) {
      this.addFav(p); // into the default tier
      if (!this.state.settings.favMenuOnClick) return;
    }
    this.openStarMenu(p, btn); // a filled star always opens the menu, so a favourite can't be removed by accident
  }

  openStarMenu(p, btn) {
    this.hideTip();
    if (!btn.isConnected) {
      // adding the favourite redrew the row: find the same star again
      const where = btn.closest?.("[data-where]")?.dataset.where || btn._where;
      btn = this.el.querySelector(`.spll-lora[data-path="${CSS.escape(p)}"]${where ? `[data-where="${where}"]` : ""} .spll-star`) || btn;
    }
    const r = btn.getBoundingClientRect();
    new PageMenu(this, r.left - 180, r.bottom + 2, { type: "items", title: this.displayName(p), items: () => this.starItems(p) }, { anchor: btn }).open();
  }

  /** The ☆ menu: pick a tier (or a collection in it), remove, and the left-click toggle. */
  starItems(p) {
    const s = this.state;
    const cur = this.tierOf(p);
    const coll = s.favColl[p] || null;
    const items = s.tiers.map((t) => ({
      label: t.name, color: t.color, tier: t, check: cur?.id === t.id && !coll,
      run: () => this.setFavPlace(p, t.id, null),
      sub: s.collections.some((c) => c.tier === t.id) ? () => ({ type: "items", items: this.collPickItems(t.id, (cid) => this.setFavPlace(p, t.id, cid), cur?.id === t.id ? coll : undefined) }) : null,
    }));
    items.push("-");
    if (this.isFav(p)) items.push({ label: "Remove from favourites", danger: true, run: () => this.removeFav(p) });
    items.push({ label: "New collection with this LoRA…", run: () => this.newCollection(cur?.id || this.defaultTier().id, null, p) });
    items.push("-", { label: "Open this menu when I click ☆", check: s.settings.favMenuOnClick, keep: true, run: () => this.commit((st) => { st.settings.favMenuOnClick = !st.settings.favMenuOnClick; }) });
    return items;
  }

  /** Every collection in a tier, indented by depth, as menu items. */
  collPickItems(tier, pick, current) {
    const out = [];
    const walk = (parent, depth) => {
      for (const c of this.collsIn(tier, parent)) {
        out.push({ label: `${"   ".repeat(depth)}${depth ? "└ " : ""}${c.name}`, check: current === c.id, run: () => pick(c.id) });
        walk(c.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }

  /** Right-click a favourite inside the Favourites menu. */
  favLoraMenuItems(p) {
    const s = this.state;
    const tier = s.favTier[p] || s.tiers[0].id;
    const coll = s.favColl[p] || null;
    const depthOk = !coll || this.collDepth(coll) < COLL_DEPTH;
    const items = [
      { label: "New collection with this LoRA…", disabled: !depthOk, closeMenu: true, run: () => this.newCollection(tier, coll, p) },
    ];
    if (s.collections.some((c) => c.tier === tier)) {
      items.push({ label: "Move to collection", sub: () => ({ type: "items", items: [
        ...(coll ? [{ label: `(loose in ${this.tierById(tier)?.name})`, keep: true, run: () => this.setFavPlace(p, tier, null) }] : []),
        ...this.collPickItems(tier, (cid) => this.setFavPlace(p, tier, cid), coll).map((it) => ({ ...it, keep: true })),
      ] }) });
    }
    if (s.tiers.length > 1) {
      items.push({ label: "Move to tier", sub: () => ({ type: "items", items: s.tiers.map((t) => ({
        label: t.name, color: t.color, tier: t, check: t.id === tier, keep: true, run: () => this.setFavPlace(p, t.id, null),
      })) }) });
    }
    items.push({ label: "Add to mix", sub: () => ({ type: "items", items: this.addToMixItems(p) }) });
    items.push("-", { label: "Show in groups", run: () => this.reveal({ path: p }) });
    items.push({ label: "Remove from favourites", danger: true, keep: true, run: () => this.removeFav(p) });
    return items;
  }

  /** Right-click a collection inside the Favourites menu. */
  collMenuItems(id) {
    const c = this.collById(id);
    if (!c) return null;
    const items = [
      { label: "Rename…", run: () => this.renameColl(id) },
      { label: "New collection inside…", disabled: this.collDepth(id) >= COLL_DEPTH, run: () => this.newCollection(c.tier, id) },
    ];
    if (this.state.tiers.length > 1) {
      items.push({ label: "Move to tier", sub: () => ({ type: "items", items: this.state.tiers.map((t) => ({
        label: t.name, color: t.color, tier: t, check: t.id === c.tier, keep: true, run: () => this.moveColl(id, t.id, null),
      })) }) });
    }
    if (c.parent) items.push({ label: "Move up a level", keep: true, run: () => this.moveColl(id, c.tier, this.collById(c.parent)?.parent || null) });
    items.push("-", { label: "Delete collection…", danger: true, run: () => this.deleteColl(id) });
    return items;
  }

  /** Right-click a tier inside the Favourites menu. */
  tierMenuItems(id) {
    return [
      { label: "Rename…", run: () => this.renameTier(id) },
      { label: "Colour…", run: () => this.pickTierColor(id) },
      { label: "New collection…", run: () => this.newCollection(id, null) },
      ...(this.state.tiers.length > 1 ? ["-", { label: "Remove tier…", danger: true, run: () => this.removeTiers([id]) }] : []),
    ];
  }

  /** Open the browser's colour picker for a tier. */
  pickTierColor(id) {
    const t = this.tierById(id);
    if (!t) return;
    const inp = h("input", { type: "color", value: t.color, style: { position: "fixed", left: "-100px", top: "0" } });
    document.body.append(inp);
    inp.addEventListener("input", () => this.setTierColor(id, inp.value));
    inp.addEventListener("change", () => { this.setTierColor(id, inp.value); inp.remove(); });
    inp.addEventListener("blur", () => setTimeout(() => inp.remove(), 300));
    inp.click();
  }

  /**
   * The tier settings, the same in Settings → Favourites and in the Favourites menu's Tiering Settings:
   * tiers (number, names, colours, order), the default tier for ☆, the left-click menu toggle, when tier
   * submenus show, and a reset.
   */
  tierSettingsEl() {
    const s = this.state;
    const wrap = h("div", { class: "spll-tiering" });
    const list = h("div", { class: "spll-tier-list" });
    for (const t of s.tiers) {
      const n = this.favCount(t.id);
      const color = h("input", { type: "color", class: "spll-color-input", value: t.color, title: "Main colour" });
      color.addEventListener("input", () => this.setTierColor(t.id, color.value));
      const shine = h("input", { type: "color", class: "spll-color-input", value: t.shine || shineOf(t.color), title: "Shine (the glint on its stars)" });
      shine.addEventListener("input", () => this.setTierColor(t.id, shine.value, "shine"));
      const outline = h("input", { type: "color", class: "spll-color-input spll-tier-outline" + (t.outline ? "" : " is-auto"), value: outlineOf(t), title: t.outline ? "Outline (your colour)" : "Outline (automatic: a darker shade of the main colour). Pick one to override." });
      outline.addEventListener("input", () => this.setTierColor(t.id, outline.value, "outline"));
      const autoBtn = t.outline ? h("button", { class: "spll-icon spll-tier-reset", title: "Outline back to automatic", text: "↺" }) : null;
      autoBtn?.addEventListener("click", () => this.commit((st) => { const x = st.tiers.find((y) => y.id === t.id); if (x) x.outline = null; }));
      const name = h("input", { class: "spll-pop-input spll-tier-input", type: "text", value: t.name, spellcheck: "false", "data-fkey": `tier-name-${t.id}` });
      name.addEventListener("change", () => this.renameTier(t.id, name.value));
      name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });
      const del = h("button", { class: "spll-icon spll-tier-del", title: "Remove this tier", text: "×", disabled: s.tiers.length <= 1 });
      del.addEventListener("click", () => this.removeTiers([t.id]));
      list.append(h("div", { class: "spll-tier-item", "data-id": t.id },
        h("span", { class: "spll-grip", title: "Drag to reorder (top = most important)", text: "⠿" }),
        color, shine, outline, autoBtn, name,
        h("span", { class: "spll-hint spll-tier-count", text: `${n}` }),
        del));
    }
    this.sortableTiers(list);
    const minus = h("button", { class: "spll-step", title: "One fewer tier", text: "−", disabled: s.tiers.length <= 1 });
    minus.addEventListener("click", () => this.setTierCount(s.tiers.length - 1));
    const plus = h("button", { class: "spll-step", title: "One more tier", text: "+", disabled: s.tiers.length >= MAX_TIERS });
    plus.addEventListener("click", () => this.addTier());
    const def = h("select", { class: "spll-select" }, ...s.tiers.map((t) => h("option", { value: t.id, selected: t.id === this.defaultTier().id, text: t.name })));
    def.addEventListener("change", () => this.commit((st) => { st.settings.favDefaultTier = def.value === st.tiers[0].id ? null : def.value; }));
    const onClick = h("input", { type: "checkbox", checked: s.settings.favMenuOnClick });
    onClick.addEventListener("change", () => this.commit((st) => { st.settings.favMenuOnClick = onClick.checked; }));
    const mode = (v, label) => {
      const r = h("input", { type: "radio", name: `spll-tm-${this.node.id}-${Math.random().toString(36).slice(2, 6)}`, checked: s.settings.tierSubmenus === v });
      r.addEventListener("change", () => this.commit((st) => { st.settings.tierSubmenus = v; }));
      return h("label", { class: "spll-check" }, r, ` ${label}`);
    };
    const radios = [mode("auto", "Only once something is outside the top tier"), mode("always", "Always")];
    const name = `spll-tm-${this.node.id}`;
    for (const r of radios) r.querySelector("input").name = name;
    const reset = h("button", { class: "spll-btn spll-btn-sm", text: "Reset to Gold, Silver, Bronze" });
    reset.addEventListener("click", () => this.resetTiers());
    wrap.append(
      h("div", { class: "spll-field" },
        h("div", { class: "spll-field-row" }, h("label", { class: "spll-label", text: `Tiers: ${s.tiers.length}` }), minus, plus),
        list,
        h("span", { class: "spll-hint", text: "Top = most important. Removing a tier that holds favourites asks where they should go." })),
      h("div", { class: "spll-field" },
        h("label", { class: "spll-label", text: "Clicking ☆ on a LoRA adds it to" }), def,
        h("label", { class: "spll-check" }, onClick, " …and opens the tier menu (right-click ☆ always opens it)")),
      h("div", { class: "spll-field" }, h("label", { class: "spll-label", text: "Tier submenus in Favourites" }), ...radios),
      h("div", { class: "spll-field-row" }, reset),
    );
    return wrap;
  }

  /** Highlight colours, so a colour scheme can't hide the node's highlights and flashes. */
  hlSettingsEl() {
    const hl = this.state.settings.hl;
    const rows = [
      ["accent", "Accent: hover outlines, drop lines, the focused search box, select mode"],
      ["on", "Switched on: switches, and favourites that are on"],
      ["fade", "Undo fade: the flash when a LoRA is switched off"],
      ["flash", "Jump flash: a LoRA shown in the groups from ENABLED or Favourites"],
      ["result", "Search result highlight"],
      ["mix", "Mix boxes in ENABLED"],
    ];
    const set = (k, v) => this.commit((st) => { st.settings.hl[k] = v; });
    const field = h("div", { class: "spll-field" }, h("label", { class: "spll-label", text: "Highlight colours" }));
    for (const [k, label] of rows) {
      const auto = k === "result" && !hl.result;
      const inp = h("input", { type: "color", class: "spll-color-input", value: hl[k] || "#e8e8e7", disabled: auto });
      inp.addEventListener("change", () => set(k, inp.value));
      const row = h("div", { class: "spll-hl-row" }, inp, h("span", { class: "spll-hl-label spll-hint", text: label }));
      if (k === "result") {
        const cb = h("input", { type: "checkbox", checked: auto });
        cb.addEventListener("change", () => set("result", cb.checked ? null : "#e8e8e7"));
        row.append(h("label", { class: "spll-check" }, cb, " Automatic"));
      } else if (hl[k] !== HL_DEFAULTS[k]) {
        const reset = h("button", { class: "spll-icon spll-tier-reset", title: "Back to the default colour", text: "↺" });
        reset.addEventListener("click", () => set(k, HL_DEFAULTS[k]));
        row.append(reset);
      }
      field.append(row);
    }
    field.append(h("span", { class: "spll-hint", text: "Automatic search highlight uses the opposite of each row's colour." }));
    return field;
  }

  /** Drag tiers by their grip to reorder them. */
  sortableTiers(list) {
    list.addEventListener("pointerdown", (e) => {
      const grip = e.target.closest(".spll-grip");
      if (!grip || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const row = grip.closest(".spll-tier-item");
      row.classList.add("is-dragging");
      const move = (ev) => {
        const others = [...list.children].filter((r) => r !== row);
        const before = others.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
        if (before) { if (row.nextElementSibling !== before) list.insertBefore(row, before); }
        else if (list.lastElementChild !== row) list.append(row);
      };
      const up = () => {
        window.removeEventListener("pointermove", move, true);
        window.removeEventListener("pointerup", up, true);
        row.classList.remove("is-dragging");
        const ids = [...list.children].map((r) => r.dataset.id);
        if (ids.join() !== this.state.tiers.map((t) => t.id).join()) this.reorderTiers(ids);
      };
      window.addEventListener("pointermove", move, true);
      window.addEventListener("pointerup", up, true);
    });
  }

  loraMenuItems(p, where, pos) {
    const missing = this.missing.has(p);
    const gid = this.m.groupOfLora.get(p);
    const items = [];
    if (!missing && where !== "result") items.push({ label: "Edit nickname…", run: () => { this.overlay = null; this.editing = { path: p, where }; this.render(); this.focusNick(p, where); } });
    if (where !== "active") items.push({ label: "Move to…", run: () => { this.overlay = { kind: "move", path: p, current: gid, title: `Move “${this.displayName(p)}” to…`, ...pos }; this.render(); } });
    if (where === "active" || where === "result") items.push({ label: "Show in groups", run: () => { this.overlay = null; this.reveal({ path: p }); } });
    // in ENABLED's page menu it's a submenu; the menus drawn inside the node swap to the list of mixes
    items.push(where === "active"
      ? { label: "Add to mix", sub: () => ({ type: "items", items: this.addToMixItems(p) }) }
      : { label: "Add to mix ▸", run: () => this.openAddToMixMenu(p, pos) });
    items.push({ label: this.isFav(p) ? "Remove from favourites" : "Add to favourites", run: () => this.toggleFav(p) });
    items.push({ label: "Unlist", run: () => this.unlistLora(p) });
    if (this.state.sources.loras.includes(p) && !this.sourceOf(p)) items.push("-", { label: "Remove from node", danger: true, run: () => this.removeLora(p) });
    if (missing) items.push("-", { label: "Remove from layout", danger: true, run: () => this.removeMissing(p) });
    return items;
  }

  /** The in-node menu for Add to mix: every mix (✓ where it's in already) and New mix…. */
  openAddToMixMenu(p, pos) {
    const items = this.addToMixItems(p)().map((it) => (it === "-" ? it : { ...it, label: (it.check ? "✓ " : "") + it.label }));
    this.overlay = { kind: "menu", ...pos, title: `Add “${this.displayName(p)}” to mix`, items };
    this.render();
  }

  openLoraMenu(p, where, pos) {
    const items = this.loraMenuItems(p, where, pos);
    this.overlay = { kind: "menu", ...pos, title: this.displayName(p), items };
    this.render();
  }

  focusNick(p, where) {
    requestAnimationFrame(() => {
      const inp = this.el.querySelector(`[data-fkey="${CSS.escape(`nick:${where}:${p}`)}"]`);
      if (inp) { inp.focus(); inp.select(); }
    });
  }

  promptRename(gid, pos) {
    const g = this.m.byId.get(gid);
    this.overlay = {
      kind: "prompt", ...pos, title: "Rename group", value: g.name, okLabel: "Rename",
      ok: (v) => { v = v.trim(); if (v) this.commit(() => { g.name = v.slice(0, 200); }); },
    };
    this.render();
  }

  promptNewGroup(parentId, pos) {
    this.overlay = {
      kind: "prompt", ...(pos || {}), title: parentId ? `New group inside “${this.m.byId.get(parentId)?.name}”` : "New group", value: "", placeholder: "Group name", okLabel: "Create",
      ok: (v) => {
        v = v.trim();
        if (!v) return;
        this.commit((s) => {
          s.groups.push({ id: uid(), name: v.slice(0, 200), color: null, parent: parentId || null, folder: null, collapsed: false });
          if (parentId) this.expandTo(parentId, true);
        });
      },
    };
    this.render();
  }

  async confirmDeleteGroup(gid) {
    const g = this.m.byId.get(gid);
    this.overlay = null;
    this.render();
    const dest = g.parent ? `“${this.m.byId.get(g.parent)?.name}”` : "“Unsorted”";
    const ok = await confirmDialog(
      "Delete group?",
      `Delete “${g.name}”? Its LoRAs and subgroups move to ${dest}. Nothing on disk is deleted.`,
      []
    );
    if (ok) this.deleteGroup(gid);
  }

  /** Slide Search Files back in (its term stays for next time). */
  closeFooterSearch() {
    this.fileSearches.footer.close();
    this.footerOpen = false;
    this.footerEl.classList.remove("is-open");
    this.sizeFsWrap();
    if (document.activeElement === this.fsInput) this.fsInput.blur();
  }

  resultSlot(t) {
    if (this.gDropEl.contains(t)) return this.gOpen ? `g:${this.gOpen}` : null;
    if (this.dropdownEl.contains(t)) return "main";
    return null;
  }

  toggleGroup(gid) {
    if (gid === UNGROUPED) return this.commit((s) => { s.settings.ungroupedCollapsed = !s.settings.ungroupedCollapsed; });
    const g = this.m.byId.get(gid);
    if (g) this.commit(() => { g.collapsed = !g.collapsed; });
  }

  async onClick(e) {
    if (this.suppressClick) { this.suppressClick = false; return; } // the click that ends a drag
    const fadeEl = e.target.closest(".spll-fading");
    if (fadeEl && this.el.contains(fadeEl)) return this.undoFade(fadeEl.dataset.fpath);
    // a click anywhere on a group's bar opens or closes it, except on or near its search box and ⋯ button
    const titleEl = e.target.closest(".spll-tree-title");
    if (titleEl && !this.selectMode && !e.target.closest("button, [data-act], input, .spll-top-drop")) return this.toggleGroupsCollapsed();
    const groupEl = e.target.closest(".spll-group");
    if (this.selectMode && groupEl && this.el.contains(groupEl)) {
      // select mode: clicking a bar ticks it
      if (e.target.closest("[data-act=sel-inside]")) return this.selInside(groupEl.dataset.gid);
      return this.selToggle(groupEl.dataset.gid);
    }
    if (groupEl && this.el.contains(groupEl)) {
      const actEl = e.target.closest("[data-act]");
      if (!actEl || actEl.dataset.act === "collapse") {
        if (!actEl && this.nearGroupControls(groupEl, e)) return;
        this.toggleGroup(groupEl.dataset.gid);
        return;
      }
    }
    const mixHeadEl = e.target.closest(".spll-mix-head");
    if (mixHeadEl && this.el.contains(mixHeadEl) && !e.target.closest("button, [data-act], input")) return this.toggleMixCollapsed(mixHeadEl.dataset.mixid);
    const t = e.target.closest("[data-act]");
    if (!t || !this.el.contains(t)) return;
    const act = t.dataset.act;
    const row = t.closest(".spll-row");
    const path = t.closest("[data-path]")?.dataset.path ?? row?.dataset.path;
    const gid = row?.dataset.gid ?? t.dataset.gid;

    const mixId = row?.dataset.mix;
    if (mixId) { // a LoRA inside a mix's box: changes go to the mix (unsaved until Save)
      if (act === "toggle") return this.toggleMixItem(mixId, path);
      if (act === "dec" || act === "inc") return this.setMixStrength(mixId, path, this.mixStrengthOf(mixId, path) + (act === "inc" ? STEP : -STEP));
    }
    const headMix = t.closest(".spll-mix-head")?.dataset.mixid;
    switch (act) {
      case "mix-toggle": return this.setMixOn(headMix, !this.mixEntry(headMix)?.on);
      case "mix-save": return this.saveMix(headMix);
      case "mix-collapse": return this.toggleMixCollapsed(headMix);
      case "mix-pick-color": { const id = this.overlay?.mixId; this.overlay = null; return this.setMixColor(id, t.dataset.color || null); }
      case "toggle": return this.setActive(path, !this.isActive(path));
      case "dec": return this.setStrength(path, this.strengthOf(path) - STEP);
      case "inc": return this.setStrength(path, this.strengthOf(path) + STEP);
      case "strength": case "gsearch": case "nick-input": case "prompt-input": case "move-filter": case "picker-filter":
        return;
      case "collapse": return this.toggleGroup(gid);
      case "gmenu":
        if (this.overlay?.kind === "menu" && this.overlay.gid === gid) return this.closeOverlay(); // pressed again
        return this.openGroupMenu(gid, this.belowButton(t));
      case "info": return this.openInfo(path);
      case "trigger": return this.onTrigger(path, t);
      case "trig-save": return this.saveTriggersFromPopover();
      case "trig-chip": {
        const o = this.overlay;
        if (o?.kind !== "triggers") return;
        const w = t.dataset.word;
        o.sel = o.sel.includes(w) ? o.sel.filter((x) => x !== w) : [...o.sel, w];
        return this.renderOverlay();
      }
      case "trig-copy": {
        const o = this.overlay;
        if (o?.kind !== "triggers") return;
        const all = this.triggersOf(o.path);
        const words = o.sel.length ? all.filter((w) => o.sel.includes(w)) : all; // listed order
        this.overlay = null;
        this.render();
        return this.copyWords(words, { x: o.x, y: o.y });
      }
      case "trig-notrig": {
        const o = this.overlay;
        if (o?.kind !== "triggers") return;
        const on = t.checked;
        this.overlay = null;
        this.render();
        await new Promise((r) => setTimeout(r, 150));
        return this.setNoTrigger(o.path, on);
      }
      case "no-trigger-all": this.overlay = null; this.render(); await new Promise((r) => setTimeout(r, 120)); return this.noTriggerAll();
      case "copy-close": return this.closeOverlay();
      case "set-blur": return this.commit((s) => { s.settings.blur = t.checked; });
      case "set-color-mode": return this.commit((s) => { s.settings.colorMode = t.value === "alternating" ? "alternating" : "individual"; });
      case "clear-main":
        this.mainQuery = ""; this.mainOpen = false; this.fileSearches.main.close(); this.render(); this.searchInput.focus(); return;
      case "new-group": return this.promptNewGroup(null, this.posFromEvent(e));
      case "rescan":
        if (!this.hasFolders()) return; // nothing to rescan: the file search always reads the folders live
        scanCache.clear();
        return this.refresh({ force: true });
      case "files-open":
        if (this.footerOpen) return this.closeSlot("fs");
        this.openSlot("fs", true);
        this.fsInput.focus({ preventScroll: true });
        this.fsInput.select(); // typing replaces the last term
        return;
      case "files-clear":
        this.fsInput.value = "";
        this.fsClear.hidden = true;
        this.fileSearches.footer.close();
        this.fsInput.focus({ preventScroll: true });
        return;
      case "dis-clear":
        this.disInput.value = "";
        this.disClear.hidden = true;
        this.closeSlot("dis");
        this.disInput.focus({ preventScroll: true });
        return;
      case "gsearch-clear": {
        const g = t.closest(".spll-row")?.dataset.gid;
        if (!g) return;
        this.groupQueries.delete(g);
        this.closeSlot(`g:${g}`);
        this.renderTree();
        this.restoreFocus({ key: `gs:${g}`, start: 0, end: 0 });
        return;
      }
      case "files-toggle":
        this.fileMode = !this.fileMode;
        this.mainOpen = false;
        this.hideTip();
        if (this.fileMode && this.mainQuery) this.fileSearches.main.setQuery(this.mainQuery);
        else this.fileSearches.main.close();
        this.render();
        this.searchInput.focus();
        return;
      case "settings": this.overlay = this.overlay?.kind === "settings" || this.overlay?.kind === "unlisted" ? null : { kind: "settings" }; return this.render();
      case "close": return this.closeOverlay();
      case "menu": {
        const it = this.overlay?.items?.[Number(t.dataset.i)];
        this.overlay = null;
        this.render();
        it?.run?.();
        return;
      }
      case "prompt-ok": {
        const o = this.overlay;
        const v = this.overlayEl.querySelector(".spll-pop-input")?.value ?? "";
        this.overlay = null;
        o?.ok?.(v);
        return this.render();
      }
      case "pick-color": {
        const g = this.m.byId.get(this.overlay?.gid);
        if (g) this.commit(() => { g.color = t.dataset.color || null; });
        return;
      }
      case "move-to": {
        const o = this.overlay;
        this.overlay = null;
        const target = t.dataset.target || null;
        if (o?.path) { if (target) this.moveLora(o.path, target); else this.render(); }
        else if (o?.gid) this.moveGroup(o.gid, target);
        return;
      }
      // a result keeps its results open and stays highlighted in the groups until they close
      case "reveal-group": return this.reveal({ gid: t.dataset.gid }, { hold: this.resultSlot(t) });
      case "reveal-lora": if (e.button === 0) this.reveal({ path }, { hold: this.resultSlot(t) }); return;
      case "fav": return this.onStarClick(path, t);
      case "active-menu": { const b = t.getBoundingClientRect(); return this.openActiveMenu(b.left, b.bottom + 2, null); }
      case "clear-history": return this.commit((s) => { s.history = []; });
      case "bulk-cancel": if (this.bulk) { this.bulk.cancel = true; this.render(); } return;
      case "remove-folder": this.overlay = null; this.render(); return this.removeFolder(t.dataset.key);
      case "show-unlisted": this.overlay = { kind: "unlisted" }; return this.render();
      case "settings-tab": this.settingsTab = t.dataset.tab; return this.render();
      case "sort-pick": { const o = this.overlay; this.overlay = null; return this.setSort(o.container, t.dataset.mode, !!o.sub); }
      case "sort-sub": if (this.overlay?.kind === "sort") this.overlay.sub = t.checked; return;
      case "groups-sort":
        this.hideTip();
        if (this.isFlat()) { this.overlay = { kind: "flatsort", ...this.posFromEvent(e) }; return this.render(); }
        return this.openSort("", this.posFromEvent(e));
      case "flat-sort-pick": this.overlay = null; return this.commit((s) => { s.settings.flatSort = t.dataset.mode; });
      case "flat-toggle":
        this.hideTip();
        this.treeEl.scrollTop = 0;
        return this.commit((s) => { s.settings.flatList = !s.settings.flatList; });
      case "expand-all": return this.commit((s) => { for (const g of s.groups) g.collapsed = false; s.settings.ungroupedCollapsed = false; });
      case "collapse-all": return this.commit((s) => { for (const g of s.groups) g.collapsed = true; s.settings.ungroupedCollapsed = true; });
      case "select-groups": this.hideTip(); return this.startSelect();
      case "sel-all": return this.selAll();
      case "sel-invert": return this.selInvert();
      case "sel-apply": return this.selApply();
      case "sel-cancel": return this.selCancel();
      case "relist": return this.relist(t.dataset.kind, t.dataset.key);
      case "back-settings": this.overlay = { kind: "settings" }; return this.render();
      case "export-layout": return this.exportLayout();
      case "import-layout": return this.pickLayoutFile();
      case "import-favhist": return this.finishImportFavHist(t.dataset.answer === "yes");
      case "set-history-off": return this.commit((s) => { s.settings.historyLength = t.checked ? 0 : 30; });
      case "change-root": this.overlay = null; return this.openPicker();
      case "picker-tick": {
        if (!this.picker || t.disabled) return;
        const k = t.dataset.sel;
        if (t.checked) {
          this.picker.sel.add(k);
          // ticking a folder covers everything inside it
          const [kind, b, rel] = k.split("|");
          if (kind === "folder") for (const x of [...this.picker.sel]) {
            const [, xb, xr] = x.split("|");
            if (x !== k && xb === b && under(xr, rel || "")) this.picker.sel.delete(x);
          }
        } else this.picker.sel.delete(k);
        return this.render();
      }
      case "picker-expand": {
        const k = t.dataset.key;
        if (this.picker) { if (this.picker.expanded.has(k)) this.picker.expanded.delete(k); else this.picker.expanded.add(k); this.render(); }
        return;
      }
      case "picker-use": {
        if (!this.picker?.sel.size) return;
        const items = [...this.picker.sel].map((k) => { const [kind, base, rel] = k.split("|"); return { kind, base, rel }; });
        return this.addSources(items);
      }
      case "picker-cancel": this.picker = null; return this.render();
      case "set-unlimited": {
        const on = t.checked;
        return this.commit((s) => { s.settings.listHeight = on ? 0 : 12; });
      }
    }
  }

  onDblClick(e) {
    // (nicknames are edited from the right-click menu, not by double-clicking)
  }

  onInput(e) {
    const t = e.target;
    if (t === this.searchInput) {
      this.mainQuery = t.value;
      this.searchClear.hidden = !this.mainQuery;
      if (!t.value.trim()) return void this.closeSlot("main");
      if (this.slotIsOpen("main")) {
        if (this.fileMode) this.fileSearches.main.setQuery(t.value);
        else this.renderDropdown();
      } else this.openSlot("main", this.hoverSlot === "main");
      return;
    }
    if (t === this.fsInput) {
      this.fsClear.hidden = !t.value;
      return void this.fileSearches.footer.setQuery(t.value);
    }
    if (t === this.disInput) {
      this.disClear.hidden = !t.value;
      if (!this.slotIsOpen("dis")) return void this.openSlot("dis", this.hoverSlot === "dis");
      return void this.fileSearches.dis.setQuery(t.value);
    }
    const act = t.dataset.act;
    if (act === "gsearch") {
      const gid = t.closest(".spll-row").dataset.gid;
      const had = !!this.groupQueries.get(gid);
      if (t.value) this.groupQueries.set(gid, t.value);
      else this.groupQueries.delete(gid);
      this.gsFocus = gid; // keep its box open while you type (it's redrawn below)
      if (!t.value.trim()) this.closeSlot(`g:${gid}`, { keepFocus: true });
      else if (this.gOpen !== gid) this.openSlot(`g:${gid}`, this.hoverSlot === `g:${gid}`);
      if (had !== !!t.value) { const f = this.captureFocus(); this.renderTree(); this.restoreFocus(f); } // shows or hides its ×
      if (this.gOpen === gid) this.renderGroupDrop();
    } else if (act === "move-filter" && this.overlay) {
      this.overlay.filter = t.value;
      const f = this.captureFocus();
      this.renderOverlay();
      this.restoreFocus(f);
    } else if (act === "picker-filter" && this.picker) {
      this.picker.filter = t.value;
      const f = this.captureFocus();
      this.renderOverlay();
      this.restoreFocus(f);
    } else if (act === "set-dropdown-rows") {
      const v = parseInt(t.value, 10);
      if (v >= 1 && v <= 50) { this.state.settings.dropdownRows = v; this.reconcile(); this.render(); this.notify(); }
    } else if (act === "set-list-height") {
      const v = parseInt(t.value, 10);
      if (v >= 1 && v <= 200) { this.state.settings.listHeight = v; this.reconcile(); this.render(); this.notify(); }
    } else if (act === "set-color-a" || act === "set-color-b") {
      if (/^#[0-9a-f]{6}$/i.test(t.value)) {
        this.state.settings[act === "set-color-a" ? "colorA" : "colorB"] = t.value;
        this.renderTree(); this.renderActive(); this.notify();
      }
    } else if (act === "set-history-length") {
      const v = parseInt(t.value, 10);
      if (v >= 1 && v <= 500) {
        this.state.settings.historyLength = v;
        this.state.history = this.state.history.slice(0, v);
        this.notify();
      }
    } else if (act === "set-api-key") {
      setApiKey(t.value.trim());
    } else if (act === "trig-input" || act === "copy-text") {
      // typing in the trigger popover; nothing to do until Save
    } else if (act === "mix-custom-color") {
      const m = this.mixById(this.overlay?.mixId);
      if (m && /^#[0-9a-f]{6}$/i.test(t.value)) { m.color = t.value; this.renderActive(); this.notify(); }
    } else if (act === "custom-color") {
      const g = this.m.byId.get(this.overlay?.gid);
      if (g && /^#[0-9a-f]{6}$/i.test(t.value)) { g.color = t.value; this.renderTree(); this.renderActive(); this.notify(); }
    }
  }

  onKeyDown(e) {
    const t = e.target;
    const act = t.dataset?.act;
    if (e.key === "Escape") {
      if (act === "strength") { t.value = fmt(this.rowStrength(t.closest(".spll-row"))); t.blur(); return; }
      if (act === "nick-input") { this.editing = null; this.render(); return; }
      // Escape closes a search box's results; its term stays (× clears it)
      if (act === "gsearch") { this.closeSlot(`g:${t.closest(".spll-row").dataset.gid}`); t.blur(); return; }
      if (t === this.searchInput) { this.closeSlot("main"); t.blur(); return; }
      if (t === this.fsInput) { this.closeSlot("fs"); return; }
      if (t === this.disInput) { this.closeSlot("dis"); t.blur(); return; }
      if (this.overlay) return this.closeOverlay();
      if (this.picker && this.state.setup) { this.picker = null; return this.render(); }
      return;
    }
    if (e.key === "Enter") {
      if (act === "strength") { t.blur(); return; }
      if (act === "nick-input") { e.preventDefault(); this.finishNick(t); return; }
      if (act === "prompt-input") { this.overlayEl.querySelector("[data-act='prompt-ok']")?.click(); return; }
      if (act === "trig-input") { e.preventDefault(); this.saveTriggersFromPopover(); return; }
      if (t === this.fsInput) return void this.fileSearches.footer.addFirst();
      if (t === this.disInput) return void this.fileSearches.dis.addFirst();
      if (t === this.searchInput && this.fileMode) return void this.fileSearches.main.addFirst();
      if (t === this.searchInput) {
        const first = this.dropdownEl.querySelector(".spll-result[data-act]");
        first?.click();
        return;
      }
      if (act === "gsearch") {
        this.gDropEl.querySelector(".spll-result[data-act]")?.click();
        return;
      }
      if (act === "move-filter") { this.overlayEl.querySelector("[data-act='move-to']")?.click(); return; }
    }
  }

  onFocusIn(e) {
    const t = e.target;
    const slot = t === this.searchInput ? "main" : t === this.disInput ? "dis" : t.dataset?.act === "gsearch" ? `g:${t.closest(".spll-row")?.dataset.gid}` : null;
    if (slot?.startsWith("g:")) { this.gsFocus = slot.slice(2); t.closest(".spll-gsearch-wrap")?.classList.add("is-open"); }
    if (slot && this.slotTerm(slot) && !this.slotIsOpen(slot)) this.openSlot(slot, this.hoverSlot === slot);
    if (t === this.fsInput && t.value && this.footerOpen) this.fileSearches.footer.setQuery(t.value);
    if (t.dataset?.act === "strength") {
      // select the value so typing replaces it; the mouseup that follows a click would otherwise clear the selection
      try { t.select(); } catch { /* */ }
      t._spllKeepSelection = true;
    }
  }

  onMouseUp(e) {
    const t = e.target;
    if (t?._spllKeepSelection) {
      t._spllKeepSelection = false;
      e.preventDefault();
    }
  }

  onFocusOut(e) {
    const t = e.target;
    const act = t.dataset?.act;
    if (act === "strength") {
      const row = t.closest(".spll-row");
      const p = row?.dataset.path;
      const v = parseFloat(String(t.value).replace(",", "."));
      if (p && isFinite(v) && round2(v) !== this.rowStrength(row)) {
        if (row.dataset.mix) this.setMixStrength(row.dataset.mix, p, v);
        else this.setStrength(p, v);
      } else if (p) t.value = fmt(this.rowStrength(row));
    } else if (act === "nick-input") {
      // a click outside the node leaves it open (so you can copy text in); see onPointerDown
      if (Date.now() - (this.lastOutsideDown || 0) < 400) return;
      // the row may be re-rendered (and blur fire) while a confirm dialog is open
      if (this.editing && !this.nickBusy) this.finishNick(t);
    }
  }

  finishNick(input) {
    if (this.nickBusy) return;
    const row = input.closest(".spll-row");
    const p = row?.dataset.path;
    const value = input.value;
    this.editing = null;
    this.nickBusy = true;
    // Wait for the current key/pointer event to finish, otherwise ComfyUI's dialog
    // treats that same event as a dismissal and closes immediately.
    setTimeout(async () => {
      try { await this.saveNickname(p, value); } finally { this.nickBusy = false; }
    }, 150);
  }

  // ----- press-and-hold drag (every drop is confirmed)
  // A quick press is a click. Holding the left button for HOLD_MS starts a drag; moving while holding
  // doesn't cancel the timer, as long as the press started on the row.
  onDragPress(e) {
    if (e.button !== 0 || this.dragging || this.arm || this.selectMode) return;
    const t = e.target;
    if (isTextInput(t) || t.closest("button, input, textarea, select, a, .spll-gsearch-wrap")) return;
    const groupEl = t.closest(".spll-group");
    const mixHead = t.closest(".spll-mix-head");
    const loraEl = mixHead ? null : t.closest(".spll-lora");
    const rowEl = groupEl || mixHead || loraEl;
    if (!rowEl || !this.el.contains(rowEl) || this.editing) return;
    if (groupEl && groupEl.dataset.gid === UNGROUPED) return;
    const d = groupEl
      ? { kind: "group", gid: groupEl.dataset.gid, label: this.m.byId.get(groupEl.dataset.gid)?.name || "" }
      : mixHead
        ? { kind: "mix", key: `m:${mixHead.dataset.mixid}`, where: "active", label: this.mixById(mixHead.dataset.mixid)?.name || "" }
        : { kind: "lora", path: loraEl.dataset.path, key: loraEl.dataset.path, where: loraEl.dataset.where, mix: loraEl.dataset.mix || null, label: this.displayName(loraEl.dataset.path) };
    const arm = { d, rowEl, pointerId: e.pointerId, x: e.clientX, y: e.clientY };
    this.arm = arm;
    rowEl.classList.add("is-arming");
    const move = (ev) => {
      if (ev.pointerId !== arm.pointerId) return;
      arm.x = ev.clientX;
      arm.y = ev.clientY;
      if (this.dragging) { ev.stopPropagation(); this.dragMove(); }
    };
    const up = (ev) => {
      if (ev.pointerId !== arm.pointerId) return;
      const wasDragging = !!this.dragging;
      this.lastArm = { x: ev.clientX, y: ev.clientY };
      cleanup();
      if (wasDragging) {
        ev.stopPropagation();
        this.suppressClick = true;
        setTimeout(() => { this.suppressClick = false; }, 400);
        this.dragDrop();
      }
    };
    const cancel = (ev) => { if (ev.pointerId === arm.pointerId) { cleanup(); this.endDrag(); } };
    const key = (ev) => { if (ev.key === "Escape" && this.dragging) { ev.stopPropagation(); ev.preventDefault(); cleanup(); this.endDrag(); } };
    const cleanup = () => {
      clearTimeout(arm.timer);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
      window.removeEventListener("keydown", key, true);
      rowEl.classList.remove("is-arming");
      if (this.arm === arm) this.arm = null;
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    window.addEventListener("keydown", key, true);
    arm.timer = setTimeout(() => this.startDrag(arm), HOLD_MS);
  }

  startDrag(arm) {
    if (this.arm !== arm) return;
    arm.rowEl.classList.remove("is-arming");
    this.hideTip();
    this.dragging = arm.d;
    this.ghost = h("div", { class: "spll spll-drag-ghost" },
      h("span", { class: "spll-drag-kind", text: arm.d.kind === "group" ? "Group" : arm.d.kind === "mix" ? "Mix" : "LoRA" }),
      h("span", { text: arm.d.label }));
    document.body.append(this.ghost);
    this.el.classList.add("is-dragging", arm.d.kind === "group" ? "is-dragging-group" : "is-dragging-lora");
    // keep auto-scrolling while the pointer rests near the list's edge
    this.dragScroll = setInterval(() => this.dragAutoScroll(), 40);
    this.dragMove();
  }

  dragAutoScroll() {
    const a = this.arm;
    if (!a || !this.dragging) return;
    // ENABLED scrolls too (mix boxes can be out of view)
    const al = this.activeEl.querySelector(".spll-active-list");
    const ar = al?.getBoundingClientRect();
    if (ar && a.x >= ar.left && a.x <= ar.right && al.scrollHeight > al.clientHeight) {
      if (a.y < ar.top + 14 && a.y > ar.top - 30) { al.scrollTop -= 10; this.activeScroll = al.scrollTop; return this.markDrop(); }
      if (a.y > ar.bottom - 14 && a.y < ar.bottom + 30) { al.scrollTop += 10; this.activeScroll = al.scrollTop; return this.markDrop(); }
    }
    const r = this.treeEl.getBoundingClientRect();
    if (a.x < r.left || a.x > r.right) return;
    const edge = 28 * (r.height / (this.treeEl.offsetHeight || r.height));
    if (a.y < r.top + edge && a.y > r.top - 40) this.treeEl.scrollTop -= 14;
    else if (a.y > r.bottom - edge && a.y < r.bottom + 40) this.treeEl.scrollTop += 14;
    else return;
    this.markDrop();
  }

  dragMove() {
    const a = this.arm;
    if (!a || !this.ghost) return;
    this.ghost.style.left = a.x + 14 + "px";
    this.ghost.style.top = a.y + 10 + "px";
    this.markDrop();
  }

  hitAt(x, y) {
    const target = document.elementFromPoint(x, y);
    if (!target || !this.el.contains(target)) return null;
    return this.dropTarget({ target, clientY: y });
  }

  markDrop() {
    const a = this.arm;
    this.clearDropMarks();
    const target = a ? this.hitAt(a.x, a.y) : null;
    if (!target) return;
    if (["reorder", "lora-order", "group-order", "into-mix", "mix-order", "out-of-mix"].includes(target.kind) && target.before !== null && target.before !== undefined) {
      target.el.classList.add(target.before ? "is-drop-before" : "is-drop-after");
    }
    else target.el?.classList.add("is-drop");
  }

  async dragDrop() {
    const d = this.dragging;
    const a = this.lastArm;
    const target = a ? this.hitAt(a.x, a.y) : null;
    this.endDrag();
    if (!d || !target) return;
    await new Promise((r) => setTimeout(r, 120)); // let the pointer event finish before a dialog opens
    if (target.kind === "lora-group") {
      const ok = await confirmDialog("Move LoRA?", `Move “${this.displayName(d.path)}” to “${this.groupPath(target.gid)}”?`, []);
      if (ok) this.moveLora(d.path, target.gid);
    } else if (target.kind === "group-group") {
      const ok = await confirmDialog("Move group?", `Move “${this.m.byId.get(d.gid)?.name}” into “${this.groupPath(target.gid)}”?`, []);
      if (ok) this.moveGroup(d.gid, target.gid);
    } else if (target.kind === "group-top") {
      const ok = await confirmDialog("Move group?", `Move “${this.m.byId.get(d.gid)?.name}” to the top level?`, []);
      if (ok) this.moveGroup(d.gid, null);
    } else if (target.kind === "reorder" || target.kind === "reorder-end") {
      let beforePath = null;
      if (target.kind === "reorder") {
        if (target.before) beforePath = target.path;
        else {
          const k = (x) => (x.mix ? `m:${x.mix}` : x.path);
          const list = this.state.active.filter((x) => k(x) !== d.key);
          const i = list.findIndex((x) => k(x) === target.path);
          beforePath = list[i + 1] ? k(list[i + 1]) : null;
        }
      }
      this.reorderActive(d.key, beforePath); // only order: no confirmation
    } else if (target.kind === "into-mix") {
      this.dropIntoMix(d, target);
    } else if (target.kind === "mix-order") {
      this.reorderMix(d, target);
    } else if (target.kind === "out-of-mix") {
      this.dropOutOfMix(d, target);
    } else if (target.kind === "lora-order") {
      this.moveLoraWithin(d.path, this.afterToBefore(this.m.lorasIn.get(this.m.groupOfLora.get(d.path)) || [], d.path, target));
    } else if (target.kind === "group-order") {
      const g = this.m.byId.get(d.gid);
      const parent = g?.parent && this.m.byId.has(g.parent) ? g.parent : "";
      this.moveGroupWithin(d.gid, this.afterToBefore((this.m.childGroups.get(parent) || []).map((x) => x.id), d.gid, target));
    }
  }

  /** "after X" becomes "before the one after X" (null = the end), with the dragged item taken out. */
  afterToBefore(list, dragged, target) {
    if (target.before) return target.id;
    const rest = list.filter((x) => x !== dragged);
    return rest[rest.indexOf(target.id) + 1] ?? null;
  }

  dropTarget(e) {
    const d = this.dragging;
    if (!d) return null;
    // reordering inside a group: a LoRA over another in its own group, or a group near the top or bottom edge of a sibling's bar
    if (d.kind === "lora" && d.where === "tree") {
      const row = e.target.closest(".spll-lora[data-where='tree']");
      if (row && row.dataset.path !== d.path && this.m.groupOfLora.get(row.dataset.path) === this.m.groupOfLora.get(d.path)) {
        const r = row.getBoundingClientRect();
        return { kind: "lora-order", el: row, before: e.clientY < r.top + r.height / 2, id: row.dataset.path };
      }
    }
    if (d.kind === "group") {
      const bar = e.target.closest(".spll-group");
      const g = this.m.byId.get(d.gid);
      const og = bar && this.m.byId.get(bar.dataset.gid);
      if (og && og.id !== d.gid && (og.parent || "") === (g?.parent || "")) {
        const r = bar.getBoundingClientRect();
        const edge = r.height * 0.3;
        if (e.clientY < r.top + edge || e.clientY > r.bottom - edge) {
          return { kind: "group-order", el: bar, before: e.clientY < r.top + edge, id: og.id };
        }
      }
    }
    if (d.kind === "lora") {
      const mt = this.mixDropTarget(e, d);
      if (mt !== undefined) return mt;
    }
    if ((d.kind === "lora" || d.kind === "mix") && d.where === "active") {
      // ENABLED's entries: LoRAs on their own and whole mix boxes
      const row = e.target.closest(".spll-active-list [data-akey]");
      if (row && row.dataset.akey !== d.key) {
        const r = row.getBoundingClientRect();
        const before = e.clientY < r.top + r.height / 2;
        return { kind: "reorder", el: row, before, path: row.dataset.akey };
      }
      if (e.target.closest(".spll-active-list") && !row) return { kind: "reorder-end", el: e.target.closest(".spll-active-list") };
      if (d.kind === "mix") return null;
    }
    if (d.kind === "mix") return null;
    if (this.isFlat()) return null; // the plain list has no groups to drop on (Move to… still works)
    const top = e.target.closest("[data-zone='top']");
    if (top && d.kind === "group" && this.m.byId.get(d.gid)?.parent) return { kind: "group-top", el: top };
    const groupRow = e.target.closest(".spll-group");
    const loraRow = e.target.closest(".spll-lora[data-where='tree']");
    const boxEl = e.target.closest(".spll-box");
    const gid = groupRow?.dataset.gid || (loraRow ? this.m.groupOfLora.get(loraRow.dataset.path) : null) || boxEl?.dataset.box || null;
    const el = groupRow || (gid ? this.rowEls.get(`g:${gid}`)?.firstElementChild || boxEl || loraRow : null);
    if (!gid) return null;
    if (d.kind === "lora") {
      if (this.m.groupOfLora.get(d.path) === gid) return null;
      return { kind: "lora-group", el, gid };
    }
    if (d.kind === "group") {
      if (gid === UNGROUPED) return null;
      if (gid === d.gid || this.descendants(d.gid).has(gid)) return null;
      if (this.m.byId.get(d.gid)?.parent === gid) return null;
      return { kind: "group-group", el, gid };
    }
    return null;
  }

  /**
   * Dropping a LoRA on a mix's box: into that mix where it lands (or reordering, inside its own box). Near the box's
   * top or bottom edge a LoRA from ENABLED (or one coming out of a mix) goes before or after the whole box instead. A LoRA from a mix dropped in
   * ENABLED outside any box comes out as a LoRA on its own. undefined = not a mix drop, carry on.
   */
  mixDropTarget(e, d) {
    const box = e.target.closest(".spll-active-list .spll-mix-box");
    if (box) {
      const id = box.dataset.mixid;
      const br = box.getBoundingClientRect();
      // the box's top and bottom edges: before or after the whole box (a LoRA from a mix comes out on its own there)
      if ((d.where === "active" || d.where === "mix") && (e.clientY < br.top + 6 || e.clientY > br.bottom - 6)) {
        return { kind: d.where === "active" ? "reorder" : "out-of-mix", el: box, before: e.clientY < br.top + 6, path: box.dataset.akey };
      }
      const row = e.target.closest(".spll-lora[data-mix]");
      const kind = d.mix === id ? "mix-order" : "into-mix";
      if (row && row.dataset.path !== d.path) {
        const r = row.getBoundingClientRect();
        return { kind, el: row, mix: id, before: e.clientY < r.top + r.height / 2, id: row.dataset.path };
      }
      if (row) return null; // over itself
      if (e.target.closest(".spll-mix-head")) {
        const first = box.querySelector(".spll-lora[data-mix]");
        return first && first.dataset.path !== d.path ? { kind, el: first, mix: id, before: true, id: first.dataset.path } : { kind, el: box, mix: id, before: null, id: null };
      }
      return { kind, el: box, mix: id, before: null, id: null };
    }
    if (d.where === "mix" && e.target.closest(".spll-active-list")) {
      const row = e.target.closest(".spll-active-list > [data-akey]");
      if (row) {
        const r = row.getBoundingClientRect();
        return { kind: "out-of-mix", el: row, before: e.clientY < r.top + r.height / 2, path: row.dataset.akey };
      }
      return { kind: "out-of-mix", el: e.target.closest(".spll-active-list"), before: null, path: null };
    }
    return undefined;
  }

  /** Where in a list of paths a drop lands: before target.id, or after it (null = the end). */
  dropIndex(list, target) {
    if (!target.id) return list.length;
    const i = list.indexOf(target.id);
    if (i < 0) return list.length;
    return target.before ? i : i + 1;
  }

  /** A LoRA dragged on to a mix: from GROUPS (added), from ENABLED (moves in), from another mix (copied). */
  dropIntoMix(d, target) {
    const id = target.mix;
    const m = this.mixById(id);
    if (!m) return;
    const p = d.path;
    if (this.unavailable(p)) return;
    if (this.mixItems(id).some((x) => x.path === p) || m.items.some((x) => x.path === p)) {
      return void toast("info", "Already in this mix", `${this.displayName(p)} is already in “${m.name}”.`);
    }
    const strength = d.where === "mix" ? this.mixStrengthOf(d.mix, p) : this.strengthOf(p);
    this.commit((s) => {
      for (const list of [m.items, s.mixDrafts[id]]) {
        if (!list) continue;
        const at = this.dropIndex(list.map((x) => x.path), target);
        list.splice(at, 0, { path: p, strength });
      }
      this.rememberIds(p);
      if (d.where === "active") {
        // it moves: no longer on by itself (its strength stays its group strength)
        const i = s.active.findIndex((x) => x.path === p);
        if (i >= 0) { const [a] = s.active.splice(i, 1); if (a.strength !== 1) s.strengths[p] = a.strength; }
      }
    });
  }

  /** Reorder inside a mix's box: saved straight away (order doesn't change what the model gets). */
  reorderMix(d, target) {
    const id = target.mix;
    const m = this.mixById(id);
    if (!m) return;
    this.commit((s) => {
      for (const list of [m.items, s.mixDrafts[id]]) {
        if (!list) continue;
        const i = list.findIndex((x) => x.path === d.path);
        if (i < 0) continue;
        const [it] = list.splice(i, 1);
        list.splice(this.dropIndex(list.map((x) => x.path), target), 0, it);
      }
    });
  }

  /** A LoRA dragged out of a mix into ENABLED: switched on by itself at the mix's strength; the mix keeps it (greyed). */
  dropOutOfMix(d, target) {
    const p = d.path;
    if (this.isActive(p)) return void toast("info", "Already on by itself", `${this.displayName(p)} is already in ENABLED by itself.`);
    if (this.unavailable(p)) return;
    const strength = this.mixStrengthOf(d.mix, p);
    const k = (x) => (x.mix ? `m:${x.mix}` : x.path);
    this.commit((s) => {
      let at = s.active.length;
      if (target.path) {
        const i = s.active.findIndex((x) => k(x) === target.path);
        if (i >= 0) at = target.before ? i : i + 1;
      }
      s.active.splice(at, 0, { path: p, strength });
      delete s.strengths[p];
      this.rememberIds(p);
      s.history = s.history.filter((x) => x !== p);
    });
  }

  clearDropMarks() {
    for (const n of this.el.querySelectorAll(".is-drop, .is-drop-before, .is-drop-after")) {
      n.classList.remove("is-drop", "is-drop-before", "is-drop-after");
    }
  }

  endDrag() {
    clearInterval(this.dragScroll);
    this.ghost?.remove();
    this.ghost = null;
    this.dragging = null;
    this.clearDropMarks();
    this.el.classList.remove("is-dragging", "is-dragging-group", "is-dragging-lora");
  }

  /** True when a click lands on, or within a few pixels of, a group's search box or ⋯ button. */
  nearGroupControls(groupEl, e) {
    const r = this.el.getBoundingClientRect();
    const scale = r.width / (this.el.offsetWidth || r.width || 1);
    const pad = GROUP_DEAD_ZONE * scale;
    for (const c of groupEl.querySelectorAll(".spll-gsearch-wrap, [data-act='gmenu']")) {
      const b = c.getBoundingClientRect();
      if (e.clientX >= b.left - pad && e.clientX <= b.right + pad && e.clientY >= b.top - pad && e.clientY <= b.bottom + pad) return true;
    }
    return false;
  }

  destroy() {
    for (const f of Object.values(this.fileSearches || {})) f.close();
    window.removeEventListener("pointermove", this.onWinMove, { capture: true });
    window.removeEventListener("pointerdown", this.onWinDown, true);
    this.stripObserver?.disconnect();
    for (const t of this.closeTimers.values()) clearTimeout(t);
    clearTimeout(this.hoverTimer);
    controllers.delete(this);
    this.scanToken++;
  }
}

// ---------------------------------------------------------------- file search
// Searches every loras folder ComfyUI uses, live (it re-reads the folders each time it opens), to add folders or LoRAs.
// Results are drawn over the page so they aren't cut off by the node; they open above or below their search box.
const ICONS = {
  fileSearch: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21H11"/><path d="M13 3v4.5A1.5 1.5 0 0 0 14.5 9H19"/><path d="M13 3l6 6v2"/><circle cx="16.5" cy="16.5" r="3.2"/><path d="m21 21-2.2-2.2"/></svg>',
  folderSearch: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 19.5H5A2 2 0 0 1 3 17.5v-11a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v2.5"/><circle cx="16.5" cy="16.5" r="3.2"/><path d="m21 21-2.2-2.2"/></svg>',
};
const svg24 = (paths) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
Object.assign(ICONS, {
  search: svg24('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.3-4.3"/>'),
  expandAll: svg24('<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>'),
  collapseAll: svg24('<path d="m7 20 5-5 5 5"/><path d="m7 4 5 5 5-5"/>'),
  selectGroups: svg24('<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>'),
  bolt: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"><path d="M13.5 2 4.5 13.5h6.5L9.5 22l10-12.5h-6.5L13.5 2z"/></svg>',
  flatList: svg24('<path d="M9 6h11"/><path d="M9 12h11"/><path d="M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>'),
  sortAz: svg24('<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M20 8h-5"/><path d="M15 10V6.5a2.5 2.5 0 0 1 5 0V10"/><path d="M15 14h5l-5 6h5"/>'),
});
const icon = (name, cls = "") => { const s = h("span", { class: `spll-svg ${cls}` }); s.innerHTML = ICONS[name]; return s; };

class FileSearch {
  constructor(ctrl, input, dir, slot) {
    this.c = ctrl;
    this.input = input;
    this.slot = slot; // which search box this is, for the node's open/close handling
    this.dir = dir; // "up" or "down"
    this.q = "";
    this.data = null;
    this.el = null;
  }

  get isOpen() { return !!this.el; }

  open() {
    if (this.el) return;
    this.el = h("div", { class: "spll spll-fs-results" });
    this.c.applyColorVars(this.el);
    document.body.append(this.el);
    this.el.addEventListener("pointerdown", (e) => { if (e.target.tagName !== "INPUT") e.preventDefault(); }); // keep typing focus
    this.el.addEventListener("click", (e) => this.onClick(e));
    this.el.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    this.el.addEventListener("mouseover", (e) => {
      const p = e.target.closest?.(".spll-fs-row")?.dataset.path;
      this.c.peek(p ? { path: p } : null);
    });
    this.el.addEventListener("mouseleave", () => this.c.peek(null));
    this.onDoc = (e) => { if (this.el && !this.el.contains(e.target) && e.target !== this.input) this.close(); };
    window.addEventListener("pointerdown", this.onDoc, true);
    this.onWin = () => this.place();
    window.addEventListener("resize", this.onWin);
    this.load();
    this.render();
  }

  close() {
    if (this.el && this.c.hold?.slot === this.slot) this.c.releaseHold(); // a result's highlight fades once its results close
    if (this.el) this.c.peek(null);
    window.removeEventListener("pointerdown", this.onDoc, true);
    window.removeEventListener("resize", this.onWin);
    this.el?.remove();
    this.el = null;
    this.data = null; // read fresh next time
  }

  async load() {
    this.loading = true;
    this.error = null;
    try {
      const r = await getJson("/spll/tree");
      if (r.error) throw new Error(r.error);
      this.data = r.bases || [];
    } catch (e) {
      this.error = String(e.message || e);
    }
    this.loading = false;
    this.render();
  }

  setQuery(q) {
    this.q = q;
    if (!this.el) this.open();
    else this.render();
  }

  results() {
    const q = this.q.trim().toLowerCase();
    if (!q || !this.data) return { folders: [], files: [] };
    const folders = [];
    const files = [];
    for (const b of this.data) {
      for (const f of b.folders) if (f.path && f.path.toLowerCase().includes(q)) folders.push({ b, rel: f.path, count: f.count });
      for (const f of b.files) if (basename(f).toLowerCase().includes(q) || f.toLowerCase().includes(q)) files.push({ b, rel: f });
    }
    folders.sort((x, y) => x.rel.length - y.rel.length || x.rel.localeCompare(y.rel));
    files.sort((x, y) => basename(x.rel).toLowerCase().localeCompare(basename(y.rel).toLowerCase()));
    return { folders: folders.slice(0, 60), files: files.slice(0, 300), more: folders.length > 60 || files.length > 300 };
  }

  render() {
    if (!this.el) return;
    const keep = this.el.querySelector(".spll-fs-list")?.scrollTop || 0;
    this.el.innerHTML = "";
    const c = this.c;
    const multi = (this.data || []).length > 1;
    const list = h("div", { class: "spll-fs-list spll-scroll" });
    const q = this.q.trim();
    if (this.error) list.append(h("div", { class: "spll-empty", text: `Couldn't read the LoRA folders: ${this.error}` }));
    else if (!this.data) list.append(h("div", { class: "spll-empty", text: "Reading your LoRA folders…" }));
    else if (!q) list.append(h("div", { class: "spll-empty", text: "Type to search every loras folder. Add whole folders or single LoRAs." }));
    else {
      const r = this.results();
      if (!r.folders.length && !r.files.length) list.append(h("div", { class: "spll-empty", text: "No folders or LoRAs match" }));
      for (const f of r.folders) {
        const added = c.isFolderAdded(f.b.path, f.rel);
        const covered = !added && c.covers(f.b.path, f.rel);
        list.append(h("div", { class: "spll-fs-row is-folder", title: c.fullPath(f.rel, f.b.path) },
          added || covered
            ? h("span", { class: "spll-fs-added", text: added ? "Added" : "Included" })
            : h("button", { class: "spll-btn spll-btn-sm", "data-fs": "add", "data-kind": "folder", "data-base": f.b.path, "data-rel": f.rel, text: "Add folder" }),
          h("span", { class: "spll-picker-icon", text: "📁" }),
          h("span", { class: "spll-result-name", text: basename(f.rel) }),
          h("span", { class: "spll-result-path", text: lorasLabel(f.rel) + (multi ? `  ·  ${f.b.path}` : "") }),
          h("span", { class: "spll-count", text: `${f.count}` }),
        ));
      }
      for (const f of r.files) {
        const inNode = c.covers(f.b.path, f.rel);
        const bid = inNode ? Object.keys(c.state.bases).find((x) => c.basePath(x) === f.b.path) : null;
        list.append(h("div", { class: "spll-fs-row" + (inNode ? " is-in" : ""), title: c.fullPath(f.rel, f.b.path), "data-path": bid ? mkKey(bid, f.rel) : null },
          inNode
            ? h("span", { class: "spll-fs-added", text: "In node" })
            : h("button", { class: "spll-btn spll-btn-sm", "data-fs": "add", "data-kind": "lora", "data-base": f.b.path, "data-rel": f.rel, text: "Add" }),
          h("span", { class: "spll-result-name", "data-fs": inNode ? "jump" : null, "data-base": f.b.path, "data-rel": f.rel, text: stripExt(basename(f.rel)) }),
          h("span", { class: "spll-result-path", text: (relOf(dirname(f.rel)) || dirname(f.rel) || "loras") + (multi ? `  ·  ${f.b.path}` : "") }),
        ));
      }
      if (r.more) list.append(h("div", { class: "spll-empty", text: "More matches: type more to narrow it down." }));
    }
    this.el.append(list);
    list.style.maxHeight = 10 * ROW_H + "px";
    list.scrollTop = keep;
    this.place();
  }

  place() {
    if (!this.el || !this.input.isConnected) return;
    const r = this.input.getBoundingClientRect();
    const w = Math.max(r.width, 340);
    this.el.style.width = w + "px";
    // the footer box grows leftwards, so its results line up on the right; the top search lines up on the left
    const x = this.dir === "up" ? r.right - w : r.left;
    this.el.style.left = clamp(x, 4, Math.max(4, window.innerWidth - w - 4)) + "px";
    if (this.dir === "up") { this.el.style.top = ""; this.el.style.bottom = window.innerHeight - r.top + 4 + "px"; }
    else { this.el.style.bottom = ""; this.el.style.top = r.bottom + 4 + "px"; }
  }

  async onClick(e) {
    const t = e.target.closest("[data-fs]");
    if (!t) return;
    const c = this.c;
    if (t.dataset.fs === "add") {
      t.disabled = true;
      await c.addSources([{ base: t.dataset.base, rel: t.dataset.rel, kind: t.dataset.kind }]);
      this.render();
      this.input.focus();
    } else if (t.dataset.fs === "jump") {
      const b = Object.keys(c.state.bases).find((x) => c.basePath(x) === t.dataset.base);
      if (!b) return;
      c.reveal({ path: mkKey(b, t.dataset.rel) }, { hold: this.slot }); // results stay open
    }
  }

  /** Enter: add the first thing listed that isn't already in the node. */
  addFirst() {
    const btn = this.el?.querySelector("[data-fs=add]");
    btn?.click();
  }
}

// ---------------------------------------------------------------- page-level cascading menu
// Drawn over the page rather than inside the node, so submenus aren't cut off at the node's edge.
// Panels: { type: "items", items, title } | { type: "tiers" } | { type: "favs", tier, coll, root } |
//         { type: "hist" } | { type: "tiering" }.
// Items: "-" or { label, color, check, hint, sub: () => panel, run, keep, closeMenu, danger, disabled }.
//   run + sub: a click runs it, hovering opens the sub. keep: the menu stays open (and redraws) after run.
class PageMenu {
  constructor(ctrl, x, y, root, opts = {}) {
    this.c = ctrl;
    this.x = x;
    this.y = y;
    this.root = root;
    this.opts = opts; // { anchor }: the star menu, which closes itself when the mouse wanders off
    this.panels = [];
    this.openTimer = null;
    this.closeTimer = null;
    this.awayTimer = null;
    this.drag = null;
  }

  open() {
    PageMenu.current?.close();
    PageMenu.current = this;
    this.layer = h("div", { class: "spll spll-pmenu-layer" });
    this.c.applyColorVars(this.layer);
    document.body.append(this.layer);
    this.layer.addEventListener("pointerdown", (e) => { if (e.target === this.layer) this.close(); });
    this.layer.addEventListener("contextmenu", (e) => { e.preventDefault(); if (e.target === this.layer) this.close(); });
    // keys typed into the menu's own boxes stay in the menu (away from ComfyUI's shortcuts)
    for (const type of ["keydown", "keyup", "keypress"]) this.layer.addEventListener(type, (e) => e.stopPropagation());
    this.onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); return this.close(); }
      if (!this.layer.contains(e.target)) e.stopPropagation(); // no canvas shortcuts while the menu is open
    };
    window.addEventListener("keydown", this.onKey, true);
    if (this.opts.anchor) this.layer.addEventListener("pointermove", (e) => this.checkAway(e));
    // hovering a favourite or history row shows the node's tooltip: name, file name, full path
    this.layer.addEventListener("pointerover", (e) => this.tipOver(e));
    this.layer.addEventListener("pointerdown", () => this.hideTip(), true);
    this.layer.addEventListener("scroll", () => this.hideTip(), true);
    this.openPanel(0, this.root, null, { x: this.x, y: this.y });
  }

  tipOver(e) {
    const row = e.target.closest?.(".spll-pmenu-lora[data-path]");
    if (row === this.tipRow) return;
    this.hideTip();
    if (!row || this.drag) return;
    this.tipRow = row;
    this.tipTimer = setTimeout(() => this.showTip(row), 450);
  }

  showTip(row) {
    if (!row.isConnected || this.tipRow !== row) return;
    const c = this.c;
    const p = row.dataset.path;
    const nick = c.files.get(p)?.nickname;
    const tip = h("div", { class: "spll-tip spll-pmenu-tip" },
      h("div", { class: "spll-tip-title", text: c.displayName(p) }),
      nick ? h("div", { class: "spll-tip-line", text: basename(p) }) : null,
      h("div", { class: "spll-tip-line", text: `in ${folderText(p) || "loras"}` }),
      h("div", { class: "spll-tip-path", text: c.fullPath(p) }),
      c.missing.has(p) ? h("div", { class: "spll-tip-warn", text: "File missing on disk" }) : null);
    this.layer.append(tip);
    this.tipEl = tip;
    // beside the menu (not over the list), level with the row
    const r = row.getBoundingClientRect();
    const m = row.closest(".spll-pmenu").getBoundingClientRect();
    const w = tip.offsetWidth, hh = tip.offsetHeight;
    const x = m.right + w + 6 < window.innerWidth ? m.right + 6 : m.left - w - 6;
    tip.style.left = clamp(x, 4, window.innerWidth - w - 4) + "px";
    tip.style.top = clamp(r.top - 4, 4, window.innerHeight - hh - 4) + "px";
  }

  hideTip() {
    clearTimeout(this.tipTimer);
    this.tipRow = null;
    this.tipEl?.remove();
    this.tipEl = null;
  }

  close() {
    this.hideTip();
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    clearTimeout(this.awayTimer);
    window.removeEventListener("keydown", this.onKey, true);
    this.layer?.remove();
    if (PageMenu.current === this) PageMenu.current = null;
  }

  /** The star menu: leaving the menu (and the star) by more than a small buffer closes it after a short delay. */
  checkAway(e) {
    if (this.drag) return;
    const B = 18;
    const rects = this.panels.filter(Boolean).map((p) => p.el.getBoundingClientRect());
    if (this.opts.anchor?.isConnected) rects.push(this.opts.anchor.getBoundingClientRect());
    const near = rects.some((r) => e.clientX >= r.left - B && e.clientX <= r.right + B && e.clientY >= r.top - B && e.clientY <= r.bottom + B);
    if (near) { clearTimeout(this.awayTimer); this.awayTimer = null; }
    else if (!this.awayTimer) this.awayTimer = setTimeout(() => this.close(), 450);
  }

  closeFrom(depth) {
    for (let d = this.panels.length - 1; d >= depth; d--) {
      const p = this.panels[d];
      if (!p) continue;
      p.el.remove();
      this.panels[d - 1]?.el.querySelector(".is-open")?.classList.remove("is-open");
    }
    this.panels.length = Math.min(this.panels.length, depth);
  }

  /** Open a panel at a depth (closing anything deeper), beside the row it came from or at a point. */
  openPanel(depth, spec, anchor, at = null) {
    this.closeFrom(depth);
    const el = h("div", { class: "spll-pmenu" + (depth ? " spll-pmenu-sub" : ""), role: "menu" });
    const p = { depth, spec, el, anchorKey: anchor?.dataset.key || null, at };
    this.panels[depth] = p;
    this.layer.append(el);
    anchor?.classList.add("is-open");
    el.addEventListener("pointerenter", () => clearTimeout(this.closeTimer));
    el.addEventListener("click", (e) => this.onPanelClick(e, p));
    el.addEventListener("contextmenu", (e) => this.onPanelContext(e, p));
    el.addEventListener("pointerdown", (e) => this.startDrag(e, p));
    this.renderPanel(p);
    return p;
  }

  /** Redraw every open panel (after a change); a panel whose row went away closes. */
  refresh({ keepFocused = false } = {}) {
    const focused = document.activeElement;
    for (let d = 0; d < this.panels.length; d++) {
      const p = this.panels[d];
      if (!p) continue;
      if (d > 0 && p.anchorKey && !this.anchorOf(p)) { this.closeFrom(d); break; }
      if (keepFocused && p.el.contains(focused) && focused.matches?.("input, select, textarea")) continue; // e.g. a colour picker that's still open
      this.renderPanel(p);
      if (d > 0 && p.anchorKey) this.anchorOf(p)?.classList.add("is-open");
    }
  }

  anchorOf(p) {
    const parent = this.panels[p.depth - 1];
    return parent && p.anchorKey ? parent.el.querySelector(`[data-key="${CSS.escape(p.anchorKey)}"]`) : null;
  }

  place(el, x, y) {
    el.style.left = "0px";
    el.style.top = "0px";
    const w = el.offsetWidth, hh = el.offsetHeight;
    el.style.left = clamp(x, 4, Math.max(4, window.innerWidth - w - 4)) + "px";
    el.style.top = clamp(y, 4, Math.max(4, window.innerHeight - hh - 4)) + "px";
  }

  position(p) {
    if (p.at) return this.place(p.el, p.at.x, p.at.y);
    const a = this.anchorOf(p);
    if (!a) return;
    const r = a.getBoundingClientRect();
    const w = p.el.offsetWidth;
    const x = r.right + w + 4 < window.innerWidth ? r.right - 2 : r.left - w + 2;
    this.place(p.el, x, r.top - 4);
  }

  // ----- rows and hover
  rowHover(p, row, sub) {
    clearTimeout(this.openTimer);
    clearTimeout(this.closeTimer);
    const next = this.panels[p.depth + 1];
    if (sub) {
      if (next && next.anchorKey === row.dataset.key) return;
      this.openTimer = setTimeout(() => this.openPanel(p.depth + 1, sub(), row), this.drag ? 600 : 120);
    } else if (next && !this.drag) {
      this.closeTimer = setTimeout(() => this.closeFrom(p.depth + 1), 300);
    }
  }

  rowLeave() {
    clearTimeout(this.openTimer);
  }

  /** A row that hovers open a submenu; clicking it opens the submenu at once (or runs it, if it has run). */
  hoverRow(p, row, sub) {
    row.addEventListener("pointerenter", () => this.rowHover(p, row, sub));
    row.addEventListener("pointerleave", () => this.rowLeave());
    return row;
  }

  renderPanel(p) {
    const keep = p.el.querySelector(".spll-pmenu-list")?.scrollTop || 0;
    p.el.innerHTML = "";
    p.el.className = "spll-pmenu" + (p.depth ? " spll-pmenu-sub" : "") + ` is-${p.spec.type}`;
    const t = p.spec.type;
    if (t === "items") this.renderItems(p);
    else if (t === "tiers") this.renderTiers(p);
    else if (t === "favs") this.renderFavs(p);
    else if (t === "hist") this.renderHist(p);
    else if (t === "tiering") this.renderTiering(p);
    else if (t === "mixes") this.renderMixes(p);
    else if (t === "mix") this.renderMix(p);
    const list = p.el.querySelector(".spll-pmenu-list");
    if (list) list.scrollTop = keep;
    this.position(p);
  }

  renderItems(p) {
    const { title } = p.spec;
    const items = typeof p.spec.items === "function" ? p.spec.items() : p.spec.items; // drawn fresh, so ticks stay right
    if (title) p.el.append(h("div", { class: "spll-pop-title", text: title }));
    items.forEach((it, i) => {
      if (!it) return;
      if (it === "-") return void p.el.append(h("div", { class: "spll-sep" }));
      const row = h("div", {
        class: "spll-pmenu-item" + (it.sub ? " has-sub" : "") + (it.danger ? " is-danger" : "") + (it.disabled ? " is-disabled" : ""),
        role: "menuitem", "data-key": `i${i}`,
      },
        it.check !== undefined ? h("span", { class: "spll-tick", text: it.check ? "✓" : "" }) : null,
        it.tier ? tierDot(it.tier) : it.color ? h("span", { class: "spll-tier-dot", style: { background: it.color } }) : null,
        h("span", { class: "spll-pmenu-label", text: it.label, style: { color: it.color || null } }),
        it.hint ? h("span", { class: "spll-pmenu-hint", text: it.hint }) : null,
        it.sub ? h("span", { class: "spll-pmenu-arrow", text: "▸" }) : null,
      );
      row._item = it;
      this.hoverRow(p, row, it.sub && !it.disabled ? it.sub : null);
      p.el.append(row);
    });
  }

  /** Favourites in tier mode: one coloured row per tier, then Tiering Settings. */
  renderTiers(p) {
    const c = this.c;
    const s = c.state;
    const total = s.tiers.reduce((n, t) => n + c.favCount(t.id), 0);
    p.el.append(h("div", { class: "spll-pop-title", text: `Favourites · ${total}` }));
    for (const t of s.tiers) {
      const row = h("div", { class: "spll-pmenu-item has-sub spll-tier-row", "data-key": `tier:${t.id}`, "data-tier": t.id, "data-drop": "tier" },
        tierDot(t),
        h("span", { class: "spll-pmenu-label spll-tier-name", text: t.name, style: { color: t.color } }),
        h("span", { class: "spll-count", text: String(c.favCount(t.id)) }),
        h("span", { class: "spll-pmenu-arrow", text: "▸" }));
      this.hoverRow(p, row, () => ({ type: "favs", tier: t.id, coll: null }));
      p.el.append(row);
    }
    p.el.append(h("div", { class: "spll-sep" }), this.tieringRow(p));
  }

  tieringRow(p) {
    return this.hoverRow(p, h("div", { class: "spll-pmenu-item has-sub spll-tiering-row", "data-key": "tiering" },
      h("span", { class: "spll-pmenu-label", text: "Tiering Settings" }), h("span", { class: "spll-pmenu-arrow", text: "▸" })),
    () => ({ type: "tiering" }));
  }

  /** A tier's or collection's contents: collections first, then LoRAs. */
  renderFavs(p) {
    const c = this.c;
    const s = c.state;
    const { tier, coll, root } = p.spec;
    const t = c.tierById(tier);
    if (!t) return;
    const cl = coll ? c.collById(coll) : null;
    if (coll && !cl) return;
    const colls = c.collsIn(tier, coll);
    const favs = c.favsIn(tier, coll);
    const title = h("div", { class: "spll-pop-title spll-fav-title" },
      root ? h("span", { text: `Favourites · ${c.favCount(tier)}` })
        : h("span", { text: `${cl ? cl.name : t.name} · ${c.favCount(tier, coll)}`, style: { color: cl ? null : t.color } }));
    const sortBtn = h("button", { class: "spll-fav-sort", "data-key": "sort", text: `Sort: ${FAV_SORTS[s.settings.favSort]} ▸` });
    this.hoverRow(p, sortBtn, () => ({ type: "items", items: () => Object.entries(FAV_SORTS).map(([k, label]) => ({
      label, check: k === s.settings.favSort, keep: true, run: () => c.setFavSort(k),
    })) }));
    title.append(sortBtn);
    p.el.append(title);
    const box = h("div", { class: "spll-pmenu-list spll-scroll", "data-tier": tier, "data-coll": coll || "", style: { maxHeight: s.settings.favRows * ROW_H + "px" } });
    if (!colls.length && !favs.length) {
      box.append(h("div", { class: "spll-empty", text: coll ? "Empty collection. Drag favourites here, or right-click one → Move to collection." : root ? "No favourites yet. Click ☆ on a LoRA." : "Nothing in this tier yet." }));
    }
    for (const x of colls) {
      const row = h("div", { class: "spll-pmenu-item has-sub spll-coll-row", "data-key": `coll:${x.id}`, "data-collid": x.id, "data-drop": "coll" },
        h("span", { class: "spll-coll-icon", text: "▤", style: { color: t.color } }),
        h("span", { class: "spll-pmenu-label", text: x.name }),
        h("span", { class: "spll-count", text: String(c.favCount(tier, x.id)) }),
        h("span", { class: "spll-grip", "data-grip": "coll", title: "Drag to move or reorder", text: "⠿" }),
        h("span", { class: "spll-pmenu-arrow", text: "▸" }));
      this.hoverRow(p, row, () => ({ type: "favs", tier, coll: x.id }));
      box.append(row);
    }
    for (const fp of favs) {
      const missing = c.missing.has(fp);
      const on = c.isActive(fp);
      // click the row to switch it on or off (it turns green when on); folder and path are in the tooltip
      const row = h("div", {
        class: "spll-pmenu-lora" + (missing ? " is-missing" : "") + (on ? " is-on" : ""),
        "data-path": fp, "data-sact": missing ? null : "toggle", "data-key": `fav:${fp}`,
      },
        h("span", { class: "spll-result-name", text: c.displayName(fp) }),
        h("span", { class: "spll-grip", "data-grip": "lora", title: "Drag to move or reorder (switches to Custom)", text: "⠿" }));
      row.addEventListener("pointerenter", () => this.rowHover(p, row, null));
      box.append(row);
    }
    p.el.append(box);
    if (root) p.el.append(h("div", { class: "spll-sep" }), this.tieringRow(p));
    if (colls.length + favs.length >= 5) p.el.append(this.rowsControl("favRows")); // short lists don't need it
  }

  renderHist(p) {
    const c = this.c;
    const s = c.state;
    const list = s.history.filter((x) => !c.isActive(x) && c.visibleFav(x));
    p.el.append(h("div", { class: "spll-pop-title", text: `History · ${list.length}` }));
    const box = h("div", { class: "spll-pmenu-list spll-scroll", style: { maxHeight: s.settings.histRows * ROW_H + "px" } });
    if (!list.length) box.append(h("div", { class: "spll-empty", text: s.settings.historyLength ? "LoRAs you switch off appear here." : "History is off (see Settings)." }));
    for (const x of list) {
      const missing = c.missing.has(x);
      const row = h("div", { class: "spll-pmenu-lora" + (missing ? " is-missing" : ""), "data-path": x, "data-sact": missing ? null : "toggle" },
        h("span", { class: "spll-result-name", text: c.displayName(x) }));
      row.addEventListener("pointerenter", () => this.rowHover(p, row, null));
      box.append(row);
    }
    p.el.append(box);
    if (list.length >= 5) p.el.append(this.rowsControl("histRows"));
  }

  /** Mixes ▸: one row per mix (green while it's in ENABLED); the button at the end adds its LoRAs on their own. */
  renderMixes(p) {
    const c = this.c;
    const s = c.state;
    p.el.append(h("div", { class: "spll-pop-title", text: `Mixes · ${s.mixes.length}` }));
    const box = h("div", { class: "spll-pmenu-list spll-scroll", style: { maxHeight: s.settings.favRows * ROW_H + "px" } });
    for (const m of s.mixes) {
      const inEn = !!c.mixEntry(m.id);
      const n = c.mixItems(m.id).length;
      const row = h("div", { class: "spll-pmenu-lora spll-pmenu-mix has-sub" + (inEn ? " is-on" : ""), "data-mixid": m.id, "data-sact": "mix-toggle", "data-key": `mix:${m.id}`,
        title: inEn ? "In ENABLED: click to take it out" : "Click to add to ENABLED and switch it on" },
        h("span", { class: "spll-mix-dot", style: { background: m.color || null } }),
        h("span", { class: "spll-result-name", text: m.name }),
        h("span", { class: "spll-count", text: String(n) }),
        h("button", { class: "spll-icon spll-mix-apply", "data-sact": "mix-apply", title: "Add these LoRAs to ENABLED on their own", text: "⇊" }),
        h("span", { class: "spll-pmenu-arrow", text: "▸" }));
      // hovering a mix shows its LoRAs and its colour
      row.addEventListener("pointerenter", () => this.rowHover(p, row, () => ({ type: "mix", id: m.id })));
      box.append(row);
    }
    p.el.append(box);
  }

  /** One mix (hovered in Mixes ▸): its LoRAs and strengths, green while they load from it; × takes one out; its colour. */
  renderMix(p) {
    const c = this.c;
    const id = p.spec.id;
    const m = c.mixById(id);
    if (!m) return;
    const items = c.mixItems(id);
    const owners = c.mixOwners();
    const on = !!c.mixEntry(id)?.on;
    p.el.append(h("div", { class: "spll-pop-title", text: `Mix: ${m.name} · ${items.length}` }));
    const box = h("div", { class: "spll-pmenu-list spll-scroll", style: { maxHeight: c.state.settings.favRows * ROW_H + "px" } });
    if (!items.length) box.append(h("div", { class: "spll-empty", text: "Empty mix." }));
    for (const it of items) {
      const missing = c.unavailable(it.path);
      const loading = on && !it.off && !missing && owners.get(it.path) === id;
      const row = h("div", {
        class: "spll-pmenu-lora spll-pmenu-mixitem" + (loading ? " is-on" : "") + (it.off ? " is-off" : "") + (missing ? " is-missing" : ""),
        "data-path": it.path, "data-mixid": id, "data-sact": missing ? null : "mix-item-toggle",
        title: missing ? "" : it.off ? "Switched off in this mix: click to switch it on" : "Click to switch it off in this mix",
      },
        h("span", { class: "spll-result-name", text: c.displayName(it.path) }),
        h("span", { class: "spll-mix-str" + (it.strength < 0 ? " is-neg" : ""), text: fmt(it.strength) }),
        h("button", { class: "spll-icon spll-mix-x", "data-sact": "mix-item-remove", title: "Remove from this mix", text: "×" }));
      row.addEventListener("pointerenter", () => this.rowHover(p, row, null));
      box.append(row);
    }
    p.el.append(box, h("div", { class: "spll-sep" }), h("div", { class: "spll-pmenu-sub-title", text: "Colour" }), c.mixColorEl(m, "mix-color", "mix-custom-color", "data-sact"));
    const inp = p.el.querySelector("input[type=color]");
    inp?.addEventListener("input", () => { if (/^#[0-9a-f]{6}$/i.test(inp.value)) { m.color = inp.value; c.renderActive(); c.notify(); } });
  }

  renderTiering(p) {
    p.el.append(h("div", { class: "spll-pop-title", text: "Tiering Settings" }), this.c.tierSettingsEl());
  }

  rowsControl(key) {
    const n = this.c.state.settings[key];
    return h("div", { class: "spll-pmenu-rows" },
      h("span", { text: `Rows: ${n}` }),
      h("button", { class: "spll-step", "data-sact": "rows-dec", "data-rows": key, title: "Fewer rows", text: "−" }),
      h("button", { class: "spll-step", "data-sact": "rows-inc", "data-rows": key, title: "More rows", text: "+" }));
  }

  // ----- clicks
  onPanelClick(e, p) {
    e.stopPropagation();
    if (this.suppressClick) { this.suppressClick = false; return; }
    const c = this.c;
    const itemRow = e.target.closest(".spll-pmenu-item");
    if (itemRow?._item) {
      const it = itemRow._item;
      if (it.disabled) return;
      if (it.run) {
        if (it.keep) {
          it.run();
          this.closeFrom(p.at ? p.depth : p.depth + 1); // a right-click menu closes itself; a submenu stays
          return this.refresh();
        }
        this.close();
        return void it.run();
      }
      if (it.sub) return void this.openPanel(p.depth + 1, it.sub(), itemRow);
      return;
    }
    if (itemRow?.dataset.key && itemRow.classList.contains("has-sub")) {
      // tier, collection and Tiering Settings rows open at once on click
      const sub = itemRow.dataset.key === "tiering" ? { type: "tiering" }
        : itemRow.dataset.tier ? { type: "favs", tier: itemRow.dataset.tier, coll: null }
        : itemRow.dataset.collid ? { type: "favs", tier: p.spec.tier, coll: itemRow.dataset.collid } : null;
      if (sub && this.panels[p.depth + 1]?.anchorKey !== itemRow.dataset.key) this.openPanel(p.depth + 1, sub, itemRow);
      return;
    }
    if (e.target.closest(".spll-fav-sort")) {
      const b = e.target.closest(".spll-fav-sort");
      if (this.panels[p.depth + 1]?.anchorKey !== "sort") b.dispatchEvent(new Event("pointerenter"));
      return;
    }
    const t = e.target.closest("[data-sact]");
    if (!t) return;
    const act = t.dataset.sact;
    if (act === "rows-dec" || act === "rows-inc") {
      const key = t.dataset.rows;
      c.commit((s) => { s.settings[key] = clamp(s.settings[key] + (act === "rows-inc" ? 1 : -1), 1, 50); });
      return this.refresh();
    }
    const mixId = t.closest("[data-mixid]")?.dataset.mixid;
    if (act === "mix-apply" && mixId) return void c.applyMixAsRegular(mixId);
    if (act === "mix-color" && p.spec.type === "mix") { c.setMixColor(p.spec.id, t.dataset.color || null); return this.refresh(); }
    if (act === "mix-item-toggle" && mixId) { c.toggleMixItem(mixId, t.closest("[data-path]").dataset.path); return this.refresh(); }
    if (act === "mix-item-remove" && mixId) { c.removeFromMix(mixId, t.closest("[data-path]").dataset.path); return this.refresh(); }
    if (act === "mix-toggle" && mixId) { Promise.resolve(c.toggleMixInEnabled(mixId)).then(() => { if (PageMenu.current === this) this.refresh(); }); return this.refresh(); }
    const path = t.closest("[data-path]")?.dataset.path;
    if (!path) return;
    if (act === "toggle") { c.setActive(path, !c.isActive(path)); return this.refresh(); }
    if (act === "jump") { this.close(); c.reveal({ path }); }
  }

  /** Right-click inside the menu: options for that favourite, collection or tier, opened at the pointer. */
  onPanelContext(e, p) {
    e.preventDefault();
    e.stopPropagation();
    const c = this.c;
    const lora = e.target.closest(".spll-pmenu-lora[data-path]");
    const coll = e.target.closest("[data-collid]");
    const tier = e.target.closest("[data-tier].spll-tier-row");
    let items = null;
    if (lora && p.spec.type === "favs") items = c.favLoraMenuItems(lora.dataset.path);
    else if (lora && p.spec.type === "hist") items = [
      { label: "Add to mix", sub: () => ({ type: "items", items: c.addToMixItems(lora.dataset.path) }) },
      { label: "Show in groups", run: () => c.reveal({ path: lora.dataset.path }) },
    ];
    else if (e.target.closest("[data-mixid]") && p.spec.type === "mixes") items = c.mixMenuItems(e.target.closest("[data-mixid]").dataset.mixid);
    else if (coll) items = c.collMenuItems(coll.dataset.collid);
    else if (tier) items = c.tierMenuItems(tier.dataset.tier);
    if (items) this.openPanel(p.depth + 1, { type: "items", items }, null, { x: e.clientX + 2, y: e.clientY + 2 });
  }

  // ----- dragging favourites and collections (by their ⠿ grip)
  startDrag(e, p) {
    const grip = e.target.closest("[data-grip]");
    if (!grip || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const row = grip.closest(".spll-pmenu-lora, .spll-coll-row");
    const kind = grip.dataset.grip;
    const id = kind === "lora" ? row.dataset.path : row.dataset.collid;
    const ghost = h("div", { class: "spll-pmenu-ghost", text: kind === "lora" ? this.c.displayName(id) : this.c.collById(id)?.name || "" });
    this.layer.append(ghost);
    row.classList.add("is-dragging");
    this.drag = { kind, id, from: p, row, ghost, target: null, x: e.clientX, y: e.clientY };
    const move = (ev) => { this.drag.x = ev.clientX; this.drag.y = ev.clientY; this.dragMove(); };
    const up = () => {
      clearInterval(tick);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      this.dragDrop();
    };
    const tick = setInterval(() => this.dragScroll(), 30);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    this.dragMove();
  }

  dragScroll() {
    const d = this.drag;
    if (!d) return;
    for (const p of this.panels) {
      const box = p?.el.querySelector(".spll-pmenu-list");
      if (!box) continue;
      const b = box.getBoundingClientRect();
      if (d.x < b.left || d.x > b.right) continue;
      if (d.y < b.top + 20 && d.y > b.top - 10) box.scrollTop -= 8;
      else if (d.y > b.bottom - 20 && d.y < b.bottom + 10) box.scrollTop += 8;
    }
  }

  /** What's under the pointer: into a collection or tier, before/after a row, or the end of a list. */
  dropTarget() {
    const d = this.drag;
    const c = this.c;
    d.ghost.style.display = "none";
    const el = document.elementFromPoint(d.x, d.y);
    d.ghost.style.display = "";
    if (!el || !this.layer.contains(el)) return null;
    const tierRow = el.closest(".spll-tier-row");
    if (tierRow) return { kind: "into", tier: tierRow.dataset.tier, coll: null, el: tierRow };
    const list = el.closest(".spll-pmenu-list[data-tier]");
    if (!list) return null;
    const tier = list.dataset.tier;
    const coll = list.dataset.coll || null;
    const collRow = el.closest(".spll-coll-row");
    if (collRow && collRow.dataset.collid !== d.id) {
      const r = collRow.getBoundingClientRect();
      const mid = d.y > r.top + r.height * 0.25 && d.y < r.bottom - r.height * 0.25;
      if (d.kind === "lora" || mid) {
        if (d.kind === "coll" && !c.canNestColl(d.id, collRow.dataset.collid)) return null;
        return { kind: "into", tier, coll: collRow.dataset.collid, el: collRow };
      }
      return { kind: "order", tier, coll, before: d.y < r.top + r.height / 2 ? collRow.dataset.collid : this.nextColl(list, collRow), el: collRow, line: d.y < r.top + r.height / 2 ? "before" : "after" };
    }
    const favRow = el.closest(".spll-pmenu-lora[data-path]");
    if (favRow && d.kind === "lora" && favRow.dataset.path !== d.id) {
      const r = favRow.getBoundingClientRect();
      const before = d.y < r.top + r.height / 2;
      const next = before ? favRow.dataset.path : this.nextFav(list, favRow);
      return { kind: "order", tier, coll, before: next, el: favRow, line: before ? "before" : "after" };
    }
    if (d.kind === "coll" && !c.canNestColl(d.id, coll)) return null;
    return { kind: "into", tier, coll, el: list, end: true };
  }

  nextFav(list, row) {
    const rows = [...list.querySelectorAll(".spll-pmenu-lora[data-path]")].filter((r) => r.dataset.path !== this.drag.id);
    return rows[rows.indexOf(row) + 1]?.dataset.path ?? null;
  }

  nextColl(list, row) {
    const rows = [...list.querySelectorAll(".spll-coll-row")].filter((r) => r.dataset.collid !== this.drag.id);
    return rows[rows.indexOf(row) + 1]?.dataset.collid ?? null;
  }

  dragMove() {
    const d = this.drag;
    d.ghost.style.left = d.x + 12 + "px";
    d.ghost.style.top = d.y + 8 + "px";
    for (const n of this.layer.querySelectorAll(".is-drop, .is-drop-before, .is-drop-after")) n.classList.remove("is-drop", "is-drop-before", "is-drop-after");
    d.target = this.dropTarget();
    const t = d.target;
    if (!t) return;
    if (t.kind === "order") t.el.classList.add(t.line === "before" ? "is-drop-before" : "is-drop-after");
    else t.el.classList.add("is-drop");
    // resting on a collection or tier opens it, so you can drop deeper
    const row = t.el.closest?.("[data-key].has-sub");
    const p = this.panels.find((x) => x?.el.contains(t.el));
    if (row && p && t.kind === "into") this.rowHover(p, row, () => (row.dataset.tier ? { type: "favs", tier: row.dataset.tier, coll: null } : { type: "favs", tier: p.spec.tier, coll: row.dataset.collid }));
  }

  dragDrop() {
    const d = this.drag;
    this.drag = null;
    d.ghost.remove();
    d.row.classList.remove("is-dragging");
    for (const n of this.layer.querySelectorAll(".is-drop, .is-drop-before, .is-drop-after")) n.classList.remove("is-drop", "is-drop-before", "is-drop-after");
    this.suppressClick = true;
    setTimeout(() => { this.suppressClick = false; }, 0);
    const t = d.target;
    if (!t) return;
    const c = this.c;
    if (d.kind === "lora") {
      const sameBox = (c.state.favTier[d.id] || c.state.tiers[0].id) === t.tier && (c.state.favColl[d.id] || null) === (t.coll || null);
      if (t.kind === "order" && sameBox) {
        const shown = c.favsIn(t.tier, t.coll).filter((x) => x !== d.id);
        const i = t.before ? shown.indexOf(t.before) : -1;
        shown.splice(i < 0 ? shown.length : i, 0, d.id);
        c.reorderFavs(shown);
      } else if (t.kind === "order") c.setFavPlace(d.id, t.tier, t.coll, t.before);
      else if (!sameBox) c.setFavPlace(d.id, t.tier, t.coll);
    } else {
      const x = c.collById(d.id);
      if (!x) return;
      if (t.kind === "order") c.moveColl(d.id, t.tier, t.coll, t.before);
      else if (!(x.tier === t.tier && (x.parent || null) === (t.coll || null))) c.moveColl(d.id, t.tier, t.coll);
    }
    this.refresh();
  }
}

// ---------------------------------------------------------------- info panel
// A page-level window (not inside the node) so there's room for example images.
class InfoPanel {
  constructor(ctrl, path) {
    this.c = ctrl;
    this.p = path;
    this.missing = ctrl.missing.has(path);
    this.payload = null;
    this.remote = null; // Civitai details for a missing LoRA
    this.status = null;
    this.trainingShown = 30;
    this.sel = []; // words picked for "Copy Selected"
  }

  open() {
    InfoPanel.current?.close();
    InfoPanel.current = this;
    this.backdrop = h("div", { class: "spll spll-modal-backdrop" });
    this.c.applyColorVars(this.backdrop);
    this.win = h("div", { class: "spll-modal", role: "dialog", "aria-label": "LoRA info" });
    this.backdrop.append(this.win);
    document.body.append(this.backdrop);
    // keep every key press here away from ComfyUI's shortcuts (Delete would remove selected nodes)
    for (const type of ["keydown", "keyup", "keypress", "copy", "cut", "paste"]) {
      this.backdrop.addEventListener(type, (e) => {
        if (type === "keydown" && e.key === "Escape") { e.preventDefault(); this.close(); }
        e.stopPropagation();
      });
    }
    this.backdrop.addEventListener("pointerdown", (e) => { if (e.target === this.backdrop) this.close(); });
    // Escape still closes the window when focus has wandered (e.g. after a confirmation dialog)
    this.onDocKey = (e) => {
      if (e.key !== "Escape" || this.backdrop.contains(e.target)) return;
      if (document.querySelector("[role=dialog]:not(.spll-modal)")) return; // let ComfyUI's dialog handle it
      e.preventDefault();
      e.stopPropagation();
      this.close();
    };
    document.addEventListener("keydown", this.onDocKey, true);
    this.backdrop.addEventListener("click", (e) => this.onClick(e));
    this.backdrop.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    this.render();
    this.load();
  }

  close() {
    document.removeEventListener("keydown", this.onDocKey, true);
    for (const v of this.backdrop?.querySelectorAll("video") || []) v.pause();
    this.backdrop?.remove();
    if (InfoPanel.current === this) InfoPanel.current = null;
  }

  q() {
    const s = this.c.state;
    return this.c.qs(this.p);
  }

  async load() {
    if (this.missing) return this.loadRemote();
    try {
      const r = await getJson(`/spll/info?${this.q()}`);
      if (r.error) throw new Error(r.error);
      this.payload = r;
      this.render();
      if (!r.info) await this.fetch(); // first open: look it up straight away
    } catch (e) {
      this.status = { error: String(e.message || e) };
      this.render();
    }
  }

  async loadRemote() {
    const ids = this.c.state.ids[this.p] || {};
    if (!ids.v && !ids.h) { this.remote = { found: false, error: "No Civitai details were saved for this LoRA." }; return this.render(); }
    this.status = { text: "Looking it up on Civitai…" };
    this.render();
    try {
      this.remote = await postJson("/spll/lookup", { versionId: ids.v, hash: ids.h, apiKey: getApiKey() });
    } catch (e) {
      this.remote = { found: false, error: String(e.message || e) };
    }
    this.status = null;
    this.render();
  }

  async fetch() {
    this.status = { text: "Reading the LoRA…" };
    this.render();
    const r = await this.c.fetchInfo(this.p, {
      onProgress: (pr) => {
        if (pr && pr.total) {
          this.status = { text: `Hashing the LoRA… ${Math.floor((pr.done / pr.total) * 100)}%` };
          this.renderStatus();
        } else if (this.status?.text?.startsWith("Hashing")) {
          this.status = { text: "Looking it up on Civitai…" };
          this.renderStatus();
        }
      },
      askToSave: false,
    });
    this.status = r?.lookup === "failed"
      ? { error: `Couldn't reach Civitai (${r.lookupError || "no answer"}). If Civitai is blocked where you are, turn on your VPN and press Refresh. Nothing was saved.` }
      : null;
    if (r) this.payload = r;
    this.render();
    if (r && r.unsaved && r.lookup !== "failed" && !r.saved) {
      await new Promise((res) => setTimeout(res, 50));
      const saved = await this.c.saveInfo(this.p, r);
      if (saved) { this.payload = saved; this.render(); }
    }
  }

  // ----- rendering
  render() {
    if (!this.win) return;
    const scroll = this.win.querySelector(".spll-modal-body")?.scrollTop || 0;
    this.win.innerHTML = "";
    const c = this.c;
    const name = c.displayName(this.p);
    this.win.append(
      h("div", { class: "spll-modal-head" },
        h("div", { class: "spll-modal-titles" },
          h("div", { class: "spll-modal-title", text: name }),
          h("div", { class: "spll-modal-sub", text: basename(this.p) }),
        ),
        h("button", { class: "spll-icon spll-modal-x", "data-pact": "close", title: "Close (Esc)", text: "×" }),
      ),
    );
    this.statusEl = h("div", { class: "spll-modal-status" });
    this.win.append(this.statusEl);
    this.renderStatus();
    const body = h("div", { class: "spll-modal-body" });
    this.win.append(body);
    if (this.missing) this.renderMissing(body);
    else this.renderInfo(body);
    this.win.append(this.footer());
    body.scrollTop = scroll;
  }

  renderStatus() {
    if (!this.statusEl) return;
    this.statusEl.innerHTML = "";
    const st = this.status;
    this.statusEl.hidden = !st;
    if (!st) return;
    this.statusEl.className = "spll-modal-status" + (st.error ? " is-error" : "");
    if (!st.error) this.statusEl.append(h("span", { class: "spll-spinner" }));
    this.statusEl.append(h("span", { text: st.error || st.text }));
  }

  row(label, ...value) {
    return h("tr", null, h("th", { text: label }), h("td", null, ...value));
  }

  renderInfo(body) {
    const c = this.c;
    const pl = this.payload;
    const info = pl?.info;
    const side = pl?.side || {};
    const civ = info?.raw?.civitai;
    const tags = h("div", { class: "spll-tags" });
    if (info?.type) tags.append(h("span", { class: "spll-tag", text: info.type }));
    if (info?.baseModel) tags.append(h("span", { class: "spll-tag is-base", text: info.baseModel }));
    if (pl?.unsaved) tags.append(h("span", { class: "spll-tag is-warn", text: "Not saved: this session only" }));
    if (tags.childElementCount) body.append(tags);

    const t = h("table", { class: "spll-info-table" });
    t.append(this.row("Name", info?.name || "—"));
    t.append(this.row("File", h("span", { class: "spll-mono", text: pl?.full || c.fullPath(this.p) })));
    t.append(this.row("Hash (sha256)", h("span", { class: "spll-mono spll-sel", text: info?.sha256 || "Not computed yet" })));
    let civCell;
    const link = (info?.links || []).find((l) => String(l).includes("civitai.com/models"));
    if (link) civCell = h("a", { href: link, target: "_blank", rel: "noopener noreferrer", text: "View on Civitai ↗" });
    else if (civ?.error) civCell = h("span", { class: "spll-muted", text: "Not found on Civitai (it may have been removed, re-uploaded or never posted there)." });
    else if (info?.raw?.civitaiError) civCell = h("span", { class: "spll-warn", text: `${info.raw.civitaiError}. Saved info is kept; try Refresh later.` });
    else civCell = h("span", { class: "spll-muted", text: info ? "—" : "Not looked up yet" });
    t.append(this.row("Civitai", civCell));
    if (info?.baseModelFile) t.append(this.row("Trained on", h("span", { class: "spll-mono", text: info.baseModelFile })));

    // trigger words
    const trig = (info?.trainedWords || []).filter((w) => w.civitai || w.user);
    const chip = (word, cls, title) => h("button", {
      class: `spll-chip ${cls}` + (this.sel.includes(word) ? " is-sel" : ""), "data-pact": "sel-word", "data-word": word, title, text: word,
    });
    const trigBox = h("div", { class: "spll-chips" });
    for (const w of trig) trigBox.append(chip(w.word, "is-civitai", "Civitai trigger word. Click to select"));
    for (const w of side.triggers || []) trigBox.append(chip(w, "is-user", "Your trigger word. Click to select"));
    const all = triggersFrom(pl);
    if (!all.length) trigBox.append(h("span", { class: "spll-muted", text: side.noTrigger ? "None (you marked this LoRA as having no trigger words)." : info ? "None on Civitai." : "Load the info to see them." }));
    const canCopy = all.length || this.sel.length;
    t.append(this.row("Trigger words", trigBox,
      canCopy ? h("button", { class: "spll-btn spll-btn-sm is-primary", "data-pact": "copy-sel", text: this.sel.length ? `Copy Selected (${this.sel.length})` : "Copy All" }) : null,
      !all.length ? h("label", { class: "spll-check spll-notrig" },
        h("input", { type: "checkbox", checked: !!side.noTrigger, "data-pact": "notrig" }), " No trigger words (stop showing red)") : null));

    t.append(this.row("Your trigger words",
      h("div", { class: "spll-inline" },
        h("input", { class: "spll-pop-input", "data-field": "triggers", type: "text", value: (side.triggers || []).join(", "), placeholder: "Comma-separated, added to the T button", spellcheck: "false" }),
        h("button", { class: "spll-btn", "data-pact": "save-triggers", text: "Save" }),
      )));

    // training tags from the file
    const training = (info?.trainedWords || []).filter((w) => w.metadata && typeof w.count === "number");
    if (training.length) {
      const box = h("div", { class: "spll-chips" });
      for (const w of training.slice(0, this.trainingShown)) {
        box.append(h("button", { class: "spll-chip is-meta" + (this.sel.includes(w.word) ? " is-sel" : ""), "data-pact": "sel-word", "data-word": w.word, title: "Training tag. Click to select" }, w.word, h("small", { text: String(w.count) })));
      }
      if (training.length > this.trainingShown) box.append(h("button", { class: "spll-btn spll-btn-sm", "data-pact": "more-tags", text: `Show all ${training.length}` }));
      t.append(this.row("Training tags", box));
    }

    t.append(this.row("Nickname",
      h("div", { class: "spll-inline" },
        h("input", { class: "spll-pop-input", "data-field": "nickname", type: "text", value: side.nickname || "", placeholder: stripExt(basename(this.p)), spellcheck: "false" }),
        h("button", { class: "spll-btn", "data-pact": "save-nickname", text: "Save" }),
      )));
    t.append(this.row("Your note",
      h("div", { class: "spll-inline is-col" },
        h("textarea", { class: "spll-pop-input spll-note", "data-field": "note", rows: "3", placeholder: "Anything you want to remember about this LoRA", spellcheck: "false" }, side.note || ""),
        h("button", { class: "spll-btn", "data-pact": "save-note", text: "Save note" }),
      )));
    body.append(t);

    // examples
    const media = [];
    if (pl?.preview) media.push({ local: true, type: pl.preview, url: `${api.apiURL ? api.apiURL("/spll/preview") : "/api/spll/preview"}?${this.q()}` });
    for (const img of info?.images || []) if (img?.url && !String(img.url).includes("/spll/preview")) media.push(img);
    if (media.length) {
      body.append(h("div", { class: "spll-section-title", text: `Examples · ${media.length}` }));
      const grid = h("div", { class: "spll-gallery" });
      media.forEach((m, i) => grid.append(this.mediaCard(m, i)));
      body.append(grid);
    }
    if (info?.description) {
      const d = h("details", { class: "spll-desc" }, h("summary", { text: "Description from Civitai" }));
      const div = h("div", { class: "spll-desc-body" });
      div.textContent = String(info.description).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      d.append(div);
      body.append(d);
    }
  }

  mediaCard(m, i) {
    const blur = this.c.state.settings.blur && !m.local;
    const isVideo = m.type === "video" || /\.(mp4|webm)(\?|$)/i.test(m.url || "");
    const card = h("figure", { class: "spll-media" + (blur ? " is-blurred" : ""), "data-i": String(i) });
    const frame = h("div", { class: "spll-media-frame", "data-pact": "media" });
    if (isVideo) {
      const v = h("video", { src: m.url, muted: true, autoplay: true, loop: true, playsInline: true, preload: "metadata" });
      v.muted = true; // autoplay needs it; click to hear it
      frame.append(v, h("span", { class: "spll-media-sound", text: "🔇" }));
    } else {
      frame.append(h("img", { src: m.url, loading: "lazy", alt: "" }));
    }
    if (blur) frame.append(h("span", { class: "spll-media-cover", text: "Click to show" }));
    card.append(frame);
    const cap = h("figcaption");
    if (m.local) cap.append(h("span", { class: "spll-tag", text: "Preview next to the LoRA" }));
    const bits = [["Seed", m.seed], ["Steps", m.steps], ["CFG", m.cfg], ["Sampler", m.sampler]].filter(([, v]) => v !== undefined && v !== null && v !== "");
    if (bits.length) cap.append(h("div", { class: "spll-media-meta", text: bits.map(([k, v]) => `${k} ${v}`).join(" · ") }));
    if (m.positive) {
      const d = h("details", null, h("summary", { text: "Prompt" }), h("div", { class: "spll-sel", text: m.positive }));
      if (m.negative) d.append(h("div", { class: "spll-muted spll-sel", text: `Negative: ${m.negative}` }));
      cap.append(d);
    }
    if (m.civitaiUrl) cap.append(h("a", { href: m.civitaiUrl, target: "_blank", rel: "noopener noreferrer", text: "Open on Civitai ↗" }));
    if (cap.childElementCount) card.append(cap);
    return card;
  }

  renderMissing(body) {
    const c = this.c;
    const ids = c.state.ids[this.p] || {};
    body.append(h("div", { class: "spll-missing-note", text: "This LoRA isn't on disk. It was used by this workflow; here's what's known about it." }));
    const t = h("table", { class: "spll-info-table" });
    t.append(this.row("Expected at", h("span", { class: "spll-mono", text: c.fullPath(this.p) })));
    if (ids.h) t.append(this.row("Hash (sha256)", h("span", { class: "spll-mono spll-sel", text: ids.h })));
    const r = this.remote;
    if (r?.found) {
      t.append(this.row("Name", r.name || "—"));
      if (r.baseModel) t.append(this.row("Base model", r.baseModel));
      if (r.fileName) t.append(this.row("File on Civitai", h("span", { class: "spll-mono", text: `${r.fileName}${r.sizeKB ? ` (${(r.sizeKB / 1024).toFixed(1)} MB)` : ""}` })));
      if (r.triggers?.length) t.append(this.row("Trigger words", r.triggers.join(", ")));
      const canDownload = ids.v && /\.safetensors$/i.test(this.p);
      t.append(this.row("Download",
        canDownload ? h("button", { class: "spll-btn is-primary", "data-pact": "download", disabled: !!this.downloading, text: this.downloading ? "Downloading…" : "Download to folder" }) : null,
        h("a", { href: r.link, target: "_blank", rel: "noopener noreferrer", class: "spll-dl-link", text: "Open on Civitai ↗" }),
        h("div", { class: "spll-muted", text: canDownload ? "Download to folder saves it at the path above (the file is checked against this workflow's hash)." : "Put the file at the path above, then press ↻ on the node." })));
    } else if (r) {
      t.append(this.row("Civitai", h("span", { class: "spll-muted", text: r.error || "Not found." })));
      if (ids.m) t.append(this.row("Download", h("a", { href: `https://civitai.com/models/${ids.m}${ids.v ? `?modelVersionId=${ids.v}` : ""}`, target: "_blank", rel: "noopener noreferrer", text: "Try the Civitai page ↗" })));
    }
    body.append(t);
    if (r?.images?.length) {
      const grid = h("div", { class: "spll-gallery" });
      r.images.forEach((m, i) => grid.append(this.mediaCard(m, i)));
      body.append(grid);
    }
  }

  footer() {
    const f = h("div", { class: "spll-modal-foot" });
    const pl = this.payload;
    if (!this.missing) {
      f.append(h("button", { class: "spll-btn", "data-pact": "refresh", disabled: this.c.busy.has(this.p), text: pl?.info ? "Refresh from Civitai" : "Fetch from Civitai" }));
      if (pl?.unsaved && pl.lookup !== "failed") f.append(h("button", { class: "spll-btn is-primary", "data-pact": "save-info", text: "Save next to LoRA" }));
      if (pl?.saved) f.append(h("button", { class: "spll-btn is-danger", "data-pact": "clear", text: "Clear saved info" }));
    }
    f.append(h("span", { class: "spll-grow" }), h("button", { class: "spll-btn", "data-pact": "close", text: "Close" }));
    return f;
  }

  // ----- actions
  async onClick(e) {
    const t = e.target.closest("[data-pact]");
    if (!t) return;
    const act = t.dataset.pact;
    const field = (name) => this.win.querySelector(`[data-field="${name}"]`)?.value ?? "";
    switch (act) {
      case "close": return this.close();
      case "sel-word": {
        const w = t.dataset.word;
        this.sel = this.sel.includes(w) ? this.sel.filter((x) => x !== w) : [...this.sel, w];
        return this.render();
      }
      case "copy-sel": {
        // listed order: trigger words first, then training tags
        const info = this.payload?.info;
        const listed = [...triggersFrom(this.payload), ...(info?.trainedWords || []).filter((w) => w.metadata).map((w) => w.word)];
        const words = this.sel.length ? [...new Set(listed)].filter((w) => this.sel.includes(w)) : triggersFrom(this.payload);
        const text = words.join(", ");
        if (await copyText(text)) toast("success", "Copied", text);
        else window.prompt("Copy with Ctrl+C:", text);
        return;
      }
      case "notrig": {
        const r = await this.c.saveSide(this.p, { noTrigger: t.checked }, !!this.payload?.hasSidecar);
        if (r) { this.payload = { ...r, info: r.info || this.payload?.info, unsaved: r.unsaved || this.payload?.unsaved, lookup: r.lookup || this.payload?.lookup }; }
        return this.render();
      }
      case "more-tags": this.trainingShown = 100000; return this.render();
      case "media": return this.onMedia(t);
      case "refresh": return this.fetch();
      case "download": return this.download();
      case "save-info": {
        const r = await this.c.saveInfo(this.p, this.payload);
        if (r) { this.payload = r; this.render(); }
        return;
      }
      case "clear": {
        const ok = await confirmDialog("Clear saved info?", "Delete the saved info file for this LoRA? Your nickname, trigger words and note are kept. You can fetch the info again any time.", [this.payload.full + ".rgthree-info.json"]);
        if (!ok) return;
        try {
          const r = await postJson("/spll/clearinfo", this.c.q(this.p));
          if (r.error) throw new Error(r.error);
          this.c.session.delete(this.p);
          this.c.applyPayload(this.p, r);
          this.payload = r;
        } catch (err) { toast("error", "Couldn't clear info", String(err.message || err)); }
        return this.render();
      }
      case "save-triggers":
      case "save-nickname":
      case "save-note": {
        const fields = act === "save-triggers" ? { triggers: field("triggers").split(",").map((w) => w.trim()).filter(Boolean) }
          : act === "save-nickname" ? { nickname: field("nickname").trim() }
          : { note: field("note") };
        const r = await this.c.saveSide(this.p, fields, !!this.payload?.hasSidecar);
        if (r) { this.payload = { ...r, info: r.info || this.payload?.info, unsaved: r.unsaved || this.payload?.unsaved }; this.render(); toast("success", "Saved"); }
        return;
      }
    }
  }

  async download() {
    const c = this.c;
    const ids = c.state.ids[this.p] || {};
    const r = this.remote || {};
    const dest = c.fullPath(this.p);
    const folder = dirname(this.p);
    let folderExists = true;
    if (folder) {
      try {
        const ex = await postJson("/spll/exists", { base: c.basePath(baseOf(folder)), root: "", folders: [relOf(folder)] });
        folderExists = !!ex.exists?.[relOf(folder)];
      } catch { /* */ }
    }
    const size = r.sizeKB ? ` (${(r.sizeKB / 1024).toFixed(1)} MB)` : "";
    const ok = await confirmDialog(
      "Download this LoRA?",
      `Download “${r.name || basename(this.p)}”${size} from Civitai and save it here?${folderExists ? "" : " Its folder doesn't exist yet and will be created."}${ids.h ? " The file is checked against the hash this workflow saved, and discarded if it doesn't match." : ""}`,
      [dest].concat(folderExists ? [] : [`New folder: ${c.fullPath(folder)}`])
    );
    if (!ok) return;
    this.downloading = true;
    this.status = { text: "Downloading…" };
    this.render();
    const q = c.qs(this.p);
    const timer = setInterval(async () => {
      try {
        const pr = (await getJson(`/spll/dlprogress?${q}`)).progress;
        if (pr) {
          const mb = (pr.done / 1048576).toFixed(1);
          this.status = { text: pr.total ? `Downloading… ${Math.floor((pr.done / pr.total) * 100)}% (${mb} MB)` : `Downloading… ${mb} MB` };
          this.renderStatus();
        }
      } catch { /* */ }
    }, 500);
    try {
      const res = await postJson("/spll/download", {
        ...c.q(this.p), versionId: ids.v, hash: ids.h, apiKey: getApiKey(), createFolder: !folderExists,
      });
      if (res.error) throw new Error(res.error);
      toast("success", "Downloaded", dest);
      scanCache.clear();
      this.close();
      await c.refresh({ force: true, promptFolders: false });
    } catch (e) {
      this.status = { error: String(e.message || e) };
    } finally {
      clearInterval(timer);
      this.downloading = false;
      if (InfoPanel.current === this) this.render();
    }
  }

  onMedia(frame) {
    const card = frame.closest(".spll-media");
    if (card.classList.contains("is-blurred")) { card.classList.remove("is-blurred"); return; }
    const v = frame.querySelector("video");
    if (!v) return;
    // only one video plays with sound at a time
    const unmute = v.muted;
    for (const other of this.win.querySelectorAll("video")) {
      other.muted = true;
      const s = other.parentElement.querySelector(".spll-media-sound");
      if (s) s.textContent = "🔇";
    }
    v.muted = !unmute;
    if (unmute) { v.muted = false; v.play().catch(() => {}); }
    frame.querySelector(".spll-media-sound").textContent = v.muted ? "🔇" : "🔊";
  }
}

// ---------------------------------------------------------------- registration
app.registerExtension({
  name: "SuperPowerLoraLoader",

  settings: [
    {
      id: KEY_SETTING,
      category: ["Super-Power Lora Loader", "Civitai", "API key"],
      name: "Civitai API key",
      tooltip: "Optional. Some models need it for info lookups. Also editable from the node's gear menu.",
      type: "text",
      defaultValue: "",
    },
  ],

  getCustomWidgets() {
    return {
      [WIDGET_TYPE](node, inputName) {
        const el = document.createElement("div");
        const ctrl = new Controller(node, el);
        const widget = node.addDOMWidget(inputName, WIDGET_TYPE, el, {
          getValue: () => ctrl.getState(),
          setValue: (v) => ctrl.setState(v),
          getMinHeight: () => ctrl.height(),
          hideOnZoom: false,
          socketless: true, // no input dot for the widget itself
        });
        widget.serializeValue = () => ctrl.promptValue();
        widget.spll = ctrl;
        node.spll = ctrl;
        const onRemoved = node.onRemoved;
        node.onRemoved = function () {
          ctrl.destroy();
          return onRemoved?.apply(this, arguments);
        };
        // First render for a freshly created node (no saved value): show the root picker.
        queueMicrotask(() => { if (!ctrl.scanned && !ctrl.loading && !ctrl.state.setup) ctrl.refresh(); });
        return { widget };
      },
    };
  },

  nodeCreated(node) {
    if (node.comfyClass !== NODE_TYPE) return;
    // A fresh node shows the root picker; it's sized for 12 rows of groups once a root is chosen.
    // A saved workflow restores its own size after this.
    const sz = node.size;
    if (sz) node.setSize([Math.max(sz[0], DEFAULT_WIDTH), sz[1]]);
    // never narrower than the node's compact layout can work at
    const onResize = node.onResize;
    node.onResize = function (size) {
      if (size && size[0] < MIN_WIDTH) size[0] = MIN_WIDTH;
      return onResize?.apply(this, arguments);
    };
  },

  async refreshComboInNodes() {
    // ComfyUI's "refresh" (R key / button): pick up new LoRAs.
    scanCache.clear();
    for (const c of controllers) if (c.state.setup) c.refresh({ force: true });
  },
});
