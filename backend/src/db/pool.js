import crypto from "node:crypto";
import pg from "pg";
import { log } from "../lib/logger.js";

const { Pool } = pg;

let pgPool = null;

/** Multi-tenant when DATABASE_URL is set (PostgreSQL required). */
export function isMultiTenant() {
  return Boolean(process.env.DATABASE_URL);
}

/** @deprecated use isMultiTenant */
export function isDatabaseEnabled() {
  return isMultiTenant();
}

export function getDbKind() {
  return isMultiTenant() ? "postgres" : null;
}

function openPostgres() {
  if (pgPool) return pgPool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const needsSsl = /sslmode=require/i.test(url);
  pgPool = new Pool({
    connectionString: url,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
  });
  pgPool.on("error", (err) => {
    log(`PostgreSQL pool error: ${err.message}`);
  });
  return pgPool;
}

export async function initDb() {
  if (!isMultiTenant()) return { kind: null };
  openPostgres();
  log("Multi-tenant: using PostgreSQL (DATABASE_URL).");
  return { kind: "postgres" };
}

export function getPool() {
  return openPostgres();
}

/** Run a parameterized query ($1, $2, …). Returns { rows }. */
export async function query(text, params = []) {
  if (!isMultiTenant()) throw new Error("DATABASE_URL is required for multi-tenant mode");
  return openPostgres().query(text, params);
}

export function newUserId() {
  return crypto.randomUUID();
}
