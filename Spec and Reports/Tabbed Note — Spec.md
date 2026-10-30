# Tabbed Note — Spec

Oct 28, 2026 · @Jeff

## Status

Round 2 is built, tested and sent. Round 3 is built, tested and sent. Round 4 is built, tested and sent. Round 5 is built, tested and sent. Round 6 is built, tested and sent. Round 7 is built, tested and sent. Round 8 (below) is built, tested in classic and Nodes 2.0, and sent. Waiting for Jeff to try it.

The technical history of the node lives in `AFTER_ACTION_REPORT.md` in the node's folder. It was started this round, with a summary of the original build and a section for each part.

## What it does today

A note node with coloured tabs, found under utils → Tabbed Note. ComfyUI ignores it when a workflow runs.

- Each node shows its tabs horizontally (title and colour) or vertically (icon and colour), chosen in the ⋯ menu.
- Right-clicking a tab renames it, changes its colour or icon, moves it into a group, reorders, duplicates or deletes it.
- Tabs can sit in groups, which can be renamed, recoloured and collapsed. Tabs can be dragged to reorder or regroup.
- A tab is either plain text or markdown. Markdown tabs show the formatted note; double-click to edit, click outside or press Esc to finish.
- Spell check is on for each tab by default and can be turned off per tab.
- Everything saves with the workflow.

## Change 1: Tag list tabs

A third kind of tab that shows headlines, sub headlines and chips you click to copy.

- **Tab type.** The "Markdown tab" tick is replaced by a Tab type submenu in the right-click menu: Plain, Markdown or Tag list.
- **Viewing.** Headlines, with sub headlines beneath them and chips under each sub headline. Chips run left to right and wrap onto a new line when the node is too narrow. Clicking a chip copies it, and the chip briefly shows "Copied".
- **Editing.** Double-click to edit, like a markdown tab; click outside or press Esc to finish. Spell check follows the tab's existing setting.
- **Copy options**, ticked per tab in its right-click menu:
  - Add comma when copying: "stiletto heels" copies as "stiletto heels,".
  - Use underscores when copying: "stiletto heels" copies as "stiletto\_heels". When this is on, the chips show underscores too.
  - Both together give "stiletto\_heels,".

Editing uses a simple markdown-style layout, with chips separated by commas (so a chip cannot contain a comma):

```markdown
# Clothing
## Boots
white PVC fold-over cuff ankle boots, stiletto heels
## Dress
pink halterneck dress, side slits
```

## Change 2: pysssss autocomplete

An option to turn on pysssss's word and tag autocomplete while typing in a note.

- It works only when pysssss is installed and its autocomplete is switched on in ComfyUI's settings. The note's option decides where it is used.
- It can run alongside spell check.
- It hooks into pysssss's own files, so a future pysssss update could stop it working. If so, the option quietly does nothing and the note still works.
- Before building, Claude checks how the current pysssss version provides autocomplete and notes the result here.

## Change 3: Text input and output

Wired-in text becomes a new tab when the workflow runs, and a note can send text on to other nodes.

**Text input** (an option in the node's ⋯ menu, which adds an input socket):

- When the incoming text has changed since the last run, the node creates a new tab with that text. Unchanged text creates nothing.
- New tabs are named with the date and time of the run as YY/MM/DD HH:MM, for example 26/10/28 14:32, and go into their own "Generated" group.
- Only a set number of generated tabs are kept, 3 by default. A new one past the limit deletes the oldest generated tab. The limit can be changed in the node's options.
- Dragging a generated tab out of the Generated group keeps it: it no longer counts towards the limit and is never deleted automatically.
- New tabs are kept only if the workflow is saved afterwards.

**Text output** (a separate option, which adds an output socket), with two modes:

- Pass-through: sends the incoming text straight on, so the note can sit in the middle of a chain.
- Note as text: sends the open tab's text, for example as a prompt into a text encoder. Any tab can be set as the default text output tab from its right-click menu; when one is set, it is always sent instead of the open tab. Only Plain tabs can be sent: if the tab to be sent is a Markdown or Tag list tab, the run stops with an error message.

A further option adds a second output, so pass-through and Note as text can run at the same time. With both options off, the node behaves exactly as today and ComfyUI ignores it during runs. Turning either on needs a small Python part, which the node pack's loader picks up automatically.

## Decisions Claude made

Claude proposed these and Jeff has answered each one.

- **Tab type:** a Tab type submenu in the tab's right-click menu, offering Plain, Markdown or Tag list. *Changed by Jeff.*
- **Copy comma:** no trailing space, so a chip copies as "stiletto heels,". *Changed by Jeff.*
- **Underscores:** when the option is on, the chips show underscores too, not just the copied text. *Changed by Jeff.*
- **Copy options:** off by default for new tag list tabs. *Agreed.*
- **Generated tab names:** YY/MM/DD HH:MM, for example 26/10/28 14:32, so they sort in date order. *Changed by Jeff.*
- **Generated tab type:** Plain. *Agreed.*
- **Generated tab limit:** set per node. *Agreed.*
- **Generated group:** if it is deleted or renamed, the next generated tab creates a fresh one. *Agreed.*

### Decisions Claude made while building part 1

Not covered by the questions above. Say if any should change.

- Clicking a sub headline copies its tags joined with a comma and a space ("a, b"). With "Add comma when copying" on, one comma goes on the end ("a, b,").
- The copy options only appear in the menu for tag list tabs.
- Without pysssss installed, Autocomplete shows greyed out with "needs pysssss".
- Double-clicking anywhere in a tag list opens the editor, including on a chip (the chip also gets copied).
- Collapsed headlines are remembered by name, so renaming a headline expands it.
- Lines starting with ### or more count as sub headlines.
- Tag list tabs show a "T" badge, like the "M" on markdown tabs.
- "Move to group" now opens as a submenu too, so both submenus behave the same way.
- Tags written before any headline show at the top, with no headline above them.
- Fixed a bug from the original build: Esc didn't close a tab's right-click menu.

### Decisions Claude made while building part 2

Not covered by the questions above. Say if any should change.

- Empty incoming text doesn't make a tab.
- A run switches to its new tab, unless you're typing in that note at the time.
- Choosing Pass-through turns Text input on, and Text input stays locked on while a pass-through output exists.
- Turning Output off also turns off the second output.
- The generated tab limit can be 1 to 99.
- The default text output tab shows an "Out" badge, and only Plain tabs can be ticked as the default.
- Only tabs a run made count towards the limit. Tabs you drag into the Generated group yourself are never deleted.
- The node now needs `tabbed_note.py` for Text input and outputs. Without it, notes still work and those options show as unavailable.

## Open questions

Answer these here or in chat, then say go.

**Tag lists**

- [x] Answered: when editing, chips are separated by commas.
- [x] Answered (ticked): clicking a sub headline copies all of its chips at once, joined with commas.
- [x] Answered (ticked): headlines are collapsible, like tab groups.
- [x] Answered (ticked): chips can sit directly under a headline, with no sub headline.

**Autocomplete**

- [x] Answered: autocomplete is turned on per tab, off by default.

**Text input and output**

- [x] Answered: a generated tab is kept by dragging it out of the Generated group. No extra menu option.
- [x] Answered: "Note as text" sends the open tab, and any tab can be set as the default text output tab from its right-click menu.
- [x] Answered: only Plain tabs can be sent as text.
- [x] Answered: an option adds a second output, so pass-through and "Note as text" can run at the same time.
- [x] Answered: when a default text output tab is set, it is always sent instead of the open tab.
- [x] Answered: if the tab to be sent is a Markdown or Tag list tab, the run stops with an error message.

## Round 3: tag list changes

**Change A: one tag per line.** When editing a tag list, each line is one tag, replacing comma-separated tags. A tag can then contain commas, so "white PVC, fold-over cuff ankle boots" stays one chip.

```markdown
# Title
## Subtitle
Tag 1
Tag 2
Tag 3
```

**Change B: Shift to copy several tags.** In a tag list (not while editing), holding Shift and clicking chips copies several tags at once.

**Change C: softer highlight.** Every click highlights what it copied, fading on and off gently instead of snapping:

- Single click: the chip fades into its highlight with "Copied", then fades back out.
- Shift-click: each picked chip fades into its highlight and stays lit while Shift is held. When Shift is released, they all fade out together.
- Sub headline click: the sub headline and all its chips light up together, then fade out.

Already the case and staying as is: clicking a sub headline copies every tag under it.

### Open questions for round 3

- [ ] Answered: yes. Each Shift-click adds the tag to a highlighted selection and copies the whole selection straight away.
- [ ] Answered: tags are copied in the order you clicked them.
- [ ] Answered: the selection only lasts while Shift is held. Releasing Shift ends it, and the next Shift-click starts a new one. A plain click copies just that tag. No Esc needed.
- [ ] Answered: existing comma-separated tag lists are split into one tag per line once, when they load. After that, commas inside a tag are left alone.

* [x] Answered: Shift-clicking a tag that's already selected removes it from the selection (and from the copied text).

### Decisions Claude made while building round 3

- Shift-picked chips and the chips lit by a sub headline click share one highlight look, so "what's being copied" always looks the same.
- If you Shift-click away every picked tag, the clipboard keeps what it had rather than being emptied.
- In tag list tabs, pysssss autocomplete no longer adds ", " after a suggestion, since each tag is on its own line. Other tab types keep pysssss's setting.

## Round 4: tag tooltips and format examples

**Change D: tooltips on tags.** A tag can carry a short description that shows when you hover over its chip. This is mainly for Danbooru tags whose meaning isn't obvious. The description is never copied.

**Change E: examples in empty tabs.** An empty tag list shows an example of how to write one. An empty markdown tab shows an example of markdown formatting.

**Change F: write tags either way.** Tags can be written with spaces or underscores, and the "Use underscores" option decides how every chip shows and copies. Option on: spaces become underscores (already the case). Option off: underscores become spaces (new). Agreed with Jeff: underscores are left alone in emoticon tags such as `^_^` and `>_<`, by only converting an underscore that sits between two letters or numbers.

### Open questions for round 4

- [x] Answered: the description goes on the same line after a space, a pipe and a space, for example stiletto heels | very thin, high heels.
- [x] Answered: the tooltip appears as soon as you hover, styled to match the note.
- [x] Answered: chips with a description show a small dot.
- [x] Answered: no automatic Danbooru lookup. Jeff has pysssss for Danbooru tags.
- [x] Answered: empty-tab examples are greyed text of what you'd type, in the empty view and the editor, gone once you start typing.
- [ ] Long prompt-style tags such as "**Camera:** Shot with a Canon EOS R5…" are allowed. Answered: chips show them as plain text, asterisks visible, exactly as copied (Krea 2 uses this format to title prompt sections).

### Decisions Claude made while building round 4

- Emoticon tags are spotted differently from what was agreed, with the same aim. The agreed rule (only convert an underscore between two letters or numbers) would have left artoria\_pendragon\_(fate) half converted. Instead, a tag with no two letters or numbers in a row, such as ^*^, >*< or o\_o, is treated as an emoticon and left exactly as written. Every other tag has all its underscores converted.
- Tags without a description show no tooltip at all. The old delayed browser hints on chips were removed, so they can't pop up under the new tooltip.
- The description tooltip also shows when a chip is reached with the keyboard (Tab key), not just on hover.

## Round 5: "Copied" on every copied chip

**Change G.** When several tags are copied at once, each copied chip shows "Copied", the same as when a single chip is clicked.

### Open questions for round 5

- [x] Answered (revised by Jeff): Shift-click only highlights each chip, as now. When Shift is let go, every picked chip flashes "Copied" together, then fades out. The clipboard still holds the whole selection, in click order.
- [x] Answered: a sub headline click flashes "Copied" on each of its chips too, so every kind of copy confirms itself the same way.

### Decisions Claude made while building round 5

- If a plain click happens while a Shift selection is still active, the clipboard gets just that one tag, so only that chip flashes "Copied". The earlier picks fade without flashing, since they're no longer what's on the clipboard.
- Switching to another window while holding Shift counts as letting go, so the picked chips flash "Copied" then too.

### Noticed by Jeff after round 5

- The last chip clicked during a Shift selection shows a ring around it. This isn't the selection: it's the keyboard focus ring. Clicking a chip gives it focus, and pressing a key (Shift) makes the browser show where keyboard focus is. Pressing Enter or Space would copy that chip. Nothing is changed yet; it could be hidden for mouse users if Jeff wants.

## Round 6: move chips without editing

**Change H.** Using Ctrl, a chip can be moved to a new place in the tag list straight from the chip view, without opening the editor. The tag's line moves in the text to match, and its description moves with it.

### Open questions for round 6

- [ ] Answered: hold Ctrl and drag the chip to where it should go, with a marker showing where it will land.
- [ ] Answered: a chip can move anywhere within its tab.
- [ ] Answered: headlines can be Ctrl+dragged too. On drop, a notice asks: move the headline with everything under it (its sub headlines and all their chips), move just the headline, or cancel. If only the headline moves, the chips that were under it are left behind and join whatever headline is now above them.
- [ ] Answered: hide the focus ring when clicking with the mouse; keep it for moving around with the Tab key.

* [x] Answered: sub headlines work the same way. Ctrl+drag, then a notice asks: move the sub headline with its chips, move just the sub headline, or cancel.

### Decisions Claude made while building round 6

- Dropping a tag onto a headline or sub headline adds it after that title's own tags. Dropping it onto another tag puts it before or after that tag, depending on which half you drop on.
- A sub headline dropped onto a headline goes to the end of that headline's section.
- A Ctrl+click without moving the mouse is still a normal click, so it copies the tag.
- The focus ring is hidden for mouse clicks across the whole note (tabs as well as chips), so it behaves the same everywhere.

## Round 7: renaming, collapsible sub headlines, spell check fix

**Change I: rename by double-click.** Double-clicking a name opens it for renaming with the whole name already selected, so typing replaces it.

**Change J: collapsible sub headlines.** Sub headlines in a tag list can be collapsed and expanded, like headlines.

**Bug K: right-click on a misspelt word.** Right-clicking a misspelt word while typing in a note opens ComfyUI's node menu instead of the browser's menu with spelling suggestions. It should show the browser's menu, so the word can be corrected.

**Change L: bigger sub headlines.** Sub headline text is a little bigger than now.

**Change M: sub headline sections marked in colour.** Each sub headline's section is marked with solid colour from the sub headline down to its last tag, so it's clear which tags belong to it.

### Open questions for round 7

- [x] Answered: double left-click on a tab always opens its name for editing, already selected, so typing replaces it. Claude's reading: this applies to every tab in both layouts. Horizontal tabs edit in place, as now, and Claude checks this works in both canvas modes. Vertical tabs have no visible name, so a rename box opens with the name selected, and the icon picker moves to the right-click menu only.
- [x] Answered: a small arrow before each sub headline's name collapses and expands it. Clicking the name still copies its tags. Collapsed sub headlines are remembered, like headlines.

* [x] Answered: sub headlines are 14 px, the same as headlines. Headlines stand out by being bold with a line under them.
* [x] Answered: a solid bar in the tab's colour runs down the left side, from the sub headline to its last tag.

- [ ] Answered: headlines go up to 16 px (from 14 px).

### What testing found in round 7

- Double-click rename had never worked, in either canvas mode, since the first version. The first click redrew the tab strip, so the browser never saw a double-click. Fixed.
- The spelling menu problem only happened in Nodes 2.0, where the node took the right-click. Fixed, including while renaming a tab.

### Decisions Claude made while building round 7

- A collapsed sub headline shows how many tags it holds. Clicking its name still copies them, and only the name flashes "Copied", since the tags are hidden.
- Right-click is left to the browser everywhere you type in the note: the text box, a tab name being renamed, and rename boxes.

## Round 8: underlines, and long tag lists

**Bug N: long tag lists grow the node.** A tag list too long for the node makes the node grow instead of scrolling. The node must keep its size, and the tag list scrolls inside it. Claude reproduces this in both canvas modes first, and checks markdown and plain tabs for the same problem.

**Change O: underlines.** What Jeff meant in round 7 was a horizontal line under each sub headline's name, extending to the right, not a bar down the left. Headline and sub headline lines all end at the same point, near the right edge of the note.

### Open questions for round 8

- [ ] Not answered before Jeff asked for the build. Claude removed the left bar, since the underline replaces it. It's easy to bring back.

### What testing found in round 8

- The node only grew in Nodes 2.0, and it happened with markdown tabs too, not just tag lists. Fixed: both now scroll inside the node.
- In Nodes 2.0, the mouse wheel over a note zoomed the canvas instead of scrolling. That's likely the "can't scroll" Jeff saw. Fixed: the wheel scrolls the note when there's more to scroll.
- Double-clicking a tag to edit closed the editor straight away whenever the browser blocked the modern clipboard, for example when ComfyUI is opened over plain http from another computer. Fixed.

### Decisions Claude made while building round 8

- Ctrl+wheel always zooms the canvas, even over a note.
- If a note has nothing to scroll, the wheel over it zooms the canvas as before.
