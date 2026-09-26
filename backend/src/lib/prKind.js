/**
 * Detects what kind of change a PR is, so the matching review skill(s) can be
 * appended to the base skill. Pure heuristics over paths, branch, title, ticket
 * and diff text — cheap, deterministic and explainable (every hit is a reason).
 */

export const TYPE_SKILL_KINDS = ["feature", "export", "bugfix", "data"];
export const MAX_TYPE_SKILLS = 2;
const MIN_SCORE = 2;

const RULES = {
  bugfix: {
    branch: [/^(fix|bugfix|hotfix|bug)[/_-]/i],
    text: [/\b(fix(es|ed)?|bug|hotfix|defect|regression|revert)\b/i, /(不具合|修正|lỗi|sửa lỗi)/i],
    commit: [/^(fix|hotfix|bugfix)(\(|:|\s)/i],
  },
  export: {
    path: [/(export|report|excel|xlsx|csv|pdf|download|print|帳票)/i],
    diff: [
      /\b(exceljs|xlsx|sheetjs|json2csv|csv-stringify|csv-writer|papaparse|pdfkit|pdfmake|jspdf|puppeteer|openpyxl|xlsxwriter|reportlab)\b/i,
      /content-disposition/i,
      /(text\/csv|spreadsheetml|application\/pdf)/i,
    ],
    text: [/\b(export|download|report|csv|excel|pdf)\b/i, /(xuất|出力|帳票)/i],
  },
  data: {
    path: [
      /(^|\/)(migrations?|seeds?|schema)(\/|\.|$)/i,
      /\.sql$/i,
      /(^|\/)(jobs?|cron|batch|workers?|queues?|schedulers?|consumers?|lambdas?|fargate[-_]tasks?|webhooks?|integrations?)(\/|\.|$)/i,
      /(serverless\.ya?ml|docker-compose\.ya?ml|\.github\/workflows|bitbucket-pipelines\.yml)$/i,
    ],
    diff: [
      /\b(ALTER TABLE|CREATE TABLE|DROP (TABLE|COLUMN)|CREATE INDEX|addColumn|removeColumn|changeColumn|queryInterface)\b/i,
      /\b(cron|schedule(d|r)?|setInterval|backoff|retry|webhook|idempoten)/i,
    ],
    text: [/\b(migration|batch|cron|job|sync|webhook|integration|import)\b/i],
  },
  feature: {
    path: [
      /(^|\/)(routes?|controllers?|pages?|components?|views?|screens?|handlers?|api|forms?)(\/|\.|$)/i,
      /\.(jsx|tsx|vue|svelte)$/i,
    ],
    text: [/\b(add|new|create|implement|feature|screen|page|form|list|search)\b/i],
  },
};

function anyMatch(patterns, value) {
  return (patterns || []).some((re) => re.test(value || ""));
}

/**
 * @param {{ title?, sourceBranch?, commitMessages?, ticketSummary?, ticketDescription?, files?, diffText?, reopened? }} pr
 * @returns {{ kind: string, score: number, reasons: string[] }[]} at most MAX_TYPE_SKILLS kinds, strongest first
 */
export function detectPrKinds(pr = {}) {
  const files = (pr.files || []).filter(Boolean);
  const text = [pr.title, pr.ticketSummary].filter(Boolean).join(" \n ");
  const ticketText = (pr.ticketDescription || "").slice(0, 800);
  const commits = pr.commitMessages || [];
  const diff = (pr.diffText || "").slice(0, 60000);

  const results = [];
  for (const kind of TYPE_SKILL_KINDS) {
    const rule = RULES[kind];
    let score = 0;
    const reasons = [];

    if (rule.branch && anyMatch(rule.branch, pr.sourceBranch)) {
      score += 3;
      reasons.push(`branch "${pr.sourceBranch}"`);
    }
    if (rule.path) {
      const hits = files.filter((f) => anyMatch(rule.path, f));
      if (hits.length) {
        // Path hits are strong evidence; weigh by the share of the diff they cover.
        score += hits.length >= Math.max(2, Math.ceil(files.length / 3)) ? 3 : 2;
        reasons.push(`files: ${hits.slice(0, 3).join(", ")}${hits.length > 3 ? ` +${hits.length - 3}` : ""}`);
      }
    }
    if (rule.diff) {
      const hits = rule.diff.filter((re) => re.test(diff));
      if (hits.length) {
        score += Math.min(2, hits.length);
        reasons.push("diff content");
      }
    }
    if (rule.text && anyMatch(rule.text, text)) {
      score += kind === "feature" ? 1 : 2;
      reasons.push("title/ticket");
    } else if (rule.text && anyMatch(rule.text, ticketText)) {
      score += 1;
      reasons.push("ticket description");
    }
    if (rule.commit && commits.some((m) => anyMatch(rule.commit, m))) {
      score += 1;
      reasons.push("commit messages");
    }
    if (kind === "bugfix" && pr.reopened) {
      score += 2;
      reasons.push("ticket was reopened");
    }

    if (score >= MIN_SCORE) results.push({ kind, score, reasons });
  }

  results.sort((a, b) => b.score - a.score || TYPE_SKILL_KINDS.indexOf(a.kind) - TYPE_SKILL_KINDS.indexOf(b.kind));

  // Feature is the generic fallback: keep it only when nothing more specific wins,
  // or as the second skill next to export/data (a new export screen is also a feature).
  let picked = results.filter((r) => r.kind !== "feature");
  const feature = results.find((r) => r.kind === "feature");
  if (feature && !picked.some((r) => r.kind === "bugfix")) picked.push(feature);
  picked = picked.slice(0, MAX_TYPE_SKILLS);

  if (!picked.length) {
    return [{ kind: "feature", score: 0, reasons: ["default — no specific pattern detected"] }];
  }
  return picked;
}
