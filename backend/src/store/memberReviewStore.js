import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { matchesAuthor } from "../lib/authorIdentity.js";
import { isDatabaseEnabled, query } from "../db/pool.js";
import { getRequestUserId } from "../lib/requestContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE_PATH = path.join(DATA_DIR, "member-reviews.json");

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

function writeAllFile(reviews) {
  ensureDataDir();
  fs.writeFileSync(FILE_PATH, JSON.stringify(reviews, null, 2), "utf-8");
}

async function readAll() {
  if (!isDatabaseEnabled()) return readAllFile();
  const userId = getRequestUserId();
  if (!userId) return {};
  const result = await query(`SELECT id, data FROM member_reviews WHERE user_id = $1`, [userId]);
  const map = {};
  for (const row of result.rows) {
    map[row.id] = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  }
  return map;
}

/** Persist one finished member review (report + the date range it covered). */
export async function saveMemberReview(review) {
  const next = {
    ...review,
    id: crypto.randomUUID(),
    from: review.from || null,
    to: review.to || null,
    reviewedAt: new Date().toISOString(),
  };
  if (isDatabaseEnabled()) {
    const userId = getRequestUserId();
    if (!userId) throw new Error("userId required to save member review");
    await query(`INSERT INTO member_reviews (user_id, id, data, created_at) VALUES ($1, $2, $3::jsonb, $4)`, [
      userId,
      next.id,
      JSON.stringify(next),
      next.reviewedAt,
    ]);
    return next;
  }
  const all = readAllFile();
  all[next.id] = next;
  writeAllFile(all);
  return next;
}

export async function getMemberReview(id) {
  const all = await readAll();
  return all[id] || null;
}

/** Past reviews of one person, newest first — summary fields only (no report body). */
export async function listMemberReviews({ author, authorUsername } = {}) {
  return Object.values(await readAll())
    .filter((r) => matchesAuthor(r, author, authorUsername))
    .sort((a, b) => new Date(b.reviewedAt) - new Date(a.reviewedAt))
    .map((r) => ({
      id: r.id,
      author: r.author,
      authorUsername: r.authorUsername || null,
      from: r.from,
      to: r.to,
      provider: r.provider,
      mode: r.mode,
      savedReviews: r.coverage?.savedReviews ?? r.metrics?.savedReviews ?? null,
      reviewedAt: r.reviewedAt,
    }));
}
