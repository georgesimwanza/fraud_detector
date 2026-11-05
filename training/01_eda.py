"""Exploratory data analysis of the ULB credit-card dataset (methodology §3.5).

    python training/01_eda.py --csv path/to/creditcard.csv          # -> docs/figures/eda_*.png

Writes four figures (150 dpi) and prints a summary:
  eda_class_distribution.png   class counts, imbalance as a ratio and a percentage
  eda_amount_time.png          Amount and Time, fraud vs legitimate (per-class density)
  eda_features_grid.png        V1..V28 small multiples, fraud vs legitimate
  eda_correlation.png          correlation heatmap of the 30 features and Class

Densities are normalised per class: with ~0.17% fraud, raw counts would flatten the
fraud distribution to nothing. Each figure says so on its axis.
"""

import argparse
from pathlib import Path

import matplotlib

matplotlib.use("Agg")  # files only, no window
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

FEATURE_ORDER = ["Time", *[f"V{i}" for i in range(1, 29)], "Amount"]
LABEL = "Class"
REPO = Path(__file__).resolve().parents[1]

# Validated categorical pair (dataviz palette, light mode): blue = legitimate, orange = fraud.
LEGIT, FRAUD = "#2a78d6", "#eb6834"
INK, MUTED, GRID = "#202224", "#5f6673", "#e6e9f0"
DPI = 150


def style() -> None:
    plt.rcParams.update(
        {
            "figure.facecolor": "white",
            "axes.facecolor": "white",
            "axes.edgecolor": "#c9cfdb",
            "axes.labelcolor": INK,
            "axes.titlecolor": INK,
            "axes.titleweight": "bold",
            "axes.grid": True,
            "axes.axisbelow": True,
            "grid.color": GRID,
            "grid.linewidth": 0.8,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "xtick.color": MUTED,
            "ytick.color": MUTED,
            "font.size": 10,
            "legend.frameon": False,
        }
    )


def class_distribution(df: pd.DataFrame, out: Path) -> str:
    counts = df[LABEL].value_counts().reindex([0, 1], fill_value=0)
    legit, fraud = int(counts[0]), int(counts[1])
    pct = 100 * fraud / len(df)
    ratio = legit / fraud if fraud else float("inf")
    summary = f"{fraud:,} fraud of {len(df):,} ({pct:.3f}%), about 1 fraud per {ratio:,.0f} legitimate"

    fig, ax = plt.subplots(figsize=(6.4, 4.2))
    bars = ax.bar(["Legitimate (0)", "Fraud (1)"], [legit, fraud], color=[LEGIT, FRAUD], width=0.5)
    ax.set_yscale("log")
    ax.set_ylabel("Transactions (log scale)")
    ax.set_title("Class distribution")
    for bar, n in zip(bars, [legit, fraud]):
        ax.annotate(f"{n:,}", (bar.get_x() + bar.get_width() / 2, n), xytext=(0, 4), textcoords="offset points",
                    ha="center", color=INK, fontweight="bold")
    ax.text(0.5, -0.2, f"Imbalance 1 : {ratio:,.0f}  ·  fraud = {pct:.3f}% of transactions",
            transform=ax.transAxes, ha="center", color=MUTED)
    fig.tight_layout()
    fig.savefig(out / "eda_class_distribution.png", dpi=DPI)
    plt.close(fig)
    return summary


def amount_time(df: pd.DataFrame, out: Path) -> None:
    legit, fraud = df[df[LABEL] == 0], df[df[LABEL] == 1]
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(11, 4.2))

    # Amount spans 0 to ~25,000 and is heavily skewed: log-spaced bins on a log axis.
    amax = max(df["Amount"].max(), 1.0)
    bins = np.logspace(np.log10(0.5), np.log10(amax + 1), 50)
    a1.hist(legit["Amount"] + 0.5, bins=bins, density=True, histtype="stepfilled", alpha=0.35, color=LEGIT, label="Legitimate")
    a1.hist(fraud["Amount"] + 0.5, bins=bins, density=True, histtype="step", linewidth=2, color=FRAUD, label="Fraud")
    a1.set_xscale("log")
    a1.set_xlabel("Transaction amount (dataset currency units, log scale)")
    a1.set_ylabel("Density (normalised per class)")
    a1.set_title("Amount")
    a1.legend()

    hours = 3600
    tbins = np.linspace(0, df["Time"].max() / hours, 49)
    a2.hist(legit["Time"] / hours, bins=tbins, density=True, histtype="stepfilled", alpha=0.35, color=LEGIT, label="Legitimate")
    a2.hist(fraud["Time"] / hours, bins=tbins, density=True, histtype="step", linewidth=2, color=FRAUD, label="Fraud")
    a2.set_xlabel("Time since first transaction (hours)")
    a2.set_ylabel("Density (normalised per class)")
    a2.set_title("Time")
    a2.legend()

    fig.tight_layout()
    fig.savefig(out / "eda_amount_time.png", dpi=DPI)
    plt.close(fig)


def features_grid(df: pd.DataFrame, out: Path) -> list[tuple[str, float]]:
    legit, fraud = df[df[LABEL] == 0], df[df[LABEL] == 1]
    v_cols = FEATURE_ORDER[1:29]
    fig, axes = plt.subplots(4, 7, figsize=(17, 9.5), sharey=False)
    separation = []
    for ax, col in zip(axes.flat, v_cols):
        lo, hi = np.percentile(df[col], [0.5, 99.5])
        lo, hi = min(lo, fraud[col].quantile(0.01)), max(hi, fraud[col].quantile(0.99))
        bins = np.linspace(lo, hi, 40)
        ax.hist(legit[col].clip(lo, hi), bins=bins, density=True, histtype="stepfilled", alpha=0.35, color=LEGIT)
        ax.hist(fraud[col].clip(lo, hi), bins=bins, density=True, histtype="step", linewidth=1.6, color=FRAUD)
        ax.set_title(col, fontsize=10)
        ax.tick_params(labelsize=7)
        ax.set_yticks([])
        # Standardised mean difference: how far apart the class means sit, in pooled SDs.
        pooled = np.sqrt((legit[col].var() + fraud[col].var()) / 2) or 1.0
        separation.append((col, float((fraud[col].mean() - legit[col].mean()) / pooled)))
    fig.legend(
        handles=[plt.Rectangle((0, 0), 1, 1, color=LEGIT, alpha=0.35), plt.Line2D([], [], color=FRAUD, linewidth=2)],
        labels=["Legitimate", "Fraud"],
        loc="upper right",
        ncol=2,
    )
    fig.suptitle("PCA components V1–V28: fraud vs legitimate (density normalised per class; x = component value, unitless)",
                 fontweight="bold", color=INK, x=0.01, ha="left")
    fig.tight_layout(rect=(0, 0, 1, 0.96))
    fig.savefig(out / "eda_features_grid.png", dpi=DPI)
    plt.close(fig)
    return sorted(separation, key=lambda s: -abs(s[1]))


def correlation(df: pd.DataFrame, out: Path) -> None:
    corr = df[[*FEATURE_ORDER, LABEL]].corr()
    fig, ax = plt.subplots(figsize=(10, 8.5))
    im = ax.imshow(corr.values, cmap="RdBu_r", vmin=-1, vmax=1)
    ax.set_xticks(range(len(corr)), corr.columns, rotation=90, fontsize=8)
    ax.set_yticks(range(len(corr)), corr.columns, fontsize=8)
    ax.grid(False)
    ax.set_title("Pearson correlation: features and Class")
    cbar = fig.colorbar(im, ax=ax, shrink=0.8)
    cbar.set_label("Correlation coefficient (r)")
    fig.tight_layout()
    fig.savefig(out / "eda_correlation.png", dpi=DPI)
    plt.close(fig)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--csv", type=Path, default=REPO / "creditcard.csv")
    p.add_argument("--out", type=Path, default=REPO / "docs" / "figures")
    args = p.parse_args()

    df = pd.read_csv(args.csv)
    missing = [c for c in [*FEATURE_ORDER, LABEL] if c not in df.columns]
    if missing:
        raise SystemExit(f"{args.csv} is missing columns: {missing}")
    args.out.mkdir(parents=True, exist_ok=True)
    style()

    print(f"Rows: {len(df):,}   columns: {len(df.columns)}   missing values: {int(df.isna().sum().sum())}   "
          f"duplicate rows: {int(df.duplicated().sum()):,}")
    print("Class:", class_distribution(df, args.out))
    amount_time(df, args.out)
    print(f"Amount: median {df['Amount'].median():.2f}, max {df['Amount'].max():,.2f}; "
          f"fraud median {df.loc[df[LABEL] == 1, 'Amount'].median():.2f}")
    print(f"Time: spans {df['Time'].max() / 3600:.1f} hours")
    separation = features_grid(df, args.out)
    print("Most separating components (standardised mean difference, fraud − legit):")
    for col, d in separation[:6]:
        print(f"  {col:>4}  {d:+.2f}")
    correlation(df, args.out)
    print(f"Figures written to {args.out}")


if __name__ == "__main__":
    main()
