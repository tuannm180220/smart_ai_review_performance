/**
 * Disputes: the team pushes back on an AI review item (e.g. "this is intended project
 * behaviour"). The item leaves the active improvements — so it no longer counts in the
 * UI, the .md report, history, related-PR context or the member report — and is kept in
 * `disputes` with the reason, so it can be restored and so later reviews can be told not
 * to raise the same point again.
 *
 * Pure functions: callers load/save the review.
 */

export const MAX_REASON_CHARS = 500;
export const MAX_TEAM_DECISIONS = 12;

function improvementsOf(review) {
  return [...(review.improvements || review.weaknesses || [])];
}

export class DisputeError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

/**
 * @param review saved review
 * @param {{ index: number, item?: string, reason: string, removeSignals?: string[], by?: string|null, at?: string }} input
 */
export function applyDispute(review, { index, item, reason, removeSignals = [], by = null, at = new Date().toISOString() }) {
  const improvements = improvementsOf(review);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= improvements.length) {
    throw new DisputeError("That review item no longer exists — reload the review.");
  }
  // Guard against a stale UI disputing a different item than the one shown.
  if (item != null && improvements[i] !== item) {
    throw new DisputeError("The review changed since you opened it — reload and try again.");
  }
  const text = String(reason || "").trim();
  if (!text) throw new DisputeError("A reason is required to dispute a review item.");

  const current = new Set(review.signals || []);
  const removed = (removeSignals || []).filter((s) => current.has(s));
  const [disputedItem] = improvements.splice(i, 1);

  return {
    ...review,
    improvements,
    weaknesses: improvements,
    signals: (review.signals || []).filter((s) => !removed.includes(s)),
    disputes: [
      ...(review.disputes || []),
      { item: disputedItem, reason: text.slice(0, MAX_REASON_CHARS), removedSignals: removed, by, at },
    ],
    adjustedAt: at,
  };
}

/** Undo a dispute: the item goes back to the improvements and its removed signals come back. */
export function restoreDispute(review, disputeIndex, at = new Date().toISOString()) {
  const disputes = [...(review.disputes || [])];
  const i = Number(disputeIndex);
  if (!Number.isInteger(i) || i < 0 || i >= disputes.length) {
    throw new DisputeError("That dispute no longer exists — reload the review.");
  }
  const [d] = disputes.splice(i, 1);
  const improvements = [...improvementsOf(review), d.item];
  const signals = [...new Set([...(review.signals || []), ...(d.removedSignals || [])])];
  return { ...review, improvements, weaknesses: improvements, signals, disputes, adjustedAt: at };
}

/**
 * Team decisions for the prompt: disputes from this repo's saved reviews, the PR under
 * review first (a re-review must not bring back what the team already rejected), then the
 * most recent others.
 */
export function collectTeamDecisions(reviews, { repo, prId, limit = MAX_TEAM_DECISIONS } = {}) {
  const out = [];
  for (const r of reviews || []) {
    if (repo && r.repo !== repo) continue;
    for (const d of r.disputes || []) {
      out.push({
        prId: r.prId,
        samePr: String(r.prId) === String(prId),
        item: d.item,
        reason: d.reason,
        at: d.at,
      });
    }
  }
  out.sort((a, b) => Number(b.samePr) - Number(a.samePr) || String(b.at || "").localeCompare(String(a.at || "")));
  return out.slice(0, limit).map(({ prId: id, samePr, item, reason }) => ({ prId: id, samePr, item, reason }));
}
