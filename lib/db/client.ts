import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function withDatabase<T>(operation: (database: ReturnType<typeof drizzle<typeof schema>>) => Promise<T>) {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;

  const pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 5_000 });
  const database = drizzle(pool, { schema });
  try {
    return await operation(database);
  } finally {
    await pool.end();
  }
}
