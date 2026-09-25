import test from "node:test";
import assert from "node:assert/strict";
import { parseUnifiedDiffFiles, preparePrDiffForReview, skipDiffPathReason } from "../lib/prDiff.js";
import { buildPrReviewPrompt } from "../services/prReviewPrompt.js";

const SAMPLE = `diff --git a/src/app.js b/src/app.js
index 111..222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -1,3 +1,4 @@
+export function greet() { return "hi"; }
 function main() {}
diff --git a/package-lock.json b/package-lock.json
index 333..444 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,2 +1,3 @@
 { "lockfileVersion": 2 }
+lots of churn
diff --git a/dist/bundle.js b/dist/bundle.js
index 555..666 100644
--- a/dist/bundle.js
+++ b/dist/bundle.js
@@ -1 +1 @@
-old
+new
diff --git a/logo.png b/logo.png
index 777..888 100644
Binary files a/logo.png and b/logo.png differ
`;

test("skipDiffPathReason drops lockfiles, generated dirs, and assets", () => {
  assert.equal(skipDiffPathReason("packages/foo/package-lock.json"), "lockfile");
  assert.equal(skipDiffPathReason("static/main/dist/app.js"), "generated-dir");
  assert.equal(skipDiffPathReason("assets/logo.png"), "binary-or-asset");
  assert.equal(skipDiffPathReason("src/app.js"), null);
});

test("parseUnifiedDiffFiles splits git patches by file", () => {
  const files = parseUnifiedDiffFiles(SAMPLE);
  assert.equal(files.length, 4);
  assert.deepEqual(
    files.map((f) => f.path),
    ["src/app.js", "package-lock.json", "dist/bundle.js", "logo.png"]
  );
});

test("preparePrDiffForReview keeps source and skips noise", () => {
  const prepared = preparePrDiffForReview(SAMPLE);
  assert.deepEqual(
    prepared.filesIncluded.map((f) => f.path),
    ["src/app.js"]
  );
  const skipped = Object.fromEntries(prepared.filesSkipped.map((f) => [f.path, f.reason]));
  assert.equal(skipped["package-lock.json"], "lockfile");
  assert.equal(skipped["dist/bundle.js"], "generated-dir");
  assert.equal(skipped["logo.png"], "binary-or-asset");
  assert.match(prepared.text, /src\/app\.js/);
  assert.doesNotMatch(prepared.text, /lockfileVersion/);
});

test("preparePrDiffForReview truncates oversized files", () => {
  const huge = `diff --git a/src/big.js b/src/big.js
--- a/src/big.js
+++ b/src/big.js
@@ -1 +1 @@
+${"x".repeat(500)}
`;
  const prepared = preparePrDiffForReview(huge, { maxFileBytes: 80, maxTotalBytes: 80, maxFiles: 5 });
  assert.equal(prepared.truncated, true);
  assert.match(prepared.text, /file truncated/);
});

test("buildPrReviewPrompt attaches filtered diff as primary evidence", () => {
  const prepared = preparePrDiffForReview(SAMPLE);
  const { system, prompt } = buildPrReviewPrompt({
    evidence: { repo: "app", prId: 1, title: "greet" },
    prDiff: prepared,
  });
  assert.match(system, /unified PR diff/);
  assert.match(system, /Base Review Skill/);
  assert.match(prompt, /improvements/);
  assert.match(prompt, /labelRationale/);
  assert.doesNotMatch(prompt, /"score":/);
  assert.match(prompt, /src\/app\.js/);
  assert.match(prompt, /package-lock\.json \(lockfile\)/);
  assert.doesNotMatch(prompt, /lockfileVersion/);
});

test("buildPrReviewPrompt says when the diff is missing", () => {
  const { prompt } = buildPrReviewPrompt({
    evidence: { repo: "app", prId: 1 },
    prDiff: { text: "", error: "timeout", filesIncluded: [], filesSkipped: [] },
  });
  assert.match(prompt, /did not read the code/);
  assert.match(prompt, /timeout/);
});
