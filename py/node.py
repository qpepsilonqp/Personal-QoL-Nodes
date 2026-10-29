"""The Super-Power Lora Loader node."""

import json
import logging
import os

import comfy.sd
import comfy.utils

from .paths import PathError, is_lora_file, norm_rel, resolve_base, safe_abs, split_key

log = logging.getLogger("SuperPowerLoraLoader")


class SuperPowerLoraLoader:
    def __init__(self):
        # path -> (mtime, lora_state_dict, metadata); only LoRAs used in the last run are kept
        self._cache: dict[str, tuple] = {}

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "model": ("MODEL",),
                "spll_data": ("SUPER_POWER_LORA", {}),
            },
            "optional": {
                "clip": ("CLIP",),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP")
    RETURN_NAMES = ("MODEL", "CLIP")
    FUNCTION = "apply"
    CATEGORY = "loaders"
    DESCRIPTION = "Apply any number of LoRAs, organised into searchable, collapsible groups."
    SEARCH_ALIASES = ["lora", "power lora loader", "lora stack", "multi lora", "super power"]

    def _load(self, full: str):
        mtime = os.path.getmtime(full)
        hit = self._cache.get(full)
        if hit and hit[0] == mtime:
            return hit[1], hit[2]
        try:
            lora, meta = comfy.utils.load_torch_file(full, safe_load=True, return_metadata=True)
        except TypeError:  # older ComfyUI
            lora, meta = comfy.utils.load_torch_file(full, safe_load=True), None
        self._cache[full] = (mtime, lora, meta)
        return lora, meta

    def apply(self, model, spll_data, clip=None):
        data = spll_data
        if isinstance(data, str):
            try:
                data = json.loads(data)
            except Exception:
                data = {}
        if not isinstance(data, dict):
            data = {}

        multi = isinstance(data.get("bases"), dict)  # phase 4+: LoRAs can come from several loras folders
        if multi:
            if not data.get("setup"):
                raise ValueError("Super-Power Lora Loader: nothing added yet. Add a folder or some LoRAs to the node first.")
            hints = data["bases"]
            resolved: dict[str, str] = {}
        else:
            if data.get("root") is None:
                raise ValueError("Super-Power Lora Loader: no root folder set. Pick a root folder on the node first.")
            base = resolve_base(data.get("base"), data.get("root"))
        used = set()
        for item in data.get("loras", []) or []:
            try:
                if multi:
                    bid, rel = split_key(item.get("path"))
                    if bid not in resolved:
                        hint = hints.get(bid)
                        resolved[bid] = resolve_base(hint if isinstance(hint, str) else None, rel.rsplit("/", 1)[0] if "/" in rel else "")
                    base = resolved[bid]
                else:
                    rel = norm_rel(item.get("path"))
                strength = float(item.get("strength", 1.0))
            except (PathError, TypeError, ValueError, AttributeError) as e:
                raise ValueError(f"Super-Power Lora Loader: invalid LoRA entry {item!r}: {e}")
            if strength == 0:
                continue
            full = safe_abs(base, rel)
            if not is_lora_file(rel) or not os.path.isfile(full):
                raise FileNotFoundError(f"Super-Power Lora Loader: LoRA file missing: {os.path.join(base, rel)}")
            lora, meta = self._load(full)
            used.add(full)
            try:
                model, clip = comfy.sd.load_lora_for_models(model, clip, lora, strength, strength, lora_metadata=meta)
            except TypeError:  # older ComfyUI without lora_metadata
                model, clip = comfy.sd.load_lora_for_models(model, clip, lora, strength, strength)

        for k in list(self._cache):
            if k not in used:
                del self._cache[k]
        return (model, clip)
