import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createLogger } from "../logger";

const log = createLogger("db");

/**
 * Single Prisma client instance for the entire backend (Vercel API + listener).
 * Cached on `globalThis` to survive Next.js dev-server hot reloads without
 * leaking connections.
 *
 * Prisma 7 defaults to the lightweight "client" engine, which requires a
 * driver adapter. We use `@prisma/adapter-pg` (node-postgres) since `pg` is
 * already a project dependency.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function buildConnectionString(): string {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.length > 0) {
    return process.env.DATABASE_URL;
  }

  const host = process.env.DB_HOST;
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;
  const name = process.env.DB_NAME;
  if (!host || !user || !password || !name) {
    throw new Error(
      "Database connection not configured. Set DATABASE_URL, or DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD."
    );
  }

  const port = process.env.DB_PORT ?? "5432";
  // pg v8 currently treats `require` as `verify-full` silently and warns about it;
  // be explicit to match the future-default and silence the deprecation notice.
  const sslmode = host === "localhost" || host === "127.0.0.1" ? "disable" : "verify-full";
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${name}?sslmode=${sslmode}`;
}

function createClient(): PrismaClient {
  // `max` is the upper bound on concurrent DB connections held by this process.
  // Sized to leave headroom for the per-tick crons (position-seller, market-sync,
  // janitors) plus any in-flight API requests, while staying under typical Nile
  // plan caps. Override with DB_POOL_MAX if needed.
  const max = Number.parseInt(process.env.DB_POOL_MAX ?? "30", 10) || 30;
  const adapter = new PrismaPg({ connectionString: buildConnectionString(), max });
  return new PrismaClient({
    adapter,
    log:
      process.env.LOG_LEVEL === "debug"
        ? [{ emit: "event", level: "query" }, "warn", "error"]
        : ["warn", "error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export async function testConnection(): Promise<boolean> {
  try {
    const rows = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW() AS now`;
    log.info(`connected (server time ${rows[0]?.now.toISOString() ?? "unknown"})`);
    return true;
  } catch (error) {
    log.error("connection failed:", error);
    return false;
  }
}
