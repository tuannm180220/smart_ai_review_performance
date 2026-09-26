import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { requireUserAuth } from "../lib/userAuth.js";
import { listPrExceptions, getPrException, savePrException, deletePrException } from "../store/prExceptionStore.js";
import { MAX_EXCEPTIONS_CHARS, exceptionStatus } from "../lib/prExceptions.js";

const router = Router();
router.use(requireUserAuth);

// Status map for the PR table: { "repo#id": { updatedAt, filename, source, itemCount } }
router.get(
  "/pr-exceptions",
  asyncHandler(async (req, res) => {
    const map = {};
    for (const e of await listPrExceptions({ repo: req.query.repo })) map[e.id] = exceptionStatus(e);
    res.json(map);
  })
);

router.get(
  "/pr-exceptions/:repo/:id",
  asyncHandler(async (req, res) => {
    const e = await getPrException(req.params.repo, req.params.id);
    res.json(e || { repo: req.params.repo, prId: req.params.id, text: null });
  })
);

router.put(
  "/pr-exceptions/:repo/:id",
  asyncHandler(async (req, res) => {
    const { text, source, filename } = req.body || {};
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed) return res.status(400).json({ error: { message: "Exceptions text is required (use Clear to remove)." } });
    if (trimmed.length > MAX_EXCEPTIONS_CHARS) {
      return res.status(400).json({ error: { message: `Exceptions must be ${MAX_EXCEPTIONS_CHARS} characters or fewer.` } });
    }
    const saved = await savePrException({
      repo: req.params.repo,
      prId: req.params.id,
      text: trimmed,
      source,
      filename,
      by: req.user?.email || null,
    });
    res.json({ ...saved, status: exceptionStatus(saved) });
  })
);

router.delete(
  "/pr-exceptions/:repo/:id",
  asyncHandler(async (req, res) => {
    await deletePrException(req.params.repo, req.params.id);
    res.json({ repo: req.params.repo, prId: req.params.id, text: null });
  })
);

export default router;
