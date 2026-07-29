"""
Resolution Picker (~1MP, /16)
-----------------------------
A ComfyUI custom node providing a dropdown of resolutions that are:
  - divisible by 16 on both edges  (Qwen VAE f8 x patch_size 2 = 16 alignment,
    the correct requirement for Krea 2 so no padding occurs)
  - approximately 1 megapixel
Each entry is labeled with its aspect ratio (~ marks an approximate ratio)
and orientation. Ordering: Square first, then Landscape (widest -> squarest),
then Portrait (tallest -> squarest).
Outputs: width (INT), height (INT)

Install: drop this file into ComfyUI/custom_nodes/ (with the package
__init__.py) and restart ComfyUI. Appears under utils/resolution as
"Resolution Picker (~1MP, /16)".
"""

# (label, width, height) — all verified: both edges /16, ~1MP.
# Grouped Square / Landscape / Portrait. "~" ratios are approximate.
RESOLUTIONS = [
    ("1024 x 1024   (1:1) - Square", 1024, 1024),         # 1.049 MP

    ("1536 x 640   (12:5) - Landscape", 1536, 640),       # 0.983 MP
    ("1568 x 672   (7:3) - Landscape", 1568, 672),        # 1.054 MP
    ("1440 x 720   (2:1) - Landscape", 1440, 720),        # 1.037 MP
    ("1360 x 768   (~16:9) - Landscape", 1360, 768),      # 1.044 MP
    ("1344 x 768   (7:4) - Landscape", 1344, 768),        # 1.032 MP
    ("1280 x 800   (8:5) - Landscape", 1280, 800),        # 1.024 MP
    ("1248 x 832   (3:2) - Landscape", 1248, 832),        # 1.038 MP
    ("1216 x 832   (~19:13) - Landscape", 1216, 832),     # 1.012 MP
    ("1152 x 864   (4:3) - Landscape", 1152, 864),        # 0.995 MP
    ("1152 x 896   (9:7) - Landscape", 1152, 896),        # 1.032 MP
    ("1088 x 960   (17:15) - Landscape", 1088, 960),      # 1.044 MP

    ("640 x 1536   (5:12) - Portrait", 640, 1536),        # 0.983 MP
    ("672 x 1568   (3:7) - Portrait", 672, 1568),         # 1.054 MP
    ("720 x 1440   (1:2) - Portrait", 720, 1440),         # 1.037 MP
    ("768 x 1360   (~9:16) - Portrait", 768, 1360),       # 1.044 MP
    ("768 x 1344   (4:7) - Portrait", 768, 1344),         # 1.032 MP
    ("800 x 1280   (5:8) - Portrait", 800, 1280),         # 1.024 MP
    ("832 x 1248   (2:3) - Portrait", 832, 1248),         # 1.038 MP
    ("832 x 1216   (~13:19) - Portrait", 832, 1216),      # 1.012 MP
    ("864 x 1152   (3:4) - Portrait", 864, 1152),         # 0.995 MP
    ("896 x 1152   (7:9) - Portrait", 896, 1152),         # 1.032 MP
    ("960 x 1088   (15:17) - Portrait", 960, 1088),       # 1.044 MP
]

_LOOKUP = {label: (w, h) for label, w, h in RESOLUTIONS}


class Resolution1MPPicker:
    """Dropdown of ~1MP resolutions (both edges divisible by 16) with labeled
    aspect ratio and orientation, grouped Square/Landscape/Portrait.
    Outputs width and height as INT."""

    CATEGORY = "utils/resolution"
    FUNCTION = "pick"
    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    DESCRIPTION = (
        "Pick a ~1MP resolution with both edges divisible by 16 (the correct "
        "alignment for the Qwen VAE + patch_size 2 used by Krea 2, so no "
        "padding occurs). Entries are grouped Square, Landscape, then Portrait, "
        "each showing its aspect ratio (~ = approximate). Outputs width and "
        "height as INT."
    )

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "resolution": ([label for label, _, _ in RESOLUTIONS],),
            }
        }

    def pick(self, resolution):
        width, height = _LOOKUP[resolution]
        return (int(width), int(height))


NODE_CLASS_MAPPINGS = {
    "Resolution1MPPicker": Resolution1MPPicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "Resolution1MPPicker": "Resolution Picker (~1MP, /16)",
}
