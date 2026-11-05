import { describe, expect, it } from "vitest";
import { buildReport, daysBetween, driftLevel, driftReport, performance, psi, shadowComparison, thresholdCurve, toCsv } from "./analytics";

// Deterministic pseudo-random numbers so the drift tests never flake.
function lcg(seed: number) {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}
function normals(n: number, mean: number, seed: number): number[] {
  const r = lcg(seed);
  return Array.from({ length: n }, () => mean + Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r()));
}

describe("performance", () => {
  it("computes precision, recall and F1, and null when undefined", () => {
    expect(performance({ tp: 8, fp: 2, fn: 2, tn: 88 })).toMatchObject({ n: 100, positives: 10, precision: 0.8, recall: 0.8 });
    expect(performance({ tp: 8, fp: 2, fn: 2, tn: 88 }).f1).toBeCloseTo(0.8);
    expect(performance({ tp: 0, fp: 0, fn: 0, tn: 5 })).toMatchObject({ precision: null, recall: null, f1: null });
  });
});

describe("thresholdCurve", () => {
  const scores = [
    { probability: 0.9, label: 1 as const, amount: 100 },
    { probability: 0.5, label: 1 as const, amount: 40 },
    { probability: 0.3, label: 0 as const, amount: 5 },
    { probability: 0.05, label: 0 as const, amount: 5 },
  ];
  const curve = thresholdCurve(scores);
  const at = (t: number) => curve.find((p) => Math.abs(p.threshold - t) < 1e-9)!;

  it("covers every settable threshold 0.01 … 0.99", () => {
    expect(curve).toHaveLength(99);
    expect(curve[0].threshold).toBe(0.01);
    expect(curve[98].threshold).toBe(0.99);
  });

  it("uses the FR6 rule: a score exactly at the threshold is flagged", () => {
    expect(at(0.5)).toMatchObject({ tp: 2, fp: 0, fn: 0, tn: 2, missedFraudAmount: 0 });
    expect(at(0.51)).toMatchObject({ tp: 1, fn: 1, missedFraudAmount: 40 });
  });

  it("trades false positives for missed fraud as the threshold rises", () => {
    expect(at(0.1)).toMatchObject({ tp: 2, fp: 1 });
    expect(at(0.95)).toMatchObject({ tp: 0, fp: 0, fn: 2, missedFraudAmount: 140 });
  });
});

describe("PSI drift", () => {
  it("is ~0 for the same distribution and significant for a shifted one", () => {
    const ref = normals(2_000, 0, 1);
    expect(psi(ref, normals(2_000, 0, 2))).toBeLessThan(0.1);
    expect(psi(ref, normals(2_000, 1.5, 3))).toBeGreaterThan(0.25);
  });

  it("classifies with the conventional cut-offs", () => {
    expect([driftLevel(0.05), driftLevel(0.1), driftLevel(0.2), driftLevel(0.25)]).toEqual(["stable", "moderate", "moderate", "significant"]);
  });

  it("handles heavily tied data without dividing by zero", () => {
    const value = psi(new Array(500).fill(0), [...new Array(250).fill(0), ...new Array(250).fill(1)]);
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0.25);
  });

  it("ranks the shifted feature first, skips Time, and waits for enough rows", () => {
    const row = (i: number, shift: number, seedBase: number) => ({
      probability: 0.1,
      amount: 50 + (i % 7),
      v: Array.from({ length: 28 }, (_, k) => normals(1, k === 13 ? shift : 0, seedBase + i * 31 + k)[0]),
      receivedAt: i,
    });
    const reference = Array.from({ length: 300 }, (_, i) => row(i, 0, 10));
    const current = Array.from({ length: 300 }, (_, i) => row(i, 3, 99_999));
    const report = driftReport("m", reference, current);
    expect(report.features[0].feature).toBe("V14");
    expect(report.features[0].level).toBe("significant");
    expect(report.features.some((f) => f.feature === "Time")).toBe(false);
    expect(driftReport("m", reference.slice(0, 50), current.slice(0, 50)).features).toEqual([]);
  });
});

describe("shadowComparison", () => {
  it("measures agreement and each model's performance at the same threshold", () => {
    const rows = [
      { probability: 0.9, shadowProbability: 0.8, shadowModelVersion: "b", label: 1 as const },
      { probability: 0.2, shadowProbability: 0.7, shadowModelVersion: "b", label: 0 as const },
      { probability: 0.1, shadowProbability: 0.1, shadowModelVersion: "b", label: null },
      { probability: 0.4, shadowProbability: 0.6, shadowModelVersion: "b", label: 1 as const },
    ];
    const c = shadowComparison("a", rows, 0.5)!;
    expect(c).toMatchObject({ shadowModelVersion: "b", n: 4, agreement: 0.5, activeAlerts: 1, shadowAlerts: 3 });
    expect(c.active).toMatchObject({ tp: 1, fp: 0, fn: 1, n: 3 });
    expect(c.shadow).toMatchObject({ tp: 2, fp: 1, fn: 0, n: 3 });
    expect(shadowComparison("a", [], 0.5)).toBeNull();
  });
});

describe("reports", () => {
  it("lists every day in the range, across a DST change", () => {
    expect(daysBetween("2026-03-28", "2026-03-31")).toEqual(["2026-03-28", "2026-03-29", "2026-03-30", "2026-03-31"]);
    expect(daysBetween("2026-10-31", "2026-10-31")).toEqual(["2026-10-31"]);
  });

  it("zero-fills missing days and totals the rest", () => {
    const day = { date: "2026-10-02", total: 10, alerts: 3, open: 1, confirmedFraud: 1, falsePositive: 1, scoringFailed: 0, latencySumMs: 200 };
    const r = buildReport("2026-10-01", "2026-10-03", {
      days: [day],
      amounts: [{ day: "2026-10-02", alertAmount: 300, confirmedFraudAmount: 120 }],
      avgReviewMinutes: 4,
      labelled: { tp: 1, fp: 1, fn: 0, tn: 8 },
      topAlerts: [],
    });
    expect(r.days.map((d) => d.total)).toEqual([0, 10, 0]);
    expect(r.totals).toMatchObject({ total: 10, alerts: 3, alertAmount: 300, confirmedFraudAmount: 120 });
    expect(r.avgLatencyMs).toBe(20);
    expect(r.feedback).toMatchObject({ reviewed: 2, precision: 0.5 });
    expect(r.labelled.precision).toBe(0.5);
  });
});

describe("toCsv", () => {
  it("quotes separators and neutralises spreadsheet formulas", () => {
    expect(toCsv(["a", "b"], [["x,y", 1], ['say "hi"', null], ["=SUM(A1)", -3]])).toBe('a,b\r\n"x,y",1\r\n"say ""hi""",\r\n\'=SUM(A1),-3\r\n');
  });
});
