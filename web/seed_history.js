import { app } from "../../scripts/app.js";

const DEFAULT_MAX = 10;
const LIMIT = 1000;

function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for non-secure contexts, e.g. ComfyUI opened over a LAN IP on http.
  return new Promise((resolve, reject) => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy") ? resolve() : reject(new Error("copy failed"));
    } catch (e) {
      reject(e);
    } finally {
      ta.remove();
    }
  });
}

function clampMax(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_MAX;
  return Math.min(LIMIT, Math.max(1, n));
}

function ensureState(node) {
  node.properties = node.properties || {};
  if (!Array.isArray(node.properties.seed_history)) {
    node.properties.seed_history = [];
  }
  node.properties.max_seeds = clampMax(node.properties.max_seeds ?? DEFAULT_MAX);
  return node.properties;
}

// Keep pointer and wheel events inside the widget so the canvas doesn't
// drag the node or zoom while you click and scroll the list.
function isolate(el) {
  for (const ev of ["pointerdown", "mousedown", "wheel"]) {
    el.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  }
}

app.registerExtension({
  name: "SeedHistory.node",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "SeedHistory") return;

    nodeType.prototype.trimSeedHistory = function () {
      const p = ensureState(this);
      if (p.seed_history.length > p.max_seeds) {
        p.seed_history.length = p.max_seeds;
      }
    };

    nodeType.prototype.renderSeedHistory = function () {
      const list = this._seedListEl;
      if (!list) return;
      list.replaceChildren();

      const p = ensureState(this);
      const history = p.seed_history;

      if (this._seedCountEl) {
        this._seedCountEl.textContent = `${history.length} / ${p.max_seeds} · newest first`;
      }

      if (!history.length) {
        const empty = document.createElement("div");
        empty.textContent = "No seeds yet. Run the workflow.";
        empty.style.cssText = "opacity:0.6;font-style:italic;padding:4px 2px;";
        list.appendChild(empty);
        return;
      }

      // history[0] is always the most recent seed.
      history.forEach((seed, i) => {
        const row = document.createElement("div");
        row.title = "Click to copy";
        row.style.cssText = [
          "display:flex",
          "gap:8px",
          "align-items:center",
          "padding:3px 6px",
          "margin-bottom:2px",
          "border-radius:4px",
          "cursor:pointer",
          "font-family:monospace",
          "font-size:12px",
          "background:var(--comfy-input-bg, #222)",
          "color:var(--input-text, #ddd)",
          "user-select:none",
          "flex-shrink:0",
        ].join(";");

        const idx = document.createElement("span");
        idx.textContent = `${i + 1}.`;
        idx.style.cssText = "opacity:0.5;min-width:28px;text-align:right;";

        const val = document.createElement("span");
        val.textContent = seed;
        val.style.cssText = "flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

        row.append(idx, val);
        row.addEventListener("mouseenter", () => (row.style.filter = "brightness(1.3)"));
        row.addEventListener("mouseleave", () => (row.style.filter = ""));
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          copyText(seed)
            .then(() => {
              val.textContent = "Copied!";
              setTimeout(() => (val.textContent = seed), 900);
            })
            .catch(() => {
              val.textContent = "Copy failed";
              setTimeout(() => (val.textContent = seed), 1200);
            });
        });

        list.appendChild(row);
      });
    };

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated?.apply(this, arguments);
      const p = ensureState(this);

      // Setting for how many seeds to keep. Stored in node.properties (saved
      // in the workflow JSON) rather than as a widget value, so it never
      // shifts the seed widget's saved values.
      const maxWidget = this.addWidget(
        "number",
        "seeds to keep",
        p.max_seeds,
        (v) => {
          const n = clampMax(v);
          this.properties.max_seeds = n;
          if (maxWidget.value !== n) maxWidget.value = n;
          this.trimSeedHistory();
          this.renderSeedHistory();
          app.graph.setDirtyCanvas(true, true);
        },
        { min: 1, max: LIMIT, step: 10, step2: 1, precision: 0, round: 1 }
      );
      maxWidget.serialize = false;
      this._seedMaxWidget = maxWidget;

      // Outer box fills the space the node gives it. Only the list scrolls;
      // the header and Clear button stay put.
      const box = document.createElement("div");
      box.style.cssText =
        "width:100%;height:100%;box-sizing:border-box;display:flex;" +
        "flex-direction:column;gap:4px;padding:2px 0;min-height:0;";

      const header = document.createElement("div");
      header.style.cssText =
        "display:flex;align-items:center;justify-content:space-between;" +
        "font-size:11px;opacity:0.8;color:var(--input-text, #ddd);flex-shrink:0;";

      const count = document.createElement("span");
      this._seedCountEl = count;

      const clear = document.createElement("button");
      clear.textContent = "Clear";
      clear.style.cssText =
        "font-size:11px;padding:1px 8px;cursor:pointer;" +
        "background:var(--comfy-menu-bg, #333);color:var(--input-text, #ddd);" +
        "border:1px solid var(--border-color, #555);border-radius:4px;";
      clear.addEventListener("click", (e) => {
        e.stopPropagation();
        this.properties.seed_history = [];
        this.renderSeedHistory();
        app.graph.setDirtyCanvas(true, true);
      });

      header.append(count, clear);

      const list = document.createElement("div");
      list.style.cssText =
        "flex:1 1 auto;min-height:0;overflow-y:auto;overflow-x:hidden;" +
        "display:flex;flex-direction:column;padding-right:2px;";
      this._seedListEl = list;

      box.append(header, list);
      isolate(box);

      // serialize:false — the list is saved via node.properties instead.
      this.addDOMWidget("seed_history", "div", box, {
        serialize: false,
        getMinHeight: () => 70,
      });

      this.renderSeedHistory();
      const [w, h] = this.size;
      this.setSize([Math.max(w, 260), Math.max(h, 240)]);
      return r;
    };

    // Runs after a saved workflow is loaded and properties are restored.
    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure?.apply(this, arguments);
      const p = ensureState(this);
      if (this._seedMaxWidget) this._seedMaxWidget.value = p.max_seeds;
      this.trimSeedHistory();
      this.renderSeedHistory();
      return r;
    };

    const onExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      onExecuted?.apply(this, arguments);
      const raw = message?.seed?.[0];
      if (raw == null) return;

      const seed = String(raw);
      const history = ensureState(this).seed_history;

      // Newest goes to the top. A reused seed moves back to the top
      // instead of appearing twice.
      const existing = history.indexOf(seed);
      if (existing === 0) return;
      if (existing > 0) history.splice(existing, 1);
      history.unshift(seed);

      this.trimSeedHistory();
      this.renderSeedHistory();
      if (this._seedListEl) this._seedListEl.scrollTop = 0;
      app.graph.setDirtyCanvas(true, true);
    };
  },
});
