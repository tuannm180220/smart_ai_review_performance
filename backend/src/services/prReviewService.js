import { readConfig } from "../config/configStore.js";
import { getStore } from "../store/recordStore.js";
import { upsertPrReview, listPrReviews } from "../store/prReviewStore.js";
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
import { embedText, cosineSimilarity, buildReviewEmbeddingText } from "../lib/textEmbedding.js";
import { composeReviewPersona } from "./reviewSkills.js";
import { detectPrKinds } from "../lib/prKind.js";
import { buildTicketPrContext, summarizeTicketContext } from "../lib/ticketContext.js";

const COMMENT_EXCERPT_LENGTH = 500;
const MAX_COMMENTS = 10;
const MAX_FILES = 15;
const DESCRIPTION_EXCERPT_LENGTH = 800;
const MAX_HISTORY = 5;
const MAX_RELATED = 5;
const MIN_RELATED_SIMILARITY = 0.15;

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
  const synced = (await store.get(repo, Number(prId))) || (await store.get(repo, prId));
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
 * Pulls this author's past reviews (most recent first, current PR excluded) as
 * compact entries — not the full documents — so each new review can be told
 * about recurring patterns (e.g. "tests-missing 3 times running") without the
 * prompt ballooning. Every review saved via reviewPullRequest/submitPrReview
 * becomes part of this history for that author's *next* review — the more the
 * app is used, the more context future reviews have, with no separate store.
 */
export async function getAuthorReviewHistory({ author, authorUsername, excludeRepo, excludePrId, limit = MAX_HISTORY } = {}) {
  if (!author && !authorUsername) return [];
  const all = await listPrReviews({ author, authorUsername });
  return all
    .filter((r) => !(excludeRepo && r.repo === excludeRepo && String(r.prId) === String(excludePrId)))
    .slice(0, limit)
    .map((r) => ({
      repo: r.repo,
      prId: r.prId,
      reviewedAt: r.reviewedAt,
      ticketComplexity: r.ticketComplexity,
      codeCompleteness: r.codeCompleteness,
      signals: r.signals || [],
      topImprovement: (r.improvements || r.weaknesses || [])[0] || null,
    }));
}

/**
 * Ranks this repo's past reviews by text similarity to the current PR (ticket, title,
 * files touched) using a local hashing-trick embedding — no external embeddings API.
 * This is the RAG half of review context: getAuthorReviewHistory follows the author
 * across repos, this follows the *repo* across authors, so recurring patterns in a
 * codebase area surface even for a first-time contributor to that area.
 */
export async function getRelatedRepoReviews({ repo, embedding, excludePrId, limit = MAX_RELATED } = {}) {
  if (!repo || !embedding) return [];
  const all = await listPrReviews({ repo });
  return all
    .filter((r) => String(r.prId) !== String(excludePrId) && Array.isArray(r.embedding))
    .map((r) => ({ review: r, similarity: cosineSimilarity(embedding, r.embedding) }))
    .filter(({ similarity }) => similarity >= MIN_RELATED_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit)
    .map(({ review: r, similarity }) => ({
      repo: r.repo,
      prId: r.prId,
      title: r.title,
      link: r.link,
      reviewedAt: r.reviewedAt,
      ticketComplexity: r.ticketComplexity,
      codeCompleteness: r.codeCompleteness,
      signals: r.signals || [],
      topImprovement: (r.improvements || r.weaknesses || [])[0] || null,
      similarity: Math.round(similarity * 100) / 100,
    }));
}

/** Earlier (and later) PRs of the same Jira ticket, across repos — see lib/ticketContext.js. */
async function getSameTicketContext(record, prDiff, evidence) {
  if (!record.jiraKey) return null;
  try {
    const store = await getStore();
    const [reviews, records] = await Promise.all([listPrReviews(), store.getAll()]);
    return buildTicketPrContext({
      current: {
        repo: record.repo,
        prId: record.prId,
        jiraKey: record.jiraKey,
        createdAt: record.createdAt,
        files: prDiff?.filesIncluded?.length ? prDiff.filesIncluded.map((f) => f.path) : evidence.changedFileSample,
      },
      reviews,
      records,
    });
  } catch (err) {
    logError(`Could not load same-ticket PRs for ${record.jiraKey}:`, err.message);
    return null;
  }
}

function buildSavedReview({ record, assessment, prDiff, provider, relatedPrs, ticketContext }) {
  const diffCoverage = summarizeDiffCoverage(prDiff);
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
    provider,
    ...assessment,
    ticketContext: ticketContext || null,
    diffCoverage,
    relatedPrs: (relatedPrs || []).map(({ repo, prId, title, link, similarity }) => ({
      repo,
      prId,
      title,
      link,
      similarity,
    })),
  };
  // Stored so *future* reviews in this repo can find this one — richer than the query
  // embedding below since strengths/improvements/signals only exist after the review.
  saved.embedding = embedText(
    buildReviewEmbeddingText({
      title: saved.title,
      jiraKey: saved.jiraKey,
      ticketSummary: saved.ticketSummary,
      changedFiles: diffCoverage?.included,
      summary: saved.summary,
      strengths: saved.strengths,
      improvements: saved.improvements,
      signals: saved.signals,
    })
  );
  saved.reviewDocument = formatPrReviewMarkdown(saved);
  return saved;
}

export async function reviewPullRequest({ repo, prId, hint } = {}) {
  if (!repo || prId == null || prId === "") {
    throw new AtlassianApiError("repo and prId are required", 400, "MISSING_PR");
  }

  const { cfg, usingClaudeSubscription } = requireAiConfig();
  const record = await loadRecord({ repo, prId, hint });
  const evidence = evidenceFromRecord(record);
  const prDiff = await loadPrDiffForReview({ repo: record.repo, prId: record.prId });
  const history = await getAuthorReviewHistory({
    author: record.author,
    authorUsername: record.authorUsername,
    excludeRepo: record.repo,
    excludePrId: record.prId,
  });
  const queryEmbedding = embedText(
    buildReviewEmbeddingText({
      title: record.title,
      jiraKey: record.jiraKey,
      ticketSummary: record.ticketSummary,
      changedFiles: evidence.changedFileSample,
    })
  );
  const ticketContext = await getSameTicketContext(record, prDiff, evidence);
  const sameTicket = new Set((ticketContext?.earlier || []).map((p) => `${p.repo}#${p.prId}`));
  // Same-ticket PRs already appear in full in their own section — don't spend tokens twice.
  const relatedPrs = (
    await getRelatedRepoReviews({
      repo: record.repo,
      embedding: queryEmbedding,
      excludePrId: record.prId,
    })
  ).filter((r) => !sameTicket.has(`${r.repo}#${r.prId}`));
  const reviewKinds = detectPrKinds({
    title: record.title,
    sourceBranch: record.sourceBranch,
    commitMessages: evidence.commitMessages,
    ticketSummary: record.ticketSummary,
    ticketDescription: record.ticketDescription,
    files: prDiff?.filesIncluded?.length ? prDiff.filesIncluded.map((f) => f.path) : evidence.changedFileSample,
    diffText: prDiff?.text,
    reopened: record.reopened,
  });
  const { persona, used: skillsUsed } = await composeReviewPersona(
    record.repo,
    reviewKinds.map((k) => k.kind)
  );
  const { system, prompt } = buildPrReviewPrompt({
    evidence,
    prDiff,
    history,
    relatedPrs,
    customSystemPrompt: persona,
    reviewKinds,
    ticketContext,
  });

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
  const saved = buildSavedReview({
    record,
    assessment,
    prDiff,
    provider: cfg.aiProvider,
    relatedPrs,
    ticketContext: summarizeTicketContext(ticketContext),
  });
  saved.reviewKinds = reviewKinds.map((k) => k.kind);
  saved.skillsUsed = skillsUsed;
  return await upsertPrReview(saved);
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
