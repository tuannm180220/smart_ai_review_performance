CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_configs (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  atlassian_email TEXT NOT NULL DEFAULT '',
  jira_base_url TEXT NOT NULL DEFAULT '',
  jira_story_points_field TEXT NOT NULL DEFAULT 'customfield_10016',
  bitbucket_workspace TEXT NOT NULL DEFAULT '',
  ai_provider TEXT NOT NULL DEFAULT '',
  ai_model TEXT NOT NULL DEFAULT '',
  ai_use_claude_subscription BOOLEAN NOT NULL DEFAULT FALSE,
  local_repo_root TEXT NOT NULL DEFAULT '',
  atlassian_api_token_enc TEXT NOT NULL DEFAULT '',
  bitbucket_api_token_enc TEXT NOT NULL DEFAULT '',
  ai_api_key_enc TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pr_ticket_records (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  repo TEXT NOT NULL,
  pr_id INTEGER NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ,
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_pr_ticket_records_user_repo
  ON pr_ticket_records (user_id, repo);

CREATE TABLE IF NOT EXISTS pr_reviews (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (user_id, id)
);

-- Per-PR review exceptions (intended behaviours the AI must not report), written before/after review.
CREATE TABLE IF NOT EXISTS pr_exceptions (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (user_id, id)
);

CREATE TABLE IF NOT EXISTS pr_watch (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_created
  ON usage_events (created_at);

CREATE TABLE IF NOT EXISTS pr_review_prompts (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  repo TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'base',
  prompt_text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'typed',
  filename TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, repo, kind)
);

-- Upgrade: one override per (repo, review skill kind). Existing rows become the repo's "base" skill.
ALTER TABLE pr_review_prompts ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'base';
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.key_column_usage
    WHERE table_name = 'pr_review_prompts'
      AND constraint_name = 'pr_review_prompts_pkey'
      AND column_name = 'kind'
  ) THEN
    ALTER TABLE pr_review_prompts DROP CONSTRAINT IF EXISTS pr_review_prompts_pkey;
    ALTER TABLE pr_review_prompts ADD PRIMARY KEY (user_id, repo, kind);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS author_emails (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  email TEXT,
  PRIMARY KEY (user_id, username)
);
