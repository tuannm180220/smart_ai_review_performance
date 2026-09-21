import { listPullRequests, getPullRequestDetails } from "./bitbucketService.js";
import { getTicket } from "./jiraService.js";
import { extractJiraKey } from "../lib/extractJiraKey.js";
import { getStore } from "../store/recordStore.js";
import { log, logError } from "../lib/logger.js";

const TERMINAL_STATUSES = new Set(["done", "closed", "resolved"]);

function computeReopened(statusHistory) {
  const reopenEvents = statusHistory.filter(
    (e) => TERMINAL_STATUSES.has((e.from || "").toLowerCase()) && !TERMINAL_STATUSES.has((e.to || "").toLowerCase())
  );
  return {
    reopened: reopenEvents.length > 0,
    reopenCount: reopenEvents.length,
    reopenDates: reopenEvents.map((e) => e.at),
  };
}

async function buildRecord({ repo, pr }) {
  const details = await getPullRequestDetails({ repo, id: pr.id });
  const { key: jiraKey, allKeys, multiple } = extractJiraKey(pr.sourceBranch, pr.title);

  const base = {
    prId: pr.id,
    repo,
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
    jiraKey,
    jiraKeyCandidates: allKeys,
    multipleKeysDetected: multiple,
    jiraStatusHistory: [],
    storyPoints: null,
    ticketStatus: null,
    ticketSummary: null,
    ticketDescription: null,
    ticketComments: [],
    reopened: false,
    reopenCount: 0,
    reopenDates: [],
    linkStatus: "unlinked",
    ticketError: null,
  };

  if (!jiraKey) {
    return base;
  }

  const ticket = await getTicket(jiraKey);

  if (ticket.error) {
    return {
      ...base,
      linkStatus: "ambiguous",
      ticketError: ticket.error,
    };
  }

  const reopenInfo = computeReopened(ticket.statusHistory);

  return {
    ...base,
    linkStatus: "linked",
    jiraStatusHistory: ticket.statusHistory,
    storyPoints: ticket.storyPoints,
    ticketStatus: ticket.status,
    ticketSummary: ticket.summary,
    ticketDescription: ticket.description,
    ticketComments: ticket.comments,
    ...reopenInfo,
  };
}

export async function runSync({ repo, from, to, author, state, onProgress }) {
  const store = await getStore();
  const prs = await listPullRequests({ repo, from, to, author, state });

  const results = [];
  const errors = [];

  for (const pr of prs) {
    try {
      const record = await buildRecord({ repo, pr });
      await store.upsert(record);
      results.push(record);
    } catch (err) {
      logError(`Sync failed for PR #${pr.id} in ${repo}:`, err.message);
      errors.push({ prId: pr.id, message: err.message });
    }
    onProgress?.({ done: results.length + errors.length, total: prs.length });
  }

  log(`Sync complete for ${repo}: ${results.length} synced, ${errors.length} failed.`);

  return { synced: results.length, failed: errors.length, errors, records: results };
}
