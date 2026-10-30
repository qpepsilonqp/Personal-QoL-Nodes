# Tabbed Note: after action report

Technical record of how this node is built and why. Each round adds a dated section at the end;
earlier sections are never rewritten.

Spec doc (what the node should do, in plain language):
https://claude.ai/artifact/1yAUT8jKZbGxzPSGk1AgaE

---

## 2026-09-30: Original build, plus the spell check change

### How it is built

- **Frontend-only virtual node.** Registered entirely in `web/tabbed_note.js` with
  `LiteGraph.registerNodeType("TabbedNote", …)` inside an extension's `registerCustomNodes()`,
  the same pattern as the built-in Note and Markdown Note. `isVirtualNode = true` means the
  frontend never sends it to the backend when a prompt is queued. The bundled `__init__.py`
  only sets `WEB_DIRECTORY`; it has no Python node class.
- **State.** Everything lives in `node.properties.tabnote`:
  `{version, orientation, active, tabs[], groups[]}`. Each tab is
  `{id, title, color, icon, group, markdown, spellcheck, content}`; each group is
  `{id, name, color, collapsed}`. Properties serialise with the workflow and survive copy/paste,
  so there are no widget values to keep in sync. `normalize()` fills in missing fields, so
  older saved notes keep loading after new fields are added.
- **UI.** One DOM widget (`addDOMWidget`, `serialize: false`) holds a root element with a tab
  strip and a body. `TabbedNoteUI.render()` rebuilds the strip and body from state on every
  change. That is simple and cheap at note scale, and it means state is the only source of truth.
- **Menus.** A small custom popup menu (`showMenu`) attached to `document.body`, so it is never
  clipped by the node. It supports items, separators, colour swatches with a custom picker,
  an icon grid, and a text input. It closes on outside pointerdown or Esc.
- **Keyboard isolation.** `keydown` inside the note calls `stopPropagation()`, so typing doesn't
  trigger ComfyUI shortcuts (Delete removing the node, Ctrl+Z, and so on).
- **Groups and ordering.** Tabs keep one flat array; a group is just a `group` id on each tab,
  rendered contiguously. Drag and drop uses native HTML5 drag events: drop on a tab to insert
  before or after it (by pointer half), on a group label to move into that group, and on empty
  strip space to ungroup. "Move left/right" swaps with the nearest tab in the same group.
- **Markdown.** `marked` (GFM) renders and `DOMPurify` sanitises, both bundled in `web/lib` so the
  node works offline. Sanitising matters because a downloaded workflow could otherwise run
  script through a note. Links are forced to `target=_blank rel=noopener`. If either library
  fails to load, the note shows escaped plain text instead of unsanitised HTML.
  View and edit: double-click the preview to edit; blur or Esc returns to the preview.
- **Styling.** `web/tabbed_note.css` is loaded with a `<link>` resolved from `import.meta.url`.
  Colours come from ComfyUI's theme variables (`--comfy-input-bg`, `--comfy-menu-bg`,
  `--input-text`, `--border-color`), with fallbacks. Tab colour is passed as `--tn-color`
  and mixed with `color-mix()`.

### Spell check change

- The editor textarea originally had `spellcheck="false"`, on the assumption that notes would be
  mostly prompt tags. Jeff wanted spell check, so each tab got `spellcheck: true` by default and
  a "Spell check" toggle in its right-click menu. `normalize()` treats a missing value as on, so
  existing notes picked it up. It uses the browser's own checker (the Windows one in Chrome/Edge).
- pysssss support was discussed and deferred at the time.

### Testing at the time

Only in jsdom with stubbed `app` and `LiteGraph` objects: registration, groups, markdown
sanitising, orientation, menus, save/restore round trip, and spell check toggling. It was not
tested in a real ComfyUI.

### Packaging note

Jeff's own node pack loads every `.py` and serves `./web`, so for his pack only the `web` files
are needed. The import of `../../scripts/app.js` assumes the file sits directly in the web root.

---

## 2026-10-28: Round 2, part 1: tab types, tag lists, copy options, pysssss autocomplete

### Issues that came up

- **Work done before the go-ahead.** At the start of this round, the workspace held a version of
  the node built between 00:54 and 01:16, before Jeff said go at 01:18. It included part 2
  (text input/output, a Python node class) and a running test ComfyUI. The test server was a
  background task of this same session, so the early build was almost certainly made by Claude,
  in work that wasn't visible in the conversation. It broke the "no code until go" rule. It was
  set aside unused (kept in the session scratchpad) and this round was built from the version
  Jeff already had (the spell check version). Jeff was told.
- **Esc didn't close menus (bug since the original build).** The note calls `stopPropagation()`
  on keydown to block ComfyUI shortcuts. After a right-click, focus sits on the tab, so Esc
  never bubbled to the window listener that closes menus. Fixed by listening in the capture
  phase. Found by the end-to-end test.
- **The original build was never tested in a real ComfyUI.** This round was tested end to end in
  ComfyUI with frontend 1.57.4, in both classic canvas and Nodes 2.0, with pysssss installed and
  Jeff's own pack loader (`__init__.py`) serving the files from a `JeffNodes` folder.

### What was implemented and how

- **Tab type.** `tab.markdown` (bool) is replaced by `tab.type`: `"plain" | "markdown" | "tags"`.
  State version goes 1 → 2. `normalize()` migrates old tabs (`markdown: true` → `"markdown"`)
  and removes the old field, so saved workflows load unchanged. Tested with a version 1 node.
- **Flyout submenus.** `showMenu` is now built on `buildMenu(items, accent, isSub)`. An item with
  `submenu: () => items` opens a second menu beside it on hover or click (flipping left if it
  would overflow the window). `openSub` is tracked alongside `openMenu`; outside clicks check
  both. "Tab type" uses it, and "Move to group" was switched to it so both submenus behave the
  same (consistency rule). Items can show a right-aligned `hint` (the current type, or "needs
  pysssss").
- **Tag list parsing (`parseTags`).** Line-based: `# x` headline, `##`+ sub headline, any other
  line split on commas, trimmed, empties dropped. Tags before any headline go in an untitled
  headline (rendered without a title row). Tags after a headline but before its first sub
  headline belong to the headline. Parsing happens on render from `tab.content`; nothing is
  stored separately, so the text is the single source of truth.
- **Tag list view.** Headline = button with chevron; click toggles `tab.collapsed` (an array of
  headline titles, so collapse survives edits that move a headline, and duplicate titles
  collapse together). Sub headline = button; click copies all its chips. Chips = buttons in a
  wrapping flex row.
- **Copying.** `navigator.clipboard.writeText`, with an `execCommand("copy")` fallback because the
  Clipboard API needs a secure context and Jeff may open ComfyUI over LAN http. Feedback is a
  `::after` overlay showing `data-copied` ("Copied" or "Copy failed") for 0.9 s, so the chip's
  width never changes.
- **Copy options.** `tab.copyComma` appends `,` (no trailing space) to whatever is copied.
  `tab.copyUnderscore` replaces whitespace with `_` in the chip text, which is also what's
  displayed. Copy-all joins chips with `, ` and then applies the comma option once at the end.
  Both options are off by default and only appear in the menu for tag list tabs.
- **Editing.** Markdown and tag list tabs share one path: `this.editing` (renamed from
  `editingMd`). Double-click anywhere in the view opens the textarea; blur or Esc finishes.
  The textarea now syncs on `keyup` as well as `input`, as a safety net for text inserted by
  other code.
- **pysssss autocomplete.** pysssss keeps its word lists as static fields on
  `TextAreaAutoComplete` in `js/common/autocomplete.js`, so the note must import the exact same
  module URL the frontend already loaded. The install folder name varies, so `getAutocomplete()`
  looks it up in `api.getExtensions()` (paths ending `/js/common/autocomplete.js`) and imports
  `api.fileURL(path)`, exactly as the frontend's extension loader does. The result is cached;
  `acAvailable` drives the greyed-out menu item. When `tab.autocomplete` is on, the editor runs
  `new TextAreaAutoComplete(textarea)`, which uses pysssss's global words and respects its own
  enabled setting and separator.
  Two interactions needed handling:
  - Clicking a suggestion blurs the textarea first, which would end editing before pysssss
    inserts. A capture-phase `pointerdown` listener notes when the pointer went down inside
    `.pysssss-autocomplete`, and the blur handler ignores that one blur.
  - Esc with suggestions open closes the suggestions only (checked via `ac.dropdown.parentElement`);
    the next Esc ends editing.
  The dropdown is removed whenever the body re-renders or the node is removed.
  Risk: this relies on pysssss's file path and class name. If either changes, the option quietly
  does nothing (the import fails or the class is missing) and the note still works.
- `api` is now imported from `../../scripts/api.js` (same depth assumption as `app.js`).
- Duplicating a tab copies its `collapsed` array instead of sharing it.

### How it was tested

A Playwright script (kept in the session scratchpad, not shipped) ran 32 checks per canvas mode:
type submenu, tag parsing and display, copying (chip, sub headline, both options), menu ticks,
collapse and expand, chip wrapping at 260 px wide, Esc and click-outside finishing, markdown via
the submenu, autocomplete (suggestions shown, Esc order, clicking a suggestion keeps editing and
saves), loading a version 1 markdown tab, a save and reload round trip, no console errors, and
Delete while typing not deleting the node. 64/64 passed. Screenshots were reviewed for both modes.

### Decisions Claude made (listed in the spec for Jeff to veto)

Copy-all joins with `, `; options appear only on tag list tabs; autocomplete greys out without
pysssss; double-click edits from anywhere in the view, including on a chip; collapse is
remembered by headline name; `###` and deeper count as sub headlines; badge "T"; "Move to group"
became a flyout for consistency; tags before any headline show at the top with no title.

---

## 2026-10-28: Round 2, part 2: text input, generated tabs, outputs

### Issues that came up

- **The node now needs a Python part.** To receive text and send outputs, the node must run in
  the backend, so `tabbed_note.py` was added. The early copy set aside in part 1 had already
  worked out a sound design for this (its runs were in the test server's log). Part 2 follows
  that design, rewritten on top of part 1 and checked line by line, with changes where Jeff's
  answers differ (see below).
- **No new bugs found.** The `pkill -f` used to restart the test server also matched its own
  shell; it was replaced with a match that can't hit itself. That was test tooling only.

### What was implemented and how

- **Python (`tabbed_note.py`).** `TabbedNote` with optional `text` (`forceInput` STRING) and
  `tn_payload` (STRING), two STRING outputs, `OUTPUT_NODE = True` so a note with only Text input
  on still executes. `run()` parses the payload, raises `ValueError(error)` if the frontend set
  one (ComfyUI shows that as the run's error), fills outputs per slot (`pass` → incoming text,
  `note` → payload note text), and returns `ui.tabnote_text = [text]` when Text input is on.
- **Attaching to the backend node.** `beforeRegisterNodeDef` deletes `tn_payload` from the node
  definition before registration, so the frontend never makes a widget for it, and patches the
  prototype (`onConfigure`, `onExecuted`, `onRemoved`). The `nodeCreated` hook builds the note UI
  (`setupNode`). The constructor still creates the definition's sockets; `syncIO` then removes
  any the note's options don't call for.
- **Payload.** `app.graphToPrompt` is wrapped in `setup()`. After the original builds the prompt,
  every entry with `class_type == "TabbedNote"` gets `inputs.tn_payload = node.tnUI.payload()`.
  `app.queuePrompt` calls `this.graphToPrompt`, so the wrapper is used. Subgraph ids
  (`"12:5"`) are resolved by walking `node.subgraph`.
- **Fallback.** If `tabbed_note.py` isn't loaded, `registerCustomNodes` registers a
  frontend-only class (as in round 1) flagged `tnFallback`. Notes work, the node is always
  virtual, and the ⋯ menu shows "Text input and outputs: needs tabbed_note.py", greyed out.
- **Sockets (`syncIO`).** Driven by `s.io = {input, outputs: [up to two of "pass"|"note"]}`.
  Outputs are only added or removed at the end, so existing links keep their slot index.
  Labels show what each sends ("pass-through", "note text"). `node.isVirtualNode` is set to
  `!(input || outputs.length)`, so a plain note is still left out of the prompt entirely.
  Runs on create, on configure (load or paste) and on every option change.
- **Generated tabs (`onIncomingText`).** Ignores text equal to `s.lastInput` (Jeff: only new
  text makes a tab; this also covers cached re-sends) and empty text. Finds the Generated group
  by `s.genGroup` *and* the name "Generated"; if the group was deleted or renamed, it makes a new
  one. The new tab gets `generated: <timestamp>` and a `YY/MM/DD HH:MM` title. Only tabs with the
  `generated` flag in the current group count towards `s.genLimit` (1–99, default 3); the oldest
  are removed. `moveTab` clears the flag when a tab leaves its group, so dragging out (or "Move
  to group") keeps it. Tabs dragged in by hand, duplicates, and tabs in a renamed group are
  never removed. The new tab is shown unless focus is inside the note.
- **Note as text (`payload`).** Sends `s.outputTab` if set, else the open tab. A non-Plain tab
  produces an error message instead (Jeff: stop the run). Removing a tab clears `outputTab`.
  The tab menu's "Default text output tab" only appears when a Note as text output exists, and
  is disabled ("Plain only") for non-Plain tabs unless it's already ticked, so it can be unticked.
- **Menu (⋯).** Text input (locked on with "used by pass-through" while a pass-through output
  exists, because choosing pass-through turns it on), Output and Second output as flyout
  submenus (Off / Pass-through / Note as text; turning Output off also turns off the second),
  and "Generated tab limit…" with a number input.
- State fields added: `io`, `genLimit`, `genGroup`, `lastInput`, `outputTab`; tab `generated`.
  `normalize()` fills them in, so part 1 notes load unchanged.

### Differences from the early copy, and why

- Early copy counted every tab in the Generated group; here only run-made tabs count, so a tab
  Jeff drags in can never be deleted by a run.
- Early copy showed the new tab unless a markdown or tag edit was open; here it's unless focus
  is anywhere in the note, so typing in a Plain tab isn't interrupted either.
- Early copy allowed ticking a Markdown or Tag list tab as the default output tab and failing
  at run time; here the menu prevents it, and the run-time error remains as the safety net
  (for example, when the open tab is Markdown).

### How it was tested

Real runs in ComfyUI (frontend 1.57.4) through Jeff's pack loader: String (Multiline) →
Tabbed Note → two Preview as Text nodes. 28 checks per canvas mode, all passing in classic and
Nodes 2.0: virtual and absent from the prompt by default; no payload widget; Text input socket;
a tab per new text; date-time name; Generated group; unchanged text ignored; limit 3 then 1;
keeping by `moveTab` and by real drag and drop; renamed group left alone; two labelled outputs;
pass-through and note text values arriving downstream; default output tab sent instead of the
open tab; Markdown tab stopping the run with the message; options off removing sockets; save
and reload keeping sockets, links and settings; no console errors. The part 1 suite was rerun
after the registration change: 64/64. The fallback was tested with `tabbed_note.py` removed.
The test server was stopped afterwards.

### Decisions Claude made (listed in the spec for Jeff to veto)

Empty incoming text makes no tab; a run shows its new tab unless you're typing in the note;
choosing pass-through turns Text input on and locks it; turning Output off also turns off the
second output; the limit can be 1 to 99; the default output tab is marked "Out"; the limit
setting shows even while Text input is off.

---

## 2026-10-28: Round 3: one tag per line, Shift-click selection, soft highlights

### Issues that came up

- **pysssss separator vs one tag per line.** pysssss appends its separator (", " by default)
  after an inserted suggestion. In a one-tag-per-line list that would put a stray comma inside
  the tag. For tag list tabs the editor now creates `new TextAreaAutoComplete(ta, null, "")`; the
  third argument overrides the separator (pysssss reads it with `??`, so `""` sticks). Plain
  and Markdown tabs keep pysssss's own setting. Found while updating the round 1 tests.
- No other problems. Two test-script expectations were wrong (a quick double Shift-click
  correctly removes then re-adds a tag at the end of the order; node ids change on `graph.add`).

### What was implemented and how

- **Parsing.** `parseTags` no longer splits on commas: every non-heading, non-empty line is one
  tag, trimmed.
- **One-time split of older lists.** State version 2 → 3. `normalize()` records the incoming
  version before upgrading; if it was below 3, each `tags` tab's content goes through
  `splitCommaLines` (non-heading lines split on commas, empties dropped, headings and blank lines
  kept). Plain and Markdown tabs are untouched. Because the version is saved as 3, a note is
  never split twice, and commas typed afterwards stay inside tags.
- **Shift-click selection.** `this.sel` is an ordered array of `{key, text}`; `key` is the chip's
  position (`headline.sub.chip`, `h` for chips straight under a headline), so identical tag text
  in two places stays distinct. Shift-click toggles membership, toggles `.is-selected` on the
  chip, and copies the selection joined with `, ` (copy options applied as for single tags;
  nothing is copied when the selection becomes empty). One note owns the selection at a time
  (`selOwner`). It ends on a window-level capture `keyup` of Shift, on window `blur` (Shift
  released in another window never reaches the page), on a plain click, on a sub headline
  click, when editing starts, and when another tab is shown. Ending removes the class instead of
  re-rendering, so the highlight can fade. The selection survives a re-render (for example
  collapsing a headline) because chips get `.is-selected` from the keys. A double-click with
  Shift held doesn't open the editor, so fast Shift-clicks on one chip just select and unselect.
- **Soft highlights.** Chips transition background, border and text colour (0.35 s out,
  0.18 s in for `.is-selected` and `.is-lit`). The "Copied" overlay (`::after`) is now always
  present at `opacity: 0` with `pointer-events: none`, and `.is-copied` fades it to 1 (0.18 s in,
  0.35 s out), so the text never shifts. A sub headline click flashes "Copied" on the sub headline
  and adds `.is-lit` to its chips for 0.9 s. `prefers-reduced-motion` turns all of these
  transitions off.

### How it was tested

New Playwright suite, 21 checks per canvas mode, 42/42 across classic and Nodes 2.0: tags with
commas stay whole; overlay opacity measured mid-fade (about 0.64 at 60 ms, 1 at 460 ms, back to
0); Shift-click order, highlight, removal, double Shift-click, release, a new selection after
release, window blur ending it, copy options on selections; sub headline lighting and fading;
old comma lists split, other tab types untouched, version 3 lists untouched, no second split on
reload. Round 1 suite (updated to one tag per line, autocomplete now inserting on a new line)
64/64; part 2 suite with real runs 56/56. Test server stopped afterwards.

### Decisions Claude made (listed in the spec for Jeff to veto)

Selected and sub-headline-lit chips share one highlight look; removing the last picked tag
leaves the clipboard as it was; pysssss adds no separator in tag list tabs.

---

## 2026-10-28: Round 4: tag descriptions, spaces or underscores, examples in empty tabs

### Issues that came up

- **Emoticon rule refined.** The spec said to convert only underscores between two letters or
  numbers. Checking real Danbooru tags showed that misses qualifiers: `artoria_pendragon_(fate)`
  would become `artoria pendragon_(fate)`. The rule now decides per tag instead: a tag with no
  run of two or more letters or digits is an emoticon (`^_^`, `>_<`, `o_o`, `x_x`, `-_-`) and is
  left as written; every other tag has all its underscores converted. Same intent as agreed
  (emoticons untouched), better result. Noted in the spec.
- **Browser tooltips would have clashed.** The tag view had a `title` hint and chips had their
  own `title`; the browser shows those after a delay, which would have stacked under the instant
  tooltip. Both were removed from tag lists, so only tags with a description show a tooltip.
- No bugs found in earlier rounds.

### What was implemented and how

- **Descriptions.** `parseTagLine` splits a tag line at the first `" | "` (space, pipe, space):
  left is the tag, right the description. Chips are now `{text, desc}` objects; `chipText`
  accepts either form. Copying (single, Shift selection, sub headline) only ever uses `text`.
- **Tooltip.** One shared `.tn-tip` element on `document.body` (like the menus, so it's never
  clipped by the node), shown on `pointerenter` or keyboard `focus` with no delay, hidden on
  `pointerleave`, `blur`, any scroll or wheel (the canvas pans or zooms with the wheel), body
  re-render, and node removal. Positioned centred above the chip, flipping below when there's
  no room and clamped to the window. Its left border takes the tab colour. The description is
  also exposed as `aria-description` for screen readers.
- **Dot marker.** A `.tn-chip-dot` span inside described chips (the chip gets extra right
  padding). It's empty, so the chip's text stays exactly the tag. It inverts colour when the
  chip is highlighted.
- **Spaces or underscores (`chipText`).** Use underscores on: whitespace becomes `_` (as before).
  Off: underscores become spaces unless the tag is an emoticon (see above). Display and copy use
  the same function, so what you see is what you copy.
- **Examples in empty tabs.** `EXAMPLES.tags` and `EXAMPLES.markdown` are shown greyed in a
  dashed box by `emptyExample()` when a tag list or markdown tab has no content, under "Double-click
  to start writing. For example:". The editor's placeholder shows the same example (plus how to
  finish editing), so it disappears as soon as you type. The tag example includes a description
  and a `**Camera:**` style prompt line.

### How it was tested

New Playwright suite, 20 checks per canvas mode, 40/40 across classic and Nodes 2.0: both empty
examples (view and editor placeholder), descriptions hidden from chips, spaces/underscores both
ways with `^_^`, `>_<` and `artoria_pendragon_(fate)`, the long `**Camera:**` tag shown and copied
exactly, dots only on described tags, tooltip shown within 30 ms of hovering and placed just above
the tag, no browser `title` anywhere up the chip's ancestors, tooltip hiding on moving away,
descriptions left out of every kind of copy. Earlier suites rerun: round 1 64/64, round 3 42/42,
part 2 with real runs 56/56. Test server stopped afterwards.

### Decisions Claude made (listed in the spec for Jeff to veto)

Emoticon detection by "no run of two letters or digits"; tags without a description show no
tooltip at all (the old delayed hints were removed); the tooltip also shows on keyboard focus.

---

## 2026-10-30: Round 5: "Copied" on every copied chip

### Issues that came up

- **Design changed during planning.** Claude first proposed flashing "Copied" on each chip as it
  was Shift-picked. Jeff chose instead: picking only highlights, and letting go of Shift flashes
  "Copied" on every picked chip at once. His reason: a multi-copy that doesn't confirm itself the
  same way as a single copy feels as if it didn't work.
- **Plain click mid-selection.** If a selection is still active when a plain click happens
  (Shift's key-up was missed), the clipboard is replaced by the single tag. Flashing "Copied" on
  the old picks would then be wrong, so only a confirmed ending (Shift let go, or the window
  left) flashes; other endings just fade the highlight.

### What was implemented and how

- `flashCopied(els, ok)` is the one place that shows the confirmation: it sets `data-copied`
  ("Copied" or "Copy failed") and adds `.is-copied` to each element for 0.9 s. The existing CSS
  fades it in (0.18 s) and out (0.35 s).
- `copyWithFeedback` (single chip, sub headline) now uses it for every element, so a sub headline
  click flashes "Copied" on the sub headline and each of its chips. The old `.is-lit` highlight
  class was removed from JS and CSS.
- Shift-click still copies the selection on every click (so the clipboard is always right), and
  keeps that copy's promise in `this.selCopy`. `endSelection(flash)` passes `flash = true` from
  the Shift key-up and window blur listeners only. `clearSelection(flash)` removes
  `.is-selected` from the picked chips and, when flashing, awaits the last copy and calls
  `flashCopied` with its result.

### How it was tested

Round 3 suite extended (25 checks per mode, 50/50 in classic and Nodes 2.0): no "Copied" while
Shift is held; on release every picked chip flashes "Copied" and then fades; leaving the window
flashes too; a plain click mid-selection flashes only the clicked chip; a sub headline click
flashes "Copied" on the sub headline and every chip. Rounds 1 (64/64) and 4 (40/40) and part 2
with real runs (56/56) rerun. Screenshots checked. Test server stopped afterwards.

### Decisions Claude made (listed in the spec for Jeff to veto)

A plain click during a selection doesn't flash the old picks; leaving the window counts as
letting go of Shift.

---

## 2026-10-30: Round 6: Ctrl+drag to move tags and headlines, focus ring for keyboard only

### Issues that came up

- **Why not HTML5 drag and drop (used for tabs).** On Windows, holding Ctrl during a native drag
  asks for a copy, which a move-only drop target refuses, and native drags inside the canvas
  interfere with ComfyUI's own node dragging. So this uses pointer events directly.
- **Disabled buttons get no pointer events.** Empty sub headlines were `disabled`, so they
  couldn't be dragged or dropped on. They now use an `is-empty` class with `aria-disabled`, and
  do nothing on click.
- **The ring Jeff noticed** after Shift-clicking was the keyboard focus ring: Chrome shows it
  once a key is pressed while a clicked button has focus. It's now hidden for mouse use.
- No bugs found in earlier rounds.

### What was implemented and how

- **Line-aware parsing.** `parseTags` records `line` (index in the text) for every headline, sub
  headline and tag, and `end` (exclusive) for every headline and sub headline section: up to the
  next headline, or the next sub headline within the same headline. Since the text is the only
  source of truth, every move is `moveLines(src, from, count, to)`, which moves a run of lines to
  sit before line `to` (original indices) and returns null for no-op moves.
- **Drag (`startTagDrag`).** Delegated `pointerdown` on the tag view; acts only with Ctrl and the
  main button. It calls `preventDefault` and `stopPropagation` so ComfyUI doesn't start a node or
  canvas drag (checked: node position and canvas offset unchanged in both modes). Movement under
  5 px is still a click. Once dragging: window capture listeners for move, up, cancel and Esc; a
  `.tn-ghost` label follows the pointer; the source dims; any Shift selection ends and the
  tooltip hides. The click that follows pointerup is swallowed (`consumeDragClick`), so a drag
  never also copies a tag or collapses a headline.
- **Drop targets (`dropTarget`).** Elements carry `data-drag` (chip/sub/head) and a positional
  `data-key`. `elementFromPoint` finds the target (the ghost has `pointer-events: none`).
  - Tag: on a tag, before or after by horizontal half (bar marker); on a sub headline or headline
    title, appended after that title's own last tag (dashed outline).
  - Sub headline: on a sub headline, above its line or below its section by vertical half (line
    marker); on a headline, the end of that headline's section.
  - Headline: on another headline, above it or below its whole section.
- **Move notice (`dropTagItem`).** Tags move straight away. Headlines and sub headlines open a
  menu at the drop point with a new `{heading}` item type: "Move "<title>"", then "With its sub
  headlines and tags" / "With its tags" (moves `end - line` lines), "Just the headline" / "Just
  the sub headline" (moves 1 line), and Cancel. Esc or clicking outside also cancels.
- **Focus ring.** The root tracks input: `data-input="pointer"` on any pointerdown (capture),
  `"keyboard"` on Tab. CSS hides `:focus-visible` outlines under `[data-input="pointer"]`
  across the whole note, so tabs and chips behave the same.

### How it was tested

New suite with real mouse drags while holding Ctrl, 27 checks per canvas mode, 54/54 across
classic and Nodes 2.0: ghost and marker shown and cleaned up; before and after a tag; onto a sub
headline and a headline; description moving with its tag; no move without Ctrl; Esc during a
drag; the notice for sub headlines and headlines with the right wording; each choice (with
contents, just the title, Cancel, Esc); sub headline onto a headline; no copy or collapse after a
drag; node and canvas not moving; normal clicks still copying; focus ring hidden after mouse
clicks with Shift and shown after Tab. Earlier suites rerun: round 1 64/64, round 3 and 5
50/50, round 4 40/40, part 2 with real runs 56/56. Test server stopped afterwards.

### Decisions Claude made (listed in the spec for Jeff to veto)

Dropping a tag on a title adds it after that title's own tags; a sub headline dropped on a
headline goes to the end of that section; a Ctrl+click without moving is still a normal click;
the focus ring rule applies to the whole note, not only chips.

---

## 2026-10-30: Round 7: double-click rename, sub headline collapse, spelling menu, sizes

### Issues that came up (reproduced in the test ComfyUI before fixing)

- **Double-click rename never worked (bug since the original build).** `activate()` committed
  and re-rendered the whole tab strip on every click, so between the two clicks of a
  double-click the tab element was replaced and the browser never fired `dblclick`. The original
  jsdom tests called `renameInline` directly, so they missed it. Fixed: `activate()` now does
  nothing for the open tab and otherwise toggles `is-active` on the existing tab elements (found
  by `data-id`) and re-renders only the body.
- **Right-click on a misspelt word opened ComfyUI's menu (Nodes 2.0 only).** The Vue node took
  the `contextmenu` event for its own menu. Classic mode was unaffected. Fixed with a root
  listener that stops `contextmenu` propagation when the target is a textarea, input or
  contenteditable, without `preventDefault`, so the browser's own menu (with spelling
  suggestions) opens. The tab's own right-click handler also steps aside while its name is being
  edited (found by the new test).
- **Flaky check in the round 1 suite.** "Esc leaves the editor" failed once in Nodes 2.0, then
  passed three runs in a row. The test presses Esc in the same instant as the double-click,
  before the editor is focused (focus happens on the next animation frame); no person can do
  that. Left as is; noted here in case it shows up again.

### What was implemented and how

- **Rename.** Horizontal tabs: `renameInline` as before (contenteditable title, whole name
  selected, Enter saves, Esc cancels); the tab's `draggable` is switched off while typing, so
  clicks inside the name place the cursor. Vertical tabs: double-click opens the existing rename
  box (`renameMenu`, input focused with its value selected); the icon picker stays in the
  right-click menu only. `dblclick` stops propagating so Nodes 2.0 doesn't act on it.
- **Sub headline sections.** Each sub headline is now wrapped in `.tn-sub` (3 px solid left border
  in the tab colour, so the bar runs from the title down to its last tag), with a `.tn-sub-row`
  holding a `.tn-sub-chev` arrow button and the name button. The arrow toggles a key
  `"## <headline> / <sub headline>"` in `tab.collapsed`, the same array as headlines, so it saves
  with the note. Collapsed sub headlines show a tag count; clicking the name still copies all its
  tags (only the name flashes, since the tags are hidden).
- **Sizes.** Headline titles 14 → 16 px; sub headline titles 12 → 14 px.

### How it was tested

New suite, 20 checks per canvas mode, 40/40 in classic and Nodes 2.0: rename by double-click on
the open tab and on another tab (name selected, focus on it, typing replaces, Enter saves, Esc
cancels), the strip not being rebuilt on tab switch, vertical rename box with the name selected,
icon picker still in the menu, right-click in the text box and in a name being renamed not blocked
and no ComfyUI menu appearing, tab right-click menu still working, 16/14 px sizes, the bar's
style, colour and extent, collapsing and expanding with the arrow, remembered collapse, copying
from a collapsed sub headline. Earlier suites rerun: round 6 54/54, round 1 64/64 (after the one
flaky run), rounds 3 and 5 50/50, round 4 40/40, part 2 with real runs 56/56. Test server stopped.

### Decisions Claude made (listed in the spec for Jeff to veto)

A collapsed sub headline shows how many tags it holds; clicking its name copies them and only the
name flashes; right-click is left to the browser in every typing area of the note.

---

## 2026-10-30: Round 8: long lists keep the node's size and scroll; underlines

### Issues that came up (reproduced before fixing)

- **Long tag lists and markdown notes grew the node (Nodes 2.0 only).** Measured: with a long
  list, the classic node stayed at 320 px and the list scrolled; in Nodes 2.0 the node grew to
  1633 px. Plain tabs were fine, because a textarea has its own size. Nodes 2.0 lets a widget's
  content height push the node, and the tag and markdown views had no size of their own.
  Fixed in CSS: inside `.tn-body`, `.tn-tags` and `.tn-md` are `position: absolute; inset: 0`, and
  `.tn-text` is absolute at 100% (a textarea doesn't stretch from its edges). The body's content
  no longer adds to the node's height, so the views scroll inside whatever space the node gives.
- **The mouse wheel zoomed the canvas instead of scrolling (Nodes 2.0 only).** Traced with
  listeners at every level: the canvas container takes wheel events in the capture phase, on the
  way down, before they reach any node. (The frontend only leaves the wheel alone for a focused
  element marked `data-capture-wheel`.) Fixed with a window-level capture listener: if the
  pointer is inside a `.tn-root` and some element between it and the root can scroll (overflow
  auto/scroll and more content than room), `stopPropagation()`. Nothing is prevented, so the
  browser scrolls natively. Ctrl/Cmd+wheel is left alone so zooming still works, and a note with
  nothing to scroll leaves the wheel to the canvas.
- **Double-clicking a tag closed the editor straight away when the clipboard fallback was used.**
  Found by the new test, which runs without clipboard permission. The second click of the
  double-click copies the tag; the old fallback selected text in a hidden textarea, which took
  focus from the editor that had just opened, so its blur handler closed it. This affected anyone
  opening ComfyUI over plain http from another machine. Fixed: the fallback now fills in the
  browser's own `copy` event (`execCommand("copy")` with a `copy` listener that calls
  `clipboardData.setData`), which doesn't move focus. Checked that the right text lands on the
  clipboard.
- **Lines misread in round 7.** Jeff wanted a horizontal line under sub headline names, not a
  bar down the left. Jeff asked for the build before answering whether to keep the bar; Claude
  removed it, since the underline replaces it (easy to restore: `border-left` on `.tn-sub`).

### What was implemented and how

- `.tn-sub-row` gets a `border-bottom` matching the headline's (1 px, tab colour at 45%; dashed
  when collapsed). Headline and sub headline lines end at the same right edge, 12 px inside the
  note (the tag view's padding). The `.tn-sub` left border was removed; the indent stays.

### How it was tested

New suite, 14 checks per canvas mode, 28/28: long tag list and long markdown keep the note's
size and have more to scroll; a real mouse wheel scrolls both and doesn't zoom; editing a long
list keeps the size; the note follows the node when resized smaller; all lines end at one point
near the right edge; no left bar. Round 7's bar check updated to the underline. All earlier suites
rerun and passing: round 7 40/40, round 6 54/54, round 1 64/64, rounds 3 and 5 50/50, round 4
40/40, part 2 with real runs 56/56. Test server stopped afterwards.

### Decisions Claude made (listed in the spec for Jeff to veto)

The left bar was removed in favour of the underline; Ctrl+wheel always zooms the canvas, even over
the note; a note with nothing to scroll leaves the wheel to the canvas.
