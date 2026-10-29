import { app } from "../../scripts/app.js";

// Must match the key in NODE_CLASS_MAPPINGS on the Python side.
const NODE_NAME = "ResolutionPicker";

// --- math: mirrors resolution_selector.py exactly -------------------------

function parseRatio(label) {
    try {
        const token = String(label).split(" ")[0];         // "2.39:1"
        const parts = token.split(":");
        const w = parseFloat(parts[0]);
        const h = parseFloat(parts[1]);
        if (!isFinite(w) || !isFinite(h) || h === 0) return null;
        return [w, h];
    } catch (e) {
        return null;
    }
}

function roundToDivisor(value, divisor) {
    divisor = Math.max(1, parseInt(divisor) || 1);          // "8" -> 8
    const snapped = Math.floor(value / divisor + 0.5) * divisor; // == Python
    return Math.max(divisor, snapped);
}

function computeDimensions(megapixels, aspectRatio, orientation, divisibleBy) {
    const r = parseRatio(aspectRatio);
    if (!r || !isFinite(megapixels) || megapixels <= 0) return null;

    let ratio = r[0] / r[1];
    if (ratio < 1) ratio = 1 / ratio;                        // long : short

    const target = megapixels * 1000000.0;
    let longDim = roundToDivisor(Math.sqrt(target * ratio), divisibleBy);
    let shortDim = roundToDivisor(Math.sqrt(target / ratio), divisibleBy);

    if (orientation === "Portrait") return { width: shortDim, height: longDim };
    return { width: longDim, height: shortDim };
}

// --- helpers --------------------------------------------------------------

function getWidgetValue(node, name) {
    const w = node.widgets ? node.widgets.find((x) => x.name === name) : null;
    return w ? w.value : undefined;
}

// --- live display widget --------------------------------------------------
// Computes on every repaint from the CURRENT widget values, so it can never
// go stale — no dependence on per-widget callbacks firing.

function addDisplayWidget(node) {
    const widget = {
        type: "res_display",
        name: "computed_resolution",
        value: "—",
        serialize: false,
        serializeValue() { return undefined; },
        draw(ctx, node, widgetWidth, widgetY) {
            // recompute live
            const mp = parseFloat(getWidgetValue(node, "megapixels"));
            const ar = getWidgetValue(node, "aspect_ratio");
            const or = getWidgetValue(node, "orientation");
            const db = getWidgetValue(node, "divisible_by");
            const dims = computeDimensions(mp, ar, or, db);
            if (dims) {
                const actualMP = (dims.width * dims.height) / 1000000;
                this.value = `${dims.width} × ${dims.height}   (${actualMP.toFixed(2)} MP)`;
            } else {
                this.value = "—";
            }

            // render
            const LG = window.LiteGraph || {};
            const m = 14;
            const h = 26;
            const w = widgetWidth - m * 2;
            const x = m;
            const y = widgetY;

            ctx.save();
            ctx.beginPath();
            if (ctx.roundRect) ctx.roundRect(x, y, w, h, 6);
            else ctx.rect(x, y, w, h);
            ctx.fillStyle = LG.WIDGET_BGCOLOR || "#222";
            ctx.fill();
            ctx.strokeStyle = LG.WIDGET_OUTLINE_COLOR || "#484848";
            ctx.lineWidth = 1;
            ctx.stroke();

            ctx.textBaseline = "middle";

            ctx.fillStyle = LG.WIDGET_SECONDARY_TEXT_COLOR || "#999";
            ctx.font = "11px sans-serif";
            ctx.textAlign = "left";
            ctx.fillText("output", x + 10, y + h / 2);

            ctx.fillStyle = LG.WIDGET_TEXT_COLOR || "#ddd";
            ctx.font = "bold 13px sans-serif";
            ctx.textAlign = "right";
            ctx.fillText(this.value, x + w - 10, y + h / 2);

            ctx.restore();
        },
        computeSize(width) {
            return [width, 34];
        },
    };

    if (node.addCustomWidget) node.addCustomWidget(widget);
    else node.widgets.push(widget);
    return widget;
}

// --- register -------------------------------------------------------------

app.registerExtension({
    name: "comfy.resolution_selector",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const ret = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
            const node = this;

            // Force two-decimal display / snapping on the megapixels widget.
            const mp = node.widgets.find((w) => w.name === "megapixels");
            if (mp) {
                mp.options = mp.options || {};
                mp.options.precision = 2;
                mp.options.round = 0.01;
                if (mp.options.step == null) mp.options.step = 0.01;
            }

            addDisplayWidget(node);
            node.setDirtyCanvas(true, true);
            return ret;
        };
    },
});
