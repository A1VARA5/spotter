// A tiny database interface so the same code runs on PGlite (tests, local) and Neon (Vercel).
import { DDL } from "./schema";

export type Db = {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
};

export async function pgliteDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) (await import("node:fs")).mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.exec(DDL);
  return {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await pg.query<T>(sql, params)).rows;
    },
  };
}

export async function neonDb(url: string): Promise<Db> {
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url);
  for (const stmt of DDL.split(";").map((s) => s.trim()).filter(Boolean)) await sql.query(stmt);
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.query(text, params)) as T[];
    },
  };
}

// One database per process. Kept on globalThis so dev hot reloads don't open a second PGlite on the same folder.
const g = globalThis as unknown as { __spotterDb?: Promise<Db> | null };

/** Neon when DATABASE_URL is set, otherwise a local PGlite folder (.data/). */
export function getDb(): Promise<Db> {
  g.__spotterDb ??= (process.env.DATABASE_URL ? neonDb(process.env.DATABASE_URL) : pgliteDb(".data/spotter")).catch((e) => {
    g.__spotterDb = null; // don't cache a failed start
    throw e;
  });
  return g.__spotterDb;
}
