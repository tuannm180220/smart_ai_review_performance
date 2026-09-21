import { Router } from "express";
import { listRepos, listPullRequests, getPullRequestDetails } from "../services/bitbucketService.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { requireUserAuth } from "../lib/userAuth.js";

const router = Router();

router.use(requireUserAuth);

router.get(
  "/bitbucket/repos",
  asyncHandler(async (req, res) => {
    res.json(await listRepos());
  })
);

router.get(
  "/bitbucket/prs",
  asyncHandler(async (req, res) => {
    const { repo, from, to, author, state } = req.query;
    if (!repo) return res.status(400).json({ error: { message: "repo is required" } });
    res.json(await listPullRequests({ repo, from, to, author, state }));
  })
);

router.get(
  "/bitbucket/prs/:id/details",
  asyncHandler(async (req, res) => {
    const { repo } = req.query;
    if (!repo) return res.status(400).json({ error: { message: "repo query param is required" } });
    res.json(await getPullRequestDetails({ repo, id: req.params.id }));
  })
);

export default router;
