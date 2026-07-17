import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";

function connectionString() {
  if (process.env.E2E_TEST === "1") return process.env.E2E_DATABASE_URL?.trim();
  return process.env.DATABASE_URL?.trim();
}

export function isDatabaseConfigured() {
  return Boolean(connectionString());
}

export async function withDatabase<T>(operation: (database: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>) {
  const databaseUrl = connectionString();
  if (!databaseUrl) return null;

  const pool = new Pool({ connectionString: databaseUrl, max: 1, idleTimeoutMillis: 5_000 });
  const database = drizzle(pool, { schema });
  try {
    return await operation(database);
  } finally {
    await pool.end();
  }
}
