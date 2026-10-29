"""
ComfyUI custom node package.

Auto-discovers every sibling .py module, merges each module's
NODE_CLASS_MAPPINGS / NODE_DISPLAY_NAME_MAPPINGS, and exposes the combined
mappings for ComfyUI to load. Drop new node files in this folder and they
register automatically — no need to edit this file.

Front-end JavaScript is served from the ./web subfolder (see WEB_DIRECTORY at
the bottom). Drop any node's .js in ./web and ComfyUI loads it automatically —
again, no need to edit this file.

Handles module filenames that aren't valid Python identifiers (e.g.
"sigmas-at-percent.py") because importlib imports by string name.
"""

import importlib
import pkgutil
import traceback

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

for _finder, module_name, _ispkg in pkgutil.iter_modules(__path__):
    if module_name.startswith("_"):
        continue  # skip __init__, private/helper modules
    try:
        module = importlib.import_module(f".{module_name}", __name__)
    except Exception:
        print(f"[custom_nodes] Failed to import '{module_name}':")
        traceback.print_exc()
        continue

    class_map = getattr(module, "NODE_CLASS_MAPPINGS", None)
    if class_map:
        for key in class_map:
            if key in NODE_CLASS_MAPPINGS:
                print(f"[custom_nodes] WARNING: duplicate node key '{key}' "
                      f"(from '{module_name}') overrides a previous mapping.")
        NODE_CLASS_MAPPINGS.update(class_map)

    display_map = getattr(module, "NODE_DISPLAY_NAME_MAPPINGS", None)
    if display_map:
        NODE_DISPLAY_NAME_MAPPINGS.update(display_map)

print(f"[custom_nodes] Loaded {len(NODE_CLASS_MAPPINGS)} node(s): "
      f"{', '.join(sorted(NODE_CLASS_MAPPINGS)) or '(none)'}")

# Serve front-end extensions from ./web. ComfyUI auto-loads every .js file it
# finds there, so this line covers all current and future nodes in this package.
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
