import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesAuthor } from "../lib/authorIdentity.js";
import { isDatabaseEnabled, query } from "../db/pool.js";
import { getRequestUserId } from "../lib/requestContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE_PATH = path.join(DATA_DIR, "pr-reviews.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function reviewId(repo, prId) {
  return `${repo}#${prId}`;
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

function withinRange(iso, from, to) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1) return false;
  return true;
}

export function filterPrReviews(reviews, { author, authorUsername, from, to, repo } = {}) {
  return (reviews || [])
    .filter((r) => (repo ? r.repo === repo : true))
    .filter((r) => matchesAuthor(r, author, authorUsername))
    .filter((r) => (from || to ? withinRange(r.prCreatedAt || r.createdAt, from, to) : true))
    .sort((a, b) => new Date(b.prCreatedAt || b.reviewedAt) - new Date(a.prCreatedAt || a.reviewedAt));
}

async function readAll() {
  if (!isDatabaseEnabled()) return readAllFile();
  const userId = getRequestUserId();
  if (!userId) return {};
  const result = await query(`SELECT id, data FROM pr_reviews WHERE user_id = $1`, [userId]);
  const map = {};
  for (const row of result.rows) {
    map[row.id] = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
  }
  return map;
}

export async function upsertPrReview(review) {
  const id = reviewId(review.repo, review.prId);
  const next = {
    ...review,
    id,
    reviewedAt: review.reviewedAt || new Date().toISOString(),
  };
  if (isDatabaseEnabled()) {
    const userId = getRequestUserId();
    if (!userId) throw new Error("userId required to upsert PR review");
    await query(
      `INSERT INTO pr_reviews (user_id, id, data) VALUES ($1, $2, $3::jsonb)
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

export async function getPrReview(repo, prId) {
  const all = await readAll();
  return all[reviewId(repo, prId)] || null;
}

export async function listPrReviews(filters = {}) {
  return filterPrReviews(Object.values(await readAll()), filters);
}

export async function listPrReviewStatuses({ repo } = {}) {
  const statuses = {};
  for (const review of Object.values(await readAll())) {
    if (repo && review.repo !== repo) continue;
    statuses[review.id] = {
      reviewedAt: review.reviewedAt,
      ticketComplexity: review.ticketComplexity,
      codeCompleteness: review.codeCompleteness,
    };
  }
  return statuses;
}
