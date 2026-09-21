import { Router } from "express";
import { asyncHandler } from "../lib/asyncHandler.js";
import { verifyCredentials, createToken, requireAdminAuth } from "../lib/adminAuth.js";
import { getUsageTimeSeries, getUsageSummary } from "../services/usageService.js";
import { getTopVulnerabilities } from "../services/vulnerabilityService.js";
import { getImpactTrend } from "../services/impactService.js";
import { listMappings, setMappingGlobal } from "../store/authorEmailStore.js";

const router = Router();

router.post(
  "/admin/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body || {};
    if (!verifyCredentials(email, password)) {
      return res.status(401).json({ error: { message: "Invalid email or password" } });
    }
    const { token, expiresAt } = createToken(email);
    res.json({ token, email, expiresAt });
  })
);

router.use("/admin", requireAdminAuth);

router.get(
  "/admin/usage",
  asyncHandler(async (req, res) => {
    const { granularity, from, to } = req.query;
    res.json(await getUsageTimeSeries({ granularity: granularity || "day", from, to }));
  })
);

router.get(
  "/admin/summary",
  asyncHandler(async (req, res) => {
    res.json(await getUsageSummary());
  })
);

router.get(
  "/admin/vulnerabilities/top",
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit) || 10;
    res.json(await getTopVulnerabilities(limit));
  })
);

router.get(
  "/admin/impact",
  asyncHandler(async (req, res) => {
    res.json(await getImpactTrend());
  })
);

router.get(
  "/admin/authors",
  asyncHandler(async (req, res) => {
    res.json(await listMappings());
  })
);

router.post(
  "/admin/authors/:key",
  asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    res.json(await setMappingGlobal(req.params.key, email || null));
  })
);

export default router;
