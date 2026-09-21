import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { reviewPullRequest } from "../services/prReviewService.js";
import { getPrReview, listPrReviews, listPrReviewStatuses } from "../store/prReviewStore.js";
import { appendEvent } from "../store/usageEventStore.js";
import { resolveEmail } from "../store/authorEmailStore.js";
import { requireUserAuth } from "../lib/userAuth.js";

const router = Router();

router.use(requireUserAuth);

router.get(
  "/pr-reviews",
  asyncHandler(async (req, res) => {
    const { author, from, to, repo } = req.query;
    res.json(await listPrReviews({ author, from, to, repo }));
  })
);

router.get(
  "/pr-reviews/status",
  asyncHandler(async (req, res) => {
    res.json(await listPrReviewStatuses({ repo: req.query.repo }));
  })
);

router.get(
  "/pr-reviews/:repo/:id",
  asyncHandler(async (req, res) => {
    const review = await getPrReview(req.params.repo, req.params.id);
    if (!review) return res.status(404).json({ error: { message: "No saved review for this PR." } });
    res.json(review);
  })
);

router.post(
  "/pr-reviews/:repo/:id",
  asyncHandler(async (req, res) => {
    const review = await reviewPullRequest({ repo: req.params.repo, prId: req.params.id });
    await appendEvent({
      type: "pr_review",
      repo: req.params.repo,
      prId: req.params.id,
      author: review.author,
      authorUsername: review.authorUsername,
      authorEmail: await resolveEmail(review.author, review.authorUsername),
    });
    res.json(review);
  })
);

export default router;
