import { getBitbucketClient } from "./atlassian.js";
import { readConfig } from "../config/configStore.js";

const ALL_STATES = ["OPEN", "MERGED", "DECLINED", "SUPERSEDED"];

async function paginate(client, url, params) {
  const results = [];
  let nextUrl = url;
  let nextParams = params;

  while (nextUrl) {
    const res = await client.get(nextUrl, nextParams ? { params: nextParams } : undefined);
    results.push(...(res.data.values || []));
    nextUrl = res.data.next || null;
    nextParams = undefined; // `next` already encodes all query params
  }

  return results;
}

export async function listRepos() {
  const cfg = readConfig();
  const client = getBitbucketClient();
  const repos = await paginate(client, `/repositories/${cfg.bitbucketWorkspace}`, { pagelen: 100 });
  return repos.map((r) => ({ slug: r.slug, name: r.name, fullName: r.full_name }));
}

function buildQuery({ from, to, author }) {
  const clauses = [];
  if (from) clauses.push(`created_on >= ${JSON.stringify(new Date(from).toISOString())}`);
  if (to) clauses.push(`created_on <= ${JSON.stringify(new Date(to).toISOString())}`);
  if (author) clauses.push(`author.username = ${JSON.stringify(author)}`);
  return clauses.length ? clauses.join(" AND ") : undefined;
}

export async function listPullRequests({ repo, from, to, author, state }) {
  const cfg = readConfig();
  const client = getBitbucketClient();
  const states = state ? [state] : ALL_STATES;

  const params = {
    pagelen: 50,
    state: states,
    sort: "-created_on",
  };
  const q = buildQuery({ from, to, author });
  if (q) params.q = q;

  const prs = await paginate(client, `/repositories/${cfg.bitbucketWorkspace}/${repo}/pullrequests`, params);

  return prs.map((pr) => mapPullRequest(pr));
}

export async function listWorkspaceMembers() {
  const cfg = readConfig();
  if (!cfg.bitbucketWorkspace) return [];
  const client = getBitbucketClient();
  const members = await paginate(
    client,
    `/workspaces/${encodeURIComponent(cfg.bitbucketWorkspace)}/members`,
    { pagelen: 100 }
  );
  return members.map((m) => {
    const user = m.user || {};
    return {
      author: user.display_name || user.nickname || user.username || "unknown",
      authorUsername: user.username || user.nickname || null,
    };
  });
}

export async function getPullRequest({ repo, id }) {
  const cfg = readConfig();
  const client = getBitbucketClient();
  const res = await client.get(`/repositories/${cfg.bitbucketWorkspace}/${repo}/pullrequests/${id}`);
  return mapPullRequest(res.data);
}

function mapPullRequest(pr) {
  return {
    id: pr.id,
    title: pr.title,
    author: pr.author?.display_name || pr.author?.username || pr.author?.nickname || "unknown",
    authorUsername: pr.author?.username || pr.author?.nickname || null,
    state: pr.state,
    createdAt: pr.created_on,
    updatedAt: pr.updated_on,
    sourceBranch: pr.source?.branch?.name || null,
    destinationBranch: pr.destination?.branch?.name || null,
    link: pr.links?.html?.href || null,
  };
}

function findActivityTimestamp(activity, predicate) {
  for (const entry of activity) {
    if (predicate(entry)) {
      return entry;
    }
  }
  return null;
}

export async function getPullRequestDetails({ repo, id }) {
  const cfg = readConfig();
  const client = getBitbucketClient();
  const base = `/repositories/${cfg.bitbucketWorkspace}/${repo}/pullrequests/${id}`;

  const [diffstatRes, commits, comments, activity] = await Promise.all([
    paginate(client, `${base}/diffstat`, { pagelen: 100 }),
    paginate(client, `${base}/commits`, { pagelen: 100 }),
    paginate(client, `${base}/comments`, { pagelen: 100 }),
    paginate(client, `${base}/activity`, { pagelen: 50 }),
  ]);

  const approval = findActivityTimestamp(activity, (e) => e.approval);
  const mergeUpdate = findActivityTimestamp(
    activity,
    (e) => e.update && e.update.state === "MERGED"
  );

  return {
    diffstat: diffstatRes.map((d) => ({
      path: d.new?.path || d.old?.path,
      status: d.status,
      linesAdded: d.lines_added,
      linesRemoved: d.lines_removed,
    })),
    commits: commits.map((c) => ({
      hash: c.hash,
      message: c.message,
      author: c.author?.raw || c.author?.user?.display_name || "unknown",
      date: c.date,
    })),
    comments: comments
      .filter((c) => !c.deleted)
      .map((c) => ({
        id: c.id,
        author: c.user?.display_name || "unknown",
        authorUsername: c.user?.username || c.user?.nickname || null,
        parentId: c.parent?.id ?? null,
        content: c.content?.raw || "",
        createdAt: c.created_on,
        inline: c.inline || null,
      })),
    approvedAt: approval?.approval?.date || null,
    approvedBy: approval?.approval?.user?.display_name || null,
    mergedAt: mergeUpdate?.update?.date || null,
    mergedBy: mergeUpdate?.update?.author?.display_name || null,
  };
}

/** Unified diff for the PR as Bitbucket shows it (destination...source). */
export async function getPullRequestDiff({ repo, id }) {
  const cfg = readConfig();
  const client = getBitbucketClient();
  const res = await client.get(
    `/repositories/${cfg.bitbucketWorkspace}/${repo}/pullrequests/${id}/diff`,
    {
      headers: { Accept: "text/plain" },
      responseType: "text",
      timeout: 60000,
      maxContentLength: 8 * 1024 * 1024,
      maxBodyLength: 8 * 1024 * 1024,
      transformResponse: [(data) => data],
    }
  );
  if (res.data == null) return "";
  return typeof res.data === "string" ? res.data : String(res.data);
}
