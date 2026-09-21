import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, logError } from "../lib/logger.js";
import { isDatabaseEnabled, query } from "../db/pool.js";
import { getRequestUserId } from "../lib/requestContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const JSON_PATH = path.join(DATA_DIR, "records.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function recordId(repo, prId) {
  return `${repo}#${prId}`;
}

function asJson(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function createJsonStore() {
  ensureDataDir();

  function readAll() {
    if (!fs.existsSync(JSON_PATH)) return {};
    try {
      return JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
    } catch {
      return {};
    }
  }

  function writeAll(records) {
    fs.writeFileSync(JSON_PATH, JSON.stringify(records, null, 2), "utf-8");
  }

  return {
    kind: "json",
    async upsert(record) {
      const all = readAll();
      all[recordId(record.repo, record.prId)] = record;
      writeAll(all);
      return record;
    },
    async getAll() {
      return Object.values(readAll()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },
    async get(repo, prId) {
      return readAll()[recordId(repo, prId)] || null;
    },
    async getByRepo(repo) {
      return Object.values(readAll()).filter((r) => r.repo === repo);
    },
  };
}

function createPostgresStore() {
  return {
    kind: "postgres",
    async upsert(record) {
      const userId = getRequestUserId();
      if (!userId) throw new Error("userId required to upsert records");
      const id = recordId(record.repo, record.prId);
      await query(
        `INSERT INTO pr_ticket_records (user_id, id, repo, pr_id, data, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (user_id, id) DO UPDATE SET
           data = EXCLUDED.data,
           repo = EXCLUDED.repo,
           pr_id = EXCLUDED.pr_id,
           created_at = EXCLUDED.created_at`,
        [userId, id, record.repo, record.prId, JSON.stringify(record), record.createdAt || null]
      );
      return record;
    },
    async getAll() {
      const userId = getRequestUserId();
      if (userId) {
        const result = await query(
          `SELECT data FROM pr_ticket_records WHERE user_id = $1 ORDER BY created_at DESC NULLS LAST`,
          [userId]
        );
        return result.rows.map((r) => asJson(r.data));
      }
      const result = await query(`SELECT data FROM pr_ticket_records ORDER BY created_at DESC NULLS LAST`);
      return result.rows.map((r) => asJson(r.data));
    },
    async get(repo, prId) {
      const userId = getRequestUserId();
      if (!userId) throw new Error("userId required to get record");
      const result = await query(`SELECT data FROM pr_ticket_records WHERE user_id = $1 AND id = $2`, [
        userId,
        recordId(repo, prId),
      ]);
      return asJson(result.rows[0]?.data) || null;
    },
    async getByRepo(repo) {
      const userId = getRequestUserId();
      if (!userId) throw new Error("userId required to get records by repo");
      const result = await query(
        `SELECT data FROM pr_ticket_records WHERE user_id = $1 AND repo = $2 ORDER BY created_at DESC NULLS LAST`,
        [userId, repo]
      );
      return result.rows.map((r) => asJson(r.data));
    },
  };
}

let storeInstance = null;

export async function getStore() {
  if (storeInstance) return storeInstance;
  if (isDatabaseEnabled()) {
    storeInstance = createPostgresStore();
    log("Record store: using PostgreSQL.");
    return storeInstance;
  }
  storeInstance = createJsonStore();
  log("Record store: using JSON file (single-tenant).");
  return storeInstance;
}
