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

## 30 Oct 2026 — Bug: switches wrong after reloading a workflow

- **Report (Jeff):** after saving a workflow and reloading it, Fast Groups switches didn't show
  the real on/off state.
- **Cause:** `WidgetLegacy` (how Nodes 2.0 shows old-style widgets) only redraws a row's
  canvas through `widget.triggerDraw`, hooked onto `widget.callback`. rgthree's service updates
  `widget.toggled` directly in `refreshWidgets()`, with no callback, so the row picture keeps its
  first drawing. Any state rgthree learns after that first draw (workflow load on a slower or
  larger graph, nodes muted with Ctrl+M, changes from other nodes) never appears. Data was
  always correct; only the picture was stale.
- **Reproduced** with the fix off: group nodes' modes set directly → rgthree's widgets read
  false/true/false, rows still drawn yes/yes/yes.
- **Fix:** none needed beyond phase 1. Our rows re-render after every `refreshWidgets()`.
  Verified with the fix on: direct mode changes, reopening a saved workflow and a page reload
  all show the right state, in both canvas modes. Classic canvas was never affected (it redraws
  every frame).

## 30 Oct 2026 — Phase 2: Seed + Label

### What was found (tested before building)

- **Seed:** works in Nodes 2.0 (buttons, typing, queued runs; "Use Last Queued Seed" updates).
  One problem: rgthree splices ComfyUI's `control_after_generate` widget out of `node.widgets`,
  but `seedWidget.linkedWidgets` still holds it. Nodes 2.0's number widget reads
  `linkedWidgets` and shows a "Randomize Value" control (popover: fixed / increment /
  decrement / randomize), shown as active. It has no effect (the widget isn't in
  `node.widgets`, so it never runs on queue; verified with real queued runs), but it misleads
  and conflicts with rgthree's own -1/-2/-3 seed modes. Classic shows no such control.
- **Label:** rgthree hijacks `LGraphCanvas.prototype.drawNode` and draws the label on the
  canvas; that still happens in Nodes 2.0, so it looks right. But the Vue node box (min width
  225 px, plus a title strip above `node.pos`) sits invisibly over it and takes the mouse:
  clicks well beside the text selected the label, and pinned labels no longer let clicks
  through (rgthree's click-through is in `LGraph.getNodeOnPos`, which only the canvas uses).
  Making the box `pointer-events: none` alone fixes click-through but breaks select/drag,
  because in Nodes 2.0 the canvas doesn't select or drag nodes; the Vue node does.
- Double-click on a label opens nothing in either mode (rgthree's `showShowNodePanel` no
  longer does anything in this frontend), so not a Nodes 2.0 issue; left alone.

### What was built

- **Seed:** on add, drop `control_after_generate` entries from `seed.linkedWidgets` that aren't
  in `node.widgets`. Nothing else touched.
- **Label:** wrap `LGraphCanvas.prototype.drawNode` (after rgthree's wrap). For each label it
  draws in Nodes 2.0: add class `qol-rg-label-node` to its `[data-node-id]` element
  (`pointer-events: none !important`), and keep a child `.qol-rg-label-hit`
  (`pointer-events: auto`) positioned at `node.pos − box translate` and sized to `node.size`.
  Pointer events on the child bubble to the Vue node's handlers, so select, drag and
  right-click work as normal. Pinned labels give the child `pointer-events: none`, so clicks
  reach the canvas, where rgthree's click-through applies. The hit area isn't rotated with
  `angle` (classic hit-testing isn't either).
- Settings: two more per-node switches (`PersonalQoL.RgthreeFix.Seed`, `.Label`). Build
  `2026-10-30.2`.

### Tested

- Nodes 2.0: Seed shows no Randomize Value control; buttons, typing, and real queued runs
  (-1 and a fixed seed) behave as classic; last-seed button updates after a run.
  Label: click beside the text does nothing; click on it selects; drag moves it; pinned
  label over a node passes the click to the node; right-click opens the node menu (pinned:
  the canvas-style menu, which has Unpin).
- Classic: same Label and Seed checks, unchanged. Fast Groups rows re-checked (no regression).

## 30 Oct 2026 — Phase 3: Bookmark + Display Any

### What was found (tested before building)

- **Display Any:** shows its value after a run in both modes. rgthree makes the box read-only
  with `showValueWidget.inputEl.readOnly = true`, which only reaches the classic DOM textarea.
  Nodes 2.0's `WidgetTextarea` sets `readonly` from `widget.options.read_only ||
  widget.options.disabled`, so in Nodes 2.0 you could type into it.
- **Bookmark:** looks right and its shortcut jumps correctly in both modes. Setting the shortcut
  differs: classic opens a prompt with the old key selected, so a key press replaces it. Nodes
  2.0 shows an inline input and a click puts the cursor at the end, so typing B over 1 gave "1B",
  which then never matches (`areOnlyKeysDown`). (In classic, rgthree's combo recorder in
  `onMouseDown` didn't record "shift + b" in testing either; it stored "B", same as typing.)

### What was built

- **Display Any:** on add, `showValueWidget.options.read_only = true`. The option object is the
  one registered with the widget store, so Nodes 2.0 picks it up. Classic unchanged.
- **Bookmark:** one capturing `focusin` listener on `document`. When the focused element is the
  first `<input>` inside a `[data-node-id]` whose node is a Bookmark (flag set on add), select
  all and swallow that click's `mouseup` (once, 500 ms window) so the selection stays. Later
  clicks behave normally. Only in Nodes 2.0. The zoom box is untouched.
- Two more switches: `PersonalQoL.RgthreeFix.DisplayAny`, `.Bookmark`. Build `2026-10-30.3`.

### Tested

- Nodes 2.0: Display Any value appears after a run; typing into it changes nothing; text can
  still be selected. Bookmark: click the shortcut, press Shift+B → "B"; Shift+B then jumps.
- Classic: same checks, unchanged. Phase 1 and 2 nodes re-checked (no regression).

## 30 Oct 2026 — Phase 4: Fast Actions Button + Image Comparer

### What was found (tested before building)

- **Fast Actions Button:** only standard `button` and `combo` widgets, which Nodes 2.0 renders
  natively. Wired to a Fast Groups Muter with an action chosen, the button ran it identically
  in both modes. No fix, so no switch.
- **Image Comparer:** blank in Nodes 2.0 after a run (two 512×384 images from EmptyImage).
  Its `RgthreeImageComparerWidget` draws both images in `draw()` from `node.size`, and the
  slider depends on the node's `onMouseEnter/Move/Leave` (canvas events). In Nodes 2.0 the
  widget goes to `WidgetLegacy` at its `computeSize` height (20 px), and the canvas never sees
  the mouse over a Vue node (`isPointerOver` stayed false).

### What was built

- New `prepare(proto)` step in setup for fixes whose widget is added during construction:
  rgthree adds `rgthree_comparer` in `onNodeCreated`, before `onAdded`. `prepare` wraps the
  class's `addCustomWidget` so the widget gets `element` before registration (same rule as
  Fast Groups: Nodes 2.0 picks the renderer at registration).
- The element: optional picker row (only when more than two images, as rgthree), and a stage
  with image A and image B stacked (`object-fit: contain`). The widget also gets
  `computeLayoutSize() → {minHeight: 120}` so Nodes 2.0 lets it fill the node; classic layout
  checked unchanged.
  - **Slide:** on pointer move, B is shown clipped to the left of the pointer
    (`clip-path: inset(0 W−x 0 0)`), with a 1 px `mix-blend-mode: difference` line drawn only
    within the contained image rect, matching rgthree's drawing. Hidden on leave.
  - **Click:** B shown while the left button is held. Release listened for on `window` in the
    **capture** phase, because `WidgetDOM` stops `pointerup` propagation.
  - `node.imageIndex` set as rgthree does (side under the pointer in Slide, 1 while held in
    Click), so the right-click image options still pick the right image.
  - Picker buttons call rgthree's own `widget.setSelected(...)`, so the choice is stored in
    rgthree's value and saved with the workflow.
- Re-render after the node's `onExecuted` and `onConfigure` (instance wraps).
- Switch `PersonalQoL.RgthreeFix.ImageComparer`. Build `2026-10-30.4`.

### Tested

- Nodes 2.0: images show after a run; Slide and Click behave as classic; batches of 2+2 show
  A1 A2 B1 B2 and picking B2 swaps it in; choices and images survive a page reload.
- Classic: unchanged (same screenshots as before the fix). Earlier phases re-checked.

## 30 Oct 2026 — Phase 5: Context nodes (no changes)

- Tested Context, Context Big, Context Switch, Context Switch Big, Context Merge, Context Merge
  Big in both modes. `BaseContextMultiCtxInputNode.stabilize()` adds `ctx_06` once five inputs
  are linked and trims unused trailing inputs back to five; Nodes 2.0's `.lg-slot--input` list
  matched `node.inputs` at every step. A real run (EmptyLatentImage → Context → Context Switch
  → PreviewAny) gave identical output in both modes, with no console errors.
- **No fix needed; no code or switches added.**
- Dynamic Context / Dynamic Context Switch are behind rgthree's unreleased flag
  (`UNRELEASED_KEYS` in constants.ts) and weren't registered, so untested.
- Noted, not fixed: rgthree's `addConnectionLayoutSupport` ("Connections Layout" menu,
  `properties.connections_layout`) moves slots by overriding canvas slot positions. Nodes 2.0
  lays slots out in the DOM (inputs left, outputs right), so the option has no effect there.
  Applies to several rgthree nodes. Raised with Jeff as a question.

## 30 Oct 2026 — Phase 6: Power Lora Loader

### What was found (tested before building)

- Header, rows and Add Lora are old-style canvas widgets (`PowerLoraLoaderHeaderWidget`,
  `PowerLoraLoaderWidget` with hit areas, `RgthreeBetterButtonWidget`). In Nodes 2.0 each goes
  to `WidgetLegacy`, whose canvas is the node width minus padding (396 px for a 420 px node),
  while rgthree draws to `node.size[0]`; the right-hand ▶ (increase) arrow was clipped.
- Row right-click: rgthree's row menu (Show Info / Toggle / Move Up / Move Down / Remove)
  relies on `getSlotInPosition` + `getSlotMenuOptions`, i.e. the canvas's context-menu path.
  In Nodes 2.0 right-click on a row opens the Vue node menu, so rows couldn't be removed or
  reordered at all.
- `showModelAndClip` (which decides whether `strengthTwo` is serialised) is only updated in the
  row's `draw()`, which Nodes 2.0 doesn't call once the row has an element; it must be kept in
  step by us.

### What was built

- `prepare(proto)` wraps the class's `addCustomWidget`: rows (`lora_*`), the header and the
  Add Lora button each get an `element` before registration; after each add, a microtask
  re-renders (rows added after `onAdded`, e.g. Add Lora and `configure`).
- **Row:** switch → `value.on`; name → rgthree's `node.showLoraChooser(event, cb)` with the same
  callback as `onLoraClick`; i → `widget.showLoraInfoDialog()`; strength box(es) with −/+
  (0.05 steps, rounded, as `stepStrength`), drag on the number (0.05 per px of movement, as
  `doOnStrengthAnyMove`) and click-without-drag → `app.canvas.prompt("Value", …)` as
  `doOnStrengthValUp`. Second (Clip) box shown when `Show Strengths` = `Separate Model & Clip`;
  `pllSyncShowModelAndClip` mirrors the state logic from rgthree's `draw()`.
- **Row right-click:** `contextmenu` on the row → the same `LiteGraph.ContextMenu` items as
  rgthree's `getSlotMenuOptions`. Move uses the same splice as `moveArrayItem`; Remove uses
  `node.removeWidget` (so Nodes 2.0 drops the row) without resizing (as classic).
- **Header:** Toggle All → `node.toggleAllLoras()`; state from `node.allLorasState()` (mixed
  shows a middle knob); labels "Strength" or "Model / Clip". Hidden while there are no rows.
- **Add Lora:** same callback as rgthree's button (`addNewLoraWidget`, height update).
- Re-render after our own actions, `onConfigure` and `onPropertyChanged`.
- Switch `PersonalQoL.RgthreeFix.PowerLoraLoader`. Build `2026-10-30.5`.

### Tested (dummy LoRA files, UI and prompt output only)

- Nodes 2.0: rows render full width with both arrows; row toggle, Toggle All, −/+, drag, typed
  value, choosing a LoRA by name, Add Lora, Move Up and Remove all work and show at once;
  Separate Model & Clip shows and saves the clip strength (`graphToPrompt` includes
  `strengthTwo`); values survive reopening the workflow and a page reload.
- Classic: unchanged (screenshots), and reopening keeps values. Earlier phases re-checked.
- Not tested: an actual run with real LoRA files (none here); the run path is rgthree's own,
  unchanged.

## 30 Oct 2026 — Round 7: node settings (Properties) in Nodes 2.0

- **Report (Jeff):** Show Strengths can't be changed in Nodes 2.0. Cause: the Nodes 2.0 menu
  (`useMoreOptionsMenu`) has no Properties item, and drops any extension item whose content is
  in its block list (`Properties`, `Properties Panel`, `Title`, `Mode`, `Colors`, `Shapes`, …).
  So no rgthree node setting could be changed in Nodes 2.0.
- Extension `getNodeMenuItems` isn't what the Nodes 2.0 menu lists; it lists each node's
  `getExtraMenuOptions` output (shown under "Extensions"), which is how rgthree's own
  "Connections Layout" appears there.
- **Built:** at setup, for every registered node type ending in "(rgthree)", wrap its
  prototype's `getExtraMenuOptions` (once per prototype; item de-duplicated by a flag) to add
  **Node Properties ▸**, only while Nodes 2.0 is on (classic already has Properties).
  - Its submenu is built by us, not `LGraphCanvas.onShowMenuNodeProperties`: Nodes 2.0 rebuilds
    LiteGraph submenus as plain text (LiteGraph's `<span>` labels ran together) and only calls
    each entry's own `callback`. Entries read "name: value" (combo values via
    `getPropertyPrintableValue`, long values cut at 40 chars).
  - Clicking an entry opens LiteGraph's own editor, `canvas.showEditPropertyValue(node, key)`,
    deferred one tick so the menu-closing click doesn't close it; positioned at the last pointer.
    Changes go through `setProperty`, so rgthree's handlers (and our `onPropertyChanged` render)
    run as on the classic canvas.
- New switch `PersonalQoL.RgthreeFix.PropertiesMenu` (all rgthree nodes, under the master).
  Build `2026-10-30.6`.
- **Tested** in Nodes 2.0: Power Lora Loader Show Strengths → Separate shows the Clip boxes at
  once; Fast Groups Muter sort (dropdown) and matchTitle (text) change; Image Comparer lists
  comparer_mode. Classic: the node menu still shows only its own Properties / Properties Panel.
  Earlier phases re-checked.

## 30 Oct 2026 — Round 8: choosing instead of typing, and the safety net

### Safety net (Jeff's rule: classic must keep working even if the patch breaks)

- Risk found: the `addCustomWidget` wraps (Fast Groups, Image Comparer, Power Lora Loader) run
  while rgthree builds its nodes, in classic too. An exception there would have stopped rgthree's
  own `addCustomWidget`, breaking the node in both modes.
- Built `safeAttach(attach, widget, node)`: runs our attach in try/catch; on failure logs a
  warning and undoes our changes on the widget (`element` back to undefined, our
  `computeLayoutSize` removed, our flags removed), so rgthree's widget is registered exactly as
  rgthree made it. Also wrapped: each `prepare`, the existing-nodes pass at setup, and the
  Node Properties hook install. (`onAdded`, `refreshWidgets`, `drawNode` and the menu wraps
  already caught errors.)
- Tested by forcing `Element.prototype.append` to throw while a Power Lora Loader is built:
  node builds in both modes, rows fall back to rgthree's drawing, rgthree's toggle still works,
  no page errors, fallback logged.

### Node Properties: per-setting submenus (Nodes 2.0 only)

- Node Properties ▸ now lists each setting as its own entry ("name: value").
  - **Fixed choices** (combo/enum via `getPropertyInfo().values`, and booleans as On / Off):
    a further submenu listing every value, current one ticked (✓); click → `setProperty`.
    Third-level submenus work in the Nodes 2.0 menu.
  - **matchColors:** submenu with "Any colour" (clears), the nine ComfyUI group colours
    (names as rgthree accepts them; a colour also counts as ticked if its hex is in the list),
    and "Custom…". Clicking a colour toggles it. Text only: the Nodes 2.0 menu shows labels as
    plain text, so no swatches.
  - **Typed settings:** clicking opens our panel (`.qol-rg-type`) beside the menu entry that
    was clicked (rect of the last pointerdown target), kept on screen: input + suggestion list
    (substring match on value and hint, 12 max), ↑/↓ to move, Enter applies, Esc or a click
    outside cancels. Keys are stopped from reaching the canvas. Numbers are validated (invalid
    input turns the box red and isn't applied). Suggestions: matchTitle → group titles;
    fontFamily → common fonts; Label fontColor / backgroundColor → transparent, white, black
    and the ComfyUI palette's hex values (labelled); matchColors Custom… → colours used by
    groups in the workflow plus the colour names (appends to the list). Others: none.
  - LiteGraph's pop-up editor is no longer used here.
- Build `2026-10-30.7`.

### Tested (Nodes 2.0)

- Fast Groups Muter: sort → alphanumeric; matchColors Red, then Blue → "red,blue", ticks
  shown, untick Red → "blue"; Custom "#a4d399" → "blue,#a4d399"; matchTitle "de" suggests
  "Detailer", ↓ + Enter applies; showNav → Off. Label: fontSize "abc" refused, "20" applied;
  fontFamily "geo" suggests Georgia, Esc leaves Arial.
- Classic: node menu unchanged (Properties / Properties Panel only). All earlier phases
  re-checked.

## 30 Oct 2026 — Round 9: settings gear

- **Request (Jeff):** Node Properties is hidden in the right-click menu; add a gear at the
  opposite end of the node's badge strip ("frontend_only" / "rgthree-comfy") that opens the
  same list. Agreed: same spot on nodes without the strip; only rgthree nodes with settings;
  older LiteGraph menu style is acceptable; covered by the Properties-menu switch.
- **Measured:** the badge strip is 24 px tall, 8 px above the node's bottom edge; Nodes 2.0's
  resize handles are 20×20 px at each corner (offset −4 px). Gear: 22×22 px, `right: 22px;
  bottom: 8px` on the `[data-node-id]` element, so it's level with the badge and clear of the
  handle.
- **Built:** `ensureGears()` adds or removes a `.qol-rg-gear` button on each Nodes 2.0 node
  element, for nodes whose type ends in "(rgthree)" and that have properties; hidden while the
  node is collapsed. Run from a `MutationObserver` on `document.body` (coalesced to one call per
  animation frame), because Nodes 2.0 rebuilds node elements as you work. The gear swallows its
  own `pointerdown` (no select or drag) and opens `new LiteGraph.ContextMenu` with the same
  `settingEntry` items as Node Properties, so submenus, ticks and the type-in panel are shared.
- **Label exception:** the Label's node box is invisible and wider than the text, so its gear is
  positioned by `syncLabelHitArea` just after the drawn text and is only visible while the label
  is selected. Contained to the Label.
- Build `2026-10-30.8`.
- **Tested (Nodes 2.0):** gears on Fast Groups Bypasser/Muter, Power Lora Loader, Seed, Image
  Comparer, Label; none on Empty Latent Image. Gear menu lists the settings; sort changed via
  the gear; typed setting opens the panel; collapsed Seed hides its gear; Label gear hidden →
  shown on select → hidden on deselect, and its menu lists the Label settings. Classic: no
  gears, node menu unchanged. Earlier phases re-checked.

## 30 Oct 2026 — Round 9 follow-up: no gear on Label

- **Changed by Jeff:** Labels get no gear at all; they keep Node Properties in the right-click
  menu only. `ensureGears()` now skips `Label (rgthree)`; the Label gear positioning in
  `syncLabelHitArea` and its CSS were removed. Build `2026-10-30.9`.
- **Tested (Nodes 2.0):** gears on Fast Groups Bypasser/Muter, Power Lora Loader, Seed, Image
  Comparer; none on Label, selected or not; the Label's right-click menu still has Node
  Properties; Label click, drag and pinned click-through unchanged. Classic menu unchanged.
