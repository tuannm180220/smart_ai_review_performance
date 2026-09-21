import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listAuthors } from "../services/performanceReviewService.js";
import { isDatabaseEnabled, query } from "../db/pool.js";
import { getRequestUserId } from "../lib/requestContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE_PATH = path.join(DATA_DIR, "author-emails.json");

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

function writeAllFile(mappings) {
  ensureDataDir();
  fs.writeFileSync(FILE_PATH, JSON.stringify(mappings, null, 2), "utf-8");
}

export function authorKey(author, authorUsername) {
  return (authorUsername || author || "").trim().toLowerCase();
}

async function readAllMappings() {
  if (!isDatabaseEnabled()) return readAllFile();
  const userId = getRequestUserId();
  if (userId) {
    const result = await query(`SELECT username, email FROM author_emails WHERE user_id = $1`, [userId]);
    const map = {};
    for (const row of result.rows) map[row.username] = row.email;
    return map;
  }
  // Admin / no user context: merge all tenants (last write wins per username).
  const result = await query(`SELECT username, email FROM author_emails`);
  const map = {};
  for (const row of result.rows) {
    if (row.email) map[row.username] = row.email;
  }
  return map;
}

export async function resolveEmail(author, authorUsername) {
  const key = authorKey(author, authorUsername);
  if (!key) return null;
  const mappings = await readAllMappings();
  return mappings[key] || null;
}

export async function setMapping(key, email) {
  const normalizedKey = key.trim().toLowerCase();
  if (isDatabaseEnabled()) {
    const userId = getRequestUserId();
    if (!userId) {
      // Admin global mapping: upsert under a synthetic scope is awkward;
      // store against the first user that already has this key, or skip user filter
      // by using a dedicated admin row — for simplicity upsert into a shared "admin" namespace
      // via NULL user is not allowed by FK. Use merge-all read and write to every user that
      // has this author, else require a request user.
      throw new Error("Author email mapping requires a user context in multi-tenant mode");
    }
    if (email) {
      await query(
        `INSERT INTO author_emails (user_id, username, email) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, username) DO UPDATE SET email = EXCLUDED.email`,
        [userId, normalizedKey, email.trim()]
      );
    } else {
      await query(`DELETE FROM author_emails WHERE user_id = $1 AND username = $2`, [userId, normalizedKey]);
    }
    return readAllMappings();
  }
  const mappings = readAllFile();
  if (email) {
    mappings[normalizedKey] = email.trim();
  } else {
    delete mappings[normalizedKey];
  }
  writeAllFile(mappings);
  return mappings;
}

/** Admin helper: set mapping across all users who have this username, or insert for no-op if none. */
export async function setMappingGlobal(key, email) {
  if (!isDatabaseEnabled()) return setMapping(key, email);
  const normalizedKey = key.trim().toLowerCase();
  const users = await query(`SELECT id FROM users`);
  for (const row of users.rows) {
    if (email) {
      await query(
        `INSERT INTO author_emails (user_id, username, email) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, username) DO UPDATE SET email = EXCLUDED.email`,
        [row.id, normalizedKey, email.trim()]
      );
    } else {
      await query(`DELETE FROM author_emails WHERE user_id = $1 AND username = $2`, [row.id, normalizedKey]);
    }
  }
  return readAllMappings();
}

export async function listMappings() {
  const authors = await listAuthors();
  const mappings = await readAllMappings();
  return authors.map(({ author, authorUsername }) => {
    const key = authorKey(author, authorUsername);
    return { key, author, authorUsername, email: mappings[key] || null };
  });
}
