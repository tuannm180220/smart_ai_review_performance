import { listRepos, listPullRequests } from "./bitbucketService.js";
import { addItemIfNew, getWatchItems, getWatchItem, saveReview } from "../store/prWatchStore.js";
import { reviewPullRequest } from "./prReviewService.js";
import { readConfig } from "../config/configStore.js";
import { AtlassianApiError } from "../lib/httpClient.js";
import { log, logError } from "../lib/logger.js";

function startOfTodayIso() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** Fetches today's PRs across every repo in the configured workspace and records any not already seen. */
export async function pollNewPrs() {
  const cfg = readConfig();
  if (!cfg.bitbucketWorkspace || !cfg.atlassianEmail || !cfg.bitbucketApiToken) {
    return [];
  }

  const repos = await listRepos();
  const from = startOfTodayIso();
  const added = [];

  for (const repo of repos) {
    let prs;
    try {
      prs = await listPullRequests({ repo: repo.slug, from });
    } catch (err) {
      logError(`PR watch: failed to list PRs for ${repo.slug}:`, err.message);
      continue;
    }
    for (const pr of prs) {
      const created = await addItemIfNew({
        repo: repo.slug,
        prId: pr.id,
        title: pr.title,
        author: pr.author,
        authorUsername: pr.authorUsername,
        state: pr.state,
        createdAt: pr.createdAt,
        sourceBranch: pr.sourceBranch,
        link: pr.link,
      });
      if (created) added.push(created);
    }
  }

  if (added.length) log(`PR watch: ${added.length} new PR(s) detected.`);
  return added;
}

export async function listWatchItems() {
  return getWatchItems();
}

export async function reviewWatchedPr({ repo, prId }) {
  const item = await getWatchItem(repo, prId);
  if (!item) throw new AtlassianApiError("PR not found in today's watch list.", 404, "NOT_FOUND");

  const saved = await reviewPullRequest({
    repo,
    prId,
    hint: {
      id: item.prId,
      title: item.title,
      author: item.author,
      authorUsername: item.authorUsername,
      state: item.state,
      createdAt: item.createdAt,
      sourceBranch: item.sourceBranch,
      link: item.link,
    },
  });

  return saveReview(repo, prId, saved.reviewDocument, saved);
}
