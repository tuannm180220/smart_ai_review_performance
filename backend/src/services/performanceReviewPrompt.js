import { MAX_DIFF_BYTES_PER_COMMIT } from "./localGitDiffService.js";

function hasCommitDiffs(evidence) {
  return evidence.some((e) => (e.commitDiffs || []).some((c) => c.diff));
}

export function buildPerformanceReviewPrompt(author, from, to, metrics, evidence, codeReview) {
  const commitDiffsAvailable = hasCommitDiffs(evidence);

  const system = [
    "You are a senior staff engineer performing a code-aware performance review of one engineer.",
    "Use the provided commit diffs (unified patch format) as primary evidence for code quality — cite specific",
    "files, patterns, risks, and strengths you observe in the diffs. Also use metrics, review comments, and ticket data.",
    "Never invent facts not present in the evidence. Every code-quality claim must reference a PR id and ideally a file path.",
    "Write as a clean Markdown document with the exact section headings requested.",
  ].join(" ");

  const prompt = `Review engineer "${author}" for the period ${from || "(all time)"} to ${to || "(all time)"}.

## Code review coverage
${JSON.stringify(codeReview, null, 2)}
Commit diffs were read from local git clones only (\`git show\`) after \`git fetch\` per repo.
Coverage: ${codeReview.prsWithDiffs} PR(s), ${codeReview.commitsFetched} commit diff(s).
Each diff is truncated at ${MAX_DIFF_BYTES_PER_COMMIT} bytes when very large. Root: ${codeReview.localRepoRoot}.

## Aggregate metrics (authored PRs — do not recompute)
${JSON.stringify(metrics, null, 2)}

## Evidence packet (authored PRs with commit diffs where available)
${evidence.length} PRs included. Fields commitDiffs[].diff contain unified diffs per commit.
${JSON.stringify(evidence, null, 2)}

Produce a Markdown document with exactly these sections, in this order:

# Performance Review — ${author}
One-line byline: period, PR count, and whether commit diffs were analyzed.

## Executive Summary
2-4 sentences referencing at least one delivery metric and one code-quality observation from the diffs.

## Delivery
Volume and consistency of PRs/tickets shipped and story points. Cite specific PR ids.

## Code Quality (from commit diffs)
${commitDiffsAvailable
    ? "Analyze the actual code changes in commitDiffs — structure, readability, error handling, tests, security smells, scope discipline. Quote or paraphrase specific files/lines from the diffs. Note recurring patterns across PRs. If a PR has no diff attached, say so and rely only on review comments for that PR."
    : "No commit diffs were available — state this plainly and use only review comments and diff sizes. Do not claim to have read source code."}
Also incorporate review comment themes where relevant (quote 1-2 verbatim with PR id).

## Rework & Bug Turnaround
Reopened tickets and follow-up PR timing (reworkEvents / avgDaysToReworkPr). Name ticket keys. If none, say plainly.

## Recommendations
2-4 numbered, actionable suggestions grounded in diff observations or metrics above.

## Evidence Log
Bullet list: "PR #<id> (<repo>) — <reason>" or "<TICKET-KEY> — <reason>", including file paths for code-quality citations.

Keep under 800 words excluding Evidence Log. No filler.`;

  return { system, prompt };
}

export function buildMemberReviewFromPrReviewsPrompt(author, from, to, metrics, prReviews, coverage) {
  const system = [
    "You are a staff engineer writing a performance review of ONE engineer from saved PR reviews.",
    "Do not re-read or invent code. Do not assign numeric scores. Synthesize habits with citations.",
    "A habit is a signal (or a paraphrased improvement) seen in 2+ PRs, or once if the PR is high-complexity or marked security-risk.",
    "A single nit is not a habit. Empty signals on older reviews: cluster similar improvement text; do not invent signal tags.",
    "Weight high-complexity PRs more than low-complexity ones when judging quality of work.",
    "Ignore process noise: approval rate, “PR not approved”, lockfiles, null/zero story points — unless they blocked judging the work.",
    "If coverage.unreviewedCount > 0, say the picture is incomplete. Never infer quality for unreviewed PRs.",
    "Never invent PRs, comments, or tickets. Write Markdown with the exact section headings requested.",
    "Write the entire report in Vietnamese. Keep PR ids, ticket keys, repo names and quoted review bullets as-is.",
  ].join(" ");

  const prompt = `Review engineer "${author}" for the period ${from || "(all time)"} to ${to || "(all time)"}.

## Coverage (pre-computed — use these counts, do not recount)
${JSON.stringify(coverage, null, 2)}
signalCounts = how often each habit tag appeared. complexity / completeness = label tallies.
aiIssueCount = total improvement bullets across saved AI PR reviews. humanReviewComments = top-level Bitbucket comments by people other than the author (replies and self-comments excluded).
weaknessGroups = per weakness category (scope, tests, error-handling, security, requirements, other), already grouped from signals: prCount, prIds, rate = prCount / savedReviews.
Only saved structured reviews are in the packet.

## Delivery metrics (synced authored PRs — do not recompute)
${JSON.stringify(metrics, null, 2)}
Use volume as context, not as a quality proxy. Do not praise or penalize story points when they are 0 or unused.

## Saved PR reviews (${prReviews.length})
Each item: ticketComplexity, codeCompleteness, strengths, improvements, signals, summary.
${JSON.stringify(prReviews, null, 2)}

Produce a Markdown document in Vietnamese with exactly these headings, in this order:

# Đánh giá năng lực — ${author}
One line: period · N saved reviews of M synced PRs. No numeric score.

## Tình hình chung
Facts only, no judgement. A short table or bullet list with:
- Projects: each repo from metrics.projects with its PR and ticket count
- Tasks: metrics.linkedTickets tickets, metrics.totalPRs PRs (metrics.mergedPRs merged)
- Story points: metrics.storyPoints — write "không theo dõi" if 0
- Issues found in review: coverage.aiIssueCount from AI PR reviews · coverage.humanReviewComments human review comments
- Rework: metrics.reopenedTicketCount reopened tickets (name keys) — reopen is not automatically the author’s fault
- Complexity mix from coverage.complexity
If coverage.unreviewedCount > 0, add one line: "X/M PR chưa được review — các mục dưới chỉ phản ánh các PR đã review."

## Điểm mạnh
Up to 6 bullets of recurring strengths (positive signals or repeated strength bullets); fewer if the sample is small — never pad. Each cites PR ids and quotes one strength bullet. Prefer strengths shown on high-complexity PRs.

## Điểm yếu & thói quen cần cải thiện
Start from coverage.weaknessGroups. First a summary table of groups with prCount > 0, most PRs first:
| Nhóm | Số PR | Tỉ lệ | Thói quen / Lỗi lẻ | PR |
Tỉ lệ = prCount/savedReviews (rate as %), e.g. "4/12 (33%)". Group names in Vietnamese: scope → Phạm vi thay đổi, tests → Kiểm thử, error-handling → Xử lý lỗi, security → Bảo mật, requirements → Đáp ứng yêu cầu, other → Khác.
Then, in the same order, a subsection per group:
### <Group name> — <prCount>/<savedReviews> PR
- "Thói quen" if 2+ PRs, or 1× high-complexity / security-risk; otherwise "Lỗi lẻ"
- PRs: cited ids
- Example: quote one improvement bullet verbatim
For "other", cluster the improvement text into named themes; do not invent signal tags.
Skip groups with prCount = 0. If high-complexity PRs have weaker completeness than low-complexity ones, say so explicitly.
If nothing repeats, say the sample is too small for habits and list one-off notes only.

## Đề xuất cho kỳ tới
2–4 numbered items. Each maps to a weakness group above, names at least one PR id, and states how to check it next period (e.g. "tests-missing appears in fewer PRs"). No generic advice unless it recurred.

## Evidence Log
"PR #<id> (<repo>) · <complexity> / <completeness> — <one-line: main signal or improvement>".

Keep under 700 words excluding Evidence Log. No HR filler, no restating the ticket titles. No 1–10 scores.`;

  return { system, prompt };
}
