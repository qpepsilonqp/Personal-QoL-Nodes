"""
SigmaAtPercent — ComfyUI custom node
--------------------------------------
Takes a SIGMAS tensor (e.g. from Flux2Scheduler) and returns the sigma value
at a given completion percentage.

Use case: feed the output into NAG's end_sigma so guidance cuts off
automatically at e.g. 80% of steps, regardless of step count or resolution.

Install: drop this file into ComfyUI/custom_nodes/
"""


class SigmaAtPercent:
    """
    Extracts the sigma value at a given percentage through the denoising schedule.

    Example: 80% completion with 30 steps → index 24 → sigma ≈ 0.441
    The node rounds to the nearest step boundary so the value is always
    an actual scheduled sigma, not an interpolated one.
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
                "percent_complete": (
                    "FLOAT",
                    {
                        "default": 0.80,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.0001,
                        "round": 0.0001,
                        "display": "slider",
                    },
                ),
            }
        }

    def get_sigma(self, sigmas, percent_complete: float):
        # sigmas tensor has shape [steps + 1]; last entry is always 0.0 (terminal)
        # We exclude the terminal zero — it's not a real sampling step.
        num_steps = len(sigmas) - 1  # e.g. 31 values → 30 steps

        # Clamp to valid range
        percent_complete = max(0.0, min(1.0, percent_complete))

        # Which step index corresponds to this completion point?
        # Step 0 = start (sigma=1.0), step num_steps = end (sigma=0.0 terminal)
        # At 80% complete we want the sigma *after* 80% of steps have run.
        step_index = round(percent_complete * num_steps)
        step_index = max(0, min(step_index, num_steps))

        sigma_value = float(sigmas[step_index])

        print(
            f"[SigmaAtPercent] {percent_complete*100:.1f}% of {num_steps} steps "
            f"→ step index {step_index} → sigma = {sigma_value:.6f}"
        )

        return (sigma_value,)


# --- ComfyUI registration ---

NODE_CLASS_MAPPINGS = {
    "SigmaAtPercent": SigmaAtPercent,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SigmaAtPercent": "Sigma at Percent 📐",
}
