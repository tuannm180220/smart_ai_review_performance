#!/usr/bin/env node
/**
 * Import legacy backend/data JSON files into one Postgres user.
 *
 * Usage:
 *   node scripts/importLocalData.js --email you@example.com --password 'secret123'
 *
 * Requires DATABASE_URL.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { isMultiTenant, query, newUserId, initDb, getDbKind } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { writeConfigForUser } from "../src/config/configStore.js";
import { log, logError } from "../src/lib/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");

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

async function main() {
  const email = (arg("email") || "").trim().toLowerCase();
  const password = arg("password");
  if (!email || !password) {
    console.error("Usage: node scripts/importLocalData.js --email you@example.com --password 'secret'");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL || !isMultiTenant()) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  await runMigrations();
  await initDb();

  let userId;
  const existing = await query(`SELECT id FROM users WHERE email = $1`, [email]);
  if (existing.rows[0]) {
    userId = existing.rows[0].id;
    log(`Using existing user ${email} (${userId})`);
    const hash = await bcrypt.hash(password, 10);
    await query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, userId]);
    log(`Updated password for ${email}`);
  } else {
    const hash = await bcrypt.hash(password, 10);
    userId = newUserId();
    await query(`INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)`, [
      userId,
      email,
      hash,
    ]);
    log(`Created user ${email} (${userId})`);
  }

  const config = readJson("config.json", {});
  await writeConfigForUser(userId, config);
  log("Imported config.json");

  const recordsObj = readJson("records.json", {});
  let recordCount = 0;
  for (const record of Object.values(recordsObj || {})) {
    if (!record?.repo || record.prId == null) continue;
    const id = `${record.repo}#${record.prId}`;
    await query(
      `INSERT INTO pr_ticket_records (user_id, id, repo, pr_id, data, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data, created_at = EXCLUDED.created_at`,
      [userId, id, record.repo, record.prId, JSON.stringify(record), record.createdAt || null]
    );
    recordCount += 1;
  }
  log(`Imported ${recordCount} PR records`);

  const reviews = readJson("pr-reviews.json", {});
  let reviewCount = 0;
  for (const [id, data] of Object.entries(reviews || {})) {
    await query(
      `INSERT INTO pr_reviews (user_id, id, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data`,
      [userId, id, JSON.stringify(data)]
    );
    reviewCount += 1;
  }
  log(`Imported ${reviewCount} PR reviews`);

  const authors = readJson("author-emails.json", {});
  let authorCount = 0;
  for (const [username, em] of Object.entries(authors || {})) {
    await query(
      `INSERT INTO author_emails (user_id, username, email) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, username) DO UPDATE SET email = EXCLUDED.email`,
      [userId, username, em]
    );
    authorCount += 1;
  }
  log(`Imported ${authorCount} author email mappings`);

  const events = readJson("usage-events.json", []);
  let eventCount = 0;
  if (Array.isArray(events)) {
    for (const event of events) {
      await query(`INSERT INTO usage_events (user_id, payload, created_at) VALUES ($1, $2::jsonb, $3)`, [
        userId,
        JSON.stringify(event),
        event.timestamp || new Date().toISOString(),
      ]);
      eventCount += 1;
    }
  }
  log(`Imported ${eventCount} usage events`);

  const watch = readJson("pr-watch.json", null);
  if (watch?.date) {
    await query(
      `INSERT INTO pr_watch (user_id, date, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id, date) DO UPDATE SET data = EXCLUDED.data`,
      [userId, watch.date, JSON.stringify(watch)]
    );
    log(`Imported pr-watch for ${watch.date}`);
  }

  log(`Done (backend=${getDbKind()}).`);
  process.exit(0);
}

main().catch((err) => {
  logError("Import failed:", err.message);
  process.exit(1);
});
