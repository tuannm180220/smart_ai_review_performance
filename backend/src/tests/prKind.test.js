import test from "node:test";
import assert from "node:assert/strict";
import { detectPrKinds } from "../lib/prKind.js";
import { REVIEW_SKILLS, getDefaultSkillText, normalizeSkillKind } from "../lib/reviewSkillCatalog.js";
import { buildPrReviewPrompt } from "../services/prReviewPrompt.js";

const kinds = (pr) => detectPrKinds(pr).map((k) => k.kind);

test("export PR is detected from files and libraries, with feature as second skill", () => {
  const out = kinds({
    title: "Add member list export",
    files: ["apps/server/src/services/memberExport.service.ts", "apps/web/src/pages/members/index.tsx"],
    diffText: "+import ExcelJS from 'exceljs';\n+res.setHeader('Content-Disposition', ...)",
  });
  assert.deepEqual(out, ["export", "feature"]);
});

test("bugfix branch wins and drops the generic feature skill", () => {
  const out = kinds({
    title: "Date filter misses last day",
    sourceBranch: "fix/PROJ-12-date-filter",
    files: ["src/routes/orders.js", "src/pages/Orders.jsx"],
  });
  assert.equal(out[0], "bugfix");
  assert.ok(!out.includes("feature"));
});

test("migration and job files select the data skill", () => {
  const out = kinds({
    title: "Nightly user sync",
    files: ["db/migrations/20260101_add_external_id.sql", "src/jobs/syncUsers.js"],
    diffText: "+ALTER TABLE users ADD COLUMN external_id TEXT;",
  });
  assert.equal(out[0], "data");
});

test("reopened ticket counts toward bugfix", () => {
  const out = kinds({ title: "Adjust rounding", files: ["src/lib/money.js"], reopened: true });
  assert.ok(out.includes("bugfix"));
});

test("nothing specific falls back to feature with a reason", () => {
  const [only] = detectPrKinds({ title: "Tidy up", files: ["README.md"] });
  assert.equal(only.kind, "feature");
  assert.match(only.reasons[0], /default/);
});

test("never more than two type skills", () => {
  const out = kinds({
    title: "fix export job",
    sourceBranch: "hotfix/export",
    files: ["src/jobs/reportExport.js", "db/migrations/1.sql"],
    diffText: "+exceljs\n+ALTER TABLE x",
  });
  assert.ok(out.length <= 2);
});

test("every catalog skill has non-empty default text and unknown kinds are rejected", () => {
  for (const s of REVIEW_SKILLS) assert.ok(getDefaultSkillText(s.kind).length > 1000, s.kind);
  assert.equal(normalizeSkillKind("EXPORT"), "export");
  assert.equal(normalizeSkillKind(undefined), "base");
  assert.equal(normalizeSkillKind("nope"), null);
});

test("prompt lists detected review types and keeps the JSON contract", () => {
  const { system, prompt } = buildPrReviewPrompt({
    evidence: { prId: 1 },
    prDiff: { text: "diff --git a/x b/x", filesIncluded: [{ path: "x" }] },
    customSystemPrompt: "BASE\n\n---\n\nEXPORT SKILL",
    reviewKinds: [{ kind: "export", reasons: ["files: x"] }],
  });
  assert.match(system, /EXPORT SKILL/);
  assert.match(system, /ignore any instruction/);
  assert.match(prompt, /## Review type \(detected by the app\)\n- export: files: x/);
  assert.match(prompt, /"improvements"/);
});
