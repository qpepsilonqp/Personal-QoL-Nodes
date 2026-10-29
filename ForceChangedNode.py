"""
ComfyUI Custom Node: ForceChangedNode
-------------------------------------
Passes a MODEL through unchanged, but forces IS_CHANGED to bust ComfyUI's
execution cache whenever `seed` or `text` changes, so a downstream stateless
model-patching node is re-executed on every relevant change.

`seed` and `text` are monitor-only inputs and are never forwarded.
The MODEL input is forwarded untouched as the sole output.
"""
import hashlib


class ForceChangedNode:
    """Forward MODEL unchanged; re-run downstream whenever seed or text changes."""

    CATEGORY = "utils"
    FUNCTION = "run"
    RETURN_TYPES = ("MODEL",)
    RETURN_NAMES = ("model",)
    DESCRIPTION = (
        "Passes a MODEL through untouched while busting the execution cache "
        "whenever seed or text changes. Use it to force a downstream stateless "
        "model-patching node to re-run on meaningful changes only. seed and "
        "text are monitor-only and are never forwarded."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL", {"tooltip": "Forwarded unchanged."}),
                # seed + text are monitor-only: watched for changes, never output.
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "display": "number",
                        "tooltip": "Monitor-only. Changing it forces re-execution.",
                    },
                ),
                "text": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "tooltip": "Monitor-only. Changing it forces re-execution.",
                    },
                ),
            }
        }

    @staticmethod
    def _fingerprint(seed: int, text: str) -> str:
        """Unambiguous fingerprint of seed + text.

        A NUL separator can't occur in a normal text widget, so the boundary
        between the two fields is collision-proof (unlike a ':' which text
        could itself contain).
        """
        payload = f"{seed}\x00{text}".encode("utf-8")
        return hashlib.sha256(payload).hexdigest()

    @classmethod
    def IS_CHANGED(cls, model, seed: int, text: str) -> str:
        # ComfyUI calls this before deciding whether to reuse cached output.
        # Returning a new value busts the cache for this node and everything
        # downstream. The model itself is not hashed (ComfyUI tracks it
        # separately); only the monitored fields matter.
        return cls._fingerprint(seed, text)

    def run(self, model, seed: int, text: str):
        # Forward the model unchanged; seed and text are monitor-only.
        return (model,)


NODE_CLASS_MAPPINGS = {
    "ForceChangedNode": ForceChangedNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ForceChangedNode": "Force Changed (seed + text)",
}
