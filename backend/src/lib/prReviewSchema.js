export const COMPLEXITY = new Set(["low", "medium", "high"]);
export const COMPLETENESS = new Set(["incomplete", "adequate", "solid", "excellent"]);
export const PR_REVIEW_SIGNALS = new Set([
  "tight-scope",
  "bloated-scope",
  "tests-present",
  "tests-missing",
  "good-error-handling",
  "weak-error-handling",
  "clear-diff",
  "hard-to-review",
  "security-risk",
  "matches-ticket",
  "partial-ticket",
]);

/** Weakness categories for the member report — each maps negative signals to one group. */
export const WEAKNESS_GROUPS = {
  scope: ["bloated-scope", "hard-to-review"],
  tests: ["tests-missing"],
  "error-handling": ["weak-error-handling"],
  security: ["security-risk"],
  requirements: ["partial-ticket"],
};

const MAX_STRENGTHS = 3;
const MAX_IMPROVEMENTS = 4;
const MAX_BULLET_CHARS = 140;
const MAX_SUMMARY_CHARS = 220;
const MAX_RATIONALE_CHARS = 160;

export function clipText(value, max) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return "";
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(" ");
  const kept = (at > max * 0.55 ? cut.slice(0, at) : cut).trimEnd();
  return `${kept}…`;
}

function asStringArray(value, max) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => clipText(typeof item === "string" ? item : String(item || ""), MAX_BULLET_CHARS))
    .filter(Boolean)
    .slice(0, max);
}

function asSignals(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    const key = String(item || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
    if (!PR_REVIEW_SIGNALS.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out.slice(0, 8);
}

function pickEnum(value, allowed, fallback) {
  const key = String(value || "").trim().toLowerCase();
  return allowed.has(key) ? key : fallback;
}

const FOLLOW_UP_STATUS = new Set(["fixed", "still-open"]);
const MAX_FOLLOW_UPS = 6;

/** Status of feedback from earlier PRs of the same ticket (multi-PR tasks). */
function asFollowUps(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((f) => f && typeof f === "object")
    .map((f) => ({
      prId: f.prId ?? null,
      item: clipText(String(f.item || ""), MAX_BULLET_CHARS),
      status: String(f.status || "").trim().toLowerCase(),
    }))
    .filter((f) => f.item && FOLLOW_UP_STATUS.has(f.status))
    .slice(0, MAX_FOLLOW_UPS);
}

/** Normalize the structured assessment the model returns. Does not compute a numeric score. */
export function normalizeAssessment(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const improvements = asStringArray(src.improvements?.length ? src.improvements : src.weaknesses, MAX_IMPROVEMENTS);
  return {
    strengths: asStringArray(src.strengths, MAX_STRENGTHS),
    improvements,
    weaknesses: improvements,
    signals: asSignals(src.signals),
    scoreRationale: clipText(src.labelRationale || src.scoreRationale, MAX_RATIONALE_CHARS),
    ticketComplexity: pickEnum(src.ticketComplexity, COMPLEXITY, "medium"),
    codeCompleteness: pickEnum(src.codeCompleteness, COMPLETENESS, "adequate"),
    summary: clipText(src.summary, MAX_SUMMARY_CHARS),
    followUps: asFollowUps(src.followUps),
  };
}

function formatDisputes(review) {
  const disputes = review.disputes || [];
  if (!disputes.length) return [];
  return [
    "",
    "## Disputed by the team (removed from this report)",
    ...disputes.map((d) => `- ~~${d.item}~~ — ${d.reason}${d.by ? ` (${d.by})` : ""}`),
  ];
}

function formatFollowUps(review) {
  const ctx = review.ticketContext;
  const followUps = review.followUps || [];
  if (!ctx?.earlier?.length && !followUps.length) return [];
  const lines = ["", `## Earlier PRs of ${ctx?.jiraKey || "this ticket"}`];
  if (ctx?.earlier?.length) {
    lines.push(`Context: ${ctx.earlier.map((p) => `#${p.prId}${p.reviewed ? "" : " (not reviewed)"}`).join(", ")}`);
  }
  for (const f of followUps) lines.push(`- ${f.status === "fixed" ? "Fixed" : "Still open"} (PR #${f.prId}): ${f.item}`);
  return lines;
}

export function formatPrReviewMarkdown(review) {
  const strengths = (review.strengths || []).map((s) => `- ${s}`).join("\n") || "- (none recorded)";
  const improvements =
    (review.improvements || review.weaknesses || []).map((s) => `- ${s}`).join("\n") || "- (none recorded)";
  const signals = (review.signals || []).join(", ") || "none";
  const ticket = review.jiraKey
    ? `${review.jiraKey}${review.storyPoints != null ? ` (${review.storyPoints} pts)` : ""}`
    : "none";

  return [
    `# PR Review — #${review.prId} ${review.title || ""}`.trim(),
    `${review.author || "unknown"} · ${review.repo} · ${review.state || ""} · ticket ${ticket}`.trim(),
    "",
    `Ticket complexity: **${review.ticketComplexity}** · Code completeness: **${review.codeCompleteness}**`,
    review.scoreRationale || "",
    "",
    "## Summary",
    review.summary || "No summary recorded.",
    "",
    "## Strengths",
    strengths,
    "",
    "## Improvements",
    improvements,
    ...formatFollowUps(review),
    ...formatDisputes(review),
    "",
    `Signals: ${signals}`,
  ].join("\n");
}

export function countBy(reviews, field) {
  const counts = {};
  for (const r of reviews || []) {
    const key = r[field] || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

/** Per weakness group: how many PRs hit it, which ones, and the share of reviewed PRs (rate). PRs with improvements but no negative signal land in "other". */
export function groupWeaknesses(reviews) {
  const groups = {};
  for (const name of [...Object.keys(WEAKNESS_GROUPS), "other"]) groups[name] = { prCount: 0, prIds: [] };
  for (const r of reviews || []) {
    const signals = new Set(r.signals || []);
    let matched = false;
    for (const [name, groupSignals] of Object.entries(WEAKNESS_GROUPS)) {
      if (!groupSignals.some((s) => signals.has(s))) continue;
      groups[name].prCount += 1;
      groups[name].prIds.push(r.prId);
      matched = true;
    }
    if (!matched && (r.improvements || []).length) {
      groups.other.prCount += 1;
      groups.other.prIds.push(r.prId);
    }
  }
  const total = (reviews || []).length;
  for (const g of Object.values(groups)) g.rate = total ? Number((g.prCount / total).toFixed(2)) : 0;
  return groups;
}

export function countSignals(reviews) {
  const counts = {};
  for (const r of reviews || []) {
    for (const signal of r.signals || []) {
      counts[signal] = (counts[signal] || 0) + 1;
    }
  }
  return counts;
}
