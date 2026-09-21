#!/usr/bin/env node
/**
 * Seed one Postgres app user from backend/data/config.json (+ optional JSON dumps).
 *
 * Usage:
 *   node scripts/seedAccountFromLocal.js --email you@example.com --password 'login-pass'
 *
 * Requires DATABASE_URL (PostgreSQL).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { initDb, query, newUserId, getDbKind, isMultiTenant } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { writeConfigForUser } from "../src/config/configStore.js";
import { log, logError } from "../src/lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

const envPath = path.join(ROOT, ".env");
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

function arg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
}

function readJson(file, fallback) {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fallback;
  }
}

async function ensureUser(email, password) {
  const existing = await query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rows[0]) {
    const userId = existing.rows[0].id;
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId]);
      log(`Reset password for ${email}`);
    }
    return userId;
  }
  if (!password || String(password).length < 8) {
    throw new Error(`User ${email} does not exist — pass --password (min 8 chars) to create`);
  }
  const userId = newUserId();
  const hash = await bcrypt.hash(password, 10);
  await query(`INSERT INTO users (id, email, password_hash) VALUES ($1,$2,$3)`, [userId, email, hash]);
  await query(`INSERT INTO user_configs (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
  log(`Created user ${email}`);
  return userId;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (PostgreSQL multi-tenant).");
    process.exit(1);
  }
  if (!isMultiTenant()) {
    console.error("Multi-tenant is not active");
    process.exit(1);
  }

  await runMigrations();
  await initDb();
  if (getDbKind() !== "postgres") {
    console.error("Expected Postgres backend");
    process.exit(1);
  }

  const email =
    (arg("email") || "").trim().toLowerCase() ||
    (() => {
      try {
        return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")).atlassianEmail?.trim().toLowerCase();
      } catch {
        return "";
      }
    })();
  const password = arg("password");
  if (!email) {
    console.error("Pass --email you@example.com");
    process.exit(1);
  }

  const userId = await ensureUser(email, password);

  if (fs.existsSync(CONFIG_PATH)) {
    await writeConfigForUser(userId, JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")));
    log("Seeded config.json");
  }

  const records = readJson("records.json", null);
  let recordCount = 0;
  if (records && typeof records === "object") {
    for (const record of Object.values(records)) {
      if (!record?.repo || record.prId == null) continue;
      const id = `${record.repo}#${record.prId}`;
      await query(
        `INSERT INTO pr_ticket_records (user_id, id, repo, pr_id, data, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6)
         ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at`,
        [userId, id, record.repo, record.prId, JSON.stringify(record), record.createdAt || null]
      );
      recordCount += 1;
    }
  }
  log(`Seeded ${recordCount} records from records.json`);

  const check = await query(
    `SELECT u.email, c.atlassian_email, c.jira_base_url, c.bitbucket_workspace,
            length(c.atlassian_api_token_enc) AS at_len, length(c.bitbucket_api_token_enc) AS bb_len
     FROM users u
     LEFT JOIN user_configs c ON c.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  log("Seed result:", check.rows[0]);
  process.exit(0);
}

main().catch((err) => {
  logError("Seed failed:", err.message);
  process.exit(1);
});
