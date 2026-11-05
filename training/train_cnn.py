"""Train the 1-D CNN on the ULB credit-card dataset and write a model bundle.

    python training/train_cnn.py --csv path/to/creditcard.csv

Steps (all seeded):
  1. Stratified 70/15/15 train/validation/test split.
  2. Test split written to data/splits/test.csv so the simulator replays only unseen rows.
  3. StandardScaler on Time and Amount, fitted on TRAIN only. V1..V28 left as-is (PCA components).
  4. SMOTE on TRAIN only, then class-weighted binary cross-entropy.
  5. CNN: Conv1D 64/128/256 -> global max pool -> dense 128/64 (dropout 0.4) -> sigmoid.
     Adam 0.001, early stopping on validation PR-AUC.
  6. suggested_threshold = F1-maximising point on the VALIDATION precision-recall curve.
  7. Precision, recall, F1, ROC-AUC, PR-AUC on validation and test recorded in metadata.json.
"""

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from imblearn.over_sampling import SMOTE
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.utils.class_weight import compute_class_weight

FEATURE_ORDER = ["Time", *[f"V{i}" for i in range(1, 29)], "Amount"]
SCALED = ["Time", "Amount"]
LABEL = "Class"
REPO = Path(__file__).resolve().parents[1]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--csv", type=Path, default=REPO / "creditcard.csv")
    p.add_argument("--out", type=Path, default=REPO / "models")
    p.add_argument("--splits-dir", type=Path, default=REPO / "data" / "splits")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--batch-size", type=int, default=2048)
    p.add_argument("--patience", type=int, default=5)
    p.add_argument("--smote-ratio", type=float, default=0.1, help="minority:majority ratio after SMOTE")
    return p.parse_args()


def build_model(keras):
    layers = keras.layers
    model = keras.Sequential(
        [
            keras.Input(shape=(len(FEATURE_ORDER), 1)),
            layers.Conv1D(64, 3, padding="same", activation="relu"),
            layers.BatchNormalization(),
            layers.Conv1D(128, 3, padding="same", activation="relu"),
            layers.BatchNormalization(),
            layers.Conv1D(256, 3, padding="same", activation="relu"),
            layers.BatchNormalization(),
            layers.GlobalMaxPooling1D(),
            layers.Dense(128, activation="relu"),
            layers.Dropout(0.4),
            layers.Dense(64, activation="relu"),
            layers.Dropout(0.4),
            layers.Dense(1, activation="sigmoid"),
        ],
        name="fraud_cnn",
    )
    model.compile(
        optimizer=keras.optimizers.Adam(learning_rate=0.001),
        loss="binary_crossentropy",
        metrics=[keras.metrics.AUC(curve="PR", name="pr_auc"), keras.metrics.AUC(curve="ROC", name="roc_auc")],
    )
    return model


def metrics_at(y_true: np.ndarray, probs: np.ndarray, threshold: float) -> dict:
    pred = (probs >= threshold).astype(int)
    tn, fp, fn, tp = confusion_matrix(y_true, pred, labels=[0, 1]).ravel()
    return {
        "threshold": threshold,
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "f1": float(f1_score(y_true, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_true, probs)),
        "pr_auc": float(average_precision_score(y_true, probs)),
        "confusion": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
        "n": int(len(y_true)),
        "positives": int(y_true.sum()),
    }


def main() -> None:
    args = parse_args()
    import keras

    keras.utils.set_random_seed(args.seed)  # seeds Python, NumPy and the backend

    df = pd.read_csv(args.csv)
    missing = [c for c in [*FEATURE_ORDER, LABEL] if c not in df.columns]
    if missing:
        raise SystemExit(f"{args.csv} is missing columns: {missing}")
    print(f"Loaded {len(df):,} rows, fraud rate {df[LABEL].mean():.4%}")

    # 1. Stratified 70/15/15 split.
    train, rest = train_test_split(df, test_size=0.30, stratify=df[LABEL], random_state=args.seed)
    val, test = train_test_split(rest, test_size=0.50, stratify=rest[LABEL], random_state=args.seed)
    print(f"Split: train {len(train):,} / val {len(val):,} / test {len(test):,}")

    # 2. Unscaled test split for the simulator.
    args.splits_dir.mkdir(parents=True, exist_ok=True)
    test_path = args.splits_dir / "test.csv"
    test[[*FEATURE_ORDER, LABEL]].to_csv(test_path, index=False)
    print(f"Test split written to {test_path}")

    # 3. Scaler on TRAIN only.
    scaler = StandardScaler().fit(train[SCALED].to_numpy())

    def to_x(frame: pd.DataFrame) -> np.ndarray:
        x = frame[FEATURE_ORDER].to_numpy(dtype=np.float64).copy()
        idx = [FEATURE_ORDER.index(c) for c in SCALED]
        x[:, idx] = scaler.transform(x[:, idx])
        return x

    x_train, y_train = to_x(train), train[LABEL].to_numpy()
    x_val, y_val = to_x(val), val[LABEL].to_numpy()
    x_test, y_test = to_x(test), test[LABEL].to_numpy()

    # 4. SMOTE on TRAIN only, then class weights for the remaining imbalance.
    x_train, y_train = SMOTE(sampling_strategy=args.smote_ratio, random_state=args.seed).fit_resample(x_train, y_train)
    weights = compute_class_weight("balanced", classes=np.array([0, 1]), y=y_train)
    class_weight = {0: float(weights[0]), 1: float(weights[1])}
    print(f"After SMOTE: {len(y_train):,} rows, {y_train.mean():.2%} fraud; class weights {class_weight}")

    # 5. Train.
    model = build_model(keras)
    model.summary()
    model.fit(
        x_train.reshape(-1, 30, 1),
        y_train,
        validation_data=(x_val.reshape(-1, 30, 1), y_val),
        epochs=args.epochs,
        batch_size=args.batch_size,
        class_weight=class_weight,
        callbacks=[keras.callbacks.EarlyStopping(monitor="val_pr_auc", mode="max", patience=args.patience, restore_best_weights=True)],
        verbose=2,
    )

    # 6. Threshold from the validation PR curve (max F1 on the fraud class).
    val_probs = model.predict(x_val.reshape(-1, 30, 1), batch_size=8192, verbose=0).reshape(-1)
    precision, recall, thresholds = precision_recall_curve(y_val, val_probs)
    f1 = 2 * precision[:-1] * recall[:-1] / np.clip(precision[:-1] + recall[:-1], 1e-12, None)
    threshold = float(thresholds[int(np.argmax(f1))])
    print(f"Suggested threshold (max validation F1): {threshold:.4f}")

    # 7. Metrics.
    test_probs = model.predict(x_test.reshape(-1, 30, 1), batch_size=8192, verbose=0).reshape(-1)
    metrics = {"validation": metrics_at(y_val, val_probs, threshold), "test": metrics_at(y_test, test_probs, threshold)}
    print(json.dumps(metrics["test"], indent=2))

    now = datetime.now(timezone.utc)
    version = f"cnn-{now:%Y%m%d-%H%M%S}"
    bundle = args.out / version
    bundle.mkdir(parents=True)
    model.save(bundle / "model.keras")
    joblib.dump(scaler, bundle / "scaler.joblib")
    metadata = {
        "version": version,
        "trained_at": now.isoformat(),
        "dataset": f"ULB creditcard.csv ({len(df):,} rows)",
        "feature_order": FEATURE_ORDER,
        "metrics": metrics,
        "suggested_threshold": threshold,
        "stub": False,
        "seed": args.seed,
        "split": {"train": len(train), "validation": len(val), "test": len(test)},
        "smote_ratio": args.smote_ratio,
        "test_split_csv": str(test_path),
    }
    (bundle / "metadata.json").write_text(json.dumps(metadata, indent=2))
    print(f"Bundle written to {bundle}")


if __name__ == "__main__":
    main()
