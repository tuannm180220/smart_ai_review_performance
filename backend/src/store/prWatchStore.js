import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDatabaseEnabled, query } from "../db/pool.js";
import { getRequestUserId } from "../lib/requestContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE_PATH = path.join(DATA_DIR, "pr-watch.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function itemKey(repo, prId) {
  return `${repo}#${prId}`;
}

function writeStateFile(state) {
  ensureDataDir();
  fs.writeFileSync(FILE_PATH, JSON.stringify(state, null, 2), "utf-8");
}

function readStateFile() {
  ensureDataDir();
  let state = null;
  if (fs.existsSync(FILE_PATH)) {
    try {
      state = JSON.parse(fs.readFileSync(FILE_PATH, "utf-8"));
    } catch {
      state = null;
    }
  }
  if (!state || state.date !== todayKey()) {
    state = { date: todayKey(), items: {} };
    writeStateFile(state);
  }
  return state;
}

async function readState() {
  if (!isDatabaseEnabled()) return readStateFile();
  const userId = getRequestUserId();
  if (!userId) return { date: todayKey(), items: {} };
  const date = todayKey();
  const result = await query(`SELECT data FROM pr_watch WHERE user_id = $1 AND date = $2`, [userId, date]);
  if (!result.rows[0]) {
    const state = { date, items: {} };
    await query(
      `INSERT INTO pr_watch (user_id, date, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id, date) DO NOTHING`,
      [userId, date, JSON.stringify(state)]
    );
    return state;
  }
  return typeof result.rows[0].data === "string" ? JSON.parse(result.rows[0].data) : result.rows[0].data;
}

async function writeState(state) {
  if (!isDatabaseEnabled()) {
    writeStateFile(state);
    return;
  }
  const userId = getRequestUserId();
  if (!userId) throw new Error("userId required for pr-watch");
  await query(
    `INSERT INTO pr_watch (user_id, date, data) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT (user_id, date) DO UPDATE SET data = EXCLUDED.data`,
    [userId, state.date, JSON.stringify(state)]
  );
}

export async function getWatchDate() {
  return (await readState()).date;
}

export async function getWatchItems() {
  const state = await readState();
  return Object.values(state.items).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function getWatchItem(repo, prId) {
  const state = await readState();
  return state.items[itemKey(repo, prId)] || null;
}

export async function addItemIfNew(item) {
  const state = await readState();
  const key = itemKey(item.repo, item.prId);
  if (state.items[key]) return null;
  state.items[key] = {
    ...item,
    status: "not_reviewed",
    reviewDocument: null,
    reviewedAt: null,
    firstSeenAt: new Date().toISOString(),
  };
  await writeState(state);
  return state.items[key];
}

export async function saveReview(repo, prId, document, extra = {}) {
  const state = await readState();
  const key = itemKey(repo, prId);
  if (!state.items[key]) return null;
  state.items[key] = {
    ...state.items[key],
    status: "reviewed",
    reviewDocument: document,
    reviewedAt: new Date().toISOString(),
    score: extra.score ?? null,
    strengths: extra.strengths || [],
    weaknesses: extra.weaknesses || [],
    ticketComplexity: extra.ticketComplexity || null,
    codeCompleteness: extra.codeCompleteness || null,
  };
  await writeState(state);
  return state.items[key];
}
