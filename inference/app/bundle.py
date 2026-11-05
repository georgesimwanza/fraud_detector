"""Loads and validates a model bundle: models/<version>/{model.keras, scaler.joblib, metadata.json}."""

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import joblib
import numpy as np

from .schemas import FEATURE_ORDER, TransactionIn

TIME_IDX, AMOUNT_IDX = 0, len(FEATURE_ORDER) - 1


class BundleError(RuntimeError):
    pass


@dataclass(frozen=True)
class Bundle:
    path: Path
    version: str
    stub: bool
    metadata: dict[str, Any]
    scaler: Any
    model: Any

    def _model_input(self, txs: list[TransactionIn]) -> np.ndarray:
        x = np.array([t.features() for t in txs], dtype=np.float64)
        # Only Time and Amount are scaled; V1..V28 are already PCA components.
        x[:, [TIME_IDX, AMOUNT_IDX]] = self.scaler.transform(x[:, [TIME_IDX, AMOUNT_IDX]])
        return x

    def predict(self, txs: list[TransactionIn]) -> list[float]:
        x = self._model_input(txs)
        probs = self.model(x.reshape(-1, len(FEATURE_ORDER), 1).astype(np.float32), training=False)
        return [float(p) for p in np.asarray(probs).reshape(-1)]

    def explain(self, tx: TransactionIn, steps: int = 64) -> dict[str, Any]:
        """Integrated gradients from a baseline of all zeros in model-input space — the average
        transaction (scaled Time and Amount at their training means, every PCA component at 0).
        Each feature's attribution is its share of (probability - baseline probability); the
        shares sum to that difference up to the trapezoid-rule error, reported as `residual`."""
        import tensorflow as tf  # deferred like keras

        x = self._model_input([tx])[0]
        baseline = np.zeros_like(x)
        alphas = np.linspace(0.0, 1.0, steps + 1)[:, None]
        path = (baseline + alphas * (x - baseline)).reshape(-1, len(FEATURE_ORDER), 1).astype(np.float32)
        inputs = tf.convert_to_tensor(path)
        with tf.GradientTape() as tape:
            tape.watch(inputs)
            out = self.model(inputs, training=False)
        grads = tape.gradient(out, inputs).numpy().reshape(-1, len(FEATURE_ORDER)).astype(np.float64)
        avg_grads = (grads[:-1] + grads[1:]).mean(axis=0) / 2  # trapezoid rule
        attributions = (x - baseline) * avg_grads
        probs = np.asarray(out).reshape(-1)
        probability, baseline_probability = float(probs[-1]), float(probs[0])
        return {
            "probability": probability,
            "baseline_probability": baseline_probability,
            "attributions": [float(a) for a in attributions],
            "residual": float(probability - baseline_probability - attributions.sum()),
        }


def resolve_bundle_dir() -> Path:
    """MODEL_BUNDLE wins; otherwise the most recently trained bundle under MODELS_DIR."""
    explicit = os.environ.get("MODEL_BUNDLE")
    if explicit:
        return Path(explicit)
    models_dir = Path(os.environ.get("MODELS_DIR", Path(__file__).resolve().parents[2] / "models"))
    candidates = [p for p in models_dir.glob("*") if (p / "metadata.json").is_file()]
    if not candidates:
        raise BundleError(f"No model bundle found in {models_dir}. Run: python training/make_stub_bundle.py")
    return max(candidates, key=lambda p: json.loads((p / "metadata.json").read_text()).get("trained_at", ""))


def load_bundle(path: Path) -> Bundle:
    for name in ("model.keras", "scaler.joblib", "metadata.json"):
        if not (path / name).is_file():
            raise BundleError(f"Bundle {path} is missing {name}")

    metadata = json.loads((path / "metadata.json").read_text())
    if metadata.get("feature_order") != FEATURE_ORDER:
        raise BundleError(
            f"Bundle {path} feature_order does not match the contract. "
            f"Expected {FEATURE_ORDER}, got {metadata.get('feature_order')}"
        )
    for key in ("version", "trained_at", "suggested_threshold"):
        if key not in metadata:
            raise BundleError(f"Bundle {path} metadata.json is missing '{key}'")

    scaler = joblib.load(path / "scaler.joblib")
    if getattr(scaler, "n_features_in_", None) != 2:
        raise BundleError(f"Bundle {path} scaler must be fitted on exactly [Time, Amount]")

    import keras  # deferred: slow import, and keeps schema-only tests fast

    model = keras.models.load_model(path / "model.keras", compile=False)
    if tuple(model.input_shape[1:]) != (len(FEATURE_ORDER), 1):
        raise BundleError(f"Bundle {path} model input shape {model.input_shape} != (None, 30, 1)")

    return Bundle(
        path=path,
        version=str(metadata["version"]),
        stub=bool(metadata.get("stub", False)),
        metadata=metadata,
        scaler=scaler,
        model=model,
    )
