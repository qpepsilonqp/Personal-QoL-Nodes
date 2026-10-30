# rgthree Nodes 2.0 fix — After Action Report

Spec doc: https://claude.ai/artifact/6XHxcrXQoGHDWsJHvp1ino

## 30 Oct 2026 — Phase 1: groundwork + Fast Groups Bypasser / Muter

Tested against ComfyUI (git master, 30 Oct 2026), comfyui-frontend-package 1.57.6 and
rgthree-comfy at commit of 30 Oct 2026, in a headless Chromium, both canvas modes.

### What was found

- rgthree has no Nodes 2.0 support. Its Fast Groups rows are old-style canvas widgets
  (`FastGroupsToggleRowWidget`, a `draw()` + `mouse()` pair, type `custom`).
- In Nodes 2.0 the frontend renders such widgets with `WidgetLegacy`: one small canvas per
  row, drawn at reduced scale. Clicks, the nav arrow and live group updates already worked;
  the problem was appearance (small text, no hover, doesn't match Vue nodes).
- The frontend picks a widget's Vue component once, when the widget is registered
  (`setNodeId` → `registerWidget(..., deriveWidgetRenderState(widget))`). A widget with a
  truthy `element` (`isDOMBackedWidget`) is rendered by `WidgetDOM`, which mounts that element,
  found by `widget.name`.
- Every old-style widget is wrapped in a `LegacyWidget` that already has an own `element`
  property (undefined), so `"element" in w` is always true; check the value instead.
- rgthree registers its node classes itself, so ComfyUI's `nodeCreated` hook never fires
  for them.
- All rgthree rows share the name `RGTHREE_TOGGLE_AND_NAV`; the frontend de-duplicates with
  `#1`, `#2` suffixes.
- A setting's `onChange` that returns a promise is awaited by the settings store, so a
  confirm dialog inside it blocks the setting from saving until answered.

### What was built

Files: `web/rgthree_nodes2_fix/rgthree_nodes2_fix.js` and `.css`. Browser-side only;
picked up automatically by the pack's `WEB_DIRECTORY`. No rgthree files or code copied.

- **Detection:** `GET /extensions` at module load (top-level await); rgthree is present if any
  path is under `/extensions/rgthree-comfy/`. Without it, no settings and no hooks.
- **Settings** (category `Personal QoL Nodes` → `rgthree Nodes 2.0 fix`): master
  `PersonalQoL.RgthreeFix.Master` plus `PersonalQoL.RgthreeFix.FastGroupsBypasser` /
  `.FastGroupsMuter`, all default true. Values read once in `setup()`; changes apply after a
  reload. Per-node switches get `attrs.disabled` when the master was off at page load.
- **Reload prompt:** `app.extensionManager.dialog.confirm` (ComfyUI's own dialog, Confirm /
  Cancel), falling back to `window.confirm`. Suppressed for 1.5 s after setup because
  `onChange` fires at start-up. Not awaited inside `onChange` (see above).
- **Hooking:** in `setup()`, each active node type's `prototype.onAdded` is wrapped (rgthree's
  runs first). On add, the node's `addCustomWidget` and `refreshWidgets` are wrapped:
  - `addCustomWidget`: before registration, each rgthree row gets a unique name
    (`RGTHREE_TOGGLE_AND_NAV_<n>`) and `element` = our row div. This is the key step: doing
    it after registration leaves the row on `WidgetLegacy`.
  - `refreshWidgets`: after rgthree's refresh (labels, on/off, order), our rows re-render.
  - Rows that existed before the hook are removed; rgthree recreates missing rows on its next
    refresh, which passes through the wrapped `addCustomWidget`.
- **Row:** label, yes/no text, switch, nav button. Click → rgthree's own `widget.toggle()`
  (so restrictions like "max one" behave identically), then all rows re-render. Nav button →
  same centre-and-zoom-out as rgthree, but without rgthree's "zoomed out below 50%" cut-off.
  Colours from ComfyUI theme variables (`--component-node-widget-background`, etc.).
- **Classic canvas:** the `element` is ignored there (it's not a registered DOM widget), so
  rgthree's drawing is untouched. Switching modes live works both ways without a reload.
- **rgthree's own support wins:** rows that arrive with a truthy `element` are left alone.

### Tested (both canvas modes)

- Nodes 2.0: rows render full width; toggling mutes/bypasses group nodes; nav jumps to the
  group; renaming/adding groups updates rows; reload restores rows; no console errors.
- Classic: rgthree's drawing and clicks unchanged.
- Live mode switch classic → Nodes 2.0 → classic.
- Master off → both nodes back to rgthree's drawing; Muter off → only Bypasser fixed.
- Not yet tested: groups inside subgraphs.
