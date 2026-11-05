"""The wire contract. Mirrors web/lib/schemas.ts; contract/fixtures.json keeps them in step."""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, Strict, field_validator

# Fixed model input order. Every bundle's metadata.json must match exactly.
FEATURE_ORDER = ["Time", *[f"V{i}" for i in range(1, 29)], "Amount"]

# Strict: no "1.5" -> 1.5 or true -> 1 coercion, matching zod. Strict floats still accept ints.
Number = Annotated[float, Strict()]
NonNegative = Annotated[float, Strict(), Field(ge=0)]


class TransactionIn(BaseModel):
    # Unknown fields are stripped; NaN/Infinity rejected.
    model_config = ConfigDict(extra="ignore", allow_inf_nan=False)

    # Optional, but an explicit null is rejected (as zod's .optional() does).
    externalId: Annotated[str, Strict(), Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")] = None  # type: ignore[assignment]
    time: NonNegative
    amount: NonNegative
    v: Annotated[list[Number], Field(min_length=28, max_length=28)]
    # Evaluation only — never passed to the model.
    label: Literal[0, 1] = None  # type: ignore[assignment]

    @field_validator("label", mode="before")
    @classmethod
    def _label_not_bool(cls, value: object) -> object:
        # True == 1 in Python; zod rejects booleans, so must we.
        if isinstance(value, bool):
            raise ValueError("label must be 0 or 1, not a boolean")
        return value

    def features(self) -> list[float]:
        """Model input in FEATURE_ORDER. The label is deliberately not part of it."""
        return [self.time, *self.v, self.amount]


class PredictRequest(BaseModel):
    transactions: Annotated[list[TransactionIn], Field(min_length=1, max_length=1000)]


class ShadowScores(BaseModel):
    model_version: str
    stub: bool
    probabilities: list[float]


class PredictResponse(BaseModel):
    model_version: str
    stub: bool
    probabilities: list[float]
    latency_ms: float
    # Present only when SHADOW_MODEL_BUNDLE is set. Recorded, never used to raise alerts.
    shadow: ShadowScores | None = None


class ExplainRequest(BaseModel):
    transaction: TransactionIn


class FeatureAttribution(BaseModel):
    feature: str
    value: float
    attribution: float


class ExplainResponse(BaseModel):
    model_version: str
    stub: bool
    method: Literal["integrated_gradients"]
    probability: float
    baseline_probability: float
    residual: float
    attributions: list[FeatureAttribution]  # FEATURE_ORDER
    latency_ms: float


class HealthResponse(BaseModel):
    status: Literal["ok"]
    model_version: str
    stub: bool
    shadow_model_version: str | None = None
