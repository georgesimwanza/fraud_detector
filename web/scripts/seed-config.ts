/**
 * Registers a model bundle in model_versions and creates (or updates) the settings row.
 * The app refuses to score transactions until this has run — it never invents a threshold.
 *
 *   npx tsx --env-file=.env.local scripts/seed-config.ts                       # newest bundle in ../models
 *   npx tsx --env-file=.env.local scripts/seed-config.ts --bundle ../models/<v> --threshold 0.62
 *
 * Default threshold: the bundle's suggested_threshold (max validation F1).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "pg";

interface Metadata {
  version: string;
  trained_at: string;
  dataset?: string;
  suggested_threshold: number;
  metrics?: unknown;
  stub?: boolean;
}

function newestBundle(modelsDir: string): string {
  const bundles = readdirSync(modelsDir)
    .map((d) => join(modelsDir, d))
    .filter((d) => existsSync(join(d, "metadata.json")));
  if (bundles.length === 0) throw new Error(`No bundles in ${modelsDir}. Run training/make_stub_bundle.py first.`);
  const meta = (d: string) => JSON.parse(readFileSync(join(d, "metadata.json"), "utf8")) as Metadata;
  return bundles.sort((a, b) => meta(a).trained_at.localeCompare(meta(b).trained_at)).at(-1)!;
}

async function main() {
  const { values } = parseArgs({ options: { bundle: { type: "string" }, threshold: { type: "string" }, test: { type: "boolean" } } });
  const bundle = values.bundle ? resolve(values.bundle) : newestBundle(resolve(__dirname, "..", "..", "models"));
  const meta = JSON.parse(readFileSync(join(bundle, "metadata.json"), "utf8")) as Metadata;
  const threshold = values.threshold !== undefined ? Number(values.threshold) : meta.suggested_threshold;
  if (!(threshold >= 0.01 && threshold <= 0.99)) throw new Error(`Threshold ${threshold} is outside 0.01–0.99.`);

  const url = values.test ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO model_versions (version, stub, trained_at, dataset, suggested_threshold, metrics)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (version) DO UPDATE SET stub = EXCLUDED.stub, trained_at = EXCLUDED.trained_at,
         dataset = EXCLUDED.dataset, suggested_threshold = EXCLUDED.suggested_threshold, metrics = EXCLUDED.metrics`,
      [meta.version, meta.stub === true, meta.trained_at, meta.dataset ?? null, meta.suggested_threshold, JSON.stringify(meta.metrics ?? null)],
    );
    await client.query(
      `INSERT INTO settings (id, threshold, active_model_version) VALUES (1, $1, $2)
       ON CONFLICT (id) DO UPDATE SET threshold = EXCLUDED.threshold, active_model_version = EXCLUDED.active_model_version, updated_at = now()`,
      [threshold, meta.version],
    );
    await client.query(
      "INSERT INTO audit_logs (actor_email, action, target, after) VALUES ('(script)', 'config.seed', 'settings', $1)",
      [{ threshold, activeModelVersion: meta.version }],
    );
    await client.query("COMMIT");
    console.log(`Active model ${meta.version}${meta.stub ? " (STUB)" : ""}, threshold ${threshold}`);
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
