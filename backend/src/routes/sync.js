import { Router } from "express";
import { runSync } from "../services/syncService.js";
import { getStore } from "../store/recordStore.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { requireUserAuth } from "../lib/userAuth.js";

const router = Router();

router.use(requireUserAuth);

router.post(
  "/sync",
  asyncHandler(async (req, res) => {
    const { repo, from, to, author, state } = req.query;
    if (!repo) return res.status(400).json({ error: { message: "repo is required" } });
    const result = await runSync({ repo, from, to, author, state });
    res.json(result);
  })
);

router.get(
  "/records",
  asyncHandler(async (req, res) => {
    const store = await getStore();
    const { repo } = req.query;
    const records = repo ? await store.getByRepo(repo) : await store.getAll();
    res.json(records);
  })
);

router.get(
  "/records/by-ticket",
  asyncHandler(async (req, res) => {
    const store = await getStore();
    const { repo } = req.query;
    const records = repo ? await store.getByRepo(repo) : await store.getAll();

    const groups = new Map();
    for (const record of records) {
      const groupKey = record.jiraKey || `__unlinked__:${record.repo}#${record.prId}`;
      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          jiraKey: record.jiraKey,
          linkStatus: record.linkStatus,
          ticketStatus: record.ticketStatus,
          ticketSummary: record.ticketSummary,
          storyPoints: record.storyPoints,
          reopened: record.reopened,
          reopenCount: record.reopenCount,
          reopenDates: record.reopenDates,
          prIds: [],
          prs: [],
        });
      }
      const group = groups.get(groupKey);
      group.prIds.push(record.prId);
      group.prs.push({
        prId: record.prId,
        repo: record.repo,
        title: record.title,
        author: record.author,
        state: record.state,
        createdAt: record.createdAt,
        mergedAt: record.mergedAt,
      });
      if (record.linkStatus === "linked") {
        group.linkStatus = "linked";
        group.ticketStatus = record.ticketStatus;
        group.ticketSummary = record.ticketSummary;
        group.storyPoints = record.storyPoints;
        group.reopened = record.reopened;
        group.reopenCount = record.reopenCount;
        group.reopenDates = record.reopenDates;
      }
    }

    res.json([...groups.values()]);
  })
);

export default router;
