"""Super-Power Lora Loader for ComfyUI.

A grouped, searchable multi-LoRA loader built for Nodes 2.0.
"""

from .py.node import SuperPowerLoraLoader
from .py import routes  # noqa: F401  (registers the API routes)

NODE_CLASS_MAPPINGS = {
    "SuperPowerLoraLoader": SuperPowerLoraLoader,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SuperPowerLoraLoader": "Super-Power Lora Loader",
}

WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
