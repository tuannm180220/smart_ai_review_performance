import test from "node:test";
import assert from "node:assert/strict";
import { buildMemberReviewFromPrReviewsPrompt } from "../services/performanceReviewPrompt.js";
import { groupWeaknesses } from "../lib/prReviewSchema.js";

test("member review prompt uses the five agreed sections", () => {
  const { system, prompt } = buildMemberReviewFromPrReviewsPrompt(
    "Ada",
    "2026-01-01",
    "2026-01-31",
    { totalPRs: 4, storyPoints: 0 },
    [{ repo: "app", prId: 12, signals: ["tests-missing"], improvements: ["add tests"] }],
    {
      savedReviews: 1,
      unreviewedCount: 2,
      signalCounts: { "tests-missing": 1 },
      complexity: { low: 1 },
      completeness: { adequate: 1 },
    }
  );
  assert.match(system, /2\+ PRs/);
  assert.match(system, /Do not assign numeric scores/);
  for (const heading of ["## Tình hình chung", "## Điểm mạnh", "## Điểm yếu & thói quen cần cải thiện", "## Đề xuất cho kỳ tới", "## Evidence Log"]) {
    assert.ok(prompt.includes(heading), heading);
  }
  assert.match(prompt, /weaknessGroups/);
  assert.match(prompt, /aiIssueCount/);
  assert.match(prompt, /\| Nhóm \| Số PR \| Tỉ lệ/);
  assert.match(system, /Vietnamese/);
  assert.match(prompt, /never pad/);
  assert.doesNotMatch(prompt, /## Executive Summary/);
  assert.doesNotMatch(prompt, /## Rework & Bug Turnaround/);
  assert.match(prompt, /signalCounts/);
  assert.match(prompt, /unreviewedCount/);
  assert.doesNotMatch(prompt, /## Scores/);
  assert.doesNotMatch(prompt, /avg score/);
  assert.doesNotMatch(prompt, /Quality of work/);
});

test("groupWeaknesses buckets PRs by negative signal, rest into other", () => {
  const groups = groupWeaknesses([
    { prId: 1, signals: ["tests-missing", "bloated-scope"], improvements: ["a"] },
    { prId: 2, signals: ["tests-missing"], improvements: ["b"] },
    { prId: 3, signals: ["tests-present"], improvements: ["naming"] },
    { prId: 4, signals: [], improvements: [] },
  ]);
  assert.deepEqual(groups.tests, { prCount: 2, prIds: [1, 2], rate: 0.5 });
  assert.deepEqual(groups.scope, { prCount: 1, prIds: [1], rate: 0.25 });
  assert.deepEqual(groups.other, { prCount: 1, prIds: [3], rate: 0.25 });
  assert.equal(groups.security.prCount, 0);
});
