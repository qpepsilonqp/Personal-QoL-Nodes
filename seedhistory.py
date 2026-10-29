"""
Seed History node for ComfyUI.

Outputs a seed (from its own widget, or from a link into that widget) and
reports the value that was actually used back to the frontend, where recent
seeds are listed (newest first, count set on the node). The list is stored in the node's properties, so it is
saved in the workflow JSON. Click a seed to copy it to the clipboard.
"""


class SeedHistory:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "seed": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFFFFFFFFFF,
                        "control_after_generate": True,
                        "tooltip": "Seed to pass on. Connect the output to a "
                        "KSampler's seed or noise_seed.",
                    },
                ),
            }
        }

    RETURN_TYPES = ("INT",)
    RETURN_NAMES = ("seed",)
    FUNCTION = "record"
    CATEGORY = "utils"
    # Lets the node run and report its seed even if the output isn't connected.
    OUTPUT_NODE = True
    DESCRIPTION = "Passes a seed through and keeps a scrollable, clickable list of recent seeds."

    def record(self, seed):
        # Seeds can exceed JavaScript's safe integer range, so send as a string.
        return {"ui": {"seed": [str(seed)]}, "result": (seed,)}


NODE_CLASS_MAPPINGS = {"SeedHistory": SeedHistory}
NODE_DISPLAY_NAME_MAPPINGS = {"SeedHistory": "Seed History"}
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
