import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDatabaseEnabled, query } from "../db/pool.js";
import { getRequestUserId } from "../lib/requestContext.js";

// Per-PR review exceptions: intended behaviours / agreed deviations the team declares
// (typed or uploaded .md) so the AI review does not report them. Stored apart from the
// review itself because they are usually written BEFORE the first review.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE_PATH = path.join(DATA_DIR, "pr-exceptions.json");

export function exceptionId(repo, prId) {
  return `${repo}#${prId}`;
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readAllFile() {
  ensureDataDir();
  if (!fs.existsSync(FILE_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(FILE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function writeAllFile(all) {
  ensureDataDir();
  fs.writeFileSync(FILE_PATH, JSON.stringify(all, null, 2), "utf-8");
}

async function readAll() {
  if (!isDatabaseEnabled()) return readAllFile();
  const userId = getRequestUserId();
  if (!userId) return {};
  const result = await query(`SELECT id, data FROM pr_exceptions WHERE user_id = $1`, [userId]);
  const map = {};
  for (const row of result.rows) map[row.id] = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  return map;
}

export async function listPrExceptions({ repo } = {}) {
  const all = await readAll();
  return Object.values(all).filter((e) => (repo ? e.repo === repo : true));
}

export async function getPrException(repo, prId) {
  const all = await readAll();
  return all[exceptionId(repo, prId)] || null;
}

export async function savePrException({ repo, prId, text, source, filename, by }) {
  const id = exceptionId(repo, prId);
  const next = {
    id,
    repo,
    prId: Number.isNaN(Number(prId)) ? prId : Number(prId),
    text,
    source: source === "uploaded" ? "uploaded" : "typed",
    filename: filename || null,
    by: by || null,
    updatedAt: new Date().toISOString(),
  };
  if (isDatabaseEnabled()) {
    const userId = getRequestUserId();
    if (!userId) throw new Error("userId required to save PR exceptions");
    await query(
      `INSERT INTO pr_exceptions (user_id, id, data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data`,
      [userId, id, JSON.stringify(next)]
    );
    return next;
  }
  const all = readAllFile();
  all[id] = next;
  writeAllFile(all);
  return next;
}

export async function deletePrException(repo, prId) {
  const id = exceptionId(repo, prId);
  if (isDatabaseEnabled()) {
    const userId = getRequestUserId();
    if (!userId) throw new Error("userId required to delete PR exceptions");
    await query(`DELETE FROM pr_exceptions WHERE user_id = $1 AND id = $2`, [userId, id]);
    return;
  }
  const all = readAllFile();
  delete all[id];
  writeAllFile(all);
}
