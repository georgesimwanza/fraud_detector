// The zod contract must accept and reject exactly what the pydantic contract does (see contract/fixtures.json).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_ORDER, TransactionInSchema, isHighRisk } from "./schemas";

interface Case {
  name: string;
  payload: unknown;
  field?: string;
  stripped?: string[];
}
const fixtures: { valid: Case[]; invalid: Case[] } = JSON.parse(
  readFileSync(join(__dirname, "..", "..", "contract", "fixtures.json"), "utf8"),
);

describe("contract", () => {
  it("has the fixed feature order", () => {
    expect(FEATURE_ORDER).toHaveLength(30);
    expect(FEATURE_ORDER[0]).toBe("Time");
    expect(FEATURE_ORDER[29]).toBe("Amount");
    expect(FEATURE_ORDER.slice(1, 29)).toEqual(Array.from({ length: 28 }, (_, i) => `V${i + 1}`));
  });

  it("FR6: a score exactly at the threshold is high risk (≥, not >)", () => {
    expect(isHighRisk(0.62, 0.62)).toBe(true);
    expect(isHighRisk(0.6199, 0.62)).toBe(false);
    expect(isHighRisk(0.6201, 0.62)).toBe(true);
    expect(isHighRisk(0.01, 0.01)).toBe(true);
    expect(isHighRisk(0.99, 0.99)).toBe(true);
  });

  it.each(fixtures.valid)("accepts: $name", (c) => {
    const result = TransactionInSchema.safeParse(c.payload);
    expect(result.success).toBe(true);
    for (const key of c.stripped ?? []) expect(result.data).not.toHaveProperty(key);
  });

  it.each(fixtures.invalid)("rejects: $name", (c) => {
    const result = TransactionInSchema.safeParse(c.payload);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => String(i.path[0]))).toContain(c.field);
  });
});
