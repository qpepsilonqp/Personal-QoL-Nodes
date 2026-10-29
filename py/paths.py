"""Path handling.

The node works inside "bases": LoRA folders ComfyUI is configured to use (the normal
models/loras plus any from extra_model_paths.yaml) that already exist and are named "loras".
Everything the node reads or writes must stay inside one of those. A base is never created.
"""

import json
import os

import folder_paths

SIDECAR_SUFFIX = ".spll.json"
LORA_EXTENSIONS = {".safetensors", ".sft", ".ckpt", ".pt", ".pth", ".bin"}


class PathError(ValueError):
    pass


def lora_bases() -> list[str]:
    """Every existing LoRA search path named 'loras', in ComfyUI's order, without duplicates."""
    out: list[str] = []
    seen: set[str] = set()
    try:
        paths = folder_paths.get_folder_paths("loras")
    except Exception:
        paths = []
    for p in paths:
        full = os.path.normpath(os.path.abspath(p))
        if os.path.basename(full).lower() != "loras" or not os.path.isdir(full):
            continue
        key = os.path.normcase(os.path.realpath(full))
        if key in seen:
            continue
        seen.add(key)
        out.append(full)
    return out


def norm_rel(rel) -> str:
    """Normalise a path relative to a loras folder, rejecting anything that could escape it.

    Returns forward-slash form, '' for the loras folder itself.
    """
    if rel is None:
        return ""
    if not isinstance(rel, str):
        raise PathError("Path must be text.")
    if "\x00" in rel:
        raise PathError("Invalid path.")
    rel = rel.replace("\\", "/").strip()
    if rel.startswith("/") or (len(rel) > 1 and rel[1] == ":"):
        raise PathError(f"Absolute paths are not allowed: {rel}")
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    for p in parts:
        if p == ".." or ":" in p:
            raise PathError(f"Path leaves the loras folder: {rel}")
    return "/".join(parts)


def resolve_base(hint=None, root=None, strict=False) -> str:
    """Pick the loras folder a node works in.

    1. The folder the workflow last used (hint), if it's still one of ComfyUI's loras folders.
    2. Otherwise the first loras folder that contains the root subfolder (workflows moved between machines).
    3. Otherwise the first loras folder.
    With strict=True only an exact match is accepted (used for anything that writes).
    Only ever returns one of lora_bases(), never an arbitrary path from the client.
    """
    bases = lora_bases()
    if not bases:
        raise PathError("ComfyUI has no existing LoRA folder named 'loras'.")
    if isinstance(hint, str) and hint.strip():
        h = os.path.normcase(os.path.normpath(hint.strip()))
        for b in bases:
            if os.path.normcase(b) == h:
                return b
    if strict:
        # anything that writes to disk must name one of the loras folders exactly
        raise PathError("That folder isn't one of ComfyUI's loras folders.")
    try:
        r = norm_rel(root) if root else ""
    except PathError:
        r = ""
    if r:
        for b in bases:
            if os.path.isdir(os.path.join(b, *r.split("/"))):
                return b
    return bases[0]


def safe_abs(base: str, rel) -> str:
    """Absolute path for a relative path, guaranteed to sit inside the given loras folder.

    Symlinked subfolders are allowed (the check is on the path as written, after '..' is rejected).
    """
    if base not in lora_bases():
        raise PathError("Not one of ComfyUI's loras folders.")
    rel = norm_rel(rel)
    full = os.path.normpath(os.path.join(base, *rel.split("/"))) if rel else base
    if full != base and not full.startswith(base + os.sep):
        raise PathError(f"Path leaves the loras folder: {rel}")
    return full


def is_lora_file(name: str) -> bool:
    return os.path.splitext(name)[1].lower() in LORA_EXTENSIONS


def sidecar_path(lora_abs: str) -> str:
    return lora_abs + SIDECAR_SUFFIX


def read_sidecar(lora_abs: str) -> dict | None:
    p = sidecar_path(lora_abs)
    if not os.path.isfile(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def write_sidecar(lora_abs: str, data: dict) -> None:
    p = sidecar_path(lora_abs)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, p)


def walk(base: str, root_rel: str, with_sidecars: bool = True):
    """(folders, loras) under a root inside a loras folder, as paths relative to that loras folder.

    Returns (None, None) if the root doesn't exist.
    """
    root_abs = safe_abs(base, root_rel)
    folders: list[str] = []
    loras: list[dict] = []
    if not os.path.isdir(root_abs):
        return None, None
    for dirpath, dirnames, filenames in os.walk(root_abs, followlinks=True):
        dirnames[:] = sorted((d for d in dirnames if not d.startswith(".")), key=str.lower)
        rel_dir = os.path.relpath(dirpath, base).replace(os.sep, "/")
        rel_dir = "" if rel_dir == "." else rel_dir
        folders.append(rel_dir)
        for fn in sorted(filenames, key=str.lower):
            if fn.startswith(".") or not is_lora_file(fn):
                continue
            rel = f"{rel_dir}/{fn}" if rel_dir else fn
            entry = {"path": rel}
            try:
                st = os.stat(os.path.join(dirpath, fn))
                entry["z"] = st.st_size
                entry["t"] = int(st.st_mtime)  # for the Newest / Oldest file sorts
            except OSError:
                pass
            if with_sidecars:
                side = read_sidecar(os.path.join(dirpath, fn))
                entry["hasSidecar"] = side is not None
                if side and isinstance(side.get("nickname"), str) and side["nickname"].strip():
                    entry["nickname"] = side["nickname"].strip()
            loras.append(entry)
    return folders, loras


def lora_entry(base: str, rel: str) -> dict | None:
    """The same entry walk() makes, for one LoRA file (None if it isn't there)."""
    full = safe_abs(base, rel)
    if not rel or not is_lora_file(rel) or not os.path.isfile(full):
        return None
    entry = {"path": rel}
    try:
        st = os.stat(full)
        entry["z"] = st.st_size
        entry["t"] = int(st.st_mtime)
    except OSError:
        pass
    side = read_sidecar(full)
    entry["hasSidecar"] = side is not None
    if side and isinstance(side.get("nickname"), str) and side["nickname"].strip():
        entry["nickname"] = side["nickname"].strip()
    return entry


def split_key(key) -> tuple[str, str]:
    """'b1:styles/x.safetensors' -> ('b1', 'styles/x.safetensors'). Keys name which loras folder a path is in."""
    if not isinstance(key, str) or ":" not in key:
        raise PathError(f"Invalid LoRA reference: {key!r}")
    bid, rel = key.split(":", 1)
    if not bid or len(bid) > 16 or not bid.replace("_", "").isalnum():
        raise PathError(f"Invalid LoRA reference: {key!r}")
    return bid, norm_rel(rel)
