// Tabbed Note — a note node for ComfyUI with tabs, groups, markdown and tag lists.
// Everything is stored in node.properties.tabnote, so it saves with the workflow.
// With Text input and outputs off, the node is virtual: ComfyUI never sends it to the backend.
// With either on, the Python part (tabbed_note.py) runs and the note sends its settings to it.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const EXT_NAME = "TabbedNote.TabbedNote";
const NODE_TYPE = "TabbedNote";
const UI_KEY = "tabnote_text"; // key the Python part uses to hand incoming text back to the note
const GENERATED = "Generated";
const OUTPUT_KINDS = [
    { id: "pass", label: "Pass-through", socket: "pass-through" },
    { id: "note", label: "Note as text", socket: "note text" },
];

// ---------- styles ----------
(() => {
    const id = "tabbed-note-css";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = new URL("./tabbed_note.css", import.meta.url).href;
    document.head.appendChild(link);
})();

// ---------- markdown (bundled locally, so it works offline) ----------
let markedLib = null;
let purify = null;
try {
    markedLib = (await import(new URL("./lib/marked.esm.js", import.meta.url).href)).marked;
} catch (e) {
    console.warn("[TabbedNote] marked failed to load; markdown tabs will show plain text.", e);
}
try {
    purify = (await import(new URL("./lib/purify.es.js", import.meta.url).href)).default;
    purify.addHook("afterSanitizeAttributes", (n) => {
        if (n.tagName === "A") {
            n.setAttribute("target", "_blank");
            n.setAttribute("rel", "noopener noreferrer");
        }
    });
} catch (e) {
    console.warn("[TabbedNote] DOMPurify failed to load; markdown tabs will show plain text.", e);
}

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function renderMarkdown(src) {
    // Only render HTML when it can be sanitized: a shared workflow could contain hostile markup.
    if (!markedLib || !purify) return `<pre class="tn-md-fallback">${escapeHtml(src)}</pre>`;
    return purify.sanitize(markedLib.parse(src ?? "", { gfm: true, breaks: false }));
}

// ---------- pysssss autocomplete (optional) ----------
// pysssss (ComfyUI-Custom-Scripts) exports TextAreaAutoComplete from js/common/autocomplete.js.
// Its word lists live on that class, so we must import the *same* module URL the frontend
// loaded. The folder name varies by install, so find it in ComfyUI's own extension list.
let acPromise = null;
function getAutocomplete() {
    acPromise ??= (async () => {
        try {
            const exts = await api.getExtensions();
            for (const p of exts.filter((x) => x.endsWith("/js/common/autocomplete.js"))) {
                try {
                    const mod = await import(api.fileURL(p));
                    if (typeof mod?.TextAreaAutoComplete === "function") return mod.TextAreaAutoComplete;
                } catch { /* try the next match */ }
            }
        } catch (e) {
            console.warn("[TabbedNote] Could not look for pysssss autocomplete.", e);
        }
        return null;
    })();
    return acPromise;
}
let acAvailable = null; // null = not checked yet, then true/false
getAutocomplete().then((AC) => { acAvailable = !!AC; });

// Clicking a suggestion blurs the text box first. Remember that the pointer went down in
// pysssss's dropdown, so finishing an edit on blur can ignore that click.
let pointerInAutocomplete = false;
document.addEventListener("pointerdown", (e) => {
    pointerInAutocomplete = !!e.target?.closest?.(".pysssss-autocomplete");
}, true);

// ---------- clipboard ----------
async function copyText(text) {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        // The Clipboard API needs a secure context (localhost or https), so this fallback covers
        // ComfyUI opened over plain http from another machine. It fills in the browser's own copy
        // event instead of selecting text in a hidden box: selecting would move focus, which
        // closed the editor when a double-click on a tag copied it and opened the editor at once.
        let ok = false;
        const onCopy = (e) => {
            e.clipboardData.setData("text/plain", text);
            e.preventDefault();
            ok = true;
        };
        document.addEventListener("copy", onCopy, true);
        try { document.execCommand("copy"); } catch { /* ok stays false */ }
        document.removeEventListener("copy", onCopy, true);
        return ok;
    }
}

// ---------- tag lists ----------
// "# Headline", "## Sub headline", and every other non-empty line is one tag (commas allowed).
// "tag | description" adds a hover description; it is never copied.
// Tags before any headline go in an untitled headline; tags straight after a headline
// (before its first sub headline) belong to the headline itself.
const DESC_SEP = " | ";
function parseTagLine(line) {
    const i = line.indexOf(DESC_SEP);
    if (i < 0) return { text: line, desc: "" };
    return { text: line.slice(0, i).trim(), desc: line.slice(i + DESC_SEP.length).trim() };
}

// Every headline, sub headline and tag records the line it came from (`line`), and headlines and
// sub headlines record where their section ends (`end`, exclusive), so they can be moved by
// moving lines of text.
function parseTags(src) {
    const heads = [];
    let head = null;
    let sub = null;
    const lines = String(src ?? "").split("\n");
    const ensureHead = () => {
        if (!head) { head = { title: null, line: 0, chips: [], subs: [] }; heads.push(head); }
        return head;
    };
    lines.forEach((raw, i) => {
        const line = raw.trim();
        if (!line) return;
        let m;
        if ((m = line.match(/^#(?!#)\s*(.*)$/))) {
            head = { title: m[1].trim(), line: i, chips: [], subs: [] };
            heads.push(head);
            sub = null;
        } else if ((m = line.match(/^#{2,}\s*(.*)$/))) {
            sub = { title: m[1].trim(), line: i, chips: [] };
            ensureHead().subs.push(sub);
        } else {
            const chip = parseTagLine(line);
            chip.line = i;
            if (chip.text) (sub ?? ensureHead()).chips.push(chip);
        }
    });
    heads.forEach((hd, i) => {
        hd.end = heads[i + 1]?.line ?? lines.length;
        hd.subs.forEach((sb, j) => { sb.end = hd.subs[j + 1]?.line ?? hd.end; });
    });
    return heads;
}

// Move `count` lines starting at `from` so they sit before line `to` (indices in the original
// text). Returns the new text, or null when nothing would change.
function moveLines(src, from, count, to) {
    if (to >= from && to <= from + count) return null;
    const lines = String(src).split("\n");
    const block = lines.splice(from, count);
    lines.splice(to > from ? to - count : to, 0, ...block);
    return lines.join("\n");
}

// Tag lists saved before version 3 put several tags on a line, separated by commas.
// Split them onto their own lines once, when the note loads.
function splitCommaLines(src) {
    return String(src ?? "").split("\n").flatMap((line) => {
        const t = line.trim();
        if (!t || t.startsWith("#")) return [line];
        return t.split(",").map((c) => c.trim()).filter(Boolean);
    }).join("\n");
}

// ---------- Shift-click selection ----------
// Only one note holds a selection at a time. It lasts while Shift is held down.
let selOwner = null;
// flash: Shift let go (or window left) confirms the copy. Other endings (a plain click, a sub
// headline click, editing) replace the clipboard, so the old selection just fades without "Copied".
function endSelection(flash = false) {
    selOwner?.clearSelection(flash);
    selOwner = null;
}
addEventListener("keyup", (e) => { if (e.key === "Shift") endSelection(true); }, true);
// Shift released in another window never reaches this page, so leaving the window ends it too.
addEventListener("blur", () => endSelection(true));

// Tags can be written with spaces or underscores; the tab's "Use underscores" option decides.
// On: spaces become underscores. Off: underscores become spaces, except in emoticon tags such
// as ^_^, >_< or o_o, recognised as tags with no run of two or more letters or digits.
const isEmoticon = (t) => !/[\p{L}\p{N}]{2,}/u.test(t);
function chipText(tab, chip) {
    const t = typeof chip === "string" ? chip : chip.text;
    if (tab.copyUnderscore) return t.replace(/\s+/g, "_");
    return isEmoticon(t) ? t : t.replace(/_+/g, " ");
}
const copyFormat = (tab, text) => (tab.copyComma ? text + "," : text);

// Flash "Copied" (or "Copy failed") over each element, fading in and back out.
function flashCopied(els, ok) {
    for (const x of els) {
        x.dataset.copied = ok ? "Copied" : "Copy failed";
        x.classList.add("is-copied");
        clearTimeout(x.tnTimer);
        x.tnTimer = setTimeout(() => x.classList.remove("is-copied"), 900);
    }
}

// ---------- examples shown in empty tabs ----------
const EXAMPLES = {
    tags: [
        "# Clothing",
        "## Boots",
        "white PVC fold-over cuff ankle boots",
        "stiletto heels | very thin, high heels",
        "## Dress",
        "pink halterneck dress",
        "# Camera",
        "**Camera:** Shot on an 85mm lens, sharp focus, bokeh",
    ].join("\n"),
    markdown: [
        "# Heading",
        "## Smaller heading",
        "**bold**, *italic* and `code`",
        "- a bullet point",
        "1. a numbered point",
        "> a quote",
        "[a link](https://example.com)",
    ].join("\n"),
};

// ---------- tag descriptions: one tooltip, shown straight away on hover or focus ----------
let tipEl = null;
function showTip(anchor, text) {
    tipEl ??= h("div", "tn-tip", { role: "tooltip" });
    tipEl.textContent = text;
    tipEl.style.setProperty("--tn-color", getComputedStyle(anchor).getPropertyValue("--tn-color"));
    document.body.append(tipEl);
    const a = anchor.getBoundingClientRect();
    const t = tipEl.getBoundingClientRect();
    const above = a.top - t.height - 6 >= 4;
    tipEl.style.left = Math.max(4, Math.min(a.left + a.width / 2 - t.width / 2, innerWidth - t.width - 4)) + "px";
    tipEl.style.top = (above ? a.top - t.height - 6 : a.bottom + 6) + "px";
}
function hideTip() { tipEl?.remove(); }
addEventListener("scroll", hideTip, true);
addEventListener("wheel", hideTip, { capture: true, passive: true });

// ---------- data ----------
const PALETTE = ["#4a90d9", "#4fae78", "#d4a23c", "#d05a4a", "#9a6bd6", "#39acb0", "#d46aa3", "#7d8a97"];
const ICONS = ["📝", "⭐", "📌", "💡", "⚠️", "✅", "❌", "❓", "⚙️", "🔧", "🎨", "🌈",
    "📷", "🎬", "🧍", "👗", "👢", "🧠", "🔤", "🔗", "📁", "🗒️", "🎯", "🔒"];
const TYPES = [
    { id: "plain", label: "Plain" },
    { id: "markdown", label: "Markdown" },
    { id: "tags", label: "Tag list" },
];

const uid = () => Math.random().toString(36).slice(2, 10);

function newTab(s, extra = {}) {
    const n = s ? s.tabs.length : 0;
    return {
        id: uid(),
        title: `Tab ${n + 1}`,
        color: PALETTE[n % PALETTE.length],
        icon: ICONS[n % ICONS.length],
        group: null,
        type: "plain",
        spellcheck: true,
        autocomplete: false,
        copyComma: false,
        copyUnderscore: false,
        collapsed: [],
        content: "",
        ...extra,
    };
}

function defaultState() {
    const t = newTab(null, { title: "Notes" });
    return {
        version: 3, orientation: "horizontal", active: t.id, tabs: [t], groups: [],
        io: { input: false, outputs: [] }, // outputs: up to two of "pass" | "note"
        genLimit: 3,      // how many run-made tabs the Generated group keeps
        genGroup: null,   // id of the current Generated group
        lastInput: null,  // last incoming text, so unchanged text makes no new tab
        outputTab: null,  // default text output tab id
    };
}

// Generated tab names: YY/MM/DD HH:MM, so they sort by date.
function stamp(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getFullYear() % 100)}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function normalize(s) {
    if (!Array.isArray(s.tabs)) s.tabs = [];
    if (!Array.isArray(s.groups)) s.groups = [];
    if (s.orientation !== "vertical") s.orientation = "horizontal";
    const groupIds = new Set(s.groups.map((g) => g.id));
    const fromVersion = Number(s.version) || 1;
    for (const t of s.tabs) {
        t.id ??= uid();
        t.title ??= "Tab";
        t.color ??= PALETTE[0];
        t.icon ??= "📝";
        t.content ??= "";
        // Version 1 stored a markdown tick; version 2 stores a tab type.
        if (!TYPES.some((x) => x.id === t.type)) t.type = t.markdown ? "markdown" : "plain";
        delete t.markdown;
        if (fromVersion < 3 && t.type === "tags") t.content = splitCommaLines(t.content);
        t.spellcheck = t.spellcheck !== false; // on unless explicitly turned off
        t.autocomplete = !!t.autocomplete;
        t.copyComma = !!t.copyComma;
        t.copyUnderscore = !!t.copyUnderscore;
        if (!Array.isArray(t.collapsed)) t.collapsed = [];
        if (t.group && !groupIds.has(t.group)) t.group = null;
    }
    if (!s.tabs.some((t) => t.id === s.active)) s.active = s.tabs[0]?.id ?? null;
    if (typeof s.io !== "object" || !s.io) s.io = {};
    s.io.input = !!s.io.input;
    s.io.outputs = (Array.isArray(s.io.outputs) ? s.io.outputs : [])
        .filter((k) => OUTPUT_KINDS.some((o) => o.id === k)).slice(0, 2);
    s.genLimit = Math.max(1, Math.min(99, Math.floor(Number(s.genLimit)) || 3));
    if (!groupIds.has(s.genGroup)) s.genGroup = null;
    s.lastInput ??= null;
    if (!s.tabs.some((t) => t.id === s.outputTab)) s.outputTab = null;
    s.version = 3;
    return s;
}

function h(tag, cls, props = {}) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const [k, v] of Object.entries(props)) {
        if (k === "text") e.textContent = v;
        else if (k === "style") Object.assign(e.style, v);
        else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v);
    }
    return e;
}

// Keep typing inside the note from triggering ComfyUI shortcuts (delete node, undo, etc).
const stopKeys = (e) => e.stopPropagation();

// ---------- floating menus (on document.body so they are never clipped by the node) ----------
let openMenu = null;
let openSub = null;

function closeSub() {
    openSub?.remove();
    openSub = null;
}

function closeMenu() {
    closeSub();
    openMenu?.remove();
    openMenu = null;
    document.removeEventListener("pointerdown", onOutsidePointer, true);
}

function onOutsidePointer(e) {
    if (openMenu && !openMenu.contains(e.target) && !openSub?.contains(e.target)) closeMenu();
}

function placeMenu(m, x, y) {
    const r = m.getBoundingClientRect();
    m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + "px";
    m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + "px";
}

/**
 * items: array of
 *   { label, action, checked, danger, disabled, hint }
 *   { label, submenu: () => items }      flyout opened on hover or click
 *   { sep: true }
 *   { heading: text }                    a title line, not clickable
 *   { swatches: current, onPick(color) }
 *   { icons: current, onPick(icon) }
 *   { input: value, placeholder, onSubmit(value) }
 */
function buildMenu(items, accent, isSub) {
    const m = h("div", "tn-menu" + (isSub ? " tn-submenu" : ""), { role: "menu" });
    if (accent) m.style.setProperty("--tn-color", accent);
    m.addEventListener("keydown", stopKeys);
    m.addEventListener("contextmenu", (e) => e.preventDefault());

    for (const it of items) {
        if (it.sep) {
            m.append(h("div", "tn-menu-sep"));
        } else if (it.heading !== undefined) {
            m.append(h("div", "tn-menu-heading", { text: it.heading }));
        } else if (it.swatches !== undefined) {
            const row = h("div", "tn-swatches");
            for (const c of PALETTE) {
                row.append(h("button", "tn-swatch" + (c.toLowerCase() === String(it.swatches).toLowerCase() ? " is-current" : ""), {
                    style: { background: c }, title: c, "aria-label": `Colour ${c}`,
                    onclick: () => { it.onPick(c); closeMenu(); },
                }));
            }
            const custom = h("label", "tn-swatch tn-swatch-custom", { title: "Custom colour" });
            const picker = h("input", "", { type: "color" });
            picker.value = /^#[0-9a-f]{6}$/i.test(it.swatches) ? it.swatches : "#888888";
            picker.addEventListener("input", () => it.onPick(picker.value));
            picker.addEventListener("change", () => closeMenu());
            custom.append(picker);
            row.append(custom);
            m.append(row);
        } else if (it.icons !== undefined) {
            const grid = h("div", "tn-icons");
            for (const ic of ICONS) {
                grid.append(h("button", "tn-icon-btn" + (ic === it.icons ? " is-current" : ""), {
                    text: ic, onclick: () => { it.onPick(ic); closeMenu(); },
                }));
            }
            m.append(grid);
            const inp = h("input", "tn-menu-input", { placeholder: "Or type any emoji / text" });
            inp.addEventListener("keydown", (e) => {
                if (e.key === "Enter" && inp.value.trim()) { it.onPick([...inp.value.trim()].slice(0, 2).join("")); closeMenu(); }
                if (e.key === "Escape") closeMenu();
            });
            m.append(inp);
        } else if (it.input !== undefined) {
            const inp = h("input", "tn-menu-input", { placeholder: it.placeholder ?? "" });
            inp.value = it.input;
            inp.addEventListener("keydown", (e) => {
                if (e.key === "Enter") { it.onSubmit(inp.value.trim()); closeMenu(); }
                if (e.key === "Escape") closeMenu();
            });
            m.append(inp);
            requestAnimationFrame(() => { inp.focus(); inp.select(); });
        } else {
            const b = h("button", "tn-menu-item" + (it.danger ? " is-danger" : "") + (it.submenu ? " has-sub" : ""), { role: "menuitem" });
            b.append(h("span", "tn-check", { text: it.checked ? "✓" : "" }), h("span", "tn-menu-label", { text: it.label }));
            if (it.hint) b.append(h("span", "tn-menu-hint", { text: it.hint }));
            if (it.submenu) b.append(h("span", "tn-menu-arrow", { text: "▸" }));
            if (it.disabled) b.disabled = true;
            if (it.submenu) {
                const open = () => {
                    if (b.disabled || openSub?.tnOwner === b) return;
                    closeSub();
                    const sm = buildMenu(it.submenu(), accent, true);
                    sm.tnOwner = b;
                    document.body.append(sm);
                    const br = b.getBoundingClientRect();
                    const mr = m.getBoundingClientRect();
                    const sr = sm.getBoundingClientRect();
                    const x = mr.right + sr.width + 2 <= innerWidth ? mr.right + 2 : mr.left - sr.width - 2;
                    placeMenu(sm, x, br.top - 5);
                    openSub = sm;
                };
                b.addEventListener("mouseenter", open);
                b.addEventListener("click", open);
            } else {
                if (!isSub) b.addEventListener("mouseenter", closeSub);
                b.addEventListener("click", () => {
                    const keepOpen = it.action?.() === "keep";
                    if (!keepOpen && (openMenu === m || openSub === m)) closeMenu();
                });
            }
            m.append(b);
        }
    }
    return m;
}

function showMenu(x, y, items, accent) {
    closeMenu();
    const m = buildMenu(items, accent, false);
    document.body.append(m);
    placeMenu(m, x, y);
    openMenu = m;
    setTimeout(() => document.addEventListener("pointerdown", onOutsidePointer, true));
}

// Capture phase: the note stops keydown from bubbling (to block ComfyUI shortcuts),
// so a bubbling listener would never hear Esc while focus is inside the note.
addEventListener("keydown", (e) => { if (e.key === "Escape" && openMenu) closeMenu(); }, true);

// Mouse wheel over something in a note that has more to scroll (a long tag list, markdown note,
// text or tab strip) scrolls it. In Nodes 2.0 the canvas catches every wheel on its way down to
// the node and zooms instead, so this listens at the window, before the canvas. Nothing is
// prevented, so the browser scrolls as normal. Ctrl+wheel still zooms, and a note with nothing
// to scroll leaves the wheel to the canvas.
addEventListener("wheel", (e) => {
    if (e.ctrlKey || e.metaKey) return;
    const root = e.target?.closest?.(".tn-root");
    if (!root) return;
    for (let el = e.target; el && root.contains(el); el = el.parentElement) {
        const oy = getComputedStyle(el).overflowY;
        if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) {
            e.stopPropagation();
            return;
        }
    }
}, { capture: true, passive: true });

// ---------- UI controller ----------
class TabbedNoteUI {
    constructor(node) {
        this.node = node;
        this.editing = false; // markdown and tag list tabs: true while the text editor is open
        this.ac = null;       // pysssss autocomplete attached to the current editor
        this.sel = [];        // Shift-click selection: [{key, text}] in click order
        this.selTab = null;   // tab the selection belongs to
        this.root = h("div", "tn-root");
        this.strip = h("div", "tn-strip");
        this.body = h("div", "tn-body");
        this.root.append(this.strip, this.body);
        this.root.addEventListener("keydown", stopKeys);
        // Focus rings only for keyboard use: mouse clicks hide them, the Tab key brings them back.
        this.root.dataset.input = "pointer";
        this.root.addEventListener("pointerdown", () => { this.root.dataset.input = "pointer"; }, true);
        this.root.addEventListener("keydown", (e) => { if (e.key === "Tab") this.root.dataset.input = "keyboard"; }, true);
        // Right-clicking where you type must reach the browser, so its menu (with spelling
        // suggestions) opens. In Nodes 2.0 the node would otherwise take it for its own menu.
        this.root.addEventListener("contextmenu", (e) => {
            if (e.target.closest?.("textarea, input, [contenteditable=true]")) e.stopPropagation();
        });
        // Dropping on empty strip space: ungroup and move to the end.
        this.strip.addEventListener("dragover", (e) => { if (this.dragId) e.preventDefault(); });
        this.strip.addEventListener("drop", (e) => {
            if (!this.dragId || e.target !== this.strip) return;
            e.preventDefault();
            this.moveTab(this.dragId, null, false, null);
        });
    }

    get s() {
        this.node.properties ??= {};
        this.node.properties.tabnote ??= defaultState();
        return normalize(this.node.properties.tabnote);
    }

    get vertical() { return this.s.orientation === "vertical"; }

    changed() {
        this.node.setDirtyCanvas?.(true, true);
        this.node.graph?.change?.();
    }

    commit() { this.changed(); this.render(); }

    // ----- rendering -----
    render() {
        const s = this.s;
        this.root.classList.toggle("tn-vertical", this.vertical);
        this.root.classList.toggle("tn-horizontal", !this.vertical);
        this.strip.replaceChildren();

        const done = new Set();
        for (const tab of s.tabs) {
            if (tab.group) {
                if (done.has(tab.group)) continue;
                done.add(tab.group);
                this.strip.append(this.groupEl(s.groups.find((g) => g.id === tab.group)));
            } else {
                this.strip.append(this.tabEl(tab));
            }
        }
        for (const g of s.groups) if (!done.has(g.id)) this.strip.append(this.groupEl(g));

        const tools = h("div", "tn-tools");
        tools.append(
            h("button", "tn-tool", { text: "+", title: "New tab", "aria-label": "New tab", onclick: () => this.addTab() }),
            h("button", "tn-tool", {
                text: "⋯", title: "Note options", "aria-label": "Note options",
                onclick: (e) => this.nodeMenu(e),
            }),
        );
        this.strip.append(tools);
        this.renderBody();
    }

    groupEl(g) {
        const s = this.s;
        const tabs = s.tabs.filter((t) => t.group === g.id);
        const wrap = h("div", "tn-group" + (g.collapsed ? " is-collapsed" : ""));
        wrap.style.setProperty("--tn-color", g.color);
        if (g.collapsed && tabs.some((t) => t.id === s.active)) wrap.classList.add("has-active");

        const head = h("button", "tn-group-head", {
            title: `${g.name} — click to ${g.collapsed ? "expand" : "collapse"}, right-click for options`,
        });
        head.append(
            h("span", "tn-chev", { text: g.collapsed ? "▸" : "▾" }),
            h("span", "tn-group-name", { text: this.vertical ? [...g.name][0] ?? "?" : g.name }),
        );
        if (g.collapsed) head.append(h("span", "tn-group-count", { text: String(tabs.length) }));
        head.addEventListener("click", () => { g.collapsed = !g.collapsed; this.commit(); });
        head.addEventListener("contextmenu", (e) => { e.preventDefault(); e.stopPropagation(); this.groupMenu(e, g); });
        head.addEventListener("dragover", (e) => { if (this.dragId) { e.preventDefault(); head.classList.add("is-drop"); } });
        head.addEventListener("dragleave", () => head.classList.remove("is-drop"));
        head.addEventListener("drop", (e) => {
            e.preventDefault(); e.stopPropagation();
            if (this.dragId) this.moveTab(this.dragId, null, false, g.id);
        });
        wrap.append(head);

        if (!g.collapsed) {
            const inner = h("div", "tn-group-tabs");
            for (const t of tabs) inner.append(this.tabEl(t));
            wrap.append(inner);
        }
        return wrap;
    }

    tabEl(tab) {
        const s = this.s;
        const el = h("div", "tn-tab" + (tab.id === s.active ? " is-active" : ""), {
            draggable: "true", role: "tab", tabindex: "0", title: tab.title,
        });
        el.style.setProperty("--tn-color", tab.color);
        el.dataset.id = tab.id;
        el.append(h("span", "tn-icon", { text: tab.icon }));
        const title = h("span", "tn-title", { text: tab.title });
        el.append(title);
        if (tab.type === "markdown") el.append(h("span", "tn-md-badge", { text: "M", title: "Markdown tab" }));
        if (tab.type === "tags") el.append(h("span", "tn-md-badge", { text: "T", title: "Tag list tab" }));
        if (s.outputTab === tab.id && s.io.outputs.includes("note")) {
            el.append(h("span", "tn-md-badge tn-out-badge", { text: "Out", title: "Default text output tab" }));
        }

        el.addEventListener("click", () => this.activate(tab.id));
        el.addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target === el) this.activate(tab.id); });
        // Double-click renames, with the whole name selected so typing replaces it. Vertical tabs
        // show no name, so a rename box opens instead (the icon picker is in the right-click menu).
        el.addEventListener("dblclick", (e) => {
            e.stopPropagation(); // in Nodes 2.0, a double-click must not reach the node
            if (this.vertical) this.renameMenu(e, tab.title, (v) => { if (v) { tab.title = v; this.commit(); } });
            else this.renameInline(tab, title);
        });
        el.addEventListener("contextmenu", (e) => {
            // While renaming, right-click belongs to the browser (spelling suggestions).
            if (title.isContentEditable) { e.stopPropagation(); return; }
            e.preventDefault(); e.stopPropagation(); this.tabMenu(e, tab);
        });

        // drag to reorder / regroup
        el.addEventListener("dragstart", (e) => {
            this.dragId = tab.id;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", tab.id);
            el.classList.add("is-dragging");
        });
        el.addEventListener("dragend", () => { this.dragId = null; this.render(); });
        el.addEventListener("dragover", (e) => {
            if (!this.dragId || this.dragId === tab.id) return;
            e.preventDefault(); e.stopPropagation();
            const after = this.isAfter(e, el);
            el.classList.toggle("drop-before", !after);
            el.classList.toggle("drop-after", after);
        });
        el.addEventListener("dragleave", () => el.classList.remove("drop-before", "drop-after"));
        el.addEventListener("drop", (e) => {
            e.preventDefault(); e.stopPropagation();
            if (this.dragId && this.dragId !== tab.id) this.moveTab(this.dragId, tab.id, this.isAfter(e, el), tab.group);
        });
        return el;
    }

    isAfter(e, el) {
        const r = el.getBoundingClientRect();
        return this.vertical ? e.clientY > r.top + r.height / 2 : e.clientX > r.left + r.width / 2;
    }

    detachAutocomplete() {
        this.ac?.dropdown?.remove();
        this.ac = null;
    }

    renderBody() {
        const s = this.s;
        const tab = s.tabs.find((t) => t.id === s.active);
        this.detachAutocomplete();
        hideTip();
        this.body.replaceChildren();
        if (!tab) {
            this.body.append(h("button", "tn-empty", { text: "Add a tab to start writing", onclick: () => this.addTab() }));
            return;
        }
        this.body.style.setProperty("--tn-color", tab.color);
        // A Shift-click selection belongs to one tab's view; switching tabs or editing ends it.
        if (this.sel.length && (this.selTab !== tab.id || this.editing || tab.type !== "tags")) this.sel = [];

        // Markdown and tag list tabs show a view; double-click anywhere in it to edit.
        if (tab.type !== "plain" && !this.editing) {
            const view = tab.type === "markdown" ? this.markdownView(tab) : this.tagsView(tab);
            view.addEventListener("dblclick", (e) => {
                if (e.shiftKey) return; // quick Shift-clicks on one chip select and unselect it
                endSelection();
                this.editing = true;
                this.renderBody();
            });
            this.body.append(view);
            return;
        }
        this.body.append(this.editor(tab));
    }

    // Empty markdown and tag list tabs show a greyed example of how to write one.
    emptyExample(type, cls) {
        const view = h("div", cls + " tn-empty-view");
        view.append(
            h("p", "tn-placeholder", { text: "Double-click to start writing. For example:" }),
            h("pre", "tn-example", { text: EXAMPLES[type] }),
        );
        return view;
    }

    markdownView(tab) {
        if (!tab.content.trim()) return this.emptyExample("markdown", "tn-md");
        const view = h("div", "tn-md", { title: "Double-click to edit" });
        view.innerHTML = renderMarkdown(tab.content);
        return view;
    }

    tagsView(tab) {
        const heads = parseTags(tab.content);
        if (!heads.length) return this.emptyExample("tags", "tn-tags");
        // No hover titles here: only tags with a description show a tooltip, straight away.
        const view = h("div", "tn-tags");
        const selected = new Set(this.sel.map((x) => x.key));
        const chipRow = (chips, prefix) => {
            const row = h("div", "tn-chips");
            chips.forEach((c, ci) => {
                const shown = chipText(tab, c);
                const key = `${prefix}.${ci}`;
                const chip = h("button", "tn-chip" + (selected.has(key) ? " is-selected" : ""), { text: shown });
                chip.dataset.drag = "chip";
                chip.dataset.key = key;
                if (c.desc) {
                    chip.classList.add("has-desc");
                    chip.setAttribute("aria-description", c.desc);
                    chip.append(h("span", "tn-chip-dot", { "aria-hidden": "true" }));
                    chip.addEventListener("pointerenter", () => showTip(chip, c.desc));
                    chip.addEventListener("pointerleave", hideTip);
                    chip.addEventListener("focus", () => showTip(chip, c.desc));
                    chip.addEventListener("blur", hideTip);
                }
                chip.addEventListener("click", (e) => {
                    if (this.consumeDragClick()) return;
                    if (e.shiftKey) this.toggleSelected(tab, chip, key, shown);
                    else {
                        endSelection();
                        this.copyWithFeedback(chip, copyFormat(tab, shown));
                    }
                });
                row.append(chip);
            });
            return row;
        };

        heads.forEach((head, hi) => {
            const sec = h("section", "tn-head");
            const key = head.title ?? "";
            const collapsed = head.title !== null && tab.collapsed.includes(key);
            if (head.title !== null) {
                const hb = h("button", "tn-head-title", {
                    title: collapsed ? "Click to expand" : "Click to collapse",
                    "aria-expanded": String(!collapsed),
                });
                hb.append(h("span", "tn-chev", { text: collapsed ? "▸" : "▾" }), h("span", "", { text: head.title || "Untitled" }));
                hb.dataset.drag = "head";
                hb.dataset.key = `${hi}`;
                hb.addEventListener("click", () => {
                    if (this.consumeDragClick()) return;
                    tab.collapsed = collapsed ? tab.collapsed.filter((k) => k !== key) : [...tab.collapsed, key];
                    this.changed();
                    this.renderBody();
                });
                sec.append(hb);
            }
            if (!collapsed) {
                if (head.chips.length) sec.append(chipRow(head.chips, `${hi}.h`));
                head.subs.forEach((sub, si) => {
                    // A sub headline's section: a coloured bar down its left side, from the title
                    // to its last tag. The arrow collapses it; clicking the name copies its tags.
                    // Collapsed sub headlines are remembered by headline + sub headline name.
                    const subKey = `## ${head.title ?? ""} / ${sub.title}`;
                    const subCollapsed = tab.collapsed.includes(subKey);
                    const box = h("div", "tn-sub" + (subCollapsed ? " is-collapsed" : ""));
                    const bar = h("div", "tn-sub-row");
                    const arrow = h("button", "tn-sub-chev", {
                        text: subCollapsed ? "▸" : "▾",
                        title: subCollapsed ? "Expand" : "Collapse",
                        "aria-label": `${subCollapsed ? "Expand" : "Collapse"} ${sub.title || "Untitled"}`,
                        "aria-expanded": String(!subCollapsed),
                    });
                    arrow.addEventListener("click", () => {
                        tab.collapsed = subCollapsed ? tab.collapsed.filter((k) => k !== subKey) : [...tab.collapsed, subKey];
                        this.changed();
                        this.renderBody();
                    });
                    const sb = h("button", "tn-sub-title", {
                        text: sub.title || "Untitled",
                        title: sub.chips.length ? "Click to copy all of these tags" : "No tags to copy",
                    });
                    sb.dataset.drag = "sub";
                    sb.dataset.key = `${hi}.${si}`;
                    bar.append(arrow, sb);
                    if (subCollapsed && sub.chips.length) bar.append(h("span", "tn-sub-count", { text: String(sub.chips.length) }));
                    box.append(bar);
                    sec.append(box);
                    if (sub.chips.length) {
                        const row = chipRow(sub.chips, `${hi}.${si}`);
                        const all = copyFormat(tab, sub.chips.map((c) => chipText(tab, c)).join(", "));
                        sb.addEventListener("click", () => {
                            if (this.consumeDragClick()) return;
                            endSelection();
                            // When collapsed, the tags aren't on screen, so only the name flashes.
                            this.copyWithFeedback(sb, all, subCollapsed ? [] : [...row.children]);
                        });
                        if (!subCollapsed) box.append(row);
                    } else {
                        // Not `disabled`: a disabled button gets no pointer events, and an empty sub
                        // headline must still be draggable and a place to drop tags.
                        sb.classList.add("is-empty");
                        sb.setAttribute("aria-disabled", "true");
                    }
                });
            } else {
                sec.classList.add("is-collapsed");
            }
            view.append(sec);
        });
        view.addEventListener("pointerdown", (e) => this.startTagDrag(e, tab, heads));
        return view;
    }

    // ----- Ctrl+drag to move tags, sub headlines and headlines -----
    // What a [data-drag] element stands for, from its key ("hi", "hi.si", "hi.si.ci", "hi.h.ci").
    dragItem(el, heads) {
        const [hi, si, ci] = el.dataset.key.split(".");
        const head = heads[+hi];
        if (el.dataset.drag === "head") return { kind: "head", el, node: head, title: head.title };
        if (el.dataset.drag === "sub") return { kind: "sub", el, node: head.subs[+si], head, title: head.subs[+si].title };
        const owner = si === "h" ? head : head.subs[+si];
        return { kind: "chip", el, node: owner.chips[+ci], owner, head };
    }

    // Where the dragged item would land if dropped at this pointer position: {el, side, at},
    // where `at` is the line it would be inserted before.
    dropTarget(ev, item, heads) {
        const under = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.("[data-drag]");
        if (!under || !this.body.contains(under) || under === item.el) return null;
        const t = this.dragItem(under, heads);
        const r = under.getBoundingClientRect();
        const lower = ev.clientY > r.top + r.height / 2;
        const lastLine = (n) => (n.chips.length ? n.chips[n.chips.length - 1].line : n.line) + 1;
        if (item.kind === "chip") {
            if (t.kind === "chip") {
                const after = ev.clientX > r.left + r.width / 2;
                return { el: under, side: after ? "after" : "before", at: t.node.line + (after ? 1 : 0) };
            }
            // Onto a title: go to the end of that title's own tags.
            return { el: under, side: "into", at: lastLine(t.node) };
        }
        if (item.kind === "sub") {
            if (t.kind === "sub") return { el: under, side: lower ? "below" : "above", at: lower ? t.node.end : t.node.line };
            if (t.kind === "head") return { el: under, side: "into", at: t.node.end };
            return null;
        }
        if (t.kind === "head") return { el: under, side: lower ? "below" : "above", at: lower ? t.node.end : t.node.line };
        return null;
    }

    startTagDrag(e, tab, heads) {
        if (!e.ctrlKey || e.button !== 0) return;
        const src = e.target.closest?.("[data-drag]");
        if (!src) return;
        e.preventDefault();
        e.stopPropagation(); // keep ComfyUI from treating this as a node or canvas drag
        const item = this.dragItem(src, heads);
        const start = [e.clientX, e.clientY];
        let ghost = null;
        let target = null;
        const mark = (t) => {
            target?.el.classList.remove("tn-drop-before", "tn-drop-after", "tn-drop-above", "tn-drop-below", "tn-drop-into");
            target = t;
            target?.el.classList.add(`tn-drop-${t.side}`);
        };
        const move = (ev) => {
            ev.stopPropagation();
            if (!ghost) {
                if (Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) < 5) return;
                endSelection();
                hideTip();
                ghost = h("div", "tn-ghost", { text: item.kind === "chip" ? src.textContent : item.title || "Untitled" });
                ghost.style.setProperty("--tn-color", getComputedStyle(src).getPropertyValue("--tn-color"));
                document.body.append(ghost);
                src.classList.add("is-dragging");
                this.root.classList.add("tn-is-dragging");
            }
            ghost.style.left = ev.clientX + 12 + "px";
            ghost.style.top = ev.clientY + 10 + "px";
            const t = this.dropTarget(ev, item, heads);
            if (t?.el !== target?.el || t?.side !== target?.side) mark(t);
        };
        const finish = (ev, cancelled) => {
            removeEventListener("pointermove", move, true);
            removeEventListener("pointerup", up, true);
            removeEventListener("pointercancel", cancel, true);
            removeEventListener("keydown", esc, true);
            if (!ghost) return; // no real drag: let the click happen as normal
            ghost.remove();
            src.classList.remove("is-dragging");
            this.root.classList.remove("tn-is-dragging");
            this.dragClick = true; // swallow the click that follows the pointerup
            setTimeout(() => { this.dragClick = false; });
            const t = target;
            mark(null);
            if (!cancelled && t) this.dropTagItem(tab, item, t, ev);
        };
        const up = (ev) => { ev.stopPropagation(); finish(ev, false); };
        const cancel = (ev) => finish(ev, true);
        const esc = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); finish(ev, true); } };
        addEventListener("pointermove", move, true);
        addEventListener("pointerup", up, true);
        addEventListener("pointercancel", cancel, true);
        addEventListener("keydown", esc, true);
    }

    consumeDragClick() {
        const was = this.dragClick;
        this.dragClick = false;
        return was;
    }

    dropTagItem(tab, item, t, ev) {
        const apply = (count) => {
            const next = moveLines(tab.content, item.node.line, count, t.at);
            if (next === null) return;
            tab.content = next;
            this.changed();
            this.renderBody();
        };
        if (item.kind === "chip") { apply(1); return; }
        // Headlines and sub headlines ask first: with everything under them, just the title, or cancel.
        const name = item.title || "Untitled";
        showMenu(ev.clientX, ev.clientY, [
            { heading: `Move "${name}"` },
            {
                label: item.kind === "head" ? "With its sub headlines and tags" : "With its tags",
                action: () => apply(item.node.end - item.node.line),
            },
            { label: item.kind === "head" ? "Just the headline" : "Just the sub headline", action: () => apply(1) },
            { sep: true },
            { label: "Cancel" },
        ], getComputedStyle(item.el).getPropertyValue("--tn-color"));
    }

    // Plain click: flash "Copied" on the element (and light up `also`, e.g. a sub headline's chips).
    async copyWithFeedback(el, text, also = []) {
        flashCopied([el, ...also], await copyText(text));
    }

    // Shift-click: add or remove a chip, then copy the whole selection in click order.
    toggleSelected(tab, chip, key, shown) {
        if (selOwner !== this) endSelection();
        selOwner = this;
        this.selTab = tab.id;
        const i = this.sel.findIndex((x) => x.key === key);
        if (i >= 0) this.sel.splice(i, 1);
        else this.sel.push({ key, text: shown });
        chip.classList.toggle("is-selected", i < 0);
        // Copy on every click so the clipboard always holds the selection; the "Copied"
        // confirmation waits until Shift is let go (see clearSelection).
        if (this.sel.length) this.selCopy = copyText(copyFormat(tab, this.sel.map((x) => x.text).join(", ")));
    }

    // The selection ends. When it's confirmed (Shift let go), every picked chip flashes "Copied"
    // together. Classes change in place rather than re-rendering, so it all fades.
    async clearSelection(flash) {
        const picked = [...this.body.querySelectorAll(".tn-chip.is-selected")];
        const pending = this.selCopy;
        this.sel = [];
        this.selCopy = null;
        for (const c of picked) c.classList.remove("is-selected");
        if (flash && picked.length) flashCopied(picked, pending ? await pending : true);
    }

    editor(tab) {
        const placeholders = {
            plain: "Write a note…",
            markdown: EXAMPLES.markdown + "\n\nClick outside or press Esc to see it formatted.",
            tags: EXAMPLES.tags + "\n\nClick outside or press Esc to see the tags.",
        };
        const ta = h("textarea", "tn-text", {
            spellcheck: tab.spellcheck ? "true" : "false",
            placeholder: placeholders[tab.type],
        });
        ta.value = tab.content;
        const sync = () => {
            if (tab.content === ta.value) return;
            tab.content = ta.value;
            this.changed();
        };
        ta.addEventListener("input", sync);
        ta.addEventListener("keyup", sync);
        ta.addEventListener("keydown", stopKeys);

        if (tab.type !== "plain") {
            let finished = false;
            const finish = () => {
                if (finished || !ta.isConnected) return;
                finished = true;
                sync();
                this.editing = false;
                this.renderBody();
            };
            ta.addEventListener("blur", () => {
                // A click on an autocomplete suggestion is part of editing, not leaving it.
                if (pointerInAutocomplete) { pointerInAutocomplete = false; return; }
                finish();
            });
            ta.addEventListener("keydown", (e) => {
                if (e.key !== "Escape") return;
                if (this.ac?.dropdown?.parentElement) return; // Esc closes the suggestions first
                finish();
            });
            requestAnimationFrame(() => ta.focus());
        }

        if (tab.autocomplete) {
            getAutocomplete().then((AC) => {
                if (!AC || !ta.isConnected || this.ac) return;
                // Tag lists are one tag per line, so pysssss's ", " after a suggestion would end up
                // inside the tag. Override its separator there; other tabs keep pysssss's setting.
                try { this.ac = tab.type === "tags" ? new AC(ta, null, "") : new AC(ta); } catch (e) { console.warn("[TabbedNote] pysssss autocomplete failed to attach.", e); }
            });
        }
        return ta;
    }

    // ----- actions -----
    // Switch tabs without rebuilding the tab strip. Rebuilding replaced the tab under the pointer
    // between the two clicks of a double-click, so the browser never reported the double-click
    // and renaming never opened.
    activate(id) {
        const s = this.s;
        if (s.active === id) return;
        s.active = id;
        this.editing = false;
        for (const el of this.strip.querySelectorAll(".tn-tab")) el.classList.toggle("is-active", el.dataset.id === id);
        this.changed();
        this.renderBody();
    }

    addTab(group = null) {
        const s = this.s;
        const t = newTab(s, { group });
        if (group) {
            const lastIdx = s.tabs.map((x) => x.group).lastIndexOf(group);
            s.tabs.splice(lastIdx + 1, 0, t);
        } else {
            s.tabs.push(t);
        }
        s.active = t.id;
        this.editing = false;
        this.commit();
    }

    addGroup(withTabId = null) {
        const s = this.s;
        const g = { id: uid(), name: `Group ${s.groups.length + 1}`, color: PALETTE[(s.groups.length + 3) % PALETTE.length], collapsed: false };
        s.groups.push(g);
        if (withTabId) {
            const t = s.tabs.find((x) => x.id === withTabId);
            if (t) t.group = g.id;
        }
        this.commit();
        return g;
    }

    moveTab(id, targetId, after, group) {
        const s = this.s;
        const i = s.tabs.findIndex((t) => t.id === id);
        if (i < 0) return;
        const [t] = s.tabs.splice(i, 1);
        // A run-made tab moved out of its group is kept: it stops counting towards the limit.
        if (t.generated && t.group !== group) delete t.generated;
        t.group = group;
        let j;
        if (targetId) {
            j = s.tabs.findIndex((x) => x.id === targetId) + (after ? 1 : 0);
        } else if (group) {
            j = s.tabs.map((x) => x.group).lastIndexOf(group) + 1;
            if (j === 0) j = s.tabs.length;
        } else {
            j = s.tabs.length;
        }
        s.tabs.splice(j, 0, t);
        this.dragId = null;
        this.commit();
    }

    shiftTab(tab, dir) {
        const s = this.s;
        const i = s.tabs.indexOf(tab);
        // Swap with the nearest tab that shares this tab's group, so tabs stay inside their group.
        let j = i + dir;
        while (j >= 0 && j < s.tabs.length && s.tabs[j].group !== tab.group) j += dir;
        if (j < 0 || j >= s.tabs.length) return;
        [s.tabs[i], s.tabs[j]] = [s.tabs[j], s.tabs[i]];
        this.commit();
    }

    deleteTab(tab) {
        if (tab.content.trim() && !confirm(`Delete the tab "${tab.title}" and its text?`)) return;
        this.removeTab(tab);
        this.commit();
    }

    removeTab(tab) {
        const s = this.s;
        const i = s.tabs.indexOf(tab);
        if (i < 0) return;
        s.tabs.splice(i, 1);
        if (s.active === tab.id) s.active = (s.tabs[i] ?? s.tabs[i - 1])?.id ?? null;
        if (s.outputTab === tab.id) s.outputTab = null;
    }

    // ----- Text input: each new incoming text becomes a tab in the Generated group -----
    onIncomingText(text) {
        const s = this.s;
        if (!s.io.input || typeof text !== "string") return;
        if (text === s.lastInput) return; // unchanged since the last run
        s.lastInput = text;
        if (!text.trim()) { this.changed(); return; }

        // Reuse the Generated group unless it was deleted or renamed.
        let g = s.groups.find((x) => x.id === s.genGroup && x.name === GENERATED);
        if (!g) {
            g = { id: uid(), name: GENERATED, color: PALETTE[5], collapsed: false };
            s.groups.push(g);
            s.genGroup = g.id;
        }
        const tab = newTab(s, { title: stamp(), group: g.id, content: text, generated: Date.now() });
        const lastIdx = s.tabs.map((x) => x.group).lastIndexOf(g.id);
        s.tabs.splice(lastIdx >= 0 ? lastIdx + 1 : s.tabs.length, 0, tab);

        // Only run-made tabs still in the group count. Tabs dragged in by hand are never removed.
        const made = s.tabs.filter((t) => t.generated && t.group === g.id).sort((a, b) => a.generated - b.generated);
        while (made.length > s.genLimit) this.removeTab(made.shift());

        // Show the new tab, unless someone is typing in this note right now.
        if (!this.root.contains(document.activeElement)) {
            s.active = tab.id;
            this.editing = false;
        }
        this.commit();
    }

    // What the Python part receives when the workflow runs (JSON text).
    payload() {
        const s = this.s;
        const out = { input: s.io.input, outputs: [...s.io.outputs], note: "", error: "" };
        if (s.io.outputs.includes("note")) {
            const tab = s.tabs.find((t) => t.id === s.outputTab) ?? s.tabs.find((t) => t.id === s.active);
            if (!tab) {
                out.error = "Tabbed Note: there is no tab to send as text.";
            } else if (tab.type !== "plain") {
                const kind = TYPES.find((t) => t.id === tab.type).label;
                out.error = `Tabbed Note: the tab "${tab.title}" is a ${kind} tab. Only Plain tabs can be sent as text.`;
            } else {
                out.note = tab.content;
            }
        }
        return JSON.stringify(out);
    }

    // ----- node options -----
    setInput(on) {
        const s = this.s;
        s.io.input = on;
        syncIO(this.node);
        this.commit();
    }

    setOutput(slot, kind) {
        const s = this.s;
        const outs = s.io.outputs;
        if (kind === null) outs.length = slot; // turning an output off also turns off any after it
        else outs[slot] = kind;
        if (kind === "pass") s.io.input = true; // pass-through needs the input
        syncIO(this.node);
        this.commit();
    }

    setType(tab, type) {
        if (tab.type === type) return;
        tab.type = type;
        this.editing = false;
        this.commit();
    }

    renameInline(tab, span) {
        // While typing, clicks inside the name should place the cursor, not start dragging the tab.
        const tabEl = span.closest(".tn-tab");
        if (tabEl) tabEl.draggable = false;
        span.contentEditable = "true";
        span.classList.add("is-editing");
        span.focus();
        const range = document.createRange();
        range.selectNodeContents(span);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        let done = false;
        const end = (save) => {
            if (done) return;
            done = true;
            const v = span.textContent.trim();
            if (save && v) tab.title = v;
            this.commit();
        };
        span.addEventListener("keydown", (e) => {
            e.stopPropagation();
            if (e.key === "Enter") { e.preventDefault(); end(true); }
            if (e.key === "Escape") end(false);
        });
        span.addEventListener("blur", () => end(true), { once: true });
        span.addEventListener("dblclick", (e) => e.stopPropagation());
    }

    // ----- menus -----
    tabMenu(e, tab) {
        const s = this.s;
        const toggle = (key) => () => { tab[key] = !tab[key]; this.commit(); };
        const groupItems = () => [
            { label: "No group", checked: !tab.group, action: () => this.moveTab(tab.id, null, false, null) },
            ...s.groups.map((g) => ({
                label: g.name, checked: tab.group === g.id,
                action: () => this.moveTab(tab.id, null, false, g.id),
            })),
            { sep: true },
            { label: "New group with this tab", action: () => {
                const g = this.addGroup();
                this.moveTab(tab.id, null, false, g.id);
            } },
        ];
        const typeItems = () => TYPES.map((t) => ({
            label: t.label, checked: tab.type === t.id, action: () => this.setType(tab, t.id),
        }));
        const items = [
            { label: "Rename…", action: () => { this.renameMenu(e, tab.title, (v) => { if (v) { tab.title = v; this.commit(); } }); return "keep"; } },
            { label: "Change icon…", action: () => { this.iconMenu(e, tab); return "keep"; } },
            { swatches: tab.color, onPick: (c) => { tab.color = c; this.commit(); } },
            { sep: true },
            { label: "Tab type", hint: TYPES.find((t) => t.id === tab.type).label, submenu: typeItems },
        ];
        if (tab.type === "tags") {
            items.push(
                { label: "Add comma when copying", checked: tab.copyComma, action: toggle("copyComma") },
                { label: "Use underscores", checked: tab.copyUnderscore, action: toggle("copyUnderscore") },
            );
        }
        items.push(
            { label: "Spell check", checked: tab.spellcheck, action: toggle("spellcheck") },
            acAvailable === false
                ? { label: "Autocomplete", hint: "needs pysssss", disabled: true }
                : { label: "Autocomplete", checked: tab.autocomplete, action: toggle("autocomplete") },
        );
        if (s.io.outputs.includes("note")) {
            const isOut = s.outputTab === tab.id;
            items.push({
                label: "Default text output tab", checked: isOut,
                hint: tab.type === "plain" || isOut ? "" : "Plain only",
                disabled: tab.type !== "plain" && !isOut,
                action: () => { s.outputTab = isOut ? null : tab.id; this.commit(); },
            });
        }
        items.push(
            { sep: true },
            { label: "Move to group", submenu: groupItems },
            { label: this.vertical ? "Move up" : "Move left", disabled: s.tabs[0] === tab, action: () => this.shiftTab(tab, -1) },
            { label: this.vertical ? "Move down" : "Move right", disabled: s.tabs.at(-1) === tab, action: () => this.shiftTab(tab, 1) },
            { label: "Duplicate", action: () => {
                const copy = { ...tab, id: uid(), title: tab.title + " copy", collapsed: [...tab.collapsed] };
                delete copy.generated; // a copy is the user's own tab, never auto-removed
                s.tabs.splice(s.tabs.indexOf(tab) + 1, 0, copy);
                s.active = copy.id;
                this.editing = false;
                this.commit();
            } },
            { sep: true },
            { label: "Delete tab", danger: true, action: () => this.deleteTab(tab) },
        );
        showMenu(e.clientX, e.clientY, items, tab.color);
    }

    groupMenu(e, g) {
        const s = this.s;
        showMenu(e.clientX, e.clientY, [
            { label: "Rename…", action: () => { this.renameMenu(e, g.name, (v) => { if (v) { g.name = v; this.commit(); } }); return "keep"; } },
            { swatches: g.color, onPick: (c) => { g.color = c; this.commit(); } },
            { sep: true },
            { label: "Add tab to group", action: () => this.addTab(g.id) },
            { label: g.collapsed ? "Expand" : "Collapse", action: () => { g.collapsed = !g.collapsed; this.commit(); } },
            { label: "Ungroup (keep tabs)", action: () => {
                for (const t of s.tabs) if (t.group === g.id) t.group = null;
                s.groups = s.groups.filter((x) => x !== g);
                this.commit();
            } },
            { label: "Delete group and its tabs", danger: true, action: () => {
                const n = s.tabs.filter((t) => t.group === g.id).length;
                if (n && !confirm(`Delete "${g.name}" and its ${n} tab(s)?`)) return;
                s.tabs = s.tabs.filter((t) => t.group !== g.id);
                s.groups = s.groups.filter((x) => x !== g);
                this.commit();
            } },
        ], g.color);
    }

    nodeMenu(e) {
        const s = this.s;
        const r = e.currentTarget.getBoundingClientRect();
        showMenu(r.left, r.bottom + 4, [
            { label: "Horizontal tabs", checked: !this.vertical, action: () => { s.orientation = "horizontal"; this.commit(); } },
            { label: "Vertical tabs", checked: this.vertical, action: () => { s.orientation = "vertical"; this.commit(); } },
            { sep: true },
            { label: "New tab", action: () => this.addTab() },
            { label: "New group", action: () => this.addGroup() },
            { sep: true },
            { label: "Collapse all groups", disabled: !s.groups.length, action: () => { s.groups.forEach((g) => (g.collapsed = true)); this.commit(); } },
            { label: "Expand all groups", disabled: !s.groups.length, action: () => { s.groups.forEach((g) => (g.collapsed = false)); this.commit(); } },
            ...this.ioItems(r),
        ]);
    }

    ioItems(r) {
        const s = this.s;
        if (this.node.tnFallback) {
            return [{ sep: true }, { label: "Text input and outputs", hint: "needs tabbed_note.py", disabled: true }];
        }
        const outs = s.io.outputs;
        const kindLabel = (k) => OUTPUT_KINDS.find((o) => o.id === k)?.label ?? "Off";
        const outItems = (slot) => () => [
            { label: "Off", checked: outs[slot] === undefined, action: () => this.setOutput(slot, null) },
            ...OUTPUT_KINDS.map((o) => ({ label: o.label, checked: outs[slot] === o.id, action: () => this.setOutput(slot, o.id) })),
        ];
        const needsInput = outs.includes("pass");
        return [
            { sep: true },
            {
                label: "Text input", checked: s.io.input,
                hint: needsInput ? "used by pass-through" : "",
                disabled: needsInput,
                action: () => this.setInput(!s.io.input),
            },
            { label: "Output", hint: kindLabel(outs[0]), submenu: outItems(0) },
            { label: "Second output", hint: kindLabel(outs[1]), disabled: !outs.length, submenu: outItems(1) },
            {
                label: "Generated tab limit…", hint: String(s.genLimit),
                action: () => {
                    showMenu(r.left, r.bottom + 4, [{
                        input: String(s.genLimit), placeholder: "Number of tabs to keep (1 to 99)",
                        onSubmit: (v) => {
                            const n = Math.floor(Number(v));
                            if (n >= 1 && n <= 99) { s.genLimit = n; this.commit(); }
                        },
                    }]);
                    return "keep";
                },
            },
        ];
    }

    renameMenu(e, value, onSubmit) {
        showMenu(e.clientX, e.clientY, [{ input: value, placeholder: "Name", onSubmit }]);
    }

    iconMenu(e, tab) {
        showMenu(e.clientX, e.clientY, [{ icons: tab.icon, onPick: (ic) => { tab.icon = ic; this.commit(); } }], tab.color);
    }
}

// ---------- sockets ----------
// Make the node's sockets match its options, and decide whether ComfyUI should run it.
// Outputs are only ever added or removed at the end, so existing links keep their slot.
function syncIO(node) {
    const ui = node.tnUI;
    if (!ui) return;
    if (node.tnFallback) { node.isVirtualNode = true; return; }
    const io = ui.s.io;
    node.inputs ??= [];
    node.outputs ??= [];
    // Remove any input that isn't the text input (for example from an old definition).
    for (let i = node.inputs.length - 1; i >= 0; i--) {
        if (node.inputs[i].name !== "text") node.removeInput(i);
    }
    const inIdx = node.inputs.findIndex((i) => i.name === "text");
    if (io.input && inIdx < 0) node.addInput("text", "STRING");
    if (!io.input && inIdx >= 0) node.removeInput(inIdx);

    while (node.outputs.length > io.outputs.length) node.removeOutput(node.outputs.length - 1);
    while (node.outputs.length < io.outputs.length) node.addOutput(node.outputs.length ? "text_2" : "text", "STRING");
    io.outputs.forEach((k, i) => {
        const label = OUTPUT_KINDS.find((o) => o.id === k).socket;
        node.outputs[i].label = label;
        node.outputs[i].localized_name = label;
    });

    node.isVirtualNode = !(io.input || io.outputs.length);
    node.setDirtyCanvas?.(true, true);
}

function setupNode(node) {
    if (node.tnUI) return;
    node.properties ??= {};
    node.properties.tabnote ??= defaultState();
    node.serialize_widgets = false;
    node.tnUI = new TabbedNoteUI(node);
    node.addDOMWidget("tabbed_note", "tabbed_note", node.tnUI.root, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => 140,
    });
    node.size = [Math.max(node.size?.[0] ?? 0, 440), Math.max(node.size?.[1] ?? 0, 300)];
    syncIO(node);
    node.tnUI.render();
}

function patchPrototype(proto) {
    const configure = proto.onConfigure;
    proto.onConfigure = function (...args) {
        const r = configure?.apply(this, args);
        if (this.tnUI) {
            this.properties.tabnote ??= defaultState();
            this.tnUI.editing = false;
            syncIO(this);
            this.tnUI.render();
        }
        return r;
    };
    const executed = proto.onExecuted;
    proto.onExecuted = function (output) {
        executed?.apply(this, arguments);
        const v = output?.[UI_KEY];
        this.tnUI?.onIncomingText(Array.isArray(v) ? v.join("\n") : v);
    };
    const removed = proto.onRemoved;
    proto.onRemoved = function (...args) {
        closeMenu();
        this.tnUI?.detachAutocomplete();
        hideTip();
        return removed?.apply(this, args);
    };
}

// Find a node from its id in the prompt; nodes inside subgraphs have ids like "12:5".
function nodeByExecutionId(id) {
    let graph = app.rootGraph ?? app.graph;
    let node = null;
    for (const p of String(id).split(":")) {
        node = graph?.getNodeById?.(Number(p)) ?? graph?.getNodeById?.(p);
        if (!node) return null;
        graph = node.subgraph;
    }
    return node;
}

// ---------- registration ----------
let backendDefined = false;

app.registerExtension({
    name: EXT_NAME,

    // tabbed_note.py is installed: build the note on top of the backend node.
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData?.name !== NODE_TYPE) return;
        backendDefined = true;
        // tn_payload is filled in when the workflow is queued; it must never become a widget.
        if (nodeData.input?.optional) delete nodeData.input.optional.tn_payload;
        if (nodeData.input?.required) delete nodeData.input.required.tn_payload;
        patchPrototype(nodeType.prototype);
    },

    nodeCreated(node) {
        if (node.comfyClass === NODE_TYPE || node.type === NODE_TYPE) setupNode(node);
    },

    // tabbed_note.py isn't installed: notes still open and edit, without Text input or outputs.
    registerCustomNodes() {
        if (backendDefined || LiteGraph.registered_node_types?.[NODE_TYPE]) return;
        const Base = globalThis.LiteGraph?.LGraphNode ?? globalThis.LGraphNode;
        class TabbedNoteFallback extends Base {
            static title = "Tabbed Note";
            static collapsable = true;
            constructor(title) {
                super(title ?? "Tabbed Note");
                this.tnFallback = true;
                this.isVirtualNode = true;
                setupNode(this);
            }
        }
        patchPrototype(TabbedNoteFallback.prototype);
        LiteGraph.registerNodeType(NODE_TYPE, TabbedNoteFallback);
        TabbedNoteFallback.category = "utils";
    },

    // Put each running note's settings and output text into the prompt as tn_payload.
    setup() {
        const original = app.graphToPrompt;
        if (typeof original !== "function" || original.tnPatched) return;
        const patched = async function (...args) {
            const result = await original.apply(this, args);
            try {
                for (const [id, entry] of Object.entries(result?.output ?? {})) {
                    if (entry?.class_type !== NODE_TYPE) continue;
                    const node = nodeByExecutionId(id);
                    if (node?.tnUI) entry.inputs.tn_payload = node.tnUI.payload();
                }
            } catch (e) {
                console.warn("[TabbedNote] Could not add the note's settings to the prompt.", e);
            }
            return result;
        };
        patched.tnPatched = true;
        app.graphToPrompt = patched;
    },
});
