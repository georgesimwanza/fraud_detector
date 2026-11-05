"""Stateless scoring service. Never touches the database; only the web server calls it."""

import hmac
import json
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from pathlib import Path

from .bundle import load_bundle, resolve_bundle_dir
from .schemas import (
    FEATURE_ORDER,
    ExplainRequest,
    ExplainResponse,
    FeatureAttribution,
    HealthResponse,
    PredictRequest,
    PredictResponse,
    ShadowScores,
    TransactionIn,
)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname.lower(),
            "service": "inference",
            "event": record.getMessage(),
            **getattr(record, "fields", {}),
        }
        return json.dumps(entry)


handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JsonFormatter())
log = logging.getLogger("inference")
log.handlers = [handler]
log.setLevel(logging.INFO)
log.propagate = False


def info(event: str, **fields) -> None:
    log.info(event, extra={"fields": fields})


@asynccontextmanager
async def lifespan(app: FastAPI):
    key = os.environ.get("INFERENCE_INTERNAL_KEY", "")
    if len(key) < 16:
        raise RuntimeError("INFERENCE_INTERNAL_KEY must be set (at least 16 characters). See inference/.env.example")
    app.state.internal_key = key.encode()
    path = resolve_bundle_dir()
    app.state.bundle = load_bundle(path)  # once, at startup; refuses to start on a contract mismatch
    # Optional challenger: scored alongside the active model, recorded, never used for alerts.
    shadow_path = os.environ.get("SHADOW_MODEL_BUNDLE")
    app.state.shadow = load_bundle(Path(shadow_path)) if shadow_path else None
    if app.state.shadow and app.state.shadow.version == app.state.bundle.version:
        raise RuntimeError("SHADOW_MODEL_BUNDLE is the same model version as the active bundle")
    # TensorFlow's first call is slow while it builds the graph; pay that here, not
    # against the web app's 800 ms timeout on the first real transactions.
    for bundle in filter(None, (app.state.bundle, app.state.shadow)):
        started = time.perf_counter()
        bundle.predict([TransactionIn(time=0.0, amount=0.0, v=[0.0] * 28)])
        info(
            "bundle_loaded",
            role="active" if bundle is app.state.bundle else "shadow",
            version=bundle.version,
            stub=bundle.stub,
            path=str(bundle.path),
            warmup_ms=round((time.perf_counter() - started) * 1000, 1),
        )
    yield


app = FastAPI(title="Fraud inference", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.exception_handler(RequestValidationError)
async def on_validation_error(request: Request, exc: RequestValidationError):
    errors = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
    info("predict_rejected", path=request.url.path, errors=errors[:5])
    return JSONResponse(status_code=422, content={"detail": errors})


@app.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    bundle, shadow = request.app.state.bundle, request.app.state.shadow
    return HealthResponse(status="ok", model_version=bundle.version, stub=bundle.stub, shadow_model_version=shadow.version if shadow else None)


def require_key(request: Request, presented: str, event: str) -> None:
    if not hmac.compare_digest(presented.encode(), request.app.state.internal_key):
        info(event)
        raise HTTPException(status_code=401, detail="Invalid internal key")


@app.post("/predict", response_model=PredictResponse)
def predict(body: PredictRequest, request: Request, x_internal_key: str = Header(default="")) -> PredictResponse:
    require_key(request, x_internal_key, "predict_unauthorized")
    started = time.perf_counter()
    bundle, shadow = request.app.state.bundle, request.app.state.shadow
    probabilities = bundle.predict(body.transactions)
    shadow_scores = (
        ShadowScores(model_version=shadow.version, stub=shadow.stub, probabilities=shadow.predict(body.transactions)) if shadow else None
    )
    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    info("predict", n=len(probabilities), model_version=bundle.version, shadow=shadow.version if shadow else None, latency_ms=latency_ms)
    return PredictResponse(
        model_version=bundle.version, stub=bundle.stub, probabilities=probabilities, latency_ms=latency_ms, shadow=shadow_scores
    )


@app.post("/explain", response_model=ExplainResponse)
def explain(body: ExplainRequest, request: Request, x_internal_key: str = Header(default="")) -> ExplainResponse:
    require_key(request, x_internal_key, "explain_unauthorized")
    started = time.perf_counter()
    bundle = request.app.state.bundle
    result = bundle.explain(body.transaction)
    latency_ms = round((time.perf_counter() - started) * 1000, 2)
    info("explain", model_version=bundle.version, residual=round(result["residual"], 6), latency_ms=latency_ms)
    return ExplainResponse(
        model_version=bundle.version,
        stub=bundle.stub,
        method="integrated_gradients",
        probability=result["probability"],
        baseline_probability=result["baseline_probability"],
        residual=result["residual"],
        attributions=[
            FeatureAttribution(feature=name, value=value, attribution=a)
            for name, value, a in zip(FEATURE_ORDER, body.transaction.features(), result["attributions"])
        ],
        latency_ms=latency_ms,
    )
