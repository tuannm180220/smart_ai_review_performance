import { readConfig } from "../config/configStore.js";
import { getStore } from "../store/recordStore.js";
// Temporarily skip local git commit diffs in the AI input.
// import { attachCommitDiffsToEvidence } from "./localGitDiffService.js";
import { listWorkspaceMembers } from "./bitbucketService.js";
import { buildPerformanceReviewPrompt, buildMemberReviewFromPrReviewsPrompt } from "./performanceReviewPrompt.js";
import { askAi } from "./aiProviderService.js";
import { AtlassianApiError } from "../lib/httpClient.js";
import { listPrReviews } from "../store/prReviewStore.js";
import { countBy, countSignals } from "../lib/prReviewSchema.js";
import { logError } from "../lib/logger.js";
import { matchesAuthor, authorLabel } from "../lib/authorIdentity.js";

const MAX_COMMENTS_PER_PR = 6;
const COMMENT_EXCERPT_LENGTH = 500;
const MAX_TICKET_COMMENTS_PER_PR = 4;
const MAX_FILES_LISTED = 8;
const DESCRIPTION_EXCERPT_LENGTH = 600;

function filterUserRecords(allRecords, author, from, to, authorUsername) {
  return allRecords
    .filter((r) => matchesAuthor(r, author, authorUsername))
    .filter((r) => (from || to ? withinRange(r.createdAt, from, to) : true))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

function withinRange(iso, from, to) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1) return false;
  return true;
}

function daysBetween(a, b) {
  return (new Date(b).getTime() - new Date(a).getTime()) / (24 * 60 * 60 * 1000);
}

function groupByTicket(allRecords) {
  const groups = new Map();
  for (const record of allRecords) {
    if (!record.jiraKey) continue;
    if (!groups.has(record.jiraKey)) groups.set(record.jiraKey, []);
    groups.get(record.jiraKey).push(record);
  }
  return groups;
}

function computeReworkEvents(userRecords, ticketGroups) {
  const userTicketKeys = new Set(userRecords.map((r) => r.jiraKey).filter(Boolean));
  const events = [];

  for (const jiraKey of userTicketKeys) {
    const group = ticketGroups.get(jiraKey) || [];
    const reopenDates = [...new Set(group.flatMap((r) => r.reopenDates || []))].sort();
    if (!reopenDates.length) continue;

    const prTimestamps = group
      .map((r) => ({ createdAt: r.createdAt, author: r.author }))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    for (const reopenDate of reopenDates) {
      const nextPr = prTimestamps.find((pr) => new Date(pr.createdAt) > new Date(reopenDate));
      events.push({
        jiraKey,
        reopenDate,
        nextPrCreatedAt: nextPr?.createdAt || null,
        nextPrAuthor: nextPr?.author || null,
        daysToReworkPr: nextPr ? Number(daysBetween(reopenDate, nextPr.createdAt).toFixed(1)) : null,
      });
    }
  }

  return events;
}

function buildMetrics(userRecords, ticketGroups) {
  const total = userRecords.length;
  const merged = userRecords.filter((r) => r.state === "MERGED");
  const approved = userRecords.filter((r) => r.approvedAt);
  const linkedTickets = new Set(userRecords.filter((r) => r.jiraKey).map((r) => r.jiraKey));
  const storyPoints = userRecords.reduce((sum, r) => sum + (r.storyPoints || 0), 0);
  const totalComments = userRecords.reduce((sum, r) => sum + (r.comments?.length || 0), 0);
  const linesAdded = userRecords.reduce(
    (sum, r) => sum + (r.diffstat || []).reduce((s, d) => s + (d.linesAdded || 0), 0),
    0
  );
  const linesRemoved = userRecords.reduce(
    (sum, r) => sum + (r.diffstat || []).reduce((s, d) => s + (d.linesRemoved || 0), 0),
    0
  );
  const reworkEvents = computeReworkEvents(userRecords, ticketGroups);
  const resolvedRework = reworkEvents.filter((e) => e.daysToReworkPr !== null);
  const avgDaysToReworkPr = resolvedRework.length
    ? Number((resolvedRework.reduce((s, e) => s + e.daysToReworkPr, 0) / resolvedRework.length).toFixed(1))
    : null;

  return {
    totalPRs: total,
    mergedPRs: merged.length,
    approvedPRs: approved.length,
    approvalRate: total ? Number((approved.length / total).toFixed(2)) : 0,
    linkedTickets: linkedTickets.size,
    storyPoints,
    totalReviewComments: totalComments,
    avgReviewCommentsPerPr: total ? Number((totalComments / total).toFixed(1)) : 0,
    linesAdded,
    linesRemoved,
    reopenedTicketCount: reworkEvents.length,
    avgDaysToReworkPr,
    reworkEvents: reworkEvents.slice(0, 10),
  };
}

function buildEvidence(userRecords) {
  return userRecords.map((r) => ({
    repo: r.repo,
    prId: r.prId,
    link: r.link,
    title: r.title,
    state: r.state,
    createdAt: r.createdAt,
    mergedAt: r.mergedAt,
    sourceBranch: r.sourceBranch,
    linesAdded: (r.diffstat || []).reduce((s, d) => s + (d.linesAdded || 0), 0),
    linesRemoved: (r.diffstat || []).reduce((s, d) => s + (d.linesRemoved || 0), 0),
    filesChanged: (r.diffstat || []).length,
    changedFileSample: (r.diffstat || []).slice(0, MAX_FILES_LISTED).map((d) => d.path),
    commitMessages: (r.commits || []).map((c) => c.message),
    approved: Boolean(r.approvedAt),
    approvedBy: r.approvedBy,
    reviewComments: (r.comments || []).slice(0, MAX_COMMENTS_PER_PR).map((c) => ({
      author: c.author,
      text: (c.content || "").slice(0, COMMENT_EXCERPT_LENGTH),
    })),
    jiraKey: r.jiraKey,
    ticketStatus: r.ticketStatus,
    ticketSummary: r.ticketSummary,
    ticketDescription: (r.ticketDescription || "").slice(0, DESCRIPTION_EXCERPT_LENGTH),
    ticketCommentSample: (r.ticketComments || []).slice(0, MAX_TICKET_COMMENTS_PER_PR).map((c) => ({
      author: c.author,
      text: (c.body || "").slice(0, COMMENT_EXCERPT_LENGTH),
    })),
    reopened: r.reopened,
    reopenCount: r.reopenCount,
  }));
}

export async function reviewUser({ author, from, to, mode, authorUsername }) {
  if (!author && !authorUsername) throw new AtlassianApiError("author is required", 400, "MISSING_AUTHOR");

  const cfg = readConfig();
  const usingClaudeSubscription = cfg.aiProvider === "claude" && cfg.aiUseClaudeSubscription;
  if (!cfg.aiProvider || (!usingClaudeSubscription && !cfg.aiApiKey)) {
    throw new AtlassianApiError("AI agent is not configured. Fill in Settings first.", 400, "AI_NOT_CONFIGURED");
  }

  const reviewMode = mode === "diffs" ? "diffs" : "pr-reviews";
  const store = await getStore();
  const allRecords = await store.getAll();
  const userRecords = filterUserRecords(allRecords, author, from, to, authorUsername);

  if (!userRecords.length && reviewMode === "diffs") {
    throw new AtlassianApiError(
      `No synced PRs found for "${author}" in the given range. Run a Sync first.`,
      404,
      "NO_DATA"
    );
  }

  const ticketGroups = groupByTicket(allRecords);
  const metrics = userRecords.length
    ? buildMetrics(userRecords, ticketGroups)
    : {
        totalPRs: 0,
        mergedPRs: 0,
        approvedPRs: 0,
        approvalRate: 0,
        linkedTickets: 0,
        storyPoints: 0,
        totalReviewComments: 0,
        avgReviewCommentsPerPr: 0,
        linesAdded: 0,
        linesRemoved: 0,
        reopenedTicketCount: 0,
        avgDaysToReworkPr: null,
        reworkEvents: [],
      };

  if (reviewMode === "pr-reviews") {
    return reviewUserFromSavedPrReviews({
      author,
      authorUsername,
      from,
      to,
      cfg,
      usingClaudeSubscription,
      userRecords,
      metrics,
    });
  }

  // Temporarily skip local git: do not send commit diffs in the AI input.
  // const { evidence, codeReview } = await attachCommitDiffsToEvidence(
  //   buildEvidence(userRecords),
  //   userRecords
  // );
  const evidence = buildEvidence(userRecords);
  const codeReview = {
    skipped: true,
    reason: "Local git commit diffs temporarily disabled.",
    prsWithDiffs: 0,
    commitsFetched: 0,
    localRepoRoot: null,
  };
  const { system, prompt } = buildPerformanceReviewPrompt(
    author,
    from,
    to,
    metrics,
    evidence,
    codeReview
  );

  const review = await askAi({
    provider: cfg.aiProvider,
    apiKey: cfg.aiApiKey,
    model: cfg.aiModel,
    system,
    prompt,
    useClaudeSubscription: usingClaudeSubscription,
  });

  return {
    author,
    from: from || null,
    to: to || null,
    provider: cfg.aiProvider,
    mode: "diffs",
    metrics,
    codeReview,
    review,
  };
}

async function reviewUserFromSavedPrReviews({
  author,
  authorUsername,
  from,
  to,
  cfg,
  usingClaudeSubscription,
  userRecords,
  metrics,
}) {
  const prReviews = (await listPrReviews({ author, authorUsername, from, to })).map((r) => ({
    repo: r.repo,
    prId: r.prId,
    title: r.title,
    link: r.link,
    state: r.state,
    prCreatedAt: r.prCreatedAt,
    jiraKey: r.jiraKey,
    storyPoints: r.storyPoints,
    ticketComplexity: r.ticketComplexity,
    codeCompleteness: r.codeCompleteness,
    strengths: r.strengths,
    weaknesses: r.improvements || r.weaknesses,
    improvements: r.improvements || r.weaknesses,
    signals: r.signals || [],
    summary: r.summary,
  }));

  if (!prReviews.length) {
    const who = authorLabel({ author, authorUsername }) || author;
    const syncedNote = userRecords.length
      ? ` ${userRecords.length} synced PR(s) found in this range — open Review PR and click Review on each one first.`
      : " Review individual PRs first on Review PR.";
    throw new AtlassianApiError(
      `No saved PR reviews for "${who}" in this range.${syncedNote}`,
      404,
      "NO_PR_REVIEWS"
    );
  }

  const reviewedKeys = new Set(prReviews.map((r) => `${r.repo}#${r.prId}`));
  const unreviewedCount = userRecords.filter((r) => !reviewedKeys.has(`${r.repo}#${r.prId}`)).length;
  const coverage = {
    savedReviews: prReviews.length,
    syncedPRs: userRecords.length,
    unreviewedCount,
    complexity: countBy(prReviews, "ticketComplexity"),
    completeness: countBy(prReviews, "codeCompleteness"),
    signalCounts: countSignals(prReviews),
  };

  const { system, prompt } = buildMemberReviewFromPrReviewsPrompt(
    author,
    from,
    to,
    metrics,
    prReviews,
    coverage
  );

  const review = await askAi({
    provider: cfg.aiProvider,
    apiKey: cfg.aiApiKey,
    model: cfg.aiModel,
    system,
    prompt,
    useClaudeSubscription: usingClaudeSubscription,
  });

  return {
    author,
    from: from || null,
    to: to || null,
    provider: cfg.aiProvider,
    mode: "pr-reviews",
    metrics: { ...metrics, savedReviews: coverage.savedReviews },
    coverage,
    prReviews,
    review,
  };
}

export async function listAuthors() {
  const store = await getStore();
  const seen = [];
  function add(author, authorUsername) {
    if (!author && !authorUsername) return;
    const existing = seen.find((p) => matchesAuthor(p, author, authorUsername));
    if (existing) {
      if (!existing.author && author) existing.author = author;
      if (!existing.authorUsername && authorUsername) existing.authorUsername = authorUsername;
      return;
    }
    seen.push({ author, authorUsername });
  }
  for (const r of await store.getAll()) add(r.author, r.authorUsername);
  for (const r of await listPrReviews()) add(r.author, r.authorUsername);
  try {
    for (const m of await listWorkspaceMembers()) add(m.author, m.authorUsername);
  } catch (err) {
    logError("Could not list Bitbucket workspace members for AI Review:", err.message);
  }
  return seen.sort((a, b) => (a.author || "").localeCompare(b.author || ""));
}
