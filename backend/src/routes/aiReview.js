import { Router } from "express";
import { reviewUser, listAuthors } from "../services/performanceReviewService.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { appendEvent } from "../store/usageEventStore.js";
import { resolveEmail } from "../store/authorEmailStore.js";
import { saveMemberReview, listMemberReviews, getMemberReview } from "../store/memberReviewStore.js";
import { requireUserAuth } from "../lib/userAuth.js";

const router = Router();

router.use(requireUserAuth);

router.get(
  "/ai-review/authors",
  asyncHandler(async (req, res) => {
    res.json(await listAuthors());
  })
);

router.get(
  "/ai-review/history",
  asyncHandler(async (req, res) => {
    const { author, authorUsername } = req.query;
    if (!author && !authorUsername) return res.status(400).json({ error: { message: "author is required" } });
    res.json(await listMemberReviews({ author, authorUsername }));
  })
);

router.get(
  "/ai-review/history/:id",
  asyncHandler(async (req, res) => {
    const review = await getMemberReview(req.params.id);
    if (!review) return res.status(404).json({ error: { message: "No saved member review with this id." } });
    res.json(review);
  })
);

router.post(
  "/ai-review",
  asyncHandler(async (req, res) => {
    const { author, authorUsername, from, to, mode } = req.body || {};
    if (!author && !authorUsername) return res.status(400).json({ error: { message: "author is required" } });
    const result = await reviewUser({ author, authorUsername, from, to, mode });
    const saved = await saveMemberReview({ ...result, authorUsername: authorUsername || null });
    await appendEvent({
      type: "performance_review",
      author,
      authorUsername,
      authorEmail: await resolveEmail(author, authorUsername),
      meta: { from: from || null, to: to || null, mode: result.mode || mode || "pr-reviews" },
    });
    res.json(saved);
  })
);

export default router;
