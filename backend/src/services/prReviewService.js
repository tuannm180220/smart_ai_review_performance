import { readConfig } from "../config/configStore.js";
import { getStore } from "../store/recordStore.js";
import { upsertPrReview } from "../store/prReviewStore.js";
import { getPullRequest, getPullRequestDetails, getPullRequestDiff } from "./bitbucketService.js";
import { getTicket } from "./jiraService.js";
import { extractJiraKey } from "../lib/extractJiraKey.js";
import { parseAiJson } from "../lib/parseAiJson.js";
import { normalizeAssessment, formatPrReviewMarkdown } from "../lib/prReviewSchema.js";
import { preparePrDiffForReview, summarizeDiffCoverage } from "../lib/prDiff.js";
import { buildPrReviewPrompt } from "./prReviewPrompt.js";
import { askAi } from "./aiProviderService.js";
import { AtlassianApiError } from "../lib/httpClient.js";
import { logError } from "../lib/logger.js";

const COMMENT_EXCERPT_LENGTH = 500;
const MAX_COMMENTS = 10;
const MAX_FILES = 15;
const DESCRIPTION_EXCERPT_LENGTH = 800;

function requireAiConfig() {
  const cfg = readConfig();
  const usingClaudeSubscription = cfg.aiProvider === "claude" && cfg.aiUseClaudeSubscription;
  if (!cfg.aiProvider || (!usingClaudeSubscription && !cfg.aiApiKey)) {
    throw new AtlassianApiError("AI agent is not configured. Fill in Settings first.", 400, "AI_NOT_CONFIGURED");
  }
  return { cfg, usingClaudeSubscription };
}

function evidenceFromRecord(record) {
  return {
    repo: record.repo,
    prId: record.prId,
    link: record.link,
    title: record.title,
    state: record.state,
    createdAt: record.createdAt,
    mergedAt: record.mergedAt,
    sourceBranch: record.sourceBranch,
    linesAdded: (record.diffstat || []).reduce((s, d) => s + (d.linesAdded || 0), 0),
    linesRemoved: (record.diffstat || []).reduce((s, d) => s + (d.linesRemoved || 0), 0),
    filesChanged: (record.diffstat || []).length,
    changedFileSample: (record.diffstat || []).slice(0, MAX_FILES).map((d) => d.path),
    commitMessages: (record.commits || []).map((c) => c.message),
    commits: (record.commits || []).map((c) => ({ hash: c.hash, message: c.message, author: c.author })),
    approved: Boolean(record.approvedAt),
    approvedBy: record.approvedBy,
    reviewComments: (record.comments || []).slice(0, MAX_COMMENTS).map((c) => ({
      author: c.author,
      text: (c.content || "").slice(0, COMMENT_EXCERPT_LENGTH),
    })),
    jiraKey: record.jiraKey || null,
    storyPoints: record.storyPoints ?? null,
    ticketStatus: record.ticketStatus || null,
    ticketSummary: record.ticketSummary || null,
    ticketDescription: (record.ticketDescription || "").slice(0, DESCRIPTION_EXCERPT_LENGTH),
    reopened: Boolean(record.reopened),
    reopenCount: record.reopenCount || 0,
  };
}

async function loadRecord({ repo, prId, hint }) {
  const store = await getStore();
  const synced = store.get(repo, Number(prId)) || store.get(repo, prId);
  if (synced) return synced;

  const pr = hint || (await getPullRequest({ repo, id: prId }));
  const details = await getPullRequestDetails({ repo, id: prId });
  const { key: jiraKey } = extractJiraKey(pr.sourceBranch, pr.title);
  let ticket = null;
  if (jiraKey) {
    try {
      const t = await getTicket(jiraKey);
      if (!t.error) ticket = t;
    } catch {
      ticket = null;
    }
  }

  return {
    repo,
    prId: pr.id,
    title: pr.title,
    author: pr.author,
    authorUsername: pr.authorUsername,
    state: pr.state,
    sourceBranch: pr.sourceBranch,
    destinationBranch: pr.destinationBranch,
    createdAt: pr.createdAt,
    updatedAt: pr.updatedAt,
    link: pr.link,
    ...details,
    jiraKey: jiraKey || null,
    storyPoints: ticket?.storyPoints ?? null,
    ticketStatus: ticket?.status || null,
    ticketSummary: ticket?.summary || null,
    ticketDescription: ticket?.description || null,
    ticketComments: ticket?.comments || [],
    reopened: false,
    reopenCount: 0,
  };
}

/**
 * Assembles the same evidence bundle (record metadata, ticket info, diff text)
 * that would otherwise be sent to an AI provider, without calling one — lets a
 * caller with its own model access (e.g. an MCP client) do the review itself.
 */
export async function getPrReviewContext({ repo, prId, hint } = {}) {
  if (!repo || prId == null || prId === "") {
    throw new AtlassianApiError("repo and prId are required", 400, "MISSING_PR");
  }
  const record = await loadRecord({ repo, prId, hint });
  const evidence = evidenceFromRecord(record);
  const prDiff = await loadPrDiffForReview({ repo: record.repo, prId: record.prId });
  return { evidence, diff: prDiff };
}

export async function reviewPullRequest({ repo, prId, hint } = {}) {
  if (!repo || prId == null || prId === "") {
    throw new AtlassianApiError("repo and prId are required", 400, "MISSING_PR");
  }

  const { cfg, usingClaudeSubscription } = requireAiConfig();
  const record = await loadRecord({ repo, prId, hint });
  const evidence = evidenceFromRecord(record);
  const prDiff = await loadPrDiffForReview({ repo: record.repo, prId: record.prId });
  const { system, prompt } = buildPrReviewPrompt({ evidence, prDiff });

  const raw = await askAi({
    provider: cfg.aiProvider,
    apiKey: cfg.aiApiKey,
    model: cfg.aiModel,
    system,
    prompt,
    useClaudeSubscription: usingClaudeSubscription,
  });

  const parsed = parseAiJson(raw);
  if (!parsed) {
    throw new AtlassianApiError("AI did not return valid JSON for this PR review.", 502, "AI_BAD_RESPONSE");
  }

  const assessment = normalizeAssessment(parsed);
  const saved = {
    repo: record.repo,
    prId: record.prId,
    title: record.title,
    link: record.link,
    author: record.author,
    authorUsername: record.authorUsername,
    state: record.state,
    prCreatedAt: record.createdAt,
    jiraKey: record.jiraKey || null,
    storyPoints: record.storyPoints ?? null,
    ticketSummary: record.ticketSummary || null,
    provider: cfg.aiProvider,
    ...assessment,
    diffCoverage: summarizeDiffCoverage(prDiff),
  };
  saved.reviewDocument = formatPrReviewMarkdown(saved);
  return upsertPrReview(saved);
}

async function loadPrDiffForReview({ repo, prId }) {
  try {
    const raw = await getPullRequestDiff({ repo, id: prId });
    return preparePrDiffForReview(raw);
  } catch (err) {
    logError(`Failed to fetch Bitbucket PR diff for ${repo}#${prId}:`, err.message);
    return {
      source: "bitbucket-pr-diff",
      text: "",
      filesIncluded: [],
      filesSkipped: [],
      truncated: false,
      rawBytes: 0,
      includedBytes: 0,
      fileCountRaw: 0,
      error: err.message,
    };
  }
}
