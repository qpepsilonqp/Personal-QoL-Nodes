import math

# ---------------------------------------------------------------------------
# Aspect ratios
#
# The label ALWAYS begins with the numeric ratio ("w:h") before the first
# space, e.g. "2.39:1 (Anamorphic Scope)". Both Python and the JavaScript
# front-end parse the ratio out of that prefix, so this list is the single
# source of truth -- edit it here and the live display follows automatically.
#
# Ordered by elongation: squarest first (1:1), widest last (3:1). Orientation
# is the master control (see class docstring), so each ratio is treated purely
# as a *shape* -- with Orientation = Portrait, 16:9 already gives a 9:16 image,
# so portrait forms are not listed separately.
# ---------------------------------------------------------------------------
ASPECT_RATIOS = [
    "1:1 (Square)",
    "5:4 (Large Format)",
    "4:3 (Standard)",
    "1.414:1 (A4)",
    "3:2 (Photo)",
    "5:3 (Super 16)",
    "16:9 (Widescreen)",
    "1.85:1 (Cinema Flat)",
    "2:1 (Univisium)",
    "21:9 (Ultrawide)",
    "2.39:1 (Anamorphic Scope)",
    "3:1 (Panorama)",
]


def parse_ratio(label):
    """'16:9 (Widescreen)' -> (16.0, 9.0). Handles decimals like '2.39:1'."""
    token = str(label).split(" ")[0]
    w_str, h_str = token.split(":")
    return float(w_str), float(h_str)


def round_to_divisor(value, divisor):
    """Round to nearest multiple of divisor (half rounds up), min one multiple.
    floor(x/d + 0.5)*d matches JavaScript's Math.round so both sides agree."""
    divisor = max(1, int(divisor))
    snapped = int(math.floor(value / divisor + 0.5)) * divisor
    return max(divisor, snapped)


def compute_dimensions(megapixels, aspect_ratio, orientation, divisible_by):
    ratio_w, ratio_h = parse_ratio(aspect_ratio)
    ratio = ratio_w / ratio_h
    if ratio < 1.0:                       # normalise to long : short
        ratio = 1.0 / ratio

    target = float(megapixels) * 1_000_000.0
    long_dim = math.sqrt(target * ratio)  # long/short == ratio, long*short == target
    short_dim = math.sqrt(target / ratio)

    long_dim = round_to_divisor(long_dim, divisible_by)
    short_dim = round_to_divisor(short_dim, divisible_by)

    if orientation == "Portrait":
        return int(short_dim), int(long_dim)
    return int(long_dim), int(short_dim)


class ResolutionPicker:
    """
    Resolution Picker

    Pick a target size in megapixels, an aspect ratio, an orientation and a
    "divisible by" constraint; outputs integer width and height.

    Orientation is the MASTER control. The aspect ratio only defines the shape,
    and Orientation decides whether the long edge is the width (Landscape) or
    the height (Portrait). This is deliberate: a dropdown can be promoted to a
    subgraph input, whereas a boolean toggle cannot.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "megapixels": ("FLOAT", {
                    "default": 1.00,
                    "min": 0.01,
                    "max": 100.00,
                    "step": 0.01,
                    "round": 0.01,
                    "tooltip": "Target image size in megapixels (millions of pixels). "
                               "Two decimals of granularity for very low resolutions.",
                }),
                "aspect_ratio": (ASPECT_RATIOS, {"default": "1:1 (Square)"}),
                "orientation": (["Landscape", "Portrait"], {
                    "default": "Landscape",
                    "tooltip": "Master control. Decides which edge is longer. "
                               "Promote this to a subgraph input to drive orientation from outside.",
                }),
                "divisible_by": ("INT", {
                    "default": 8,
                    "min": 1,
                    "max": 1024,
                    "step": 1,
                    "tooltip": "Both dimensions are snapped to the nearest multiple of this value. "
                               "Type any integer (e.g. 32 for MiniMax H3).",
                }),
            }
        }

    RETURN_TYPES = ("INT", "INT")
    RETURN_NAMES = ("width", "height")
    FUNCTION = "generate"
    CATEGORY = "utils/resolution"
    DESCRIPTION = ("Compute width/height from megapixels + aspect ratio + orientation, "
                   "snapped to a typed divisor. Orientation is a dropdown so it can be "
                   "linked inside a subgraph.")

    def generate(self, megapixels, aspect_ratio, orientation, divisible_by):
        width, height = compute_dimensions(megapixels, aspect_ratio, orientation, divisible_by)
        return (width, height)


NODE_CLASS_MAPPINGS = {
    "ResolutionPicker": ResolutionPicker,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ResolutionPicker": "Resolution Picker",
}
