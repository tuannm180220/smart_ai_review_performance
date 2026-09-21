import { createHash } from "node:crypto";

// A dependency-free "poor man's embedding": hash each token into a fixed-size
// vector (the hashing trick), so similar text lands close together without
// needing an external embeddings API or a persisted vocabulary. Good enough to
// rank past PR reviews by overlap in ticket/title/file-path/signal text.
// 512 empirically keeps hash collisions rare enough for review-sized text (title +
// ticket + a handful of filenames) that similarity ordering stays stable; smaller
// dimensions (e.g. 192) showed enough collision noise to flip the ranking of
// genuinely related vs. unrelated PRs in testing.
const EMBEDDING_DIM = 512;

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "is", "this", "that", "it",
  "as", "at", "by", "from", "be", "are", "was", "were", "will", "not", "no", "do", "does", "did",
  "if", "but", "so", "than", "then", "into", "over", "under", "about", "up", "down", "out", "off",
  "can", "could", "should", "would", "may", "might", "we", "you", "your", "our", "their", "they",
  "he", "she", "i",
]);

function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Directory scaffolding (backend/src/services/…) repeats across almost every file in a
// repo and would otherwise dominate token overlap; the basename is what actually
// identifies the feature area a PR touched.
function fileBasename(filePath) {
  const name = String(filePath || "").split(/[/\\]/).pop() || "";
  return name.replace(/\.[a-z0-9]+$/i, "");
}

function hashToken(token) {
  const digest = createHash("sha1").update(token).digest();
  return { index: digest.readUInt32BE(0) % EMBEDDING_DIM, sign: digest[4] & 1 ? 1 : -1 };
}

/** Hashing-trick bag-of-words embedding, L2-normalized so dot product == cosine similarity. */
export function embedText(text) {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  const counts = new Map();
  for (const token of tokenize(text)) counts.set(token, (counts.get(token) || 0) + 1);
  for (const [token, count] of counts) {
    const { index, sign } = hashToken(token);
    vector[index] += sign * (1 + Math.log(count));
  }
  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm > 0) for (let i = 0; i < vector.length; i++) vector[i] /= norm;
  return vector;
}

export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** Builds the text blob an embedding is computed from. Callers pass whatever fields they have. */
export function buildReviewEmbeddingText({
  title,
  jiraKey,
  ticketSummary,
  changedFiles,
  summary,
  strengths,
  improvements,
  signals,
} = {}) {
  return [
    title,
    jiraKey,
    ticketSummary,
    ...(changedFiles || []).map(fileBasename),
    summary,
    ...(strengths || []),
    ...(improvements || []),
    ...(signals || []),
  ]
    .filter(Boolean)
    .join(" \n ");
}
