import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { isDatabaseEnabled, query } from "../db/pool.js";
import { getRequestUserId } from "../lib/requestContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE_PATH = path.join(DATA_DIR, "usage-events.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAllFile() {
  ensureDataDir();
  if (!fs.existsSync(FILE_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(FILE_PATH, "utf-8"));
  } catch {
    return [];
  }
}

function writeAllFile(events) {
  ensureDataDir();
  fs.writeFileSync(FILE_PATH, JSON.stringify(events, null, 2), "utf-8");
}

export async function appendEvent(event) {
  const record = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...event,
  };
  if (isDatabaseEnabled()) {
    const userId = getRequestUserId();
    await query(`INSERT INTO usage_events (user_id, payload, created_at) VALUES ($1, $2::jsonb, $3)`, [
      userId,
      JSON.stringify(record),
      record.timestamp,
    ]);
    return record;
  }
  const events = readAllFile();
  events.push(record);
  writeAllFile(events);
  return record;
}

export async function getAllEvents() {
  if (isDatabaseEnabled()) {
    const result = await query(`SELECT payload FROM usage_events ORDER BY created_at ASC`);
    return result.rows.map((r) => (typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload));
  }
  return readAllFile();
}
