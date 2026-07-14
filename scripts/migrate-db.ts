import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Client } from "pg";

const MIGRATIONS_PATH = resolve("drizzle");

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL is required to run database migrations.");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamp with time zone DEFAULT now() NOT NULL
      )
    `);
    const migrations = (await readdir(MIGRATIONS_PATH, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^\d{4}_/.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    for (const migrationId of migrations) {
      const existing = await client.query("SELECT id FROM app_schema_migrations WHERE id = $1", [migrationId]);
      if (existing.rowCount) {
        console.log(`Migration ${migrationId} is already applied.`);
        continue;
      }

      const sql = await readFile(resolve(MIGRATIONS_PATH, migrationId, "migration.sql"), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO app_schema_migrations (id) VALUES ($1)", [migrationId]);
        await client.query("COMMIT");
        console.log(`Applied migration ${migrationId}.`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
