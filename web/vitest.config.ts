import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./", import.meta.url)),
        // "server-only" throws outside a React Server Component build; tests run in plain Node.
        "server-only": fileURLToPath(new URL("./test/empty.ts", import.meta.url)),
      },
    },
    test: {
      // Integration tests must never touch the real database.
      env: { ...env, DATABASE_URL: env.DATABASE_URL_TEST ?? "" },
      fileParallelism: false,
    },
  };
});
