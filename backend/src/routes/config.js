import { Router } from "express";
import { writeConfig, redactedConfig, readConfig } from "../config/configStore.js";
import {
  testJiraConnection,
  testBitbucketConnection,
  listJiraProjects,
  verifyBitbucketWorkspace,
} from "../services/atlassian.js";
import { asyncHandler } from "../lib/asyncHandler.js";
import { requireUserAuth } from "../lib/userAuth.js";

const router = Router();

const AI_PROVIDERS = new Set(["claude", "codex", "cursor"]);

router.use(requireUserAuth);

router.get(
  "/config",
  asyncHandler(async (req, res) => {
    res.json(redactedConfig());
  })
);

router.post(
  "/config",
  asyncHandler(async (req, res) => {
    const {
      atlassianEmail,
      atlassianApiToken,
      jiraBaseUrl,
      jiraStoryPointsField,
      bitbucketWorkspace,
      bitbucketApiToken,
      aiProvider,
      aiApiKey,
      aiModel,
      aiUseClaudeSubscription,
      localRepoRoot,
    } = req.body || {};

    if (aiProvider && !AI_PROVIDERS.has(aiProvider)) {
      return res.status(400).json({
        error: { message: `aiProvider must be one of: ${[...AI_PROVIDERS].join(", ")}` },
      });
    }

    const update = {};
    if (atlassianEmail !== undefined) update.atlassianEmail = atlassianEmail;
    if (atlassianApiToken) update.atlassianApiToken = atlassianApiToken;
    if (jiraBaseUrl !== undefined) update.jiraBaseUrl = jiraBaseUrl;
    if (jiraStoryPointsField !== undefined) update.jiraStoryPointsField = jiraStoryPointsField;
    if (bitbucketWorkspace !== undefined) update.bitbucketWorkspace = bitbucketWorkspace;
    if (bitbucketApiToken) update.bitbucketApiToken = bitbucketApiToken;
    if (aiProvider !== undefined) update.aiProvider = aiProvider;
    if (aiApiKey) update.aiApiKey = aiApiKey;
    if (aiModel !== undefined) update.aiModel = aiModel;
    if (aiUseClaudeSubscription !== undefined) update.aiUseClaudeSubscription = Boolean(aiUseClaudeSubscription);
    if (localRepoRoot !== undefined) update.localRepoRoot = localRepoRoot;

    await writeConfig(update);
    res.json(redactedConfig());
  })
);

router.post(
  "/config/test",
  asyncHandler(async (req, res) => {
    const result = { jira: null, bitbucket: null };

    try {
      result.jira = { ok: true, ...(await testJiraConnection()) };
    } catch (err) {
      result.jira = { ok: false, message: err.message };
    }

    try {
      result.bitbucket = { ok: true, ...(await testBitbucketConnection()) };
    } catch (err) {
      result.bitbucket = { ok: false, message: err.message };
    }

    res.json(result);
  })
);

router.get(
  "/config/jira-projects",
  asyncHandler(async (req, res) => {
    const cfg = readConfig();
    if (!cfg.jiraBaseUrl) return res.json([]);
    res.json(await listJiraProjects());
  })
);

router.get(
  "/config/bitbucket-workspaces/:slug/verify",
  asyncHandler(async (req, res) => {
    res.json(await verifyBitbucketWorkspace(req.params.slug));
  })
);

export default router;
