import test from "node:test";
import assert from "node:assert/strict";
import { applyDispute, restoreDispute, collectTeamDecisions } from "../lib/prReviewDisputes.js";
import { formatPrReviewMarkdown } from "../lib/prReviewSchema.js";
import { buildPrReviewPrompt } from "../services/prReviewPrompt.js";

const review = {
  repo: "app",
  prId: 7,
  ticketComplexity: "medium",
  codeCompleteness: "adequate",
  improvements: ["[major] a.js — Missing test", "[minor] b.js — Sort not stable", "[major] c.js — No permission check"],
  signals: ["tests-missing", "security-risk"],
};

test("dispute removes the item, optional signals, and records the reason", () => {
  const next = applyDispute(review, {
    index: 2,
    item: review.improvements[2],
    reason: "Public endpoint by design (spec 4.1)",
    removeSignals: ["security-risk", "not-there"],
    by: "ha.vu",
    at: "2026-09-26T00:00:00Z",
  });
  assert.deepEqual(next.improvements, review.improvements.slice(0, 2));
  assert.deepEqual(next.weaknesses, next.improvements);
  assert.deepEqual(next.signals, ["tests-missing"]);
  assert.equal(next.disputes.length, 1);
  assert.deepEqual(next.disputes[0].removedSignals, ["security-risk"]);
  assert.equal(review.improvements.length, 3, "input not mutated");

  const md = formatPrReviewMarkdown(next);
  assert.match(md, /## Disputed by the team/);
  assert.match(md, /~~\[major\] c\.js — No permission check~~ — Public endpoint by design/);
  assert.doesNotMatch(md.split("## Disputed")[0], /No permission check/);
});

test("dispute rejects stale or empty requests", () => {
  assert.throws(() => applyDispute(review, { index: 5, reason: "x" }), /no longer exists/);
  assert.throws(() => applyDispute(review, { index: 0, item: "other text", reason: "x" }), /changed/);
  assert.throws(() => applyDispute(review, { index: 0, reason: "  " }), /reason is required/);
});

test("restore puts the item and its signals back", () => {
  const disputed = applyDispute(review, { index: 2, reason: "by design", removeSignals: ["security-risk"] });
  const restored = restoreDispute(disputed, 0);
  assert.equal(restored.improvements.length, 3);
  assert.ok(restored.signals.includes("security-risk"));
  assert.equal(restored.disputes.length, 0);
  assert.throws(() => restoreDispute(restored, 0), /no longer exists/);
});

test("team decisions put this PR first and flow into the prompt", () => {
  const reviews = [
    { repo: "app", prId: 1, disputes: [{ item: "old", reason: "r1", at: "2026-01-01" }] },
    { repo: "app", prId: 7, disputes: [{ item: "same pr", reason: "r2", at: "2025-01-01" }] },
    { repo: "other", prId: 3, disputes: [{ item: "elsewhere", reason: "r3", at: "2026-05-01" }] },
  ];
  const decisions = collectTeamDecisions(reviews, { repo: "app", prId: 7 });
  assert.deepEqual(decisions.map((d) => d.item), ["same pr", "old"]);
  assert.equal(decisions[0].samePr, true);

  const { prompt } = buildPrReviewPrompt({ evidence: {}, prDiff: { text: "" }, teamDecisions: decisions });
  assert.match(prompt, /## Team decisions/);
  assert.match(prompt, /Do not raise the same point again/);
  const { prompt: none } = buildPrReviewPrompt({ evidence: {}, prDiff: { text: "" } });
  assert.doesNotMatch(none, /Team decisions/);
});
