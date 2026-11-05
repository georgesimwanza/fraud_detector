/**
 * Creates a user, or resets an existing user's password and role.
 * This is the ONLY way to create the first administrator.
 *
 *   npx tsx --env-file=.env.local scripts/create-user.ts --email you@example.com --role admin
 *
 * Prompts for the password (not echoed) unless --password is given.
 */
import { hash } from "bcryptjs";
import { Client } from "pg";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) =>
      write.call(rl, s.startsWith(question) ? s : "*".repeat(s.length));
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, role: { type: "string" }, password: { type: "string" }, test: { type: "boolean" } },
  });
  const email = values.email?.trim().toLowerCase();
  const role = values.role;
  if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) throw new Error("--email is required");
  if (role !== "admin" && role !== "analyst") throw new Error("--role must be admin or analyst");

  const password = values.password ?? (await askHidden(`Password for ${email}: `));
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  const url = values.test ? process.env.DATABASE_URL_TEST : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. See .env.example.");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const passwordHash = await hash(password, 12);
    const { rows } = await client.query<{ id: string; inserted: boolean }>(
      `INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, active = true
       RETURNING id, (xmax = 0) AS inserted`,
      [email, passwordHash, role],
    );
    await client.query(
      "INSERT INTO audit_logs (actor_email, role, action, target, after) VALUES ('(script)', NULL, $1, $2, $3)",
      [rows[0].inserted ? "user.create" : "user.reset", `users/${rows[0].id}`, { email, role }],
    );
    console.log(`${rows[0].inserted ? "Created" : "Updated"} ${role} ${email}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
