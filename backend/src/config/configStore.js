import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDatabaseEnabled, query } from "../db/pool.js";
import { getRequestUserId, getCachedConfig, setCachedConfig } from "../lib/requestContext.js";
import { encryptSecret, decryptSecret } from "../lib/secretCrypto.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "..", "data");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");

const DEFAULTS = {
  atlassianEmail: process.env.ATLASSIAN_EMAIL || "",
  atlassianApiToken: process.env.ATLASSIAN_API_TOKEN || "",
  jiraBaseUrl: process.env.JIRA_BASE_URL || "",
  jiraStoryPointsField: process.env.JIRA_STORY_POINTS_FIELD || "customfield_10016",
  bitbucketWorkspace: process.env.BITBUCKET_WORKSPACE || "",
  bitbucketApiToken: process.env.BITBUCKET_API_TOKEN || "",
  aiProvider: process.env.AI_PROVIDER || "",
  aiApiKey: process.env.AI_API_KEY || "",
  aiModel: process.env.AI_MODEL || "",
  aiUseClaudeSubscription: process.env.AI_USE_CLAUDE_SUBSCRIPTION === "true",
  localRepoRoot: process.env.LOCAL_REPO_ROOT || "",
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function rowToConfig(row) {
  if (!row) return { ...DEFAULTS };
  return {
    atlassianEmail: row.atlassian_email || "",
    atlassianApiToken: decryptSecret(row.atlassian_api_token_enc),
    jiraBaseUrl: row.jira_base_url || "",
    jiraStoryPointsField: row.jira_story_points_field || "customfield_10016",
    bitbucketWorkspace: row.bitbucket_workspace || "",
    bitbucketApiToken: decryptSecret(row.bitbucket_api_token_enc),
    aiProvider: row.ai_provider || "",
    aiApiKey: decryptSecret(row.ai_api_key_enc),
    aiModel: row.ai_model || "",
    aiUseClaudeSubscription: Boolean(row.ai_use_claude_subscription),
    localRepoRoot: row.local_repo_root || "",
  };
}

function requireUserId() {
  const userId = getRequestUserId();
  if (!userId) throw new Error("userId is required for multi-tenant config");
  return userId;
}

export async function hydrateConfig() {
  if (!isDatabaseEnabled()) return readFileConfig();
  const userId = requireUserId();
  const result = await query(`SELECT * FROM user_configs WHERE user_id = $1`, [userId]);
  let cfg;
  if (!result.rows[0]) {
    await query(`INSERT INTO user_configs (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [userId]);
    cfg = { ...DEFAULTS, atlassianApiToken: "", bitbucketApiToken: "", aiApiKey: "" };
  } else {
    cfg = rowToConfig(result.rows[0]);
  }
  setCachedConfig(cfg);
  return cfg;
}

function readFileConfig() {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    return { ...DEFAULTS };
  }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Sync read — uses ALS cache in multi-tenant mode (call hydrateConfig in auth middleware first). */
export function readConfig() {
  if (isDatabaseEnabled()) {
    const cached = getCachedConfig();
    if (cached) return cached;
    throw new Error("Config not loaded for this request. Auth middleware must hydrate config.");
  }
  return readFileConfig();
}

export async function writeConfig(partial) {
  if (isDatabaseEnabled()) {
    const userId = requireUserId();
    const current = getCachedConfig() || (await hydrateConfig());
    const next = { ...current, ...partial };

    await query(
      `INSERT INTO user_configs (
         user_id, atlassian_email, jira_base_url, jira_story_points_field,
         bitbucket_workspace, ai_provider, ai_model, ai_use_claude_subscription,
         local_repo_root, atlassian_api_token_enc, bitbucket_api_token_enc, ai_api_key_enc, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         atlassian_email = EXCLUDED.atlassian_email,
         jira_base_url = EXCLUDED.jira_base_url,
         jira_story_points_field = EXCLUDED.jira_story_points_field,
         bitbucket_workspace = EXCLUDED.bitbucket_workspace,
         ai_provider = EXCLUDED.ai_provider,
         ai_model = EXCLUDED.ai_model,
         ai_use_claude_subscription = EXCLUDED.ai_use_claude_subscription,
         local_repo_root = EXCLUDED.local_repo_root,
         atlassian_api_token_enc = EXCLUDED.atlassian_api_token_enc,
         bitbucket_api_token_enc = EXCLUDED.bitbucket_api_token_enc,
         ai_api_key_enc = EXCLUDED.ai_api_key_enc,
         updated_at = NOW()`,
      [
        userId,
        next.atlassianEmail || "",
        next.jiraBaseUrl || "",
        next.jiraStoryPointsField || "customfield_10016",
        next.bitbucketWorkspace || "",
        next.aiProvider || "",
        next.aiModel || "",
        next.aiUseClaudeSubscription ? 1 : 0,
        next.localRepoRoot || "",
        encryptSecret(next.atlassianApiToken || ""),
        encryptSecret(next.bitbucketApiToken || ""),
        encryptSecret(next.aiApiKey || ""),
      ]
    );
    setCachedConfig(next);
    return next;
  }

  ensureDataDir();
  const current = readFileConfig();
  const next = { ...current, ...partial };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

export function redactedConfig() {
  const cfg = readConfig();
  return {
    atlassianEmail: cfg.atlassianEmail,
    atlassianApiTokenSet: Boolean(cfg.atlassianApiToken),
    jiraBaseUrl: cfg.jiraBaseUrl,
    jiraStoryPointsField: cfg.jiraStoryPointsField,
    bitbucketWorkspace: cfg.bitbucketWorkspace,
    bitbucketApiTokenSet: Boolean(cfg.bitbucketApiToken),
    aiProvider: cfg.aiProvider,
    aiModel: cfg.aiModel,
    aiApiKeySet: Boolean(cfg.aiApiKey),
    aiUseClaudeSubscription: Boolean(cfg.aiUseClaudeSubscription),
    localRepoRoot: cfg.localRepoRoot || "",
  };
}

/** Used by migrate script — write config for a specific user without ALS. */
export async function writeConfigForUser(userId, partial) {
  const current = { ...DEFAULTS, ...partial };
  await query(
    `INSERT INTO user_configs (
       user_id, atlassian_email, jira_base_url, jira_story_points_field,
       bitbucket_workspace, ai_provider, ai_model, ai_use_claude_subscription,
       local_repo_root, atlassian_api_token_enc, bitbucket_api_token_enc, ai_api_key_enc, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, NOW())
     ON CONFLICT (user_id) DO UPDATE SET
       atlassian_email = EXCLUDED.atlassian_email,
       jira_base_url = EXCLUDED.jira_base_url,
       jira_story_points_field = EXCLUDED.jira_story_points_field,
       bitbucket_workspace = EXCLUDED.bitbucket_workspace,
       ai_provider = EXCLUDED.ai_provider,
       ai_model = EXCLUDED.ai_model,
       ai_use_claude_subscription = EXCLUDED.ai_use_claude_subscription,
       local_repo_root = EXCLUDED.local_repo_root,
       atlassian_api_token_enc = EXCLUDED.atlassian_api_token_enc,
       bitbucket_api_token_enc = EXCLUDED.bitbucket_api_token_enc,
       ai_api_key_enc = EXCLUDED.ai_api_key_enc,
       updated_at = NOW()`,
    [
      userId,
      current.atlassianEmail || "",
      current.jiraBaseUrl || "",
      current.jiraStoryPointsField || "customfield_10016",
      current.bitbucketWorkspace || "",
      current.aiProvider || "",
      current.aiModel || "",
      current.aiUseClaudeSubscription ? 1 : 0,
      current.localRepoRoot || "",
      encryptSecret(current.atlassianApiToken || ""),
      encryptSecret(current.bitbucketApiToken || ""),
      encryptSecret(current.aiApiKey || ""),
    ]
  );
  return current;
}
