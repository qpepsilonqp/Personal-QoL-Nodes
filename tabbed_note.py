"""Tabbed Note: the Python part of the node.

The note itself (tabs, groups, markdown, tag lists) lives in web/tabbed_note.js. This class only
runs when the note's Text input or an output is switched on. Otherwise the frontend marks the
node as virtual and ComfyUI never sends it to the backend.

When a workflow is queued, the frontend adds a `tn_payload` value (JSON text) to this node's
inputs:
    {"input": bool, "outputs": ["pass" | "note", ...], "note": str, "error": str}
"""

import json


class TabbedNote:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "optional": {
                "text": ("STRING", {"forceInput": True}),
                # Filled in by the frontend when the workflow is queued. The frontend removes it
                # from the node definition so it never shows as a widget.
                "tn_payload": ("STRING", {"default": ""}),
            },
        }

    RETURN_TYPES = ("STRING", "STRING")
    RETURN_NAMES = ("text", "text_2")
    FUNCTION = "run"
    OUTPUT_NODE = True  # so a note with only Text input on still runs and receives the text
    CATEGORY = "utils"
    DESCRIPTION = ("A note with tabs, groups, markdown and tag lists. Can turn wired-in text "
                   "into new tabs and send a note on as text.")

    def run(self, text=None, tn_payload=""):
        try:
            cfg = json.loads(tn_payload) if tn_payload else {}
        except (TypeError, ValueError):
            cfg = {}

        if cfg.get("error"):
            raise ValueError(cfg["error"])

        outputs = []
        for kind in cfg.get("outputs", [])[:2]:
            if kind == "pass":
                outputs.append(text if isinstance(text, str) else "")
            elif kind == "note":
                outputs.append(str(cfg.get("note", "")))
            else:
                outputs.append("")
        while len(outputs) < 2:
            outputs.append("")

        ui = {}
        if cfg.get("input") and isinstance(text, str):
            ui["tabnote_text"] = [text]
        return {"ui": ui, "result": tuple(outputs)}


NODE_CLASS_MAPPINGS = {"TabbedNote": TabbedNote}
NODE_DISPLAY_NAME_MAPPINGS = {"TabbedNote": "Tabbed Note"}
