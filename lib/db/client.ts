import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as coreSchema from "@/lib/db/schema";
import * as artifactSchema from "@/lib/artifacts/schema";
import * as extractionQualitySchema from "@/lib/extraction-quality/schema";

const schema = { ...coreSchema, ...artifactSchema, ...extractionQualitySchema };
type Database = ReturnType<typeof drizzle<typeof schema>>;
type DatabaseState = { connectionString: string; pool: Pool; database: Database };

const databaseGlobal = globalThis as typeof globalThis & { __aiInfraDatabase?: DatabaseState };

function usesRequestScopedIo() {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

function connectionString() {
  if (process.env.E2E_TEST === "1") return process.env.E2E_DATABASE_URL?.trim();
  return process.env.DATABASE_URL?.trim();
}

export function isDatabaseConfigured() {
  return Boolean(connectionString());
}

async function databaseState(databaseUrl: string) {
  const current = databaseGlobal.__aiInfraDatabase;
  if (current?.connectionString === databaseUrl) return current;
  if (current) await current.pool.end();
  const pool = new Pool({
    connectionString: databaseUrl,
    max: Math.max(1, Number(process.env.DATABASE_POOL_SIZE) || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    allowExitOnIdle: true,
  });
  const state = { connectionString: databaseUrl, pool, database: drizzle(pool, { schema }) };
  databaseGlobal.__aiInfraDatabase = state;
  return state;
}

export async function closeDatabasePool() {
  const current = databaseGlobal.__aiInfraDatabase;
  if (!current) return;
  databaseGlobal.__aiInfraDatabase = undefined;
  await current.pool.end();
}

export async function withDatabase<T>(operation: (database: Database) => Promise<T>) {
  const databaseUrl = connectionString();
  if (!databaseUrl) return null;

  // Cloudflare Workers binds outbound sockets to a request. Reusing a pg Pool
  // across requests can strand the next request on a socket it does not own.
  if (usesRequestScopedIo()) {
    const pool = new Pool({ connectionString: databaseUrl, max: 1, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 5_000 });
    try {
      return await operation(drizzle(pool, { schema }));
    } finally {
      await pool.end();
    }
  }

  const state = await databaseState(databaseUrl);
  return operation(state.database);
}
