import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "..", "prompts");

/** Catalog shown in the Review prompts tab. `base` always applies; the others are picked per PR. */
export const REVIEW_SKILLS = [
  {
    kind: "base",
    label: "Base — every PR",
    appliesWhen: "Always. Review procedure, severity, output style and signals shared by all PRs.",
  },
  {
    kind: "feature",
    label: "Feature — screens, forms, APIs",
    appliesWhen: "PR touches routes, controllers, pages or components (also the default when nothing else matches).",
  },
  {
    kind: "export",
    label: "Export / report",
    appliesWhen: "PR generates Excel/CSV/PDF or downloads (export/report files, exceljs/xlsx/csv libraries, Content-Disposition).",
  },
  {
    kind: "bugfix",
    label: "Bug fix / hotfix",
    appliesWhen: "fix/ or hotfix/ branch, 'fix/bug' in title or ticket, or the ticket was reopened.",
  },
  {
    kind: "data",
    label: "DB, batch & integration",
    appliesWhen: "Migrations/SQL/schema, jobs/cron/workers/Lambda, webhooks or external API clients, pipeline/infra files.",
  },
];

export const SKILL_KINDS = new Set(REVIEW_SKILLS.map((s) => s.kind));

const defaults = {};
for (const { kind } of REVIEW_SKILLS) {
  defaults[kind] = fs.readFileSync(path.join(PROMPTS_DIR, `${kind}.md`), "utf-8").trim();
}

export function normalizeSkillKind(kind) {
  const key = String(kind || "base").trim().toLowerCase();
  return SKILL_KINDS.has(key) ? key : null;
}

export function getDefaultSkillText(kind = "base") {
  return defaults[normalizeSkillKind(kind) || "base"];
}
