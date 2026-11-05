import "server-only";
import { Pool, types } from "pg";

// DATE columns as 'YYYY-MM-DD' strings (not JS Dates shifted by the server's timezone);
// BIGINT sums as numbers (latency sums stay far below 2^53).
types.setTypeParser(types.builtins.DATE, (v) => v);
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

const g = globalThis as typeof globalThis & { __fraudPool?: Pool };

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set. See web/.env.example.");
  const pool = new Pool({ connectionString, max: 10 });
  pool.on("error", (e) => console.error(JSON.stringify({ level: "error", service: "web", event: "db_pool_error", message: e.message })));
  return pool;
}

/** One pool per server process (kept on globalThis so dev hot-reloads don't leak connections). */
export function db(): Pool {
  return (g.__fraudPool ??= createPool());
}
