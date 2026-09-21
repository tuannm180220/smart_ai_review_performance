import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useToast } from "../context/ToastContext.jsx";
import { useConfigStatus } from "../context/ConfigStatusContext.jsx";

const EMPTY_FORM = {
  atlassianEmail: "",
  atlassianApiToken: "",
  jiraBaseUrl: "",
  jiraStoryPointsField: "customfield_10016",
  bitbucketWorkspace: "",
  bitbucketApiToken: "",
  aiApiKey: "",
  aiProvider: "",
  aiModel: "",
  aiUseClaudeSubscription: false,
};

const AI_PROVIDERS = [
  { value: "claude", label: "Claude (Anthropic)" },
  { value: "codex", label: "Codex (OpenAI)" },
  { value: "cursor", label: "Cursor" },
];

export default function SettingsPage() {
  const toast = useToast();
  const configStatus = useConfigStatus();
  const [form, setForm] = useState(EMPTY_FORM);
  const [tokenSet, setTokenSet] = useState({ atlassian: false, bitbucket: false, ai: false });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [verifyingWorkspace, setVerifyingWorkspace] = useState(false);
  const [workspaceVerified, setWorkspaceVerified] = useState(null);

  useEffect(() => {
    api
      .getConfig()
      .then((cfg) => {
        setForm((f) => ({
          ...f,
          atlassianEmail: cfg.atlassianEmail || "",
          jiraBaseUrl: cfg.jiraBaseUrl || "",
          jiraStoryPointsField: cfg.jiraStoryPointsField || "customfield_10016",
          bitbucketWorkspace: cfg.bitbucketWorkspace || "",
          aiProvider: cfg.aiProvider || "",
          aiModel: cfg.aiModel || "",
          aiUseClaudeSubscription: Boolean(cfg.aiUseClaudeSubscription),
        }));
        setTokenSet({
          atlassian: cfg.atlassianApiTokenSet,
          bitbucket: cfg.bitbucketApiTokenSet,
          ai: cfg.aiApiKeySet,
        });
      })
      .catch((err) => toast.error(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function update(key, value) {
    if (key === "bitbucketWorkspace") setWorkspaceVerified(null);
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function persistForm() {
    await api.saveConfig(form);
    setForm((f) => ({ ...f, atlassianApiToken: "", bitbucketApiToken: "", aiApiKey: "" }));
    const cfg = await configStatus.refresh();
    setTokenSet({
      atlassian: cfg.atlassianApiTokenSet,
      bitbucket: cfg.bitbucketApiTokenSet,
      ai: cfg.aiApiKeySet,
    });
    return cfg;
  }

  async function handleVerifyWorkspace() {
    if (!form.bitbucketWorkspace) return toast.error("Type a workspace slug first.");
    if (!form.atlassianEmail) return toast.error("Fill in Atlassian email first.");
    if (!tokenSet.bitbucket && !form.bitbucketApiToken.trim()) {
      return toast.error("Paste your Bitbucket API token, then Verify (settings are saved automatically).");
    }

    setVerifyingWorkspace(true);
    setWorkspaceVerified(null);
    try {
      // Verify uses backend-stored credentials — always persist the form first.
      await persistForm();
      const result = await api.verifyBitbucketWorkspace(form.bitbucketWorkspace.trim());
      setWorkspaceVerified(result);
      toast.success(`Found workspace "${result.name}".`);
    } catch (err) {
      setWorkspaceVerified(null);
      toast.error(err.message);
    } finally {
      setVerifyingWorkspace(false);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      await persistForm();
      toast.success("Settings saved.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!form.atlassianEmail) return toast.error("Fill in Atlassian email first.");
    if (!form.jiraBaseUrl) return toast.error("Fill in Jira base URL first.");
    if (!tokenSet.atlassian && !form.atlassianApiToken.trim()) {
      return toast.error("Paste your Jira (Atlassian) API token before testing.");
    }
    if (!tokenSet.bitbucket && !form.bitbucketApiToken.trim()) {
      return toast.error("Paste your Bitbucket API token before testing.");
    }

    setTesting(true);
    setTestResult(null);
    try {
      await persistForm();
      const result = await api.testConnections();
      setTestResult(result);
      if (result.jira?.ok && result.bitbucket?.ok) {
        toast.success("Both connections succeeded.");
      } else {
        const parts = [];
        if (!result.jira?.ok) parts.push(`Jira: ${result.jira?.message || "failed"}`);
        if (!result.bitbucket?.ok) parts.push(`Bitbucket: ${result.bitbucket?.message || "failed"}`);
        toast.error(parts.join(" · ") || "One or more connections failed.");
      }
      await configStatus.refresh();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="page">
      <h2>Settings</h2>
      <p className="muted">
        Credentials are stored per login account in PostgreSQL. Token fields stay blank
        after save for security — if you see “already set”, leave them empty unless
        replacing. Verify and Test connection save the form automatically. Each app
        account needs its own Jira + Bitbucket tokens (they are not shared between logins).
        Tokens are only sent to Atlassian&apos;s APIs; Jira and Bitbucket use separate tokens.
      </p>

      <form className="form-grid" onSubmit={handleSave}>
        <div className="field">
          <label className="field-label" htmlFor="f-email">
            Atlassian email
          </label>
          <div className="field-input">
            <input
              id="f-email"
              type="email"
              value={form.atlassianEmail}
              onChange={(e) => update("atlassianEmail", e.target.value)}
              placeholder="you@company.com"
              required
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="f-token">
            Atlassian API token
          </label>
          <div className="field-input">
            <input
              id="f-token"
              type="password"
              value={form.atlassianApiToken}
              onChange={(e) => update("atlassianApiToken", e.target.value)}
              placeholder={tokenSet.atlassian ? "••••••••" : "paste API token"}
            />
            {tokenSet.atlassian && <span className="muted small">Saved — leave blank to keep.</span>}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="f-jira-url">
            Jira base URL
          </label>
          <div className="field-input">
            <input
              id="f-jira-url"
              type="url"
              value={form.jiraBaseUrl}
              onChange={(e) => update("jiraBaseUrl", e.target.value)}
              placeholder="https://yourdomain.atlassian.net"
              required
            />
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="f-bitbucket-token">
            Bitbucket API token
          </label>
          <div className="field-input">
            <input
              id="f-bitbucket-token"
              type="password"
              value={form.bitbucketApiToken}
              onChange={(e) => update("bitbucketApiToken", e.target.value)}
              placeholder={tokenSet.bitbucket ? "••••••••" : "paste API token"}
            />
            {tokenSet.bitbucket && <span className="muted small">Saved — leave blank to keep.</span>}
            <span className="muted small">
              Create one at{" "}
              <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer">
                id.atlassian.com
              </a>{" "}
              with Bitbucket scopes — app passwords are deprecated. This is a separate token from the Jira one
              above.
            </span>
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="f-workspace">
            Bitbucket workspace
          </label>
          <div className="field-input">
            <div className="field-input-row">
              <input
                id="f-workspace"
                type="text"
                value={form.bitbucketWorkspace}
                onChange={(e) => update("bitbucketWorkspace", e.target.value)}
                placeholder="my-workspace"
              />
              <button type="button" onClick={handleVerifyWorkspace} disabled={verifyingWorkspace}>
                {verifyingWorkspace ? "Checking…" : "Verify"}
              </button>
            </div>
            {workspaceVerified && (
              <span className="muted small">✅ Found "{workspaceVerified.name}" ({workspaceVerified.slug})</span>
            )}
            <span className="muted small">
              The slug from your workspace's Bitbucket URL (bitbucket.org/<strong>your-slug</strong>/...) — save
              your email + Bitbucket API token first, then click Verify to confirm it's accessible. Bitbucket no
              longer offers an API to list all your workspaces, so this can't be a dropdown.
            </span>
          </div>
        </div>

        <h3 style={{ gridColumn: "1 / -1", margin: "8px 0 0" }}>AI agent</h3>
        <p className="muted small" style={{ gridColumn: "1 / -1", margin: "-8px 0 0" }}>
          Powers the <strong>Review member</strong> tab, which writes a performance summary for a chosen person from
          their synced PR/ticket data. Note: a Claude Pro/Max, ChatGPT Plus/Pro, or Cursor Pro subscription is
          billed separately from that provider's API — see the notes below for which providers can still avoid a
          second purchase.
        </p>

        <div className="field">
          <label className="field-label" htmlFor="f-ai-provider">
            AI agent
          </label>
          <div className="field-input">
            <select
              id="f-ai-provider"
              value={form.aiProvider}
              onChange={(e) => update("aiProvider", e.target.value)}
            >
              <option value="">Select a provider…</option>
              {AI_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            {form.aiProvider === "claude" && (
              <span className="muted small">
                Anthropic API billing is separate from Claude Pro/Max — see the subscription option below to avoid
                a second purchase.
              </span>
            )}
            {form.aiProvider === "codex" && (
              <span className="muted small">
                OpenAI has no supported way to run this against a ChatGPT Plus/Pro plan — Codex here always needs
                its own OpenAI API key, billed separately from ChatGPT.
              </span>
            )}
            {form.aiProvider === "cursor" && (
              <span className="muted small">
                Cursor API keys draw from the same monthly usage pool as your Cursor plan (Pro includes $20/mo) —
                no separate purchase needed, just generate a key from the Cursor dashboard.
              </span>
            )}
          </div>
        </div>

        {form.aiProvider === "claude" && (
          <div className="field">
            <label className="field-label" htmlFor="f-ai-claude-sub">
              Claude auth
            </label>
            <div className="field-input">
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: "normal" }}>
                <input
                  id="f-ai-claude-sub"
                  type="checkbox"
                  checked={form.aiUseClaudeSubscription}
                  onChange={(e) => update("aiUseClaudeSubscription", e.target.checked)}
                />
                Use my Claude Pro/Max subscription instead of an API key
              </label>
              <span className="muted small">
                Requires running <code>ant auth login</code> once on the machine hosting the backend (the same
                sign-in Claude Code uses) — no ANTHROPIC_API_KEY needed. Subject to your subscription's usage
                limits, which are lower than paid API rate limits; heavy or shared use may still need an API key.
              </span>
            </div>
          </div>
        )}

        <div className="field">
          <label className="field-label" htmlFor="f-ai-key">
            AI agent API key {form.aiProvider === "claude" && form.aiUseClaudeSubscription && "(optional)"}
          </label>
          <div className="field-input">
            <input
              id="f-ai-key"
              type="password"
              value={form.aiApiKey}
              onChange={(e) => update("aiApiKey", e.target.value)}
              placeholder={tokenSet.ai ? "••••••••" : "paste API key"}
            />
            {tokenSet.ai && <span className="muted small">Saved — leave blank to keep.</span>}
          </div>
        </div>

        <div style={{ gridColumn: "1 / -1" }}>
          <button type="button" className="link-button" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </button>
        </div>

        {showAdvanced && (
          <>
            <div className="field">
              <label className="field-label" htmlFor="f-story-points">
                Jira story points field ID
              </label>
              <div className="field-input">
                <input
                  id="f-story-points"
                  type="text"
                  value={form.jiraStoryPointsField}
                  onChange={(e) => update("jiraStoryPointsField", e.target.value)}
                  placeholder="customfield_10016"
                />
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="f-ai-model">
                AI model override
              </label>
              <div className="field-input">
                <input
                  id="f-ai-model"
                  type="text"
                  value={form.aiModel}
                  onChange={(e) => update("aiModel", e.target.value)}
                  placeholder="leave blank for provider default"
                />
              </div>
            </div>
          </>
        )}

        <div className="form-actions">
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          <button type="button" onClick={handleTest} disabled={testing}>
            {testing ? "Testing…" : "Test connection"}
          </button>
        </div>
      </form>

      {testResult && (
        <div className="test-results">
          <div className={`connection-status ${testResult.jira?.ok ? "ok" : "fail"}`}>
            Jira: {testResult.jira?.ok ? `Connected ✅ (${testResult.jira.displayName})` : `Failed ❌ — ${testResult.jira?.message}`}
          </div>
          <div className={`connection-status ${testResult.bitbucket?.ok ? "ok" : "fail"}`}>
            Bitbucket:{" "}
            {testResult.bitbucket?.ok
              ? `Connected ✅ (${testResult.bitbucket.displayName})`
              : `Failed ❌ — ${testResult.bitbucket?.message}`}
          </div>
        </div>
      )}
    </div>
  );
}
