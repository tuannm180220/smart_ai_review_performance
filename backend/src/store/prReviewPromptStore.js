import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDatabaseEnabled, query } from "../db/pool.js";
import { getRequestUserId } from "../lib/requestContext.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const FILE_PATH = path.join(DATA_DIR, "pr-review-prompts.json");

// One override per (repo, skill kind). "base" keeps the old key (just the repo slug)
// so prompts saved before skills existed keep working as the repo's base skill.
function fileKey(repo, kind) {
  return kind === "base" ? repo : `${repo}::${kind}`;
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

function writeAllFile(overrides) {
  ensureDataDir();
  fs.writeFileSync(FILE_PATH, JSON.stringify(overrides, null, 2), "utf-8");
}

async function readAll() {
  if (!isDatabaseEnabled()) {
    const map = {};
    for (const entry of Object.values(readAllFile())) {
      const kind = entry.kind || "base";
      map[fileKey(entry.repo, kind)] = { ...entry, kind };
    }
    return map;
  }
  const userId = getRequestUserId();
  if (!userId) return {};
  const result = await query(
    `SELECT repo, kind, prompt_text, source, filename, updated_at FROM pr_review_prompts WHERE user_id = $1`,
    [userId]
  );
  const map = {};
  for (const row of result.rows) {
    const kind = row.kind || "base";
    map[fileKey(row.repo, kind)] = {
      repo: row.repo,
      kind,
      promptText: row.prompt_text,
      source: row.source || "typed",
      filename: row.filename || null,
      updatedAt: row.updated_at,
    };
  }
  return map;
}

export async function listPromptOverrides() {
  const all = await readAll();
  return Object.values(all).sort((a, b) => a.repo.localeCompare(b.repo) || a.kind.localeCompare(b.kind));
}

export async function getPromptOverride(repo, kind = "base") {
  if (!repo) return null;
  const all = await readAll();
  return all[fileKey(repo, kind)] || null;
}

export async function savePromptOverride({ repo, kind = "base", promptText, source, filename }) {
  const next = {
    repo,
    kind,
    promptText,
    source: source === "uploaded" ? "uploaded" : "typed",
    filename: filename || null,
    updatedAt: new Date().toISOString(),
  };

  if (isDatabaseEnabled()) {
    const userId = getRequestUserId();
    if (!userId) throw new Error("userId required to save a PR review prompt override");
    await query(
      `INSERT INTO pr_review_prompts (user_id, repo, kind, prompt_text, source, filename, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id, repo, kind) DO UPDATE SET
         prompt_text = EXCLUDED.prompt_text,
         source = EXCLUDED.source,
         filename = EXCLUDED.filename,
         updated_at = NOW()`,
      [userId, repo, kind, next.promptText, next.source, next.filename]
    );
    return next;
  }

  const all = readAllFile();
  all[fileKey(repo, kind)] = next;
  writeAllFile(all);
  return next;
}

export async function deletePromptOverride(repo, kind = "base") {
  if (isDatabaseEnabled()) {
    const userId = getRequestUserId();
    if (!userId) throw new Error("userId required to delete a PR review prompt override");
    await query(`DELETE FROM pr_review_prompts WHERE user_id = $1 AND repo = $2 AND kind = $3`, [userId, repo, kind]);
    return;
  }

  const all = readAllFile();
  delete all[fileKey(repo, kind)];
  writeAllFile(all);
}
