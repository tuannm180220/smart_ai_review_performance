import test from "node:test";
import assert from "node:assert/strict";
import { buildTicketPrContext, summarizeTicketContext } from "../lib/ticketContext.js";
import { buildPrReviewPrompt } from "../services/prReviewPrompt.js";
import { normalizeAssessment, formatPrReviewMarkdown } from "../lib/prReviewSchema.js";

const records = [
  { repo: "api", prId: 1, jiraKey: "PROJ-7", title: "API part", createdAt: "2026-01-01T00:00:00Z", diffstat: [{ path: "src/a.js" }] },
  { repo: "web", prId: 5, jiraKey: "proj-7", title: "UI part", createdAt: "2026-01-03T00:00:00Z", diffstat: [{ path: "src/Page.jsx" }] },
  { repo: "api", prId: 2, jiraKey: "PROJ-7", title: "Current", createdAt: "2026-01-05T00:00:00Z" },
  { repo: "api", prId: 3, jiraKey: "PROJ-7", title: "Later fix", createdAt: "2026-01-09T00:00:00Z" },
  { repo: "api", prId: 9, jiraKey: "OTHER-1", title: "Unrelated", createdAt: "2026-01-02T00:00:00Z" },
];
const reviews = [
  {
    repo: "api",
    prId: 1,
    jiraKey: "PROJ-7",
    prCreatedAt: "2026-01-01T00:00:00Z",
    summary: "Adds endpoint",
    improvements: ["[major] src/a.js:10 — Missing permission check → add guard"],
    signals: ["security-risk"],
    diffCoverage: { included: ["src/a.js", "src/b.js"] },
  },
];
const current = { repo: "api", prId: 2, jiraKey: "PROJ-7", createdAt: "2026-01-05T00:00:00Z", files: ["src/a.js"] };

test("collects earlier same-ticket PRs across repos, oldest first, with review data and shared files", () => {
  const ctx = buildTicketPrContext({ current, reviews, records });
  assert.deepEqual(ctx.earlier.map((p) => `${p.repo}#${p.prId}`), ["api#1", "web#5"]);
  assert.equal(ctx.earlier[0].reviewed, true);
  assert.equal(ctx.earlier[0].improvements.length, 1);
  assert.deepEqual(ctx.earlier[0].sharedFiles, ["src/a.js"]);
  assert.equal(ctx.earlier[1].reviewed, false);
  assert.deepEqual(ctx.later.map((p) => p.prId), [3]);
});

test("no ticket or no siblings gives no context", () => {
  assert.equal(buildTicketPrContext({ current: { ...current, jiraKey: null }, reviews, records }), null);
  assert.equal(buildTicketPrContext({ current: { ...current, jiraKey: "NONE-1" }, reviews, records }), null);
});

test("keeps only the most recent earlier PRs when there are many", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({
    repo: "api",
    prId: 100 + i,
    jiraKey: "PROJ-7",
    createdAt: `2026-01-0${1 + (i % 4)}T0${i}:00:00Z`,
  }));
  const ctx = buildTicketPrContext({ current, records: many, limit: 6 });
  assert.equal(ctx.earlier.length, 6);
  assert.equal(ctx.omittedEarlierCount, 3);
  assert.equal(summarizeTicketContext(ctx).earlier.length, 6);
});

test("prompt explains how to use earlier PRs and asks for followUps only when there are some", () => {
  const ctx = buildTicketPrContext({ current, reviews, records });
  const { prompt } = buildPrReviewPrompt({ evidence: {}, prDiff: { text: "" }, ticketContext: ctx });
  assert.match(prompt, /## Same-ticket PRs \(PROJ-7\)/);
  assert.match(prompt, /still open from PR #/);
  assert.match(prompt, /"followUps"/);
  assert.match(prompt, /1 later PR\(s\)/);

  const { prompt: plain } = buildPrReviewPrompt({ evidence: {}, prDiff: { text: "" } });
  assert.doesNotMatch(plain, /Same-ticket PRs/);
  assert.doesNotMatch(plain, /"followUps"/);
});

test("followUps are normalized and rendered", () => {
  const a = normalizeAssessment({
    followUps: [
      { prId: 1, item: "Missing permission check", status: "Fixed" },
      { prId: 1, item: "x", status: "maybe" },
      { prId: 1, item: "", status: "fixed" },
    ],
  });
  assert.deepEqual(a.followUps, [{ prId: 1, item: "Missing permission check", status: "fixed" }]);
  const md = formatPrReviewMarkdown({
    prId: 2,
    repo: "api",
    ticketComplexity: "medium",
    codeCompleteness: "solid",
    ...a,
    ticketContext: { jiraKey: "PROJ-7", earlier: [{ prId: 1, reviewed: true }, { prId: 5, reviewed: false }] },
  });
  assert.match(md, /## Earlier PRs of PROJ-7/);
  assert.match(md, /Context: #1, #5 \(not reviewed\)/);
  assert.match(md, /- Fixed \(PR #1\): Missing permission check/);
});
