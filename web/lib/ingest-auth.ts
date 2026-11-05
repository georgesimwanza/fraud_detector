import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Checks the presented ingest key against INGEST_API_KEY_SHA256. Only the hash is stored;
 * hashing first gives equal-length buffers, so the comparison is constant-time.
 */
export function verifyIngestKey(presented: string | null): boolean {
  const expectedHex = process.env.INGEST_API_KEY_SHA256 ?? "";
  if (!/^[0-9a-f]{64}$/i.test(expectedHex)) {
    throw new Error("INGEST_API_KEY_SHA256 is not set to a 64-character hex SHA-256. See web/.env.example.");
  }
  const actual = createHash("sha256").update(presented ?? "", "utf8").digest();
  return timingSafeEqual(actual, Buffer.from(expectedHex, "hex"));
}
