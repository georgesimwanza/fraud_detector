"""Evaluate a simulator run: scored probability vs the dataset label.

Prints precision, recall, F1, ROC-AUC, PR-AUC, a confusion matrix at the active threshold,
and latency percentiles.

    # From the log the simulator writes (works without Firebase):
    python training/evaluate_run.py --jsonl simulator/runs/<run>.jsonl

    # From Firestore (needs GOOGLE_APPLICATION_CREDENTIALS and firebase-admin):
    python training/evaluate_run.py --firestore --since 2026-10-25T08:00:00Z
"""

import argparse
import json
from datetime import datetime
from pathlib import Path

import numpy as np
from sklearn.metrics import average_precision_score, confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        rows.append(
            {
                "label": r.get("label"),
                "probability": r.get("probability"),
                "thresholdUsed": r.get("thresholdUsed"),
                "latencyMs": r.get("serverLatencyMs"),
                "status": r.get("status"),
            }
        )
    return rows


def load_firestore(since: datetime) -> list[dict]:
    import firebase_admin
    from firebase_admin import firestore

    if not firebase_admin._apps:
        firebase_admin.initialize_app()
    docs = firestore.client().collection("transactions").where("receivedAt", ">=", since).stream()
    return [
        {
            "label": d.get("label"),
            "probability": d.get("probability"),
            "thresholdUsed": d.get("thresholdUsed"),
            "latencyMs": d.get("latencyMs"),
            "status": d.get("status"),
        }
        for d in (doc.to_dict() for doc in docs)
    ]


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = p.add_mutually_exclusive_group(required=True)
    src.add_argument("--jsonl", type=Path)
    src.add_argument("--firestore", action="store_true")
    p.add_argument("--since", type=datetime.fromisoformat, help="Firestore: only transactions received at/after this time")
    p.add_argument("--threshold", type=float, help="default: the threshold the most recent transactions were judged under")
    args = p.parse_args()

    if args.firestore and not args.since:
        p.error("--firestore needs --since")
    rows = load_jsonl(args.jsonl) if args.jsonl else load_firestore(args.since)

    failed = sum(1 for r in rows if r["status"] == "scoring_failed")
    scored = [r for r in rows if r["probability"] is not None]
    labelled = [r for r in scored if r["label"] in (0, 1)]
    print(f"Transactions: {len(rows)}  scored: {len(scored)}  scoring failed: {failed}  labelled: {len(labelled)}")
    if not labelled:
        raise SystemExit("No labelled, scored transactions to evaluate.")

    y = np.array([r["label"] for r in labelled])
    probs = np.array([r["probability"] for r in labelled], dtype=float)
    threshold = args.threshold if args.threshold is not None else labelled[-1]["thresholdUsed"]
    pred = (probs >= threshold).astype(int)
    thresholds_seen = sorted({r["thresholdUsed"] for r in labelled})

    print(f"\nThreshold: {threshold}" + (f"  (run used several: {thresholds_seen})" if len(thresholds_seen) > 1 else ""))
    print(f"Positives (label=1): {int(y.sum())} of {len(y)}")
    print(f"Precision: {precision_score(y, pred, zero_division=0):.4f}")
    print(f"Recall:    {recall_score(y, pred, zero_division=0):.4f}")
    print(f"F1:        {f1_score(y, pred, zero_division=0):.4f}")
    if 0 < y.sum() < len(y):
        print(f"ROC-AUC:   {roc_auc_score(y, probs):.4f}")
        print(f"PR-AUC:    {average_precision_score(y, probs):.4f}")
    else:
        print("ROC-AUC / PR-AUC: need both classes in the run")

    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    print("\nConfusion matrix        predicted 0   predicted 1")
    print(f"  actual 0 (legit)   {tn:>12}  {fp:>12}")
    print(f"  actual 1 (fraud)   {fn:>12}  {tp:>12}")

    lat = np.array([r["latencyMs"] for r in rows if r["latencyMs"] is not None], dtype=float)
    if len(lat):
        p50, p95, p99 = np.percentile(lat, [50, 95, 99])
        print(f"\nLatency (ms)  p50 {p50:.0f}  p95 {p95:.0f}  p99 {p99:.0f}  max {lat.max():.0f}")


if __name__ == "__main__":
    main()
