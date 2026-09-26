import test from "node:test";
import assert from "node:assert/strict";
import { countExceptionItems, exceptionStatus } from "../lib/prExceptions.js";
import { buildPrReviewPrompt } from "../services/prReviewPrompt.js";

test("counts bullet and numbered items, free text counts as one", () => {
  assert.equal(countExceptionItems("- a\n- b\n* c\n1. d\n2) e"), 5);
  assert.equal(countExceptionItems("# Notes\n\nPublic endpoint by design."), 1);
  assert.equal(countExceptionItems("   "), 0);
  assert.deepEqual(exceptionStatus({ text: "- a\n- b", updatedAt: "t", filename: "x.md", source: "uploaded" }), {
    updatedAt: "t",
    filename: "x.md",
    source: "uploaded",
    itemCount: 2,
  });
});

test("exceptions go into the prompt as project rules, only when present", () => {
  const { prompt } = buildPrReviewPrompt({
    evidence: {},
    prDiff: { text: "" },
    exceptions: { text: "- Intended: GET /members is public" },
  });
  assert.match(prompt, /## Known exceptions for THIS PR/);
  assert.match(prompt, /<exceptions>\n- Intended: GET \/members is public\n<\/exceptions>/);
  assert.match(prompt, /CONTRADICTS/);
  const { prompt: none } = buildPrReviewPrompt({ evidence: {}, prDiff: { text: "" }, exceptions: { text: "  " } });
  assert.doesNotMatch(none, /Known exceptions/);
});
