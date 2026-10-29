# Test-only helper: a fake MODEL source, and a recorder for LoRA application.
import json, os, comfy.sd
LOG = "/tmp/spll_calls.jsonl"
_orig = comfy.sd.load_lora_for_models
def _record(model, clip, lora, sm, sc, lora_metadata=None):
    with open(LOG, "a") as f:
        f.write(json.dumps({"keys": sorted(lora.keys()), "sm": sm, "sc": sc, "clip": clip is not None, "model": model}) + "\n")
    return (model + "+L" if isinstance(model, str) else model, clip)
comfy.sd.load_lora_for_models = _record
class FakeModel:
    @classmethod
    def INPUT_TYPES(cls): return {"required": {}}
    RETURN_TYPES = ("MODEL",); FUNCTION = "go"; CATEGORY = "testing"
    def go(self): return ("base",)
class Sink:
    @classmethod
    def INPUT_TYPES(cls): return {"required": {"model": ("MODEL",)}}
    RETURN_TYPES = (); FUNCTION = "go"; OUTPUT_NODE = True; CATEGORY = "testing"
    def go(self, model):
        with open(LOG, "a") as f: f.write(json.dumps({"final": model}) + "\n")
        return {}
NODE_CLASS_MAPPINGS = {"SPLLFakeModel": FakeModel, "SPLLSink": Sink}
