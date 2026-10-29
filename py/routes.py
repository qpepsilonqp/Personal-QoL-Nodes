"""API routes used by the Super-Power Lora Loader frontend.

Every path is resolved inside one of ComfyUI's existing folders named 'loras' (see paths.py).
"""

import asyncio
import logging
import os

from aiohttp import web
from server import PromptServer

from . import info as infomod
from .paths import (PathError, is_lora_file, lora_bases, lora_entry, norm_rel, read_sidecar,
                    resolve_base, safe_abs, split_key, walk, write_sidecar)

routes = PromptServer.instance.routes
log = logging.getLogger("SuperPowerLoraLoader")


def _err(msg: str, status: int = 400):
    return web.json_response({"error": msg}, status=status)


@routes.get("/spll/tree")
async def tree(request):
    """Every loras folder with its subfolders and LoRA files, for the root picker."""
    out = []
    for base in lora_bases():
        try:
            folders, loras = walk(base, "", with_sidecars=False)
        except PathError:
            continue
        counts: dict[str, int] = {}
        for l in loras or []:
            d = l["path"].rsplit("/", 1)[0] if "/" in l["path"] else ""
            parts = d.split("/") if d else []
            for i in range(len(parts) + 1):
                key = "/".join(parts[:i])
                counts[key] = counts.get(key, 0) + 1
        out.append({
            "path": base,
            "sep": os.sep,
            "folders": [{"path": f, "count": counts.get(f, 0)} for f in (folders or [])],
            "files": [l["path"] for l in (loras or [])],
        })
    if not out:
        return _err("ComfyUI has no existing LoRA folder named 'loras'. Check your models folder and extra_model_paths.yaml.", 404)
    return web.json_response({"bases": out})


@routes.get("/spll/scan")
async def scan(request):
    """Folders and LoRAs under a root."""
    try:
        root = norm_rel(request.query.get("root", ""))
        base = resolve_base(request.query.get("base"), root)
    except PathError as e:
        return _err(str(e))

    def work():
        folders, loras = walk(base, root)
        for l in loras or []:
            # info-file state, trigger words and Civitai ids, for the i and T buttons
            full = os.path.join(base, *l["path"].split("/"))
            l["s"] = infomod.summary(full)
            if "h" not in l["s"]:
                h = infomod.cached_hash(full)  # e.g. just downloaded, or hashed to spot a rename
                if h:
                    l["s"] = {**l["s"], "h": h}
        return folders, loras

    try:
        folders, loras = await asyncio.to_thread(work)
    except PathError as e:
        return _err(str(e))
    common = {"base": base, "sep": os.sep, "root": root}
    if folders is None:
        return web.json_response({**common, "rootExists": False, "folders": [], "loras": []})
    return web.json_response({**common, "rootExists": True, "folders": folders, "loras": loras})


def _with_summary(base, entry):
    full = os.path.join(base, *entry["path"].split("/"))
    entry["s"] = infomod.summary(full)
    if "h" not in entry["s"]:
        h = infomod.cached_hash(full)  # e.g. just downloaded, or hashed to spot a rename
        if h:
            entry["s"] = {**entry["s"], "h": h}
    return entry


def resolve_bases(hints: dict, samples: dict) -> dict:
    """Map each of a node's loras-folder ids to one of ComfyUI's loras folders on this machine."""
    out = {}
    for bid, hint in (hints or {}).items():
        if not isinstance(bid, str):
            continue
        try:
            out[bid] = resolve_base(hint if isinstance(hint, str) else None, samples.get(bid))
        except PathError:
            out[bid] = None
    return out


@routes.post("/spll/sources")
async def sources(request):
    """Everything a node loads: its added folders (walked) and its individually added LoRAs.

    Body: {"bases": {id: last known full path}, "folders": ["b1:styles", ...], "loras": ["b1:x.safetensors", ...]}
    Paths come back as keys ("b1:styles/a.safetensors").
    """
    body = await request.json()
    folders_in = [f for f in (body.get("folders") or [])[:500] if isinstance(f, str)]
    loras_in = [l for l in (body.get("loras") or [])[:5000] if isinstance(l, str)]
    samples: dict[str, str] = {}
    parsed_f, parsed_l = [], []
    for k in folders_in:
        try:
            bid, rel = split_key(k)
            parsed_f.append((k, bid, rel))
            samples.setdefault(bid, rel)
        except PathError:
            pass
    for k in loras_in:
        try:
            bid, rel = split_key(k)
            parsed_l.append((k, bid, rel))
            samples.setdefault(bid, rel.rsplit("/", 1)[0] if "/" in rel else "")
        except PathError:
            pass
    bases = resolve_bases(body.get("bases") or {}, samples)

    def work():
        folders_out, loras_out = {}, {}
        for k, bid, rel in parsed_f:
            base = bases.get(bid)
            if not base:
                folders_out[k] = {"exists": False, "folders": [], "loras": []}
                continue
            subs, loras = walk(base, rel)
            if subs is None:
                folders_out[k] = {"exists": False, "folders": [], "loras": []}
                continue
            folders_out[k] = {
                "exists": True,
                "folders": [f"{bid}:{f}" for f in subs],
                "loras": [{**_with_summary(base, l), "path": f"{bid}:{l['path']}"} for l in loras],
            }
        for k, bid, rel in parsed_l:
            base = bases.get(bid)
            e = lora_entry(base, rel) if base else None
            loras_out[k] = {**_with_summary(base, e), "path": k} if e else None
        return folders_out, loras_out

    try:
        folders_out, loras_out = await asyncio.to_thread(work)
    except PathError as e:
        return _err(str(e))
    return web.json_response({
        "sep": os.sep,
        "bases": {bid: b for bid, b in bases.items()},
        "folders": folders_out,
        "loras": loras_out,
    })


@routes.post("/spll/exists")
async def exists(request):
    """Which of the given folders exist."""
    body = await request.json()
    try:
        base = resolve_base(body.get("base"), body.get("root"))
    except PathError as e:
        return _err(str(e))
    out = {}
    for f in body.get("folders", [])[:5000]:
        try:
            out[norm_rel(f)] = os.path.isdir(safe_abs(base, f))
        except PathError:
            out[str(f)] = False
    return web.json_response({"base": base, "exists": out})


@routes.post("/spll/mkdirs")
async def mkdirs(request):
    """Create folders inside an existing loras folder. Only called after the user confirmed in the UI."""
    body = await request.json()
    try:
        base = resolve_base(body.get("base"), body.get("root"), strict=True)
    except PathError as e:
        return _err(str(e))
    created, failed = [], []
    for f in body.get("folders", [])[:1000]:
        try:
            rel = norm_rel(f)
            if not rel:
                continue  # the loras folder itself is never created
            full = safe_abs(base, rel)
            if not os.path.isdir(full):
                os.makedirs(full, exist_ok=True)
                created.append(rel)
        except PathError as e:
            failed.append({"folder": str(f), "error": str(e)})
        except OSError as e:
            failed.append({"folder": str(f), "error": e.strerror or str(e)})
    if created:
        log.info("[Super-Power Lora Loader] Created folders in %s: %s", base, ", ".join(created))
    return web.json_response({"base": base, "created": created, "failed": failed})


@routes.post("/spll/nickname")
async def set_nickname(request):
    """Save (or clear) a LoRA's nickname in its sidecar file. Only called after the user confirmed in the UI."""
    body = await request.json()
    try:
        rel = norm_rel(body.get("path"))
        base = resolve_base(body.get("base"), body.get("root"), strict=True)
        full = safe_abs(base, rel)
    except PathError as e:
        return _err(str(e))
    if not rel or not is_lora_file(rel) or not os.path.isfile(full):
        return _err("LoRA file not found.", 404)
    nickname = body.get("nickname")
    nickname = nickname.strip()[:200] if isinstance(nickname, str) else ""
    data = read_sidecar(full) or {}
    if nickname:
        data["nickname"] = nickname
    else:
        data.pop("nickname", None)
    try:
        write_sidecar(full, data)
    except OSError as e:
        return _err(f"Couldn't write next to the LoRA: {e.strerror or e}", 500)
    return web.json_response({"path": rel, "nickname": nickname or None})


# ---------------------------------------------------------------- LoRA info (phase 2)
def _lora(body_or_query, strict=False):
    """Resolve (base, rel, full path) for an existing LoRA file, or raise PathError."""
    rel = norm_rel(body_or_query.get("path"))
    base = resolve_base(body_or_query.get("base"), body_or_query.get("root"), strict=strict)
    full = safe_abs(base, rel)
    if not rel or not is_lora_file(rel) or not os.path.isfile(full):
        raise PathError("LoRA file not found.")
    return base, rel, full


def _info_payload(base, rel, full):
    saved = infomod.read_info(full)
    pending = infomod.get_pending(full)
    preview, kind = infomod.find_preview(full)
    side = read_sidecar(full)
    return {
        "path": rel,
        "base": base,
        "full": full,
        "saved": saved is not None,
        "info": pending or saved,
        "unsaved": pending is not None,
        "side": side or {},
        "hasSidecar": side is not None,
        "preview": kind,
        "summary": infomod.summary(full),
        "lookup": infomod.lookup_state(pending or saved) if (pending or saved) else None,
    }


@routes.get("/spll/info")
async def get_info(request):
    """Everything known about a LoRA without touching the network: saved info file, unsaved fetch, sidecar."""
    try:
        base, rel, full = _lora(request.query)
    except PathError as e:
        return _err(str(e), 404)
    return web.json_response(_info_payload(base, rel, full))


@routes.post("/spll/fetch")
async def fetch_info(request):
    """Hash the LoRA, read its metadata and look it up on Civitai. Nothing is written; see /spll/saveinfo."""
    body = await request.json()
    try:
        base, rel, full = _lora(body)
    except PathError as e:
        return _err(str(e), 404)
    api_key = body.get("apiKey") if isinstance(body.get("apiKey"), str) else None

    def work():
        digest = infomod.sha256(full)
        meta = infomod.read_metadata(full)
        status, civ = infomod.civitai_get(f"/model-versions/by-hash/{digest}", api_key)
        existing = infomod.read_info(full)
        return infomod.build_info(full, rel, digest, meta, status, civ, existing)

    try:
        info = await asyncio.to_thread(work)
    except OSError as e:
        return _err(f"Couldn't read the LoRA: {e.strerror or e}", 500)
    state = infomod.lookup_state(info)
    if state == "failed":
        # Civitai didn't answer: show what we have, but never offer it for saving
        payload = _info_payload(base, rel, full)
        payload.update({"info": info, "unsaved": True, "lookup": "failed",
                        "lookupError": (info.get("raw") or {}).get("civitaiError") or "Couldn't reach Civitai"})
        return web.json_response(payload)
    infomod.set_pending(full, info)
    return web.json_response(_info_payload(base, rel, full))


@routes.get("/spll/progress")
async def hash_progress(request):
    try:
        _, _, full = _lora(request.query)
    except PathError as e:
        return _err(str(e), 404)
    return web.json_response({"progress": infomod.progress(full)})


@routes.post("/spll/saveinfo")
async def save_info(request):
    """Write the last fetched info next to the LoRA. Only called after the user confirmed in the UI."""
    body = await request.json()
    try:
        base, rel, full = _lora(body, strict=True)
    except PathError as e:
        return _err(str(e))
    pending = infomod.pop_pending(full)
    if not pending:
        return _err("Nothing to save; fetch the info first.")
    try:
        infomod.write_info(full, pending)
    except OSError as e:
        infomod.set_pending(full, pending)
        return _err(f"Couldn't write next to the LoRA: {e.strerror or e}", 500)
    return web.json_response(_info_payload(base, rel, full))


@routes.post("/spll/clearinfo")
async def clear_info(request):
    """Delete the saved info file (nickname, your triggers and notes are kept). Only after confirmation."""
    body = await request.json()
    try:
        base, rel, full = _lora(body, strict=True)
    except PathError as e:
        return _err(str(e))
    try:
        infomod.delete_info(full)
    except OSError as e:
        return _err(f"Couldn't delete the info file: {e.strerror or e}", 500)
    return web.json_response(_info_payload(base, rel, full))


@routes.post("/spll/side")
async def set_side(request):
    """Update the LoRA's own data file (nickname, your trigger words, your note). Only after confirmation."""
    body = await request.json()
    try:
        base, rel, full = _lora(body, strict=True)
    except PathError as e:
        return _err(str(e))
    data = read_sidecar(full) or {}
    if "nickname" in body:
        nick = body["nickname"].strip()[:200] if isinstance(body["nickname"], str) else ""
        if nick:
            data["nickname"] = nick
        else:
            data.pop("nickname", None)
    if "triggers" in body:
        words = []
        for w in body["triggers"] if isinstance(body["triggers"], list) else []:
            if isinstance(w, str):
                for part in w.split(","):
                    part = part.strip()[:200]
                    if part and part not in words:
                        words.append(part)
        if words:
            data["triggers"] = words[:200]
        else:
            data.pop("triggers", None)
    if "noTrigger" in body:
        if body["noTrigger"]:
            data["noTrigger"] = True
        else:
            data.pop("noTrigger", None)
    if "note" in body:
        note = body["note"][:20000] if isinstance(body["note"], str) else ""
        if note.strip():
            data["note"] = note
        else:
            data.pop("note", None)
    try:
        write_sidecar(full, data)
    except OSError as e:
        return _err(f"Couldn't write next to the LoRA: {e.strerror or e}", 500)
    return web.json_response(_info_payload(base, rel, full))


@routes.get("/spll/preview")
async def preview(request):
    """An image or video sitting next to the LoRA with the same name."""
    try:
        _, _, full = _lora(request.query)
    except PathError as e:
        return _err(str(e), 404)
    p, _ = infomod.find_preview(full)
    if not p:
        return _err("No preview next to this LoRA.", 404)
    return web.FileResponse(p)


@routes.post("/spll/lookup")
async def lookup(request):
    """Civitai details for a LoRA that isn't on disk, from its saved version id or hash."""
    body = await request.json()
    api_key = body.get("apiKey") if isinstance(body.get("apiKey"), str) else None
    vid = body.get("versionId")
    h = body.get("hash")
    if isinstance(vid, int) or (isinstance(vid, str) and vid.isdigit()):
        path = f"/model-versions/{int(vid)}"
    elif isinstance(h, str) and len(h) == 64 and all(c in "0123456789abcdefABCDEF" for c in h):
        path = f"/model-versions/by-hash/{h}"
    else:
        return _err("No Civitai id or hash saved for this LoRA.")
    status, civ = await asyncio.to_thread(infomod.civitai_get, path, api_key)
    if status != 200 or not isinstance(civ, dict):
        msg = "Not found on Civitai." if status == 404 else ((civ or {}).get("error") or f"Civitai answered {status}")
        return web.json_response({"found": False, "error": msg})
    model = civ.get("model") or {}
    files = [f for f in civ.get("files") or [] if isinstance(f, dict)]
    primary = next((f for f in files if f.get("primary")), files[0] if files else {})
    return web.json_response({
        "found": True,
        "name": " - ".join(x for x in (model.get("name"), civ.get("name")) if x),
        "type": model.get("type"),
        "baseModel": civ.get("baseModel"),
        "link": infomod.civitai_link(civ),
        "fileName": primary.get("name"),
        "sizeKB": primary.get("sizeKB"),
        "triggers": infomod._clean_words(civ.get("trainedWords") or []),
        "images": [{"url": i.get("url"), "type": i.get("type"), "nsfwLevel": i.get("nsfwLevel")} for i in (civ.get("images") or [])[:8] if i.get("url")],
    })


@routes.post("/spll/side-bulk")
async def set_side_bulk(request):
    """Mark many LoRAs as having no trigger words ("No Trigger All"). Only after one confirmation in the UI."""
    body = await request.json()
    try:
        base = resolve_base(body.get("base"), body.get("root"), strict=True)
    except PathError as e:
        return _err(str(e))
    flag = bool(body.get("noTrigger", True))
    done, failed = [], []
    for p in (body.get("paths") or [])[:5000]:
        try:
            rel = norm_rel(p)
            full = safe_abs(base, rel)
            if not rel or not is_lora_file(rel) or not os.path.isfile(full):
                raise PathError("LoRA file not found.")
            data = read_sidecar(full) or {}
            if flag:
                data["noTrigger"] = True
            else:
                data.pop("noTrigger", None)
            write_sidecar(full, data)
            done.append(rel)
        except (PathError, OSError) as e:
            failed.append({"path": str(p), "error": str(e)})
    return web.json_response({"done": done, "failed": failed,
                              "summaries": {r: infomod.summary(safe_abs(base, r)) for r in done}})


@routes.post("/spll/hashes")
async def hashes(request):
    """SHA256 of a few LoRAs (used to recognise renamed or moved files)."""
    body = await request.json()
    try:
        base = resolve_base(body.get("base"), body.get("root"))
    except PathError as e:
        return _err(str(e))

    def work():
        out = {}
        for p in (body.get("paths") or [])[:50]:
            try:
                rel = norm_rel(p)
                full = safe_abs(base, rel)
                if rel and is_lora_file(rel) and os.path.isfile(full):
                    out[rel] = infomod.sha256(full)
            except (PathError, OSError):
                pass
        return out

    return web.json_response({"hashes": await asyncio.to_thread(work)})


@routes.post("/spll/download")
async def download(request):
    """Download a missing LoRA from Civitai to where the workflow expects it. Only after confirmation in the UI."""
    body = await request.json()
    try:
        rel = norm_rel(body.get("path"))
        base = resolve_base(body.get("base"), body.get("root"), strict=True)
        dest = safe_abs(base, rel)
    except PathError as e:
        return _err(str(e))
    if not rel.lower().endswith(".safetensors"):
        return _err("Only .safetensors files are downloaded.")
    if os.path.exists(dest):
        return _err("A file already exists at that path.")
    vid = body.get("versionId")
    if not (isinstance(vid, int) or (isinstance(vid, str) and vid.isdigit())):
        return _err("No Civitai version id saved for this LoRA.")
    folder = os.path.dirname(dest)
    if not os.path.isdir(folder):
        if not body.get("createFolder"):
            return _err("The folder for this LoRA doesn't exist.")
        os.makedirs(folder, exist_ok=True)
    expect = body.get("hash") if isinstance(body.get("hash"), str) and len(body.get("hash")) == 64 else None
    api_key = body.get("apiKey") if isinstance(body.get("apiKey"), str) else None
    try:
        result = await asyncio.to_thread(infomod.download, int(vid), dest, api_key, expect)
    except RuntimeError as e:
        return _err(str(e), 502)
    except OSError as e:
        return _err(f"Couldn't write the file: {e.strerror or e}", 500)
    log.info("[Super-Power Lora Loader] Downloaded %s (%s bytes)", dest, result["size"])
    return web.json_response({"path": rel, **result})


@routes.get("/spll/dlprogress")
async def dl_progress(request):
    try:
        rel = norm_rel(request.query.get("path"))
        base = resolve_base(request.query.get("base"), request.query.get("root"))
        dest = safe_abs(base, rel)
    except PathError as e:
        return _err(str(e))
    return web.json_response({"progress": infomod.progress(dest)})
