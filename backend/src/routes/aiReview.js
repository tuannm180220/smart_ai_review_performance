import { Router } from "express";
import { reviewUser, listAuthors } from "../services/performanceReviewService.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { appendEvent } from "../store/usageEventStore.js";
import { resolveEmail } from "../store/authorEmailStore.js";
import { requireUserAuth } from "../lib/userAuth.js";

const router = Router();

router.use(requireUserAuth);

router.get(
  "/ai-review/authors",
  asyncHandler(async (req, res) => {
    res.json(await listAuthors());
  })
);

router.post(
  "/ai-review",
  asyncHandler(async (req, res) => {
    const { author, authorUsername, from, to, mode } = req.body || {};
    if (!author && !authorUsername) return res.status(400).json({ error: { message: "author is required" } });
    const result = await reviewUser({ author, authorUsername, from, to, mode });
    await appendEvent({
      type: "performance_review",
      author,
      authorUsername,
      authorEmail: await resolveEmail(author, authorUsername),
      meta: { from: from || null, to: to || null, mode: result.mode || mode || "pr-reviews" },
    });
    res.json(result);
  })
);

export default router;
