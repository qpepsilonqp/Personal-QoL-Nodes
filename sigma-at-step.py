"""
SigmaAtStep — ComfyUI custom node
-----------------------------------
Takes a SIGMAS tensor (e.g. from Flux2Scheduler) and returns the sigma value
at a given step index.

This is the step-indexed sibling of SigmaAtPercent: instead of "80% of the
way through", you ask for "the sigma at step N" directly.

Indexing: a SIGMAS tensor has shape [steps + 1]. Index 0 is the starting
sigma; the final index is the terminal 0.0. So a 30-step schedule has valid
indices 0..30 (31 values), where 30 is the terminal zero.

Install: drop this file into ComfyUI/custom_nodes/ (the package __init__.py
will auto-register it).
"""


class SigmaAtStep:
    """
    Extracts the sigma value at a specific step index in the denoising schedule.

    Example: a 30-step schedule → indices 0..30. step 24 → sigma ≈ 0.4410
    The index is clamped to the valid range of the incoming SIGMAS tensor,
    so it can never go out of bounds regardless of step count.
    """

    CATEGORY = "sampling/custom_sampling/schedulers"
    RETURN_TYPES = ("FLOAT",)
    RETURN_NAMES = ("sigma",)
    FUNCTION = "get_sigma"

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "sigmas": ("SIGMAS",),
                "step": (
                    "INT",
                    {
                        "default": 0,
                        "min": 0,
                        "max": 0xFFFFFFFF,
                        "step": 1,
                        "display": "number",
                        "tooltip": "Step index into the SIGMAS tensor. 0 = start; "
                                   "the final index is the terminal 0.0. Clamped "
                                   "to the schedule length.",
                    },
                ),
            }
        }

    def get_sigma(self, sigmas, step: int):
        # sigmas tensor has shape [steps + 1]; the last entry is the terminal 0.0.
        last_index = len(sigmas) - 1  # e.g. 31 values → valid indices 0..30

        # Clamp the requested step into the tensor's valid range.
        step_index = max(0, min(int(step), last_index))

        sigma_value = float(sigmas[step_index])

        clamp_note = "" if step_index == step else f" (clamped from {step})"
        print(
            f"[SigmaAtStep] step index {step_index}{clamp_note} of "
            f"0..{last_index} → sigma = {sigma_value:.6f}"
        )

        return (sigma_value,)


# --- ComfyUI registration ---

NODE_CLASS_MAPPINGS = {
    "SigmaAtStep": SigmaAtStep,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SigmaAtStep": "Sigma at Step 📐",
}
