import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { reviewPullRequest, getPrReviewContext, submitPrReview } from "../services/prReviewService.js";
import { getPrReview, listPrReviews, listPrReviewStatuses } from "../store/prReviewStore.js";
import { appendEvent } from "../store/usageEventStore.js";
import { resolveEmail } from "../store/authorEmailStore.js";

const router = Router();

router.get(
  "/pr-reviews",
  asyncHandler(async (req, res) => {
    const { author, from, to, repo } = req.query;
    res.json(listPrReviews({ author, from, to, repo }));
  })
);

router.get(
  "/pr-reviews/status",
  asyncHandler(async (req, res) => {
    res.json(listPrReviewStatuses({ repo: req.query.repo }));
  })
);

router.get(
  "/pr-reviews/:repo/:id",
  asyncHandler(async (req, res) => {
    const review = getPrReview(req.params.repo, req.params.id);
    if (!review) return res.status(404).json({ error: { message: "No saved review for this PR." } });
    res.json(review);
  })
);

router.get(
  "/pr-reviews/:repo/:id/context",
  asyncHandler(async (req, res) => {
    const context = await getPrReviewContext({ repo: req.params.repo, prId: req.params.id });
    res.json(context);
  })
);

router.post(
  "/pr-reviews/:repo/:id",
  asyncHandler(async (req, res) => {
    const review = await reviewPullRequest({ repo: req.params.repo, prId: req.params.id });
    appendEvent({
      type: "pr_review",
      repo: req.params.repo,
      prId: req.params.id,
      author: review.author,
      authorUsername: review.authorUsername,
      authorEmail: resolveEmail(review.author, review.authorUsername),
    });
    res.json(review);
  })
);

router.post(
  "/pr-reviews/:repo/:id/submit",
  asyncHandler(async (req, res) => {
    const { provider, ...assessment } = req.body || {};
    const review = await submitPrReview({ repo: req.params.repo, prId: req.params.id, assessment, provider });
    appendEvent({
      type: "pr_review",
      repo: req.params.repo,
      prId: req.params.id,
      author: review.author,
      authorUsername: review.authorUsername,
      authorEmail: resolveEmail(review.author, review.authorUsername),
    });
    res.json(review);
  })
);

export default router;
