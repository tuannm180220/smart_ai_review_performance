import { getPromptOverride } from "../store/prReviewPromptStore.js";
import { REVIEW_SKILLS, SKILL_KINDS, getDefaultSkillText, normalizeSkillKind } from "../lib/reviewSkillCatalog.js";

export { REVIEW_SKILLS, SKILL_KINDS, getDefaultSkillText, normalizeSkillKind };

/**
 * Resolve the skills for one PR review: the repo's override for each kind if saved,
 * otherwise the built-in default. Returns the composed persona and what was used.
 */
export async function composeReviewPersona(repo, typeKinds = []) {
  const kinds = ["base", ...typeKinds.filter((k) => k !== "base" && SKILL_KINDS.has(k))];
  const parts = [];
  const used = [];
  for (const kind of kinds) {
    const override = await getPromptOverride(repo, kind);
    const text = (override?.promptText || "").trim() || getDefaultSkillText(kind);
    parts.push(text);
    used.push({ kind, source: override ? "custom" : "default" });
  }
  return { persona: parts.join("\n\n---\n\n"), used };
}
