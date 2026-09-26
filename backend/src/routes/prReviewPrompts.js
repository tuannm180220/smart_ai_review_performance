import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { requireUserAuth } from "../lib/userAuth.js";
import {
  listPromptOverrides,
  getPromptOverride,
  savePromptOverride,
  deletePromptOverride,
} from "../store/prReviewPromptStore.js";
import { REVIEW_SKILLS, getDefaultSkillText, normalizeSkillKind } from "../services/reviewSkills.js";

const router = Router();
const MAX_PROMPT_CHARS = 20000;

router.use(requireUserAuth);

// `kind` = review skill: base (every PR) | feature | export | bugfix | data. Missing → base,
// so older clients that only knew one prompt per repo keep working.
function kindFrom(req, res) {
  const kind = normalizeSkillKind(req.query.kind ?? req.body?.kind);
  if (!kind) {
    res.status(400).json({ error: { message: `Unknown skill kind. Use one of: ${REVIEW_SKILLS.map((s) => s.kind).join(", ")}` } });
    return null;
  }
  return kind;
}

function withDefault(kind, payload) {
  return { ...payload, kind, defaultPromptText: getDefaultSkillText(kind) };
}

router.get(
  "/pr-review-prompts",
  asyncHandler(async (req, res) => {
    res.json(await listPromptOverrides());
  })
);

router.get(
  "/pr-review-prompts/skills",
  asyncHandler(async (req, res) => {
    res.json(REVIEW_SKILLS.map((s) => ({ ...s, defaultPromptText: getDefaultSkillText(s.kind) })));
  })
);

router.get(
  "/pr-review-prompts/default",
  asyncHandler(async (req, res) => {
    const kind = kindFrom(req, res);
    if (!kind) return;
    res.json({ kind, promptText: getDefaultSkillText(kind) });
  })
);

router.get(
  "/pr-review-prompts/:repo",
  asyncHandler(async (req, res) => {
    const kind = kindFrom(req, res);
    if (!kind) return;
    const override = await getPromptOverride(req.params.repo, kind);
    if (!override) {
      return res.json(withDefault(kind, { repo: req.params.repo, promptText: null, isDefault: true }));
    }
    res.json(withDefault(kind, { ...override, isDefault: false }));
  })
);

router.put(
  "/pr-review-prompts/:repo",
  asyncHandler(async (req, res) => {
    const kind = kindFrom(req, res);
    if (!kind) return;
    const { repo } = req.params;
    const { promptText, source, filename } = req.body || {};
    const trimmed = typeof promptText === "string" ? promptText.trim() : "";
    if (!trimmed) {
      return res.status(400).json({ error: { message: "promptText is required" } });
    }
    if (trimmed.length > MAX_PROMPT_CHARS) {
      return res.status(400).json({ error: { message: `promptText must be ${MAX_PROMPT_CHARS} characters or fewer` } });
    }
    const saved = await savePromptOverride({ repo, kind, promptText: trimmed, source, filename });
    res.json(withDefault(kind, { ...saved, isDefault: false }));
  })
);

router.delete(
  "/pr-review-prompts/:repo",
  asyncHandler(async (req, res) => {
    const kind = kindFrom(req, res);
    if (!kind) return;
    await deletePromptOverride(req.params.repo, kind);
    res.json(withDefault(kind, { repo: req.params.repo, promptText: null, isDefault: true }));
  })
);

export default router;
