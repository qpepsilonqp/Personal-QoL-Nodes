"""A tiny stand-in for the Civitai API, for testing only."""
import json
import os
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
PORT = 8899
IMG = f"http://127.0.0.1:{PORT}/img"
LOG = os.path.join(HERE, "requests.log")

ANIME = {
    "id": 501, "modelId": 101, "name": "v2.0", "baseModel": "SDXL 1.0",
    "trainedWords": ["anime style, soft lighting"],
    "description": "<p>A soft anime look.</p>",
    "model": {"name": "Soft Anime", "type": "LORA", "nsfw": False},
    "files": [{"name": "anime_soft.safetensors", "sizeKB": 1, "primary": True, "downloadUrl": "https://civitai.com/api/download/models/501"}],
    "images": [
        {"url": f"{IMG}/ex1.png", "width": 512, "height": 768, "type": "image", "nsfwLevel": 1,
         "meta": {"prompt": "anime style, soft lighting, 1girl, garden", "negativePrompt": "lowres", "seed": 1234, "steps": 28, "sampler": "Euler a", "cfgScale": 6, "Model": "sdxl_base"}},
        {"url": f"{IMG}/vid1.mp4", "width": 320, "height": 480, "type": "video", "nsfwLevel": 1, "meta": {"prompt": "anime style, walking"}},
        {"url": f"{IMG}/ex2.png", "width": 512, "height": 768, "type": "image", "nsfwLevel": 4,
         "meta": {"prompt": "anime style, beach", "seed": 99, "steps": 30, "sampler": "DPM++ 2M", "cfgScale": 5}},
    ],
}
OIL = {
    "id": 777, "modelId": 303, "name": "v1", "baseModel": "SD 1.5", "trainedWords": [],
    "model": {"name": "Oil Paint", "type": "LORA"},
    "files": [{"name": "oil_v2.safetensors", "primary": True}],
    "images": [{"url": f"{IMG}/ex3.png", "width": 512, "height": 768, "type": "image", "nsfwLevel": 1, "meta": {"prompt": "oil painting of a harbour"}}],
}
DELETED = {  # a LoRA that's missing on disk, looked up by version id
    "id": 888, "modelId": 404, "name": "v3", "baseModel": "Flux.1 D", "trainedWords": ["deleted trigger"],
    "model": {"name": "Deleted One", "type": "LORA"},
    "files": [{"name": "deleted_one.safetensors", "sizeKB": 147456, "primary": True}],
    "images": [{"url": f"{IMG}/ex2.png", "type": "image", "nsfwLevel": 1}],
}
BY_HASH = {
    "8923c29a85d393c70abd98b01d60e4e9bb3f65f16d5713dc8eb6ebd55d3a1f3b": ANIME,
    "0e8eea5f10c5cac485302e847a872f1d07bf649ba2010e048bb293d40747c977": OIL,
}
BY_ID = {501: ANIME, 777: OIL, 888: DELETED}


class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=HERE, **k)

    def log_message(self, *a):
        pass

    def _json(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        with open(LOG, "a") as f:
            f.write(f"{self.path} auth={self.headers.get('Authorization')}\n")
        if os.path.exists(os.path.join(HERE, "OFFLINE")):
            # behave like Civitai being blocked: drop the connection
            self.close_connection = True
            return
        p = self.path.split("?")[0]
        if p.startswith("/api/download/models/"):
            vid = p.rsplit("/", 1)[1]
            fp = os.path.join(HERE, f"dl{vid}.safetensors")
            if not os.path.exists(fp):
                return self._json(404, {"error": "not found"})
            data = open(fp, "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if p.startswith("/api/v1/model-versions/by-hash/"):
            h = p.rsplit("/", 1)[1].lower()
            return self._json(200, BY_HASH[h]) if h in BY_HASH else self._json(404, {"error": "Model not found"})
        if p.startswith("/api/v1/model-versions/"):
            try:
                i = int(p.rsplit("/", 1)[1])
            except ValueError:
                return self._json(400, {"error": "bad id"})
            return self._json(200, BY_ID[i]) if i in BY_ID else self._json(404, {"error": "Model not found"})
        return super().do_GET()


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
