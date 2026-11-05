"""Replay transactions into the web ingest API at a steady rate.

    python simulator/simulate.py --rate 3 --count 200 --fraud-share 0.1
    python simulator/simulate.py --synthetic --count 100      # no dataset needed
    python simulator/simulate.py --synthetic --count 5000 --rate 200 --batch 100
                                  # NFR1 load test: POST /api/transactions/batch, 100 per request

Reads the TEST split written by training/train_cnn.py (rows the model never saw), or
generates synthetic rows with --synthetic. Sends `label` for later evaluation only.
Each response is logged to simulator/runs/<run>.jsonl for training/evaluate_run.py.

The ingest key comes from --key, the INGEST_API_KEY environment variable, or simulator/.env.
"""

import argparse
import csv
import json
import os
import random
import sys
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
V_COLS = [f"V{i}" for i in range(1, 29)]
SAFE_RATE = 5.0  # single-transaction mode: every request updates the same daily_stats row

# Fraud rows in the ULB data sit far out on these components (mean shift, synthetic mode only).
FRAUD_SHIFT = {"V3": -6.0, "V4": 4.0, "V10": -5.0, "V11": 4.0, "V12": -6.0, "V14": -7.0, "V17": -6.0}


def load_env_file(path: Path) -> None:
    if not path.is_file():
        return
    for line in path.read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def read_csv(path: Path) -> tuple[list[dict], list[dict]]:
    legit, fraud = [], []
    with path.open(newline="") as f:
        for row in csv.DictReader(f):
            rec = {
                "time": float(row["Time"]),
                "amount": float(row["Amount"]),
                "v": [float(row[c]) for c in V_COLS],
                "label": int(float(row["Class"])),
            }
            (fraud if rec["label"] == 1 else legit).append(rec)
    return legit, fraud


def synthetic_row(rng: random.Random, fraud: bool, t: float) -> dict:
    v = [rng.gauss(0, 1) for _ in V_COLS]
    if fraud:
        for name, shift in FRAUD_SHIFT.items():
            v[V_COLS.index(name)] = rng.gauss(shift, 2.0)
    amount = rng.uniform(1, 900) if fraud else rng.lognormvariate(3.0, 1.2)
    return {"time": round(t, 1), "amount": round(amount, 2), "v": [round(x, 6) for x in v], "label": int(fraud)}


def pick_rows(args, rng: random.Random) -> list[dict]:
    if args.synthetic:
        share = 0.1 if args.fraud_share is None else args.fraud_share
        n_fraud = round(args.count * share)
        flags = [True] * n_fraud + [False] * (args.count - n_fraud)
        rng.shuffle(flags)
        return [synthetic_row(rng, f, i * 2.0) for i, f in enumerate(flags)]

    if not args.csv.is_file():
        sys.exit(f"{args.csv} not found. Train first (training/train_cnn.py writes it), pass --csv, or use --synthetic.")
    legit, fraud = read_csv(args.csv)
    print(f"Loaded {len(legit) + len(fraud):,} rows from {args.csv} ({len(fraud)} fraud)")

    if args.fraud_share is None:
        rows = legit + fraud
        if args.shuffle:
            rng.shuffle(rows)
        else:
            rows.sort(key=lambda r: r["time"])
        return rows[: args.count]

    n_fraud = round(args.count * args.fraud_share)
    if not fraud and n_fraud:
        sys.exit("The CSV has no fraud rows to inject.")
    chosen = [rng.choice(fraud) for _ in range(n_fraud)] + rng.sample(legit, min(len(legit), args.count - n_fraud))
    rng.shuffle(chosen)
    return chosen


def main() -> None:
    load_env_file(HERE / ".env")
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--url", default=os.environ.get("INGEST_URL", "http://localhost:3000/api/transactions"))
    p.add_argument("--key", default=os.environ.get("INGEST_API_KEY"))
    p.add_argument("--csv", type=Path, default=REPO / "data" / "splits" / "test.csv")
    p.add_argument("--synthetic", action="store_true", help="generate rows instead of reading the test split")
    p.add_argument("--rate", type=float, default=3.0, help="transactions per second (default 3)")
    p.add_argument("--count", type=int, default=200)
    p.add_argument("--fraud-share", type=float, default=None, help="inject this proportion of fraud rows, e.g. 0.1")
    p.add_argument("--shuffle", action="store_true")
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--log", type=Path, default=None, help="default: simulator/runs/<run>.jsonl")
    p.add_argument("--batch", type=int, default=0, help="send N transactions per request to the batch endpoint (1-500)")
    args = p.parse_args()

    if not args.key:
        sys.exit("No ingest key. Set INGEST_API_KEY in simulator/.env (see .env.example) or pass --key.")
    if args.rate <= 0 or args.count <= 0:
        sys.exit("--rate and --count must be positive.")
    if args.fraud_share is not None and not 0 <= args.fraud_share <= 1:
        sys.exit("--fraud-share must be between 0 and 1.")
    if args.batch and not 1 <= args.batch <= 500:
        sys.exit("--batch must be between 1 and 500.")
    if args.rate > SAFE_RATE and not args.batch:
        print(
            f"WARNING: --rate {args.rate} is above {SAFE_RATE}/s. Every transaction updates the same daily_stats row, "
            "so requests queue on its lock. Use --batch for higher rates (one row update per request).",
            file=sys.stderr,
        )

    rng = random.Random(args.seed)
    rows = pick_rows(args, rng)
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
    log_path = args.log or HERE / "runs" / f"{run_id}.jsonl"
    log_path.parent.mkdir(parents=True, exist_ok=True)

    counts: dict[str, int] = {}
    lock = threading.Lock()
    log_file = log_path.open("w")

    def post(url: str, body: dict, timeout: float) -> tuple[int, dict, float]:
        req = urllib.request.Request(
            url, data=json.dumps(body).encode(), method="POST", headers={"Content-Type": "application/json", "X-Api-Key": args.key}
        )
        started = time.perf_counter()
        try:
            with urllib.request.urlopen(req, timeout=timeout) as res:
                status, payload = res.status, json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as e:
            status = e.code
            try:
                payload = json.loads(e.read() or b"{}")
            except json.JSONDecodeError:
                payload = {}
        except (urllib.error.URLError, TimeoutError) as e:
            status, payload = 0, {"error": str(e)}
        return status, payload, round((time.perf_counter() - started) * 1000, 1)

    def record(external_id: str, row: dict, status: int, payload: dict, client_ms: float, batch_size: int | None = None) -> None:
        entry = {
            "externalId": external_id,
            "httpStatus": status,
            "label": row["label"],
            "probability": payload.get("probability"),
            "riskLevel": payload.get("riskLevel"),
            "isAlert": payload.get("isAlert"),
            "thresholdUsed": payload.get("thresholdUsed"),
            "modelVersion": payload.get("modelVersion"),
            "status": payload.get("status", "scored" if status == 201 else None),
            "serverLatencyMs": payload.get("latencyMs"),
            "clientLatencyMs": client_ms,
            "error": payload.get("error"),
            **({"batchSize": batch_size} if batch_size else {}),
        }
        key = "alert" if payload.get("isAlert") else str(status or "network error")
        with lock:
            log_file.write(json.dumps(entry) + "\n")
            counts[key] = counts.get(key, 0) + 1
            done = sum(counts.values())
            if status not in (201,) or done % 20 == 0 or done == len(rows):
                detail = f" {entry['error']}" if entry["error"] else ""
                print(f"[{done}/{len(rows)}] {external_id} -> {status or 'ERR'}{detail}  totals {counts}")

    def send(i: int, row: dict) -> None:
        external_id = f"sim-{run_id}-{i:06d}"
        status, payload, client_ms = post(args.url, {"externalId": external_id, **row}, 10)
        record(external_id, row, status, payload, client_ms)

    # Per-item results map onto the single endpoint's status codes, so evaluate_run.py reads both alike.
    ITEM_HTTP = {"scored": 201, "scoring_failed": 503, "duplicate": 409, "invalid": 400}
    batch_url = args.url.rstrip("/") + "/batch"

    def send_batch(first: int, chunk: list[dict]) -> None:
        ids = [f"sim-{run_id}-{first + k:06d}" for k in range(len(chunk))]
        status, payload, client_ms = post(batch_url, {"transactions": [{"externalId": x, **r} for x, r in zip(ids, chunk)]}, 30)
        results = payload.get("results") if status == 200 else None
        for k, (external_id, row) in enumerate(zip(ids, chunk)):
            item = results[k] if results else {"error": payload.get("error", "batch failed")}
            if item.get("status") == "scoring_failed":
                item = {**item, "error": item.get("error") or "scoring failed"}
            record(external_id, row, ITEM_HTTP.get(item.get("status"), status), item, client_ms, len(chunk))

    target = batch_url if args.batch else args.url
    print(f"Run {run_id}: {len(rows)} transactions at {args.rate}/s{f' in batches of {args.batch}' if args.batch else ''} -> {target}")
    start = time.perf_counter()
    try:
        with ThreadPoolExecutor(max_workers=16) as pool:
            step = args.batch or 1
            for i in range(0, len(rows), step):
                delay = start + i / args.rate - time.perf_counter()
                if delay > 0:
                    time.sleep(delay)
                if args.batch:
                    pool.submit(send_batch, i, rows[i : i + step])
                else:
                    pool.submit(send, i, rows[i])
    except KeyboardInterrupt:
        print("\nStopping — waiting for in-flight requests…")
    finally:
        log_file.close()

    elapsed = time.perf_counter() - start
    print(f"\nDone in {elapsed:.1f}s. Results: {counts}  ('alert' = accepted and flagged; '201' = accepted, low risk)")
    print(f"Log: {log_path}\nEvaluate: python training/evaluate_run.py --jsonl {log_path}")


if __name__ == "__main__":
    main()
