"""Generate a valid STUB model bundle in seconds, with no dataset.

The bundle has the real file layout and metadata so the inference service, web app and
simulator can all be built and tested before the CNN is trained. It is NOT a result:
metadata says "stub": true and the web UI shows a STUB MODEL badge.

The model is a single sigmoid unit with hand-set weights on features known to separate
fraud in the ULB dataset (V14, V12, V10, V17 low; V4, V11 high), so demos produce a
plausible mix of low and high scores rather than a constant.

    python training/make_stub_bundle.py            # -> models/stub-<timestamp>/
    python training/make_stub_bundle.py --bias -4 --version stub-challenger --out models/shadow
                                                   # a more alert-happy stub to run as a shadow model
                                                   # (models/shadow/ is not scanned for the active bundle)
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
from sklearn.preprocessing import StandardScaler

FEATURE_ORDER = ["Time", *[f"V{i}" for i in range(1, 29)], "Amount"]
REPO = Path(__file__).resolve().parents[1]

# feature name -> weight on the (unscaled) PCA component
STUB_WEIGHTS = {"V3": -0.3, "V4": 0.6, "V10": -0.5, "V11": 0.5, "V12": -0.6, "V14": -0.9, "V17": -0.5}
STUB_BIAS = -5.0


def main() -> None:
    now = datetime.now(timezone.utc)
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", type=Path, default=REPO / "models")
    parser.add_argument("--version", default=f"stub-{now:%Y%m%d-%H%M%S}")
    parser.add_argument("--bias", type=float, default=STUB_BIAS, help=f"sigmoid bias (default {STUB_BIAS}; higher = more alerts)")
    args = parser.parse_args()

    import keras  # imported late so --help is instant

    bundle = args.out / args.version
    bundle.mkdir(parents=True, exist_ok=False)

    model = keras.Sequential(
        [keras.Input(shape=(len(FEATURE_ORDER), 1)), keras.layers.Flatten(), keras.layers.Dense(1, activation="sigmoid")],
        name="stub",
    )
    weights = np.zeros((len(FEATURE_ORDER), 1), dtype=np.float32)
    for name, w in STUB_WEIGHTS.items():
        weights[FEATURE_ORDER.index(name), 0] = w
    model.layers[-1].set_weights([weights, np.array([args.bias], dtype=np.float32)])
    model.save(bundle / "model.keras")

    # Scaler over plausible Time/Amount ranges (ULB: Time 0–172792 s, Amount heavy-tailed).
    rng = np.random.default_rng(0)
    sample = np.column_stack([rng.uniform(0, 172_792, 10_000), rng.lognormal(3.0, 1.3, 10_000)])
    joblib.dump(StandardScaler().fit(sample), bundle / "scaler.joblib")

    metadata = {
        "version": args.version,
        "trained_at": now.isoformat(),
        "dataset": "none (stub)",
        "feature_order": FEATURE_ORDER,
        "metrics": None,
        "suggested_threshold": 0.5,
        "stub": True,
    }
    (bundle / "metadata.json").write_text(json.dumps(metadata, indent=2))
    print(f"Stub bundle written to {bundle}")


if __name__ == "__main__":
    main()
