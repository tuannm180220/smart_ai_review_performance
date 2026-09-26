/**
 * Same-ticket context: a task (Jira ticket) is often delivered in several PRs, sometimes
 * across repos (frontend + backend). When reviewing a later PR, the model gets the earlier
 * PRs of the same ticket — their saved review (summary, improvements, signals, files) or,
 * if not reviewed yet, just their metadata — so it can judge ticket fit across the whole
 * task and check whether earlier feedback was addressed.
 *
 * Pure function over already-loaded reviews/records, so it is easy to test.
 */

export const MAX_EARLIER_PRS = 6;
const MAX_FILES = 15;

function sameKey(a, b) {
  return Boolean(a && b) && String(a).trim().toUpperCase() === String(b).trim().toUpperCase();
}

function time(iso) {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
}

function prKey(repo, prId) {
  return `${repo}#${prId}`;
}

export function buildTicketPrContext({ current, reviews = [], records = [], limit = MAX_EARLIER_PRS } = {}) {
  if (!current?.jiraKey) return null;
  const currentKey = prKey(current.repo, current.prId);
  const currentFiles = new Set(current.files || []);
  const currentTime = time(current.createdAt);

  const byKey = new Map();
  for (const r of records) {
    if (!sameKey(r.jiraKey, current.jiraKey)) continue;
    const key = prKey(r.repo, r.prId);
    if (key === currentKey) continue;
    byKey.set(key, {
      repo: r.repo,
      prId: r.prId,
      title: r.title,
      link: r.link,
      author: r.author,
      state: r.state,
      createdAt: r.createdAt,
      reviewed: false,
      filesTouched: (r.diffstat || []).map((d) => d.path).filter(Boolean).slice(0, MAX_FILES),
    });
  }
  for (const r of reviews) {
    if (!sameKey(r.jiraKey, current.jiraKey)) continue;
    const key = prKey(r.repo, r.prId);
    if (key === currentKey) continue;
    const base = byKey.get(key) || {};
    byKey.set(key, {
      ...base,
      repo: r.repo,
      prId: r.prId,
      title: r.title || base.title,
      link: r.link || base.link,
      author: r.author || base.author,
      state: r.state || base.state,
      createdAt: r.prCreatedAt || base.createdAt,
      reviewed: true,
      reviewedAt: r.reviewedAt,
      summary: r.summary,
      codeCompleteness: r.codeCompleteness,
      reviewKinds: r.reviewKinds || [],
      improvements: r.improvements || r.weaknesses || [],
      strengths: (r.strengths || []).slice(0, 2),
      signals: r.signals || [],
      followUps: r.followUps || [],
      filesTouched: (r.diffCoverage?.included?.length ? r.diffCoverage.included : base.filesTouched || []).slice(0, MAX_FILES),
    });
  }

  const all = [...byKey.values()].map((pr) => ({
    ...pr,
    sharedFiles: (pr.filesTouched || []).filter((f) => currentFiles.has(f)),
  }));

  // "Earlier" = created before the PR under review. Unknown dates count as earlier
  // (better to show context than to hide it).
  const isLater = (pr) => currentTime != null && time(pr.createdAt) != null && time(pr.createdAt) > currentTime;
  const earlier = all.filter((pr) => !isLater(pr)).sort((a, b) => (time(a.createdAt) || 0) - (time(b.createdAt) || 0));
  const later = all.filter(isLater).sort((a, b) => time(a.createdAt) - time(b.createdAt));

  if (!earlier.length && !later.length) return null;

  const kept = earlier.slice(-limit); // the most recent earlier PRs matter most
  return {
    jiraKey: current.jiraKey,
    earlier: kept,
    omittedEarlierCount: earlier.length - kept.length,
    later: later.map(({ repo, prId, title, state }) => ({ repo, prId, title, state })),
  };
}

/** Compact reference saved with the review so the UI can show which PRs were used as context. */
export function summarizeTicketContext(ctx) {
  if (!ctx) return null;
  return {
    jiraKey: ctx.jiraKey,
    earlier: ctx.earlier.map(({ repo, prId, title, link, reviewed }) => ({ repo, prId, title, link, reviewed })),
    omittedEarlierCount: ctx.omittedEarlierCount,
    laterCount: ctx.later.length,
  };
}
