# Super-Power Lora Loader – Spec v3

Oct 24, 2026 · @Jeff

**Technical record:** how the node is built, what went wrong along the way and how to test it are kept in `AFTER_ACTION_REPORT.md` inside the node's folder (shipped in every zip). This doc stays conceptual: what the node should do, agreed before any work starts.

## Overview

A ComfyUI custom node that replaces Power Lora Loader (rgthree) for libraries of hundreds of LoRAs, built to work in Nodes 2.0. Each node works from one root folder inside an existing folder named `loras` that ComfyUI uses (including ones from `extra_model_paths.yaml`), organising its LoRAs into nested, collapsible, colour-coded groups seeded from the subfolders, with search at the top level and inside each group.

It keeps what works in Power Lora Loader, per-LoRA toggle and strength and the Civitai info panel, and deliberately removes what trips you up: there is no drag-to-change strength, and nothing moves or touches the disk without a confirmation.

- **Inputs:** MODEL, and optionally CLIP (video models usually load LoRAs model-only).
- **Outputs:** MODEL, CLIP, with every active LoRA applied in order.
- **Target:** Nodes 2.0 (Vue node rendering) in the current ComfyUI frontend.

**New in v3:** typed strength with +/- buttons and no drag, confirmation for every drag and drop and every disk write, optional CLIP, negative strengths, undo/redo, keyboard isolation, path safety, rename detection by hash, smaller workflow data.

## Setup and root folder

Each node works from one root folder inside an existing folder named `loras` that ComfyUI uses, which must be set before the node can be used. Every LoRA path ComfyUI knows about counts (the normal `models/loras` and any from `extra_model_paths.yaml`), as long as it exists and is named `loras`.

### On dropping the node

1. The node opens a folder picker instead of its normal contents.
2. The picker is a collapsible tree. Each `loras` folder is listed at the top with its full path; **+** opens a folder, showing its subfolders first, then its LoRA files greyed out. A filter box searches folders and LoRAs. The root can be a `loras` folder itself or any folder below one, never anywhere else.
3. Until a root is chosen, the node shows only the picker, and running the workflow fails with a clear "No root folder set" error.
4. Once chosen, the node scans the root and builds the groups from its subfolders.

The root is saved relative to `loras` (e.g. `loras/styles`), never as a full path, so workflows work on any machine. If the root or a group's linked subfolder is missing when a workflow loads, the node asks before creating it (see Disk writes). If you decline, the root picker is shown again.

### Gear settings

A gear icon at the top right of the node opens its settings:

- **Root folder:** shows the current root, with a button to change it.
- **Dropdown rows:** how many rows a dropdown shows before it scrolls.
- **Rows per group:** how many of its own LoRAs an open group shows before it scrolls by itself, or Unlimited. One setting for every group.
- **Blur previews until clicked:** on or off.
- **Unlisted LoRAs:** opens the list of unlisted LoRAs and groups to relist them.
- **Export layout / Import layout:** see below.
- **Civitai API key:** optional, for models that need it.

### Changing the root folder

Changing the root rebuilds the node from the new folder, so it needs a warning and two confirmations:

1. **Warning:** groups, colours, unlisted LoRAs and active LoRAs from outside the new root will be removed from this node. Files on disk are not touched.
2. **First confirmation:** "Change root to `<new folder>`?"
3. **Second confirmation:** a final "Are you sure?" step, with Cancel as the default button.

Proposed: LoRAs under both the old and new root keep their group placement, toggle and strength.

### Export and import

- **Export** saves a `.json` layout file: the root folder, the group tree with names and colours, every LoRA's path, group and nickname, unlisted LoRAs and groups, and each LoRA's hash and Civitai model and version IDs where known.
- **Import** replaces the node's layout with the file's, after a confirmation. Any folders it needs are listed and confirmed before creating (see Disk writes). LoRAs in the file that aren't on disk appear as missing; LoRAs on disk that aren't in the file go into their folder's group.
- Toggles and strengths are not exported, since they belong to a particular workflow.
- **Nickname conflicts:** if the file's nickname differs from the one saved next to the LoRA, the one next to the LoRA wins.

## Node layout

The node is one panel with a header and three stacked areas, top to bottom:

1. **Header.** Node title, with the gear icon at the top right.
2. **Main search bar.** Searches groups and LoRAs within the root folder.
3. **Active section.** Every LoRA that is switched on, in the order they are applied. Always visible above the groups.
4. **Group tree.** All listed LoRAs in nested, collapsible groups.

The group tree fills the node: resizing the node shows more or fewer groups, and the tree scrolls as a whole. Each open group's own LoRAs sit in a box of up to **Rows per group** rows that scrolls by itself; with **Unlimited** the box shows them all. Subgroups are listed before a group's own LoRAs, and each level is indented further with faint guide lines. A new node starts with room for 12 rows.

## LoRA rows

Every LoRA row has the same controls, left to right:

| Control | Behaviour |
| --- | --- |
| Toggle | Switches the LoRA on or off. On adds it to the Active section. |
| Name | The nickname if set, otherwise the file name without `.safetensors`. Double-click to edit the nickname; clearing it reverts to the file name. |
| Strength | `−` button, a number box, `+` button. See below. |
| i icon | Opens the info panel. |
| T icon | The trigger button. |

### Strength

- **Buttons:** `−` and `+` change the strength by 0.05 per click.
- **Typing:** click the number to type any value, e.g. `0.73` or `-0.4`. Enter or clicking away applies it; Escape cancels.
- **Negative strengths** are allowed.
- **No drag:** dragging over the strength never changes it, unlike Power Lora Loader. Proposed: the mouse wheel doesn't change it either, for the same reason.
- One strength per LoRA, applied to MODEL and, if connected, CLIP.

### Other row behaviour

- **Hover:** hovering a LoRA's name shows a tooltip with its name, file name and full path on disk, e.g. `D:\OldComfy\models\loras\styles\anime\foo_v2.safetensors`. Hovering a group shows its path and folder.
- **Sync:** an active LoRA appears in both the Active section and its group. Changing the toggle or strength in one updates the other immediately.
- **Order:** LoRAs are applied in the order shown in the Active section. Newly activated LoRAs go to the bottom; reordering by drag asks for confirmation (see Groups).
- **Unlist:** right-click, Unlist. The LoRA disappears from the tree and search and stays hidden until relisted. Unlisting an active LoRA switches it off first.
- **Missing LoRAs:** greyed out, with toggle, strength and T icon disabled; only the i icon stays lit.

## Groups

Groups start as a mirror of the root folder's subfolder tree and can then be rearranged freely inside the node. Files on disk are never moved, renamed or deleted.

### Appearance

- **Collapsed:** the group title on the left, its own search bar on the right.
- **Expanded:** shows its subgroups and LoRAs, indented under it.
- **Colour:** each group can be given a colour. Subgroups use their parent's colour unless given their own.
- **Nesting:** groups can contain groups to any depth.

### Editing

- Create, rename and delete groups inside ComfyUI.
- Drag and drop a LoRA into any group, a group into another group, or reorder the Active section.
- **Every drop asks for confirmation**, e.g. "Move `foo_v2` to `Styles / Anime`?", so an accidental drag while navigating does nothing. Cancelling puts it back.
- Proposed: "Move to…" in the right-click menu as an alternative to dragging, picking the group from a list.
- Deleting a group moves its contents to its parent group rather than hiding them.
- Unlisting a group hides everything inside it, until relisted from the gear settings.

### Folder sync

- **Folder link:** each group remembers which subfolder it came from. Renaming or moving the group keeps the link.
- **New LoRAs:** detected when a workflow loads and when ComfyUI's model list is refreshed. Each goes into the group linked to its subfolder, recreated in its original place if deleted. LoRAs directly in the root go into an "Unsorted" group.
- **Missing LoRAs:** a LoRA in the layout but not on disk stays in place, greyed out. A missing LoRA can't be active: if a loaded workflow had it switched on, it is shown switched off with a warning. It can be removed from the layout manually.
- **Renamed or moved files:** where a LoRA's hash is known, a "missing" LoRA and a "new" one with the same hash are recognised as the same file, and the LoRA keeps its group, nickname, toggle and strength. Otherwise, a LoRA you'd placed in a group yourself stays there, and one still in its folder's group follows its new folder.
- **Duplicate names:** LoRAs with the same file name in different subfolders are told apart by their path.

## Search

All search stays inside the node's root folder and skips unlisted LoRAs. Both searches match nicknames and file names, and each result shows its folder path in small text so LoRAs with the same name can be told apart.

### Main search

- Searches every listed group and LoRA under the root. Results appear in a dropdown, limited by the dropdown-rows setting.
- **Group results** show that group's LoRAs in a dropdown underneath the result.
- **Clicking a group result** expands that group (and its parents) and scrolls the tree to it.
- **Left-clicking a LoRA result** expands its parent groups, scrolls the tree to the LoRA and briefly highlights it.

### Group search

- The search bar on each group only searches inside that group, including all subgroups at every depth.
- It finds both LoRAs and subgroups. Clicking a result behaves the same as in the main search.

## LoRA info and Civitai

The i icon works like Power Lora Loader's "Show Info" and reads the same `.rgthree-info.json` files, so info already fetched with rgthree is reused. The current rgthree source is read before building so the panel matches what you're used to.

### Fetching

1. Hash the LoRA file (SHA256), with a progress indicator for large files, and look the hash up on Civitai.
2. Merge the Civitai data with the training metadata stored inside the `.safetensors` file.
3. Ask before saving the info file next to the LoRA (see Disk writes).
4. Later opens read the saved file instantly, with no network call.

If a LoRA isn't on Civitai, or has been removed from it, the panel says so clearly, shows what the file's own metadata contains, and keeps any info saved earlier.

### Panel contents

- File name, path, hash, base model.
- Civitai model and version name, with a link to the model page.
- Trigger words: Civitai trigger words, your own triggers, and the training tags from the file, sorted by frequency.
- Example images and videos from Civitai with their generation settings, plus a preview if one sits next to the file.
- Nickname and an editable personal note; editing existing trigger words.
- Buttons to refresh from Civitai and to clear the saved info.

### Previews

- Videos play muted automatically. Clicking a video unmutes it; clicking again mutes it. Only one video plays with sound at a time.
- **Blur previews until clicked:** a gear setting, for explicit Civitai examples.

### Missing LoRAs

For a missing LoRA, the panel works from the hash and Civitai IDs saved in the workflow or layout file.

- Shows the name, expected path, base model and Civitai model and version.
- A link to the LoRA's Civitai page to download it. Once the file is in place and the model list is refreshed, the row becomes normal again.
- **Download to folder:** downloads the file from Civitai into the expected subfolder, after confirmation, using the API key if needed.
- With no saved Civitai IDs, it shows the file name and hash only, with a note that it can't be looked up.

### Bulk fetch

- A group's menu has "Fetch info for all LoRAs in this group", including subgroups.
- One confirmation covers the whole batch, listing how many info files will be written.
- It runs in the background, skips LoRAs that already have info, and paces requests so Civitai doesn't rate-limit you.

## Trigger button

The trigger button is a T icon next to the i icon on every LoRA row, styled to match it. Its colour and hover tooltip show its state:

| State | Colour | Tooltip | Click |
| --- | --- | --- | --- |
| Info not loaded | Grey | "Trigger words: info not loaded yet" | Fetches the info (asking before saving it), then switches to red or normal. |
| Info loaded, no trigger words | Red | "Trigger words: none found. Click to add your own" | Opens a text box below the row to type your own triggers. Saving switches the button to normal. |
| Trigger words available | Normal | "Click to copy trigger words: `word1, word2, …`" | Copies the trigger words to the clipboard, comma-separated. |
| LoRA missing | Disabled | "LoRA file missing" | Nothing. |

- **What counts as trigger words:** Civitai's trigger words plus any you add yourself. The file's training tags are not used for the button.
- **Long lists:** the tooltip shows the words in full, wrapping across lines.
- **Your own triggers:** saved next to the LoRA, so they survive refreshing from Civitai and appear in every workflow. Existing triggers are edited in the info panel, so a normal click always just copies.
- **Clipboard fallback:** browsers only allow clipboard access on `localhost` or HTTPS. When copying is blocked, the words appear selected in a small box to copy manually.

## Disk writes, confirmations and safety

The node never creates a folder or file without asking first. Each confirmation lists exactly what will be created and where.

| Action | What it creates | Confirmation |
| --- | --- | --- |
| Loading a workflow with missing folders | Empty folders under `loras` | One dialog listing every folder; Cancel creates nothing |
| Importing a layout | Empty folders under `loras` | One dialog listing every folder, after the import confirmation |
| Fetching info (i icon or grey T icon) | Info file next to the LoRA | Asked before saving; declining still shows the info for this session |
| Bulk fetch | One info file per LoRA | One dialog for the batch, with the count |
| Saving a nickname or your own triggers | Data file next to the LoRA | Asked the first time for each LoRA |
| Download to folder | The LoRA file | Shows file name, size and destination |
| Export layout | A `.json` file | Your browser's own save dialog |

### Path safety

- Every path from a workflow, layout file or Civitai is checked to stay inside one of ComfyUI's existing `loras` folders before anything touches the disk. Paths like `../../somewhere` or absolute paths are rejected with a clear message. Anything that writes must name a `loras` folder exactly, and a `loras` folder itself is never created.
- Downloaded files must end in `.safetensors`; other file types are refused.
- **Read-only folders:** if a write fails, a clear message explains it. Proposed: info falls back to a cache in your ComfyUI user folder.

## Data storage

The workflow holds only what that workflow needs; layout files hold the complete record; anything about the LoRA itself lives next to the LoRA.

ComfyUI embeds the workflow in every saved image, so the workflow stores the minimum: full details (hash, Civitai IDs) only for active LoRAs, and group placements only where they differ from the folders.

| Data | Workflow | Layout file | Next to the LoRA |
| --- | --- | --- | --- |
| Root folder, relative to `loras` | Yes | Yes |  |
| Group tree, names, colours, collapsed state | Yes | Yes |  |
| LoRA group placements | Only differences | All |  |
| Folder link for each group | Yes | Yes |  |
| Unlisted LoRAs and groups | Yes | Yes |  |
| Hash and Civitai IDs | Active LoRAs only | All known | In the info file |
| Toggle, strength, Active order | Yes |  |  |
| Dropdown rows, rows per group, blur setting | Yes |  |  |
| Civitai info, notes |  |  | `.rgthree-info.json` |
| Nickname, your own triggers |  | Nickname only | Yes (see Risks) |

The Civitai API key is stored in ComfyUI's user settings, never in workflows or layout files.

## How it's built

A small Python part does the file work and loads the LoRAs; the panel you see is a web page inside the node, which is what makes Nodes 2.0 support practical. The technical details live in the after action report (`AFTER_ACTION_REPORT.md` in the node folder), which is updated after every round of changes.

### Behaviour inside ComfyUI

- **Keyboard isolation:** every text box (searches, strength, nickname, triggers) keeps its keystrokes, so Delete, Backspace, Ctrl+A and letter keys never reach the canvas or delete the node.
- **Scrolling:** the mouse wheel inside the list scrolls the list, not the canvas.
- **Dragging:** dragging LoRAs and groups never drags the node. Moving something into a different group is confirmed; reordering within a group or within ENABLED isn't.
- **Undo/redo:** every change inside the node registers with ComfyUI's undo history and marks the workflow as unsaved.
- **Subgraphs:** tested inside ComfyUI subgraphs as well as the main graph.
- **Performance:** the tree only draws visible rows, so hundreds of LoRAs stay fast. Each group's box also only draws its visible rows.

### Testing

Logic and UI are checked in a headless browser in Claude's workspace. Final testing needs your ComfyUI install and LoRA folder, so expect a round or two of feedback per phase.

## Risks

- **Nodes 2.0 API.** Everything depends on a DOM widget working smoothly in Vue-rendered nodes. The current frontend source is checked first; any blocker is raised before building around it.
- **rgthree overwriting our fields.** If rgthree drops unknown fields when it refreshes `.rgthree-info.json`, nicknames and your own triggers would be wiped. rgthree's code is checked first; if it's a risk, they go in a small separate file next to the LoRA instead.
- **rgthree's licence.** Only its file format is reused by default. If any code is reused, its licence notice is kept.
- **Civitai changes.** Removed models, API changes or rate limits can break lookups; saved info is never discarded because of a failed lookup.
- **Future ComfyUI updates** can break the frontend, as with any custom node.

## Build phases

Each phase is tested in your ComfyUI before the next starts. All three phases are built (24 Oct 2026). Built as specified, except: your trigger words, notes and "No trigger words" are stored in the `.spll.json` file alongside nicknames; the info window and the Active menu open over the whole page rather than inside the node, so there's room; and "No trigger words" is stored next to the LoRA (the proposed default). Rename detection works for LoRAs whose hash the workflow knows (active ones with info fetched, or downloaded).

**How we work:** every change is written into this doc first, as clear objectives, and agreed. No code changes start until you say go.

1. **Core:** root picker and gear settings, groups, confirmed drag and drop, Active section, search, nicknames, toggle and typed strength, missing-LoRA display, keyboard isolation, undo/redo.
2. **Info:** info panel, Civitai fetching, T icon, previews, missing-LoRA download links, disk-write confirmations. Also the **Group colours** setting:
   - A gear setting switches between **Individual** (each group's colour set from its ⋯ menu, as now) and **Alternating** (two colours, also chosen in the gear).
   - Proposed: in Alternating, groups alternate among their siblings at each level (top-level groups A, B, A, B; each group's subgroups A, B, A, B), so colours stay fixed to groups and don't shift when groups are opened or collapsed.
   - Switching back to Individual restores the colours set before.
3. **Polish:** export and import, unlisting, bulk fetch, download to folder, rename detection by hash (also carrying stars across renames). Plus these changes from reviewing phases 1 and 2:
   - **Search results:** every LoRA result has an on/off toggle on its right. The toggle switches the LoRA without closing the dropdown; clicking elsewhere on the result still jumps to it. Missing LoRAs get a disabled toggle.
   - **Active section:** a single click on an active LoRA's name jumps to it in the groups (not the toggle, strength or buttons).
   - **Nicknames:** edited from the right-click menu ("Edit nickname…") everywhere; double-click no longer edits.
   - **Favourites:** a ★ button after T on every LoRA row marks a favourite.
   - **Active right-click menu:** "Favourites ▸" and "History ▸" at the top; right-clicking a LoRA adds its own options below. Hovering either opens a submenu listing those LoRAs, each with a toggle on the right and click-to-jump on the name. It scrolls past its row limit and ends with a "Rows: N \[−\] \[+\]" control. Menus are drawn over the page so submenus aren't cut off by the node, with a short delay before a submenu closes.
   - **History:** a LoRA is added when it's switched off, most recent first, once each; active LoRAs never appear. The gear has the history length (or Off) and "Clear history". The LoRA's strength is already kept per workflow, so history doesn't store it.
   - **Storage:** favourites, history and their row counts and length are saved per node in the workflow, so a shared workflow carries them and different models' workflows stay separate. No files are written. Switching off and its history entry undo together; changing the root drops entries outside it.
   - **Export and import:** layout files include favourites, history and their settings. On import, after the normal confirmation, the node itself asks whether to replace its favourites and history with the file's (No keeps them and imports the rest). This is only asked when both the node and the file have some.
   - **Selecting trigger words:** in the i window and the T box, each trigger word is a separate chip that's selected or deselected by clicking. One button reads "Copy All" by default and copies every trigger word; once at least one chip is selected it becomes "Copy Selected", and deselecting everything turns it back. Selected words are copied in listed order. Clicking a green T opens this box under the row instead of copying instantly. Training tags in the i window are selectable the same way.
   - **"No trigger words":** the box that opens from a red T has a "No trigger words" toggle. When on, the T uses the same neutral colours as the i button instead of red; it can still be clicked to add your own trigger words, and adding some turns it green. A "No Trigger All" button in the gear marks every LoRA under the root that's currently red (grey ones, with info not loaded, aren't touched). Proposed: stored next to the LoRA in its `.spll.json`, so it applies in every workflow; "No Trigger All" writes those files after one confirmation listing how many.
   - **Civitai unreachable (e.g. blocked without a VPN):** a failed lookup is never offered for saving. The node says it couldn't reach Civitai (suggesting a VPN) and the T stays grey, so clicking it retries. Info saved without Civitai data (e.g. by rgthree while blocked) shows a distinct "Civitai not checked, click to retry" T state instead of red. "Not found on Civitai" stays a real result. "Refresh from Civitai" overwrites saved info directly, and "Clear saved info" stays.
   - **Clicking a group bar:** clicking anywhere on a group's bar expands or collapses it, not just the arrow (which stays). The group search box and ⋯ button don't count, and each has a small dead zone around it (about 8 px) so a near miss does nothing rather than toggling the group. Right-click still opens the group menu.
     - **Press-and-hold to drag:** a quick press and release is a click (toggles the group). Holding the left button for about 0.3 s starts a drag; moving the mouse while holding doesn't cancel or reset the timer, as long as the press started inside the bar. The bar fills with a subtle highlight while the timer runs. This replaces the browser's built-in dragging, which starts on the first movement. Every drop is still confirmed. Proposed: LoRA rows use the same press-and-hold, so both behave alike and accidental drags while navigating are less likely.

### Phase 4 (built): flexible sources

For more casual users, while keeping the folder-based setup for big libraries.

- **Section names:** Active becomes **ENABLED**. The lower section is **DISABLED** while the node has no groups and **GROUPS** once any exist, switching back to DISABLED when the last group is removed. Favourites and history stay with ENABLED.
- **Sources instead of one root:** a node holds any mix of added folders and individually added LoRAs, from any of ComfyUI's `loras` folders. An added folder shows its subfolders as groups and picks up new LoRAs automatically; individually added LoRAs never change on their own. Setup uses the same file search. A phase 1–3 node's root converts automatically to one added folder, so nothing changes for existing workflows. Export/import, rename detection and folder sync work with sources.
- **Search Files (Nodes 2.0):** a bar along the bottom of the node holds Add group, Settings, Rescan Folders and, in the bottom-right corner, a **Search Files** button (a file with a magnifying glass; tooltip "Search Files"). Clicking it slides a search box out to the left that searches every `loras` folder live, like setup, with results opening upwards; add whole folders or individual LoRAs from it. It sits above ComfyUI's own name strip and clear of the resize corner.
- **Search Files (classic canvas):** the top search bar gets a toggle button (a folder with a magnifying glass) that switches it between searching this node and searching all files. Add group, Settings and Rescan stay at the top.
- **DISABLED search:** a search box at the bottom of the DISABLED section for adding more LoRAs.
- **Rescan Folders** (renamed from "Rescan root folder for new LoRAs"): refreshes the node's cached scans of its added folders. Greyed out when no folders have been added, with the tooltip "Rescan Folders: you need to add a folder to rescan. The file search always reads every loras folder and its subfolders live."
- **Removing:** right-click a folder's group → "Remove folder from node"; right-click a LoRA → "Remove from node". Neither touches files.
- **Sorting favourites:** the Favourites submenu gets **Sort ▸** with A to Z, Z to A, Newest added first, Oldest added first and Custom (a tick shows the current one), saved per node. In Custom, drag favourites by a ⠿ grip on each row, with no confirmation; the list scrolls near its edges. Switching to Custom starts from the order showing; dragging under another sort switches to Custom; new favourites go at the top. History stays most recent first.
- **Undo grace when disabling:** a LoRA switched off stays in ENABLED for 5 seconds as a fading row. It's already disabled (not applied if you run, and added to history). It flashes slowly yellow, brightly at first, then more dimly as it greys out, then disappears. Clicking anywhere on it during those 5 seconds re-enables it at the same position and strength (and takes it back out of history). This applies however the LoRA was switched off (ENABLED, groups, search or menus), and hovering over the fading row pauses the countdown so it can't vanish as you reach for it.

### Phase 5 (built, awaiting your testing): search and layout polish

Agreed 26–27 Oct. Objectives:

- **ENABLED keeps its scroll position.** Changing a strength (or anything else) while scrolled down in ENABLED must not jump the list back to the top. Same for every other list that redraws.
- **Search boxes open and close with the mouse.** Applies to the top search, every group search, the DISABLED search and Search Files. Hovering a box that has a search in it opens its results after about 0.15 s; moving off both the box and its results closes them after about 0.3 s; typing opens them. No timers that clear searches, and no pin or lock.
- **Clicking into a search box selects its search,** so typing replaces it. Clicking to the right of the text puts the cursor at the end instead. This must behave the same every time you come back to a box (after its results closed or you clicked elsewhere), whether or not the box still has the cursor. While you're still using the box, clicks place the cursor normally.
- **× clears a search; Escape closes the results** and keeps the search.
- **Group search results float above the group's bar,** not inside the list, so the list doesn't jump and the results never cover what they find.
- **Nodes 2.0: buttons on the name strip.** Search Files, +, ⚙ and ↻ sit together on the right of ComfyUI's node-name strip (the empty space beside the name label), Search Files leftmost. Clicking Search Files slides its box out to the left with a smooth animation, up to the name label (covering it only when there's under about 160 px of room), and it slides back, the animation reversed, when the mouse leaves the box and its results. The search is kept. If ComfyUI's name label is turned off, the buttons get their own row at the bottom right.
- **Clicking a result** jumps to it and leaves the results open. The LoRA or group flashes once, then keeps a moderate highlight in the opposite of its colour until the results close or another result is clicked; then the highlight fades over 3 s, flashes once and returns to normal. Where possible the row is scrolled beside the open results, not under them.
- **Hovering a result** outlines that LoRA or group in the groups, and in ENABLED if it's on, only where it's already visible on the node. Nothing scrolls or opens.
- **Switches on the left** in search results, Favourites and History; **Add / Add folder on the left** in Search Files; the favourites drag grip moves to the right.
- Also fixed: the Ungrouped group's count showed 0.

### Phase 6 (built, awaiting your testing): groups, menus and settings

Agreed 27 Oct, built the same day. Decisions made while building (change any of them after testing):

- Clicking a favourite that's already on switches it off (the open question below).
- Menus opened from a button (⋯) open just below it, or above or beside it when there's no room, so the button that opened them stays clickable and can close them again.
- On the classic canvas, Settings opens below the header, so the ⚙ stays visible and closes it again.
- Collapse all inside leaves the group itself open, showing its subgroups closed.
- "Unsorted" stays last until you move it.
- The GROUPS-line Sort button also orders the Ungrouped LoRAs.
- Select mode shows icon-only buttons only when the labels don't fit.

* **Expand all and Collapse all.** Icon buttons with tooltips next to the "GROUPS" title, one click each.
* **Select groups mode.** A third icon button next to "GROUPS", **Select groups…**, switches the list to a special mode:
  - The list becomes a compact tree of every group at every level (no LoRA rows, shown regardless of what's currently open), so there's little scrolling even with many groups or a small node.
  - Every group starts **ticked**. Ticks mean "open after Apply"; unticked means "closed after Apply".
  - A bar at the top reads "N of M ticked · Untick all · Invert · Apply · Cancel". **Untick all** becomes **Tick all** when nothing is ticked; **Invert** flips every tick. On a narrow node these become icon buttons with tooltips so the bar fits on one line.
  - Groups with subgroups get an **all inside** button on their bar that ticks or unticks that group and everything inside it in one click.
  - Ticking a subgroup also ticks its parents, since a subgroup can't show while its parent is closed (this applies after Invert too).
  - **Apply** opens every ticked group and closes every unticked one, then returns to the normal list. **Cancel** or Escape leaves everything as it was.
* **Inside one group.** The group menu (⋯ or right-click) gets **Expand all inside** and **Collapse all inside**, for that group's subgroups.
* **Clicking outside closes menus and popups.** Clicking the canvas, or anywhere outside, closes menus and popups: ENABLED's Favourites and History menus, the group and LoRA menus, Move to…, colours and Settings.
  - **Boxes you type into stay open on an outside click** (rename, nickname, trigger words), so you can copy text from elsewhere in ComfyUI into them. Clicking anywhere on the node closes them, so no × is needed.
  - **Serious warnings never close this way:** the folder-creation warning and every dialog in the import process, including the in-node question about replacing favourites and history.
* **Settings: × always visible.** The title and × stay pinned at the top with the tabs under them; only the contents scroll, so it still works in a tiny node or with many more settings.
* **Settings in tabs.** **Sources** (added folders and LoRAs, with Remove) · **Display** (rows per group or Unlimited, dropdown rows, group colours, blur previews) · **Lists** (history length, Off and Clear; unlisted LoRAs and groups) · **Info** (Civitai API key, No Trigger All) · **Layout file** (Export and Import). The node remembers the last tab used; if the node is too narrow for every tab name, the tab row scrolls sideways.
* **Favourites and History: click a row to switch it on.** These are quick-pick lists, so clicking anywhere on a row switches that LoRA on (search results keep their current behaviour). The menu stays open so you can pick several in a row; missing LoRAs stay greyed out and do nothing.
  - A small **Show in groups** button on the right of each row (with that tooltip) jumps to the LoRA in the groups and closes the menu, replacing the old click-the-name jump. In Favourites it sits just before the drag grip.
  - In History, a LoRA you switch on drops out of the list (History only lists LoRAs that are off) and shows up in ENABLED, where the 5-second undo still applies.
  - In Favourites, a LoRA that's on has its whole row highlighted in green (the same green as an "on" switch), so you can see at a glance which favourites are in use.
  - *Open question:* clicking a favourite that's already on switches it off (matching its switch), rather than doing nothing?
* **No confirmation when reordering inside ENABLED.** A mis-drag there is harmless and easy to spot (you won't have more than a handful of LoRAs on), so the drop happens straight away. Moving a LoRA to a different group still asks.
* **Order LoRAs inside a group.** Every group starts in a **soft A to Z** order (by nickname if set, else file name).
  - Hold-drag a LoRA within its own group to move it; a line shows where it will land.
  - "Soft" means your moves are kept, and LoRAs added to the folder later slot in alphabetically among the others rather than landing at the top or bottom.
  - The group menu gets **Sort ▸**: A to Z (soft, the default), Z to A, Newest file, Oldest file, and **Strict A to Z** (re-sorts the whole group and forgets your moves).
  - Agreed: reordering within a group happens straight away, with no confirmation (moving to another group still asks). The Sort menu has an **Also apply to subgroups** tick, off by default. **Groups** can be reordered and sorted among their siblings the same way (hold-drag within the same parent; Sort in the parent's menu, or for top-level groups via the GROUPS title). Newest and Oldest file stay, using file dates read on the Python side.
* **Clearer label on the GROUPS line.** The "1 folder" label opposite "GROUPS" becomes **Folder trees: 1** (each added folder brings its whole tree of subfolders), and LoRAs added on their own show as **Single LoRAs: 2**, joined with " · " and each shown only when above zero. The line reads: "GROUPS · 7", then the new expand / collapse / select / sort buttons, then this label on the right; on a narrow node the label shortens first.
* **Bug: pressing a button again should close what it opened.** Pressing the ⚙ while Settings is open currently closes and immediately reopens it (the press counts as a click outside, then reopens). Pressing the same button again closes what it opened, for every such button: ⚙ (both canvases), the ★ next to ENABLED, and each group's ⋯.

### Phase 7 (built, awaiting your testing): fixes

- **Fix: the first click into a search box always selects the whole search** (decided 27 Oct, option A). The old rule "click to the right of the text puts the cursor at the end" is dropped: in a wide box with a short search almost every click landed to the right of the text, so it rarely selected. To add to a search instead: press End, or click again once you're in the box (clicks then work as normal). Applies to every search box (top, group, DISABLED, Search Files), both canvas modes. Jeff uses ComfyUI Desktop (same engine as Chrome).
- **Show the node's build number in Settings,** so it's easy to check which version is loaded.

### Phase 8 (built, awaiting your testing): favourite tiers, Search Folders, mode-switch fix

Built 27 Oct. Decisions made while building: the "open the menu when I click ☆" toggle only affects adding a favourite (a filled ★ always opens the menu); collections are listed above loose favourites and follow the same sort; Tiering Settings is also reachable in quick mode, at the bottom of the Favourites list; "one fewer tier" removes the bottom tier; empty tiers and collections are removed without asking; once Search Folders has slid out on hover, its tooltip isn't shown.

- **Bug: buttons stuck after switching between classic and Nodes 2.0.** The node only checks its mode when it redraws, and switching modes doesn't trigger a redraw. Fix: notice the switch and redraw straight away.
- **Search Files becomes Search Folders,** with the folder-and-magnifying-glass icon on both canvases.
- **Nodes 2.0: Search Folders opens on hover.** Hovering the button slides the box out after a short delay (about 0.3 s); clicking opens it instantly; moving away slides it back after a short delay.
- **Favourite tiers: Gold, Silver, Bronze.**
  - While only Gold is used, Favourites looks and works as now. Once anything is in Silver or Bronze, the Favourites submenu shows Gold ▸, Silver ▸, Bronze ▸ and Tiering Settings ▸.
  - The tiers are coloured gold, silver and bronze in the menus, and every row's ★ is coloured by its tier, so you can spot them at a glance.
  - Existing favourites move into Gold.
  - Each favourite sits in exactly one tier (and one collection), so moving is always a move, not a copy.
  - The favourites sort options (A to Z, newest and so on) apply inside each tier and collection.
- **Collections inside a tier** (the name for favourites groups, to avoid confusion with the node's groups). New favourites land loose in the tier. Right-click a LoRA in the tier to put it into a collection (or a new one); drag LoRAs and collections into a collection and back out; right-click a collection to rename or delete it (deleting asks: move everything in it up to its parent, the default, or delete the contents too, removing them from favourites after a second confirmation). Collections can nest up to **3 levels** deep (2 is the expected maximum in practice; 3 is the tested limit).
- **Starring from a row.** Left-click ★ on a LoRA (ENABLED or groups) adds it to Gold and opens a small menu to pick a tier or collection; the menu closes after a short delay once the mouse leaves (with a small buffer zone). Right-clicking ★ always opens the menu. A toggle in that menu and in Tiering Settings stops the menu opening on left-click.
  - Clicking a ★ that's already filled opens the menu (with Remove from favourites in it), so a favourite can't be removed by accident.
- **Customisable tiers** (decided 27 Oct), set up in a new **Favourites** tab in the main Settings and in **Tiering Settings ▸** in the Favourites menu (same controls in both):
  - number of tiers (1 to 10; starts as Gold, Silver, Bronze), each tier's name and colour, and their order (drag; top = most important);
  - the default tier for a left-click on ★ (instead of always the top tier);
  - the "open the menu when I click ★" toggle;
  - show tier submenus "only when more than one tier is in use" (the default, quick mode) or "always";
  - Reset to Gold, Silver, Bronze.
  - Right-clicking a tier in the menu also offers Rename… and Colour….
  - **Removing a tier asks each time** (decided 27 Oct; it's rare). Options: move its favourites (and their collections, unchanged) to a tier you pick from the remaining ones, or remove them from favourites, which asks a second time ("Remove N favourites? This can't be undone."). Lowering the tier count by more than one asks once per removed tier.
- **Tiers and collections are saved in the workflow and in layout files.**

### Phase 9 (built, awaiting your testing): tighter Favourites

Built 28 Oct. Decisions made while building: the hover tooltip appears beside the menu, level with the row, so it never covers the rest of the list; the ★ fallback for the "Favourites and History" button is in place, but the node's minimum width still fits the text, so it will rarely show.

- **No switch on Favourites rows.** Clicking the row already switches the LoRA on or off and the whole row turns green when it's on, so the switch is redundant.
- **The tier list fits its contents:** the panel listing the tiers is as wide as its longest tier name (and changes when tiers are renamed). The count stays, as a small number after the name.
- **No folder text on rows.** Each favourite's folder and full file path go into its hover tooltip. **Show in groups** moves into the right-click menu. A row is then just the name and the ⠿ drag grip.
- **The ★ next to ENABLED becomes a text button, "Favourites and History",** switching back to the ★ icon only when the node is drawn too narrow for the text.
- **Decided 28 Oct:** the Favourites, collection and History lists also shrink to fit their longest name (with a sensible minimum and maximum width); the hover tooltip is the node's own styled one, as in the groups (name, file name, full path).
- **History gets the same treatment** (decided 28 Oct, for consistency): no switch, no folder text, click a row to switch it on, Show in groups on right-click.

### Phase 10 (built, awaiting your testing): ENABLED colours

- **ENABLED rows always alternate shades,** so neighbouring rows are easy to tell apart, whatever the group colour setting.
- **Individual group colours:** each ENABLED row keeps the coloured line on its left showing which group it comes from (as now).
- **Alternating group colours:** no coloured line on ENABLED rows.
- **Confirmed 28 Oct:** no coloured vertical line at the far left of ENABLED rows when Group colours is set to Alternating.
- **One pair of alternating colours, shared** (decided 28 Oct): ENABLED always stripes with the two alternating colours at exactly the same strength as the group bars (not a fainter version), so with Alternating chosen, ENABLED and GROUPS look the same; groups use them only when Group colours is set to Alternating. The two colour pickers in Settings → Display are therefore always shown, labelled "Alternating colours (always used for ENABLED; for groups when Alternating is chosen)".

### Phase 11 (built 28 Oct): layout and colours — part 1, narrow mode

- **The node can be drawn much narrower,** with a new minimum width that all of the below works at.
- **Two layouts, with a set switch-over width.** Above it the node looks as it does now; below it, narrow mode:
  - **i, T and ☆ fold into a dotted handle (⋮)** on every row in ENABLED and GROUPS; hovering it slides the three buttons out to the left.
  - **Strength shows just its number** (no −/+); hovering it opens the full − number + control, which covers part of the name while open.
  - **No folder text** next to LoRA names.
  - **Group search boxes become a magnifying-glass icon;** hovering it opens the search box.
  - **Classic canvas:** Search Folders, +, ⚙ and ↻ fold into a dotted (⋮) menu in the header that opens on hover (it can cover the search bar while open).
  - **Nodes 2.0:** no change needed for the bottom strip (it already fits, and Search Folders slides over the name label).
- *Open questions:* (decided 28 Oct: narrow strengths are rounded, e.g. 1.75 → "1.8"; the classic dotted tools menu is narrow mode only; minimum width about 220 px and the switch to narrow mode at about 360 px, fine-tuned by testing) (E, decided 28 Oct) in narrow mode, search results also drop the folder text after LoRA names and the location text after group names; both show in the hover tooltip instead.
- **Group searches are always a magnifying-glass icon** (decided 28 Oct, at every width): hovering it opens the search box; the icon lights up while that group has a search in it.
- **Narrow-mode strength shows two digits** (decided 28 Oct): 0.75 → ".75", 1.75 → "1.8" (rounded), 1.00 → "1.0", 2.50 → "2.5", 10 → "10". Negative strengths show in red without a minus sign (−0.5 → a red ".5"). Hovering shows the full value (e.g. 1.75) with −/+.

### Phase 11, part 2: highlight colours and tier stars

- **Why:** a colour scheme can clash with the node's highlights and make them hard or impossible to see.
- **Proposed: Settings → Display → Highlight colours,** each with a colour picker and Reset:
  - **Accent:** hover outlines, drop lines when dragging, the focused search box.
  - **Switched on:** the green on switches and on-favourites.
  - **Undo fade:** the yellow flash when a LoRA is switched off.
  - **Search result highlight:** automatic by default (the opposite of the row's colour, as now), or a fixed colour you pick.
  - **Mix boxes:** the colour of mixes in ENABLED (once Phase 12 is built).
- **Decided 28 Oct:** these five, plus any other highlight or flashing effect found in the node while building (each gets its own colour setting, so nothing can be hidden by a colour scheme).
- **Metallic tier stars** (added 28 Oct): each tier gets a second **shine colour** beside its main colour. Stars are drawn with a glossy, cartoon-metal gradient from the main colour to the shine, plus an outline, so similar tiers (e.g. Platinum vs Silver) stay distinguishable. Starting shines: Gold → pale yellow, Silver → white, Bronze → peach; new tiers get a matching shine automatically; both colours are editable in the tier settings. *Open questions:* (decided 28 Oct: the outline is a third way to tell tiers apart, a darker shade of the main colour by default, with an optional colour picker per tier and a way back to automatic) (decided 28 Oct: the tier dots in the menus get the same metallic look.)

### Phase 11, part 3: collapsible GROUPS

- **Why:** with search and Favourites, the node can be used from ENABLED alone; GROUPS is only needed when you don't know any part of a LoRA's name.
- **The GROUPS title gets an arrow;** clicking the title line (but not its buttons) collapses or expands the whole section, like a group bar. Works for the DISABLED list too.
- **Collapsed:** only the search, ENABLED and the GROUPS title line (still showing its counts) are visible. Saved per node in the workflow.
- *Open questions:* (decided 28 Oct: when collapsed the node shrinks to fit, since ENABLED is only as tall as its LoRAs and mixes; expanding restores the previous height) (decided 28 Oct: clicking a search result's name while collapsed opens GROUPS and jumps to it; the result's switch still works without opening anything.)

### Phase 12 (built 28 Oct): Mixes

- **A mix** is a named set of LoRAs, each with its own strength stored in the mix. It doesn't change those LoRAs' normal (group) strengths.
- **Enabling a mix** adds it to ENABLED as its own box, highlighted in a distinct colour, whose top row shows the mix name, "Saved" or "Unsaved", and a **Save** button.
- **Strengths changed inside the box** only affect that mix, and are stored in the mix when you press Save (until then it shows "Unsaved").
- **Add to mix:** right-click any LoRA anywhere (ENABLED, GROUPS, search results, Favourites, History) → **Add to mix ▸**, a submenu listing every existing mix by name (✓ on mixes it's already in), then **New mix…**, which asks for a name, creates the mix and puts the LoRA in it.
- **ENABLED's right-click menu** gets **Mixes ▸** to switch mixes on or off, rename or delete them. It only appears once a mix exists.
- **Proposed defaults** (unless changed): adding a LoRA to a mix by right-click saves it into the mix straight away at its current strength (only edits inside the box need Save); right-click inside a mix box offers Remove from mix, Save, Revert, Rename, Delete mix; a newly enabled mix goes at the bottom of ENABLED (applied last) and the whole box can be hold-dragged; one colour for all mix boxes; mixes are saved in the workflow and in layout files; missing LoRAs in a mix are greyed out and the rest still works; in narrow mode, mix rows use the same compact strength and dotted handle.
- *Open questions:* none left (all decided 28 Oct, see below).
- **Clashes when enabling a mix** (decided 28 Oct): if any of its LoRAs are already in ENABLED, a warning lists them and asks "Switch these off and load the mix?". Yes switches them off and loads the mix; No leaves everything as it was and the mix doesn't load.
- **Clashes between two mixes** (decided 28 Oct): no warning. The copy already loaded stays; the same LoRA in the newly enabled mix is shown greyed out (not loaded). Right-click a greyed-out LoRA → **Use this mix's copy** swaps them (the other mix's copy greys out instead). A greyed copy comes back by itself when the other mix is switched off.
- **The Mixes ▸ menu** (clarified 28 Oct): each mix is one row, like Favourites. Clicking anywhere on the row switches the mix on (the row turns green; clicking again switches it off). A small button at the end of the row adds the mix's LoRAs to ENABLED as ordinary LoRAs at the mix's strengths, and sets their normal (group) strengths to match (tooltip: "Add these LoRAs to ENABLED on their own"). If that mix was on, it switches off so nothing loads twice; it uses the strengths the mix box shows (including unsaved edits); LoRAs already on just take the mix's strength. The mix box's name row in ENABLED has a switch in the same place as a LoRA's switch: green when on (its LoRAs load), red when off (the mix stays in ENABLED with its rows greyed out and nothing in it loads), plus the name, Saved/Unsaved and Save. Open question: taking a mix out of ENABLED completely by clicking its row in Mixes ▸ again (the row is green while the mix is in ENABLED) and by right-clicking its name row → Remove from ENABLED?
- **Switching one LoRA off inside an enabled mix** is allowed and counts as an unsaved change (decided 28 Oct).
- **Unsaved changes are kept** when the mix is switched off or the workflow reopened, still marked "Unsaved", with **Revert** to go back to the saved version (decided 28 Oct).

Decisions made while building (change any of them after testing):

- Removing a mix from ENABLED works both ways: click it again in Mixes ▸, or right-click its name row → Remove from ENABLED.
- A new mix starts switched off (red), so it doesn't clash straight away with the LoRAs it was made from.
- In Add to mix ▸, clicking a mix that's already ticked takes the LoRA out of it again.
- Remove from mix takes effect at once, in what's saved and in unsaved changes alike.
- While a switched-on mix is loading a LoRA, switching that LoRA on by itself elsewhere is refused with a short note (change it in the mix's box instead).
- LoRAs switched off inside a mix don't count for the "Switch these off and load the mix?" question.
- Importing a layout adds its mixes, but skips any with the same name as a mix you already have.

### Phase 13 (built 29 Oct): narrow-mode fixes

Found after testing Phase 11 on Nodes 2.0 (29 Oct):

- **Minimum width becomes 240 px** (was 220). At 220 parts of the node spill just past its edge.
- **Nodes 2.0 bottom strip:** at narrow widths, Search Folders, +, ⚙ and ↻ sit on top of the node's name badge ("SuperPowerLoraLoader"). Agreed: in narrow mode, Search Folders stays in the strip as it is; +, ⚙ and ↻ fold behind a vertical ⋮ next to it, which slides them out on hover. Wide mode keeps the strip as it is.
- Classic canvas (agreed 29 Oct): the ⋮ beside the search bar keeps all four buttons (Search Folders, +, ⚙, ↻) as now. When it slides them out, the search bar shrinks to make room instead of being covered, and grows back when they fold away.
- **Bug: the classic ⋮ menu stays open.** After clicking one of its buttons, it stays open when the mouse moves away (the click leaves the cursor focus in it, which holds it open). It should close as soon as the mouse leaves, whatever was clicked, the same as the Nodes 2.0 ⋮ will.
- **ENABLED title line:** at narrow widths "ENABLED · N" wraps onto two lines. It should stay on one line, with the Favourites and History button shrinking to ★ first.
- **Bug: Settings buttons break in narrow mode.** Button text wraps onto two or three lines and pokes out of the bottom of the button: Clear history (Lists), No Trigger All (Info), Export layout… and Import layout… (Layout file). Agreed 29 Oct: button text never wraps; where a button has an explanation beside it, the explanation moves underneath the button in narrow mode, so the button keeps its full width.
- **Settings tabs in narrow mode (found while checking):** the six tabs run off the right edge ("Fa…"), so Favourites, Info and Layout file can't be seen without scrolling the tab row. Options: **A (recommended)** the tabs wrap onto two rows, so all six stay visible; **B** the tab row scrolls sideways with a fade at the edge to show there's more; **C** in narrow mode the tabs become a single dropdown showing the current tab's name.
- Settings tabs: **A agreed** (29 Oct).
- **LoRA rows in narrow mode (ENABLED and GROUPS), agreed 29 Oct:** when i, T and ☆ slide out from the ⋮, they push the strength along to the left instead of covering it. You can then move the mouse onto the strength and it opens into the full −/value/+ control while i, T and ☆ stay out. Together they cover the LoRA's name, which is fine: if you're changing the strength you already know which LoRA it is. Hovering the strength on its own still opens it, as now.

**Phase 13, part 2: dragging LoRAs into mixes** (built 29 Oct). Also added while building: ENABLED scrolls when you drag near its top or bottom, so a mix box that's out of view can be reached; and a LoRA can come out of a mix onto a box's top or bottom edge, for when ENABLED holds only mixes.

- Hold-drag a LoRA from GROUPS, from ENABLED, or from another mix's box, and drop it on a mix's box to put it in that mix. No confirmation, the same as Add to mix. It's saved into the mix straight away.
- It goes in at the strength it had where you picked it up: its group strength from GROUPS, its ENABLED strength, or its strength in the other mix.
- Agreed 29 Oct:
  1. **From ENABLED:** the LoRA moves into the mix (it leaves ENABLED as a LoRA on its own).
  2. **From another mix:** it's copied; the first mix keeps it.
  3. **Already in the mix you drop it on:** nothing changes, and a short note says it's already there.
  4. **Order inside a mix:** it lands where you drop it, and LoRAs can be hold-dragged to reorder them inside a box.
  5. **Dragging out of a mix into ENABLED:** it doesn't change the mix. The LoRA is switched on by itself at the mix's strength (which also becomes its group strength), and its copy in the mix stays but is greyed while it's on by itself (the same greyed look as a copy another mix is loading). Switching it off by itself brings the mix's copy back.
- Also agreed 29 Oct:
  - **Switching a LoRA on by itself while a mix loads it** is now allowed everywhere (GROUPS, search, Favourites, dragging out of a mix), replacing Phase 12's refusal. The mix's copy greys while the LoRA is on by itself, and comes back when it's switched off.
  - **Reordering inside a box** is saved straight away (not an unsaved change): order doesn't change what the model gets, and mixes are small enough to reorder quickly.

### Phase 14 (built 29 Oct): small features

Decisions made while building: the ⚡ shows whenever the node is in narrow mode (at 240 px "Quick Menu" still fits, so "only when it doesn't fit" would never have shown it). In the plain list, clicking a *group* in search results switches back to the groups (there's nothing to jump to otherwise). Expand / collapse / select are hidden while the plain list shows (they only act on groups).

- **T with one trigger word:** when a LoRA has exactly one trigger word, clicking T copies it to the clipboard straight away (with a short "Copied" note) instead of opening the trigger-word box. With two or more, T works as now.
  - Agreed 29 Oct (A): the trigger-word box is also where you edit a LoRA's words, so it needs another way in. Options: **A (recommended)** right-clicking T always opens the box (today right-clicking T opens the LoRA's own menu, like the rest of the row; ☆ already works this way); **B** the LoRA's right-click menu gets "Trigger words…".

* **ENABLED right-click menu:** "Move to…" is removed from a LoRA's options there (it stays in GROUPS and search results).
* **Mix name row:** ▸/▾ first, then the mix's switch, then "Mix: \<name>".
* **Collapsible mixes in ENABLED (agreed 29 Oct):** the ▸/▾ folds a mix's box down to just its name row and opens it again; clicking the name row (not its buttons) does the same, as with GROUPS. While folded, the row shows how many LoRAs are inside. Remembered per mix, in the workflow.
* **A colour for each mix (agreed 29 Oct):** each mix can have its own highlight colour instead of the one shared colour. It tints the box and its name row, and the mix's dot in Mixes ▸. The picker is the same as a group's (swatches plus Custom), with "Use the default mix colour" to go back to the shared one from Settings. It can be set from:
  - right-clicking the mix's name row in ENABLED;
  - ENABLED's right-click menu → Mixes ▸ → hovering a mix, which opens a further submenu (below).
* **The mix's hover submenu (agreed 29 Oct):** the mix's LoRAs with their strengths (as shown in its box). A LoRA is green when it's actually loading from this mix right now. Clicking one switches it on or off inside the mix (an unsaved change, the same as doing it in the box). Each LoRA can be removed from the mix there (straight away, as with Remove from mix). The mix's colour is at the bottom.
* Removing a LoRA in that submenu (agreed 29 Oct): a small × at the end of each row.
* **The button in ENABLED's title line (agreed 29 Oct):** "Favourites and History" is renamed **"Quick Menu"**, always (once a mix exists, the menu it opens also has Mixes ▸, so the old label no longer covered it). Its tooltip reads "Favourites, History & Mixes".
  - On very narrow nodes the button shrinks to a lightning-bolt icon (drawn by the node, not an emoji, so it looks the same everywhere) instead of ★, and its tooltip becomes "Quick Menu: Favourites, History & Mixes."
* **"Rows: N \[−\] \[+\]" in submenus (agreed 29 Oct):** in any submenu that has it (Favourites, a tier or collection, History), it only shows when the list has 5 or more rows; with fewer it's hidden (the setting is kept). Collections count as rows.
* **A plain list instead of groups** (agreed 29 Oct): a toggle that swaps the GROUPS section for one plain list of every LoRA in the node, without group bars; toggling back shows the groups exactly as they were. Unlisted LoRAs stay hidden. Remembered per node, in the workflow. The list fills the section and scrolls as a whole.
  1. **Toggle (agreed 29 Oct):** an icon in the GROUPS title line, beside expand / collapse / select / sort.
  2. **Order (agreed 29 Oct):** A to Z by name to start; the Sort button in the title line sorts the plain list too (A to Z, Z to A, Newest, Oldest), remembered separately from the groups' sort.
  3. **A LoRA's group (agreed 29 Oct):** shown in its tooltip, plus its group's colour line on the left in Individual colour mode.
  4. **Title (agreed 29 Oct):** "ALL LORAS · N" while the plain list shows.
  5. **Dragging (agreed 29 Oct):** from the plain list a LoRA can only be dragged into a mix in ENABLED; right-click → Move to… still changes its group.

## Confirmed decisions

All proposals in this spec are confirmed. The main ones:

- The mouse wheel doesn't change strength.
- "Move to…" in the right-click menu as an alternative to dragging.
- Unlisted LoRAs are per workflow, shared via layout files, rather than global.
- Nicknames and your own triggers are global. They're saved in our own small file in the same folder as the LoRA (`anime_style.safetensors.spll.json` beside `anime_style.safetensors`), never inside the LoRA file. Built in phase 1 as a separate file because rgthree's "Clear" deletes its whole `.rgthree-info.json`. Saving them asks the first time per LoRA.
- Changing the root keeps placement and settings for LoRAs under both roots.
- Info falls back to a cache in your ComfyUI user folder when the LoRA folder is read-only.
- Node name: "Super-Power Lora Loader". Cheesy on purpose.

## Out of scope

- **Moving files on disk.** Grouping is always virtual.
- **Drag to change strength.** Removed on purpose.
- **A combined trigger-words output.** Not wanted; the T button covers it.
- **LoRA folders not named `loras`,** including `extra_model_paths` entries pointing at differently named folders.
- **Separate model and CLIP strengths.** One strength per LoRA.
- **Classic (non-Nodes 2.0) mode** and importing existing Power Lora Loader setups: not planned unless you want them.
- **MiniMax H3 audio/video strength split.** A possible later addition, after inspecting the key layout of a few H3 LoRAs; likely three strengths (shared, video-only, audio-only).
