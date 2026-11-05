"""End-to-end tests against a freshly generated stub bundle."""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.bundle import BundleError, load_bundle

REPO = Path(__file__).resolve().parents[2]
KEY = "test-internal-key-0123456789"
GOOD = json.loads((REPO / "contract" / "fixtures.json").read_text())["valid"][0]["payload"]


@pytest.fixture(scope="session")
def bundle_dir(tmp_path_factory) -> Path:
    out = tmp_path_factory.mktemp("models")
    # Training and app code never import each other — run the script as a separate process.
    subprocess.run(
        [sys.executable, str(REPO / "training" / "make_stub_bundle.py"), "--out", str(out), "--version", "stub-test"],
        check=True,
    )
    return out / "stub-test"


@pytest.fixture(scope="session")
def client(bundle_dir):
    mp = pytest.MonkeyPatch()
    mp.setenv("MODEL_BUNDLE", str(bundle_dir))
    mp.setenv("INFERENCE_INTERNAL_KEY", KEY)
    from app.main import app

    with TestClient(app) as c:
        yield c
    mp.undo()


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "model_version": "stub-test", "stub": True, "shadow_model_version": None}


def test_predict_one_and_many(client):
    r = client.post("/predict", json={"transactions": [GOOD, GOOD, {**GOOD, "label": 1}]}, headers={"X-Internal-Key": KEY})
    assert r.status_code == 200
    body = r.json()
    assert body["model_version"] == "stub-test" and body["stub"] is True
    assert len(body["probabilities"]) == 3 and all(0 <= p <= 1 for p in body["probabilities"])
    # The label is evaluation-only: it must not change the score.
    assert body["probabilities"][0] == pytest.approx(body["probabilities"][2])


def fraud_like_row() -> dict:
    row = {**GOOD, "v": [0.0] * 28}
    for idx, value in {2: -6, 3: 4, 9: -5, 10: 4, 11: -6, 13: -7, 16: -6}.items():
        row["v"][idx] = value
    return row


def test_predict_without_shadow_has_no_shadow_scores(client):
    r = client.post("/predict", json={"transactions": [GOOD]}, headers={"X-Internal-Key": KEY})
    assert r.json()["shadow"] is None


def test_shadow_scores_every_transaction_with_its_own_model(client, tmp_path):
    subprocess.run(
        [sys.executable, str(REPO / "training" / "make_stub_bundle.py"), "--out", str(tmp_path), "--version", "stub-shadow", "--bias", "-3"],
        check=True,
    )
    client.app.state.shadow = load_bundle(tmp_path / "stub-shadow")
    try:
        r = client.post("/predict", json={"transactions": [GOOD, fraud_like_row()]}, headers={"X-Internal-Key": KEY})
        body = r.json()
        assert body["model_version"] == "stub-test" and body["shadow"]["model_version"] == "stub-shadow"
        assert len(body["shadow"]["probabilities"]) == 2
        # A higher bias scores every row higher than the active stub does.
        assert all(s > p for s, p in zip(body["shadow"]["probabilities"], body["probabilities"]))
        assert client.get("/health").json()["shadow_model_version"] == "stub-shadow"
    finally:
        client.app.state.shadow = None


def test_explain_attributions_add_up_to_the_score(client):
    row = fraud_like_row()
    r = client.post("/explain", json={"transaction": row}, headers={"X-Internal-Key": KEY})
    assert r.status_code == 200
    body = r.json()
    assert body["method"] == "integrated_gradients" and body["model_version"] == "stub-test"
    assert [a["feature"] for a in body["attributions"]][:2] == ["Time", "V1"] and len(body["attributions"]) == 30
    # Completeness: attributions sum to probability - baseline probability.
    total = sum(a["attribution"] for a in body["attributions"])
    assert total == pytest.approx(body["probability"] - body["baseline_probability"], abs=1e-3)
    assert abs(body["residual"]) < 1e-3
    # Same score as /predict.
    p = client.post("/predict", json={"transactions": [row]}, headers={"X-Internal-Key": KEY}).json()["probabilities"][0]
    assert body["probability"] == pytest.approx(p, abs=1e-6)
    # The stub's largest weight x value is V14 (-0.9 x -7), so it must lead.
    top = max(body["attributions"], key=lambda a: a["attribution"])
    assert top["feature"] == "V14" and top["value"] == -7
    # Features the stub ignores get nothing.
    assert next(a for a in body["attributions"] if a["feature"] == "V1")["attribution"] == 0


def test_explain_rejects_bad_key(client):
    r = client.post("/explain", json={"transaction": GOOD}, headers={"X-Internal-Key": "wrong"})
    assert r.status_code == 401


def test_predict_rejects_bad_key(client):
    r = client.post("/predict", json={"transactions": [GOOD]}, headers={"X-Internal-Key": "wrong"})
    assert r.status_code == 401


def test_predict_names_the_bad_field(client):
    bad = {**GOOD, "v": GOOD["v"][:27]}
    r = client.post("/predict", json={"transactions": [bad]}, headers={"X-Internal-Key": KEY})
    assert r.status_code == 422
    assert any(e["field"] == "transactions.0.v" for e in r.json()["detail"])


def test_stub_separates_fraud_like_rows(client):
    r = client.post("/predict", json={"transactions": [GOOD, fraud_like_row()]}, headers={"X-Internal-Key": KEY})
    legit, fraud = r.json()["probabilities"]
    assert legit < 0.1 < 0.9 < fraud


def test_refuses_feature_order_mismatch(bundle_dir, tmp_path):
    broken = tmp_path / "broken"
    shutil.copytree(bundle_dir, broken)
    meta = json.loads((broken / "metadata.json").read_text())
    meta["feature_order"] = ["Amount", *meta["feature_order"][1:-1], "Time"]
    (broken / "metadata.json").write_text(json.dumps(meta))
    with pytest.raises(BundleError, match="feature_order"):
        load_bundle(broken)
