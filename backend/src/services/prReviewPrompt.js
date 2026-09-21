import { PR_REVIEW_SIGNALS } from "../lib/prReviewSchema.js";

export function buildPrReviewPrompt({ evidence, prDiff, history }) {
  const system = [
    "You are a staff engineer writing a review of ONE pull request.",
    "This review has two jobs: (1) give the author concrete improvement points for this PR;",
    "(2) produce durable signals a later member review can aggregate — habits, not one-off process noise.",
    "Use only the evidence and the attached unified PR diff. Never invent files, tests, comments, or ticket facts.",
    "Prefer the diff over metadata. If the diff is missing or truncated, say so — do not pick excellent completeness.",
    "Ignore lockfiles, generated files, and “PR not yet approved” unless they hide a real engineering issue.",
    "Strengths must be reusable skills (scope discipline, tests, error handling, clarity), not “title matches ticket”.",
    "Improvements must be actionable (what to change, where). Cite a file path when possible.",
    "You may also see this author's recent review history. Judge THIS diff on its own merits — never " +
      "penalize it for a past PR — but if a signal repeats across history and this PR, name the pattern.",
    "Reply with a single JSON object only — no markdown fences, no commentary.",
  ].join(" ");

  const coverage = prDiff
    ? {
        source: prDiff.source,
        included: (prDiff.filesIncluded || []).map((f) => f.path),
        skipped: (prDiff.filesSkipped || []).slice(0, 30).map((f) => `${f.path} (${f.reason})`),
        truncated: Boolean(prDiff.truncated),
        includedBytes: prDiff.includedBytes || 0,
        error: prDiff.error || null,
      }
    : null;

  const hasDiff = Boolean(prDiff?.text?.trim());
  const diffSection = hasDiff
    ? `## PR diff coverage
${JSON.stringify(coverage, null, 2)}

Lockfiles, binaries, minified assets, and generated directories were omitted on purpose.
If truncated is true, judge only the remaining hunks and say so when completeness is uncertain.

## PR diff (Bitbucket, destination...source)
${prDiff.text}`
    : `## PR diff
No PR diff was attached${prDiff?.error ? ` (${prDiff.error})` : ""}. Judge labels from metadata only and state that you did not read the code. Do not choose excellent completeness.`;

  const signalList = [...PR_REVIEW_SIGNALS].map((s) => `"${s}"`).join(" | ");

  const historySection =
    history && history.length
      ? `## Author's recent review history (most recent first, ${history.length} shown)
${JSON.stringify(history, null, 2)}

This is retrospective context only — do not re-score a past PR. If a signal (e.g. tests-missing)
recurs here and in the current diff, say so in labelRationale or an improvement instead of treating
it as a one-off.`
      : `## Author's recent review history
No prior reviews on record for this author yet — judge this PR on its own.`;

  const prompt = `Review this pull request for the author and for a later member-level synthesis.

## Evidence
${JSON.stringify(evidence, null, 2)}

${diffSection}

${historySection}

Return JSON with exactly these keys:
{
  "summary": "1 sentence: what this PR actually delivered vs the ticket",
  "ticketComplexity": "low" | "medium" | "high",
  "codeCompleteness": "incomplete" | "adequate" | "solid" | "excellent",
  "labelRationale": "1 sentence: evidence for those two labels",
  "strengths": ["reusable engineering habit, with file if useful"],
  "improvements": ["path/or-area: what is wrong and what to do instead"],
  "signals": ["tests-missing"]
}

Do not include a score or rating. Labels must be evidence-based.

ticketComplexity (prefer the diff over story points; null points are not a signal):
- low: localized / obvious (typo, copy, config, one-file fix)
- medium: standard feature in a bounded area
- high: cross-cutting, new abstraction, security/data integrity, or large unclear AC

codeCompleteness:
- incomplete: missed AC, broken/missing path, or logic change with no tests/verification
- adequate: meets the ticket, with clear gaps (tests, errors, edges)
- solid: ticket met, tests or clear verification, reasonable edges
- excellent: rare — exceeds the ticket, tight scope, evidence of verification
If the diff is truncated or missing, completeness is at most solid.

signals must be a subset of: ${signalList}

1–3 strengths, 1–4 improvements. Each item ≤ 20 words.
Improvements are the main value. If the PR is strong, still name 1 residual risk or test gap, or a single item "none beyond nits".
Do not restate the ticket title. Do not mention story points being null unless that blocked judging complexity.
If there is no linked ticket, infer complexity from the diff only and say that in labelRationale.
JSON only.`;

  return { system, prompt };
}
