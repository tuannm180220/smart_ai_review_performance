import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool, initDb, isMultiTenant } from "./pool.js";
import { log, logError } from "../lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const envPath = path.join(__dirname, "..", "..", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

export async function runMigrations() {
  if (!isMultiTenant()) {
    throw new Error("DATABASE_URL is required to run migrations (PostgreSQL multi-tenant)");
  }
  await initDb();
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  await getPool().query(sql);
  log("PostgreSQL schema migrated.");
}

async function main() {
  try {
    await runMigrations();
    process.exit(0);
  } catch (err) {
    logError("Migration failed:", err.message);
    process.exit(1);
  }
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect) {
  main();
}
