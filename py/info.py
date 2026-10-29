"""LoRA info: hashing, Civitai lookups, safetensors metadata and info files.

Info files use rgthree's format and name (<lora file>.rgthree-info.json), so info fetched by either
node is reused by the other. Our own data (nickname, your trigger words, your note) lives in a
separate <lora file>.spll.json, because rgthree's "Clear" deletes its whole info file.
"""

import hashlib
import json
import logging
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from .paths import read_sidecar

log = logging.getLogger("SuperPowerLoraLoader")

INFO_SUFFIX = ".rgthree-info.json"
CIVITAI_API = os.environ.get("SPLL_CIVITAI_API", "https://civitai.com/api/v1")
CIVITAI_DOWNLOAD = os.environ.get("SPLL_CIVITAI_DOWNLOAD", "https://civitai.com/api/download/models")
PREVIEW_IMAGE_EXTS = ["preview.png", "preview.jpg", "preview.jpeg", "preview.webp", "png", "jpg", "jpeg", "webp"]
PREVIEW_VIDEO_EXTS = ["preview.mp4", "preview.webm", "mp4", "webm"]

_hash_cache: dict[str, tuple] = {}  # full path -> (size, mtime, sha256)
_progress: dict[str, dict] = {}  # full path -> {"done": bytes, "total": bytes}
_summary_cache: dict[str, tuple] = {}  # full path -> (key, summary)
_pending: dict[str, dict] = {}  # full path -> info fetched but not yet saved
_lock = threading.Lock()


# ---------------------------------------------------------------- files
def info_path(lora_abs: str) -> str:
    return lora_abs + INFO_SUFFIX


def read_info(lora_abs: str) -> dict | None:
    p = info_path(lora_abs)
    if not os.path.isfile(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def write_info(lora_abs: str, data: dict) -> None:
    p = info_path(lora_abs)
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    os.replace(tmp, p)
    _summary_cache.pop(lora_abs, None)


def delete_info(lora_abs: str) -> bool:
    p = info_path(lora_abs)
    _summary_cache.pop(lora_abs, None)
    _pending.pop(lora_abs, None)
    if os.path.isfile(p):
        os.remove(p)
        return True
    return False


def find_preview(lora_abs: str) -> tuple[str | None, str | None]:
    """(path, kind) of an image or video sitting next to the LoRA with the same name."""
    stem = os.path.splitext(lora_abs)[0]
    for ext in PREVIEW_IMAGE_EXTS:
        p = f"{stem}.{ext}"
        if os.path.isfile(p):
            return p, "image"
    for ext in PREVIEW_VIDEO_EXTS:
        p = f"{stem}.{ext}"
        if os.path.isfile(p):
            return p, "video"
    return None, None


# ---------------------------------------------------------------- hashing
def sha256(lora_abs: str) -> str:
    """SHA256 of the file, cached by size and modified time. Progress is readable via progress()."""
    st = os.stat(lora_abs)
    hit = _hash_cache.get(lora_abs)
    if hit and hit[0] == st.st_size and hit[1] == st.st_mtime:
        return hit[2]
    # an info file that already knows the hash saves re-reading a multi-GB file
    info = read_info(lora_abs)
    if (info and isinstance(info.get("sha256"), str) and len(info["sha256"]) == 64
            and isinstance(info.get("modified"), (int, float)) and abs(info["modified"] / 1000 - st.st_mtime) < 2):
        _hash_cache[lora_abs] = (st.st_size, st.st_mtime, info["sha256"].lower())
        return info["sha256"].lower()
    h = hashlib.sha256()
    done = 0
    _progress[lora_abs] = {"done": 0, "total": st.st_size}
    try:
        with open(lora_abs, "rb") as f:
            while True:
                chunk = f.read(4 * 1024 * 1024)
                if not chunk:
                    break
                h.update(chunk)
                done += len(chunk)
                _progress[lora_abs] = {"done": done, "total": st.st_size}
    finally:
        _progress.pop(lora_abs, None)
    digest = h.hexdigest()
    _hash_cache[lora_abs] = (st.st_size, st.st_mtime, digest)
    return digest


def cached_hash(lora_abs: str) -> str | None:
    """A hash already worked out for this exact file (no reading), or None."""
    hit = _hash_cache.get(lora_abs)
    if not hit:
        return None
    try:
        st = os.stat(lora_abs)
    except OSError:
        return None
    return hit[2] if hit[0] == st.st_size and hit[1] == st.st_mtime else None


def progress(lora_abs: str) -> dict | None:
    return _progress.get(lora_abs)


# ---------------------------------------------------------------- metadata
def read_metadata(lora_abs: str) -> dict:
    """The __metadata__ block of a .safetensors header (training info), with JSON values parsed."""
    if not lora_abs.lower().endswith((".safetensors", ".sft")):
        return {}
    try:
        with open(lora_abs, "rb") as f:
            n = int.from_bytes(f.read(8), "little", signed=False)
            if n <= 0 or n > 100 * 1024 * 1024:
                return {}
            header = json.loads(f.read(n))
    except Exception:
        return {}
    meta = header.get("__metadata__") or {}
    if not isinstance(meta, dict):
        return {}
    out = {}
    for k, v in meta.items():
        if isinstance(v, str) and v[:1] in "{[" and v[-1:] in "}]":
            try:
                v = json.loads(v)
            except Exception:
                pass
        out[k] = v
    return out


# ---------------------------------------------------------------- civitai
def civitai_get(path: str, api_key: str | None = None, timeout: float = 20.0) -> tuple[int, dict | None]:
    """GET a Civitai API path. Returns (status, json). Status 0 means the request didn't get through."""
    url = f"{CIVITAI_API}{path}"
    headers = {"User-Agent": "ComfyUI-SuperPowerLoraLoader", "Accept": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace") or "null")
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8", "replace") or "null")
        except Exception:
            body = None
        return e.code, body
    except Exception as e:
        log.warning("[Super-Power Lora Loader] Civitai request failed: %s", e)
        return 0, {"error": str(e)}


def civitai_link(data: dict) -> str | None:
    mid = data.get("modelId")
    if not mid:
        return None
    link = f"https://civitai.com/models/{mid}"
    if data.get("id"):
        link += f"?modelVersionId={data['id']}"
    return link


# ---------------------------------------------------------------- compiling info (rgthree format)
def _clean_words(words) -> list[str]:
    out = []
    for w in words or []:
        if not isinstance(w, str):
            continue
        for part in re.split(r"\s*,\s*", w):
            part = part.strip()
            if part and part not in out:
                out.append(part)
    return out


def build_info(lora_abs: str, rel: str, digest: str, meta: dict, civ_status: int, civ: dict | None,
               existing: dict | None = None) -> dict:
    """Compile info the way rgthree does, keeping anything an existing file already had."""
    info = dict(existing or {})
    info["file"] = rel
    info["path"] = lora_abs
    try:
        info["modified"] = os.path.getmtime(lora_abs) * 1000
    except OSError:
        pass
    info["sha256"] = digest
    info.setdefault("images", [])
    raw = dict(info.get("raw") or {})
    words: dict[str, dict] = {}
    for w in info.get("trainedWords") or []:
        if isinstance(w, dict) and isinstance(w.get("word"), str):
            words[w["word"]] = dict(w)

    # training tags from the file itself
    if meta:
        raw["metadata"] = meta
        if meta.get("ss_sd_model_name"):
            info["baseModelFile"] = meta["ss_sd_model_name"]
        freq = meta.get("ss_tag_frequency")
        if isinstance(freq, dict):
            counts: dict[str, int] = {}
            for bucket in freq.values():
                if isinstance(bucket, dict):
                    for tag, c in bucket.items():
                        if isinstance(c, (int, float)):
                            counts[tag] = counts.get(tag, 0) + int(c)
            for tag, c in counts.items():
                w = words.setdefault(tag, {"word": tag})
                w["count"] = c
                w["metadata"] = True

    # civitai
    if civ_status == 200 and isinstance(civ, dict) and civ.get("modelId"):
        civ = {**civ, "_sha256": digest, "_civitai_api": f"https://civitai.com/api/v1/model-versions/by-hash/{digest}"}
        raw["civitai"] = civ
        model = civ.get("model") or {}
        name = model.get("name") or ""
        if civ.get("name"):
            name = f"{name} - {civ['name']}" if name else civ["name"]
        info["name"] = name or info.get("name")
        info["type"] = model.get("type") or info.get("type")
        info["baseModel"] = civ.get("baseModel") or info.get("baseModel")
        if civ.get("description"):
            info["description"] = civ["description"]
        for word in _clean_words((civ.get("trainedWords") or []) + (civ.get("triggerWords") or [])):
            words.setdefault(word, {"word": word})["civitai"] = True
        link = civitai_link(civ)
        links = [l for l in (info.get("links") or []) if isinstance(l, str)]
        for l in (link, civ["_civitai_api"]):
            if l and l not in links:
                links.append(l)
        info["links"] = links
        known = {i.get("url") for i in info["images"] if isinstance(i, dict)}
        for img in civ.get("images") or []:
            url = img.get("url")
            if not url or url in known:
                continue
            m = img.get("meta") or {}
            img_id = os.path.splitext(os.path.basename(url))[0]
            info["images"].append({
                "url": url,
                "civitaiUrl": f"https://civitai.com/images/{img_id}",
                "width": img.get("width"),
                "height": img.get("height"),
                "type": img.get("type"),
                "nsfwLevel": img.get("nsfwLevel"),
                "seed": m.get("seed"),
                "positive": m.get("prompt"),
                "negative": m.get("negativePrompt"),
                "steps": m.get("steps"),
                "sampler": m.get("sampler"),
                "cfg": m.get("cfgScale"),
                "model": m.get("Model"),
                "resources": m.get("resources"),
            })
        raw.pop("civitaiError", None)
    elif civ_status == 404:
        raw["civitai"] = {"error": "Model not found", "_sha256": digest}
    elif civ_status:
        raw["civitaiError"] = f"Civitai answered {civ_status}"
    else:
        raw["civitaiError"] = (civ or {}).get("error") or "Couldn't reach Civitai"

    info["raw"] = raw
    info["trainedWords"] = sorted(words.values(), key=lambda w: w.get("count", 99999), reverse=True)
    return info


def civitai_triggers(info: dict | None) -> list[str]:
    """Trigger words that count for the T button: Civitai's, plus any rgthree marked as user-added."""
    if not info:
        return []
    out = []
    for w in info.get("trainedWords") or []:
        if isinstance(w, dict) and (w.get("civitai") or w.get("user")) and isinstance(w.get("word"), str):
            if w["word"] not in out:
                out.append(w["word"])
    return out


def ids_of(info: dict | None) -> dict:
    civ = ((info or {}).get("raw") or {}).get("civitai") or {}
    out = {}
    if (info or {}).get("sha256"):
        out["h"] = info["sha256"]
    if isinstance(civ, dict) and civ.get("modelId"):
        out["m"] = civ.get("modelId")
        if civ.get("id"):
            out["v"] = civ.get("id")
    return out


def summary(lora_abs: str) -> dict:
    """Small per-LoRA state for the list: whether info exists, trigger words, Civitai ids. Cached by file times."""
    ip = info_path(lora_abs)
    sp = lora_abs + ".spll.json"
    try:
        key = (os.path.getmtime(ip) if os.path.exists(ip) else 0, os.path.getmtime(sp) if os.path.exists(sp) else 0)
    except OSError:
        key = (0, 0)
    hit = _summary_cache.get(lora_abs)
    if hit and hit[0] == key:
        return hit[1]
    info = read_info(lora_abs) if key[0] else None
    side = read_sidecar(lora_abs) if key[1] else None
    trig = civitai_triggers(info)
    for w in (side or {}).get("triggers") or []:
        if isinstance(w, str) and w.strip() and w.strip() not in trig:
            trig.append(w.strip())
    raw = (info or {}).get("raw") or {}
    s = {
        "info": bool(info),
        "trig": trig,
        # saved info that never got an answer from Civitai (e.g. saved by rgthree while Civitai was blocked)
        "unchecked": bool(info) and ("civitai" not in raw or bool(raw.get("civitaiError"))),
        "noTrig": bool((side or {}).get("noTrigger")),
        **ids_of(info),
    }
    _summary_cache[lora_abs] = (key, s)
    return s


def set_pending(lora_abs: str, info: dict) -> None:
    _pending[lora_abs] = info


def pop_pending(lora_abs: str) -> dict | None:
    return _pending.pop(lora_abs, None)


def get_pending(lora_abs: str) -> dict | None:
    return _pending.get(lora_abs)


def lookup_state(info: dict | None) -> str:
    """'ok' (found on Civitai), 'notfound' (Civitai says it doesn't have it) or 'failed' (no answer)."""
    raw = (info or {}).get("raw") or {}
    if raw.get("civitaiError"):
        return "failed"
    civ = raw.get("civitai")
    if isinstance(civ, dict) and civ.get("modelId"):
        return "ok"
    if isinstance(civ, dict) and civ.get("error"):
        return "notfound"
    return "failed"


# ---------------------------------------------------------------- downloads
def download(version_id: int, dest: str, api_key: str | None, expect_sha256: str | None = None) -> dict:
    """Download a model version from Civitai to dest (via dest.part), checking its hash when known."""
    url = f"{CIVITAI_DOWNLOAD}/{int(version_id)}"
    if api_key:
        url += f"?token={urllib.parse.quote(api_key)}"
    req = urllib.request.Request(url, headers={"User-Agent": "ComfyUI-SuperPowerLoraLoader"})
    part = dest + ".part"
    h = hashlib.sha256()
    done = 0
    _progress[dest] = {"done": 0, "total": 0}
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            ctype = (r.headers.get("Content-Type") or "").lower()
            if "text/html" in ctype or "application/json" in ctype:
                body = r.read(2000).decode("utf-8", "replace")
                raise RuntimeError("Civitai didn't send a file. The model may need an API key, or be unavailable." if "html" in ctype else body[:300])
            total = int(r.headers.get("Content-Length") or 0)
            with open(part, "wb") as f:
                while True:
                    chunk = r.read(4 * 1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    h.update(chunk)
                    done += len(chunk)
                    _progress[dest] = {"done": done, "total": total}
        digest = h.hexdigest()
        if expect_sha256 and digest.lower() != expect_sha256.lower():
            raise RuntimeError("The downloaded file doesn't match the LoRA this workflow used (different hash), so it wasn't kept.")
        if os.path.exists(dest):
            raise RuntimeError("A file already exists at that path.")
        os.replace(part, dest)
        st = os.stat(dest)
        _hash_cache[dest] = (st.st_size, st.st_mtime, digest)
        return {"size": done, "sha256": digest}
    except urllib.error.HTTPError as e:
        raise RuntimeError("Civitai needs an API key for this download." if e.code in (401, 403) else f"Civitai answered {e.code}.")
    except urllib.error.URLError as e:
        raise RuntimeError(f"Couldn't reach Civitai ({e.reason}). If it's blocked where you are, turn on your VPN and try again.")
    finally:
        _progress.pop(dest, None)
        if os.path.exists(part):
            try:
                os.remove(part)
            except OSError:
                pass
