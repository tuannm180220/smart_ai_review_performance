import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { requireUserAuth } from "../lib/userAuth.js";
import {
  listPromptOverrides,
  getPromptOverride,
  savePromptOverride,
  deletePromptOverride,
} from "../store/prReviewPromptStore.js";
import { DEFAULT_REVIEW_PERSONA } from "../services/prReviewPrompt.js";

const router = Router();
const MAX_PROMPT_CHARS = 20000;

router.use(requireUserAuth);

router.get(
  "/pr-review-prompts",
  asyncHandler(async (req, res) => {
    res.json(await listPromptOverrides());
  })
);

router.get(
  "/pr-review-prompts/default",
  asyncHandler(async (req, res) => {
    res.json({ promptText: DEFAULT_REVIEW_PERSONA });
  })
);

router.get(
  "/pr-review-prompts/:repo",
  asyncHandler(async (req, res) => {
    const override = await getPromptOverride(req.params.repo);
    if (!override) {
      return res.json({ repo: req.params.repo, promptText: null, isDefault: true, defaultPromptText: DEFAULT_REVIEW_PERSONA });
    }
    res.json({ ...override, isDefault: false, defaultPromptText: DEFAULT_REVIEW_PERSONA });
  })
);

router.put(
  "/pr-review-prompts/:repo",
  asyncHandler(async (req, res) => {
    const { repo } = req.params;
    const { promptText, source, filename } = req.body || {};
    const trimmed = typeof promptText === "string" ? promptText.trim() : "";
    if (!trimmed) {
      return res.status(400).json({ error: { message: "promptText is required" } });
    }
    if (trimmed.length > MAX_PROMPT_CHARS) {
      return res.status(400).json({ error: { message: `promptText must be ${MAX_PROMPT_CHARS} characters or fewer` } });
    }
    const saved = await savePromptOverride({ repo, promptText: trimmed, source, filename });
    res.json({ ...saved, isDefault: false, defaultPromptText: DEFAULT_REVIEW_PERSONA });
  })
);

router.delete(
  "/pr-review-prompts/:repo",
  asyncHandler(async (req, res) => {
    await deletePromptOverride(req.params.repo);
    res.json({ repo: req.params.repo, promptText: null, isDefault: true, defaultPromptText: DEFAULT_REVIEW_PERSONA });
  })
);

export default router;
