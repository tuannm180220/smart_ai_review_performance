import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import { useToast } from "../context/ToastContext.jsx";

function formatUpdatedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export default function PromptsPage() {
  const toast = useToast();
  const fileInputRef = useRef(null);

  const [repos, setRepos] = useState([]);
  const [repo, setRepo] = useState("");
  const [skills, setSkills] = useState([]);
  const [kind, setKind] = useState("base");
  const [overrides, setOverrides] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(true);

  const [promptText, setPromptText] = useState("");
  const [savedPromptText, setSavedPromptText] = useState("");
  const [defaultPromptText, setDefaultPromptText] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [source, setSource] = useState("typed");
  const [filename, setFilename] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loadingPrompt, setLoadingPrompt] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .listRepos()
      .then((r) => {
        setRepos(r);
        if (r.length) setRepo(r[0].slug);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoadingRepos(false));
    api
      .listReviewSkills()
      .then(setSkills)
      .catch((err) => toast.error(err.message));
    refreshOverrides();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function refreshOverrides() {
    api
      .listPrReviewPrompts()
      .then(setOverrides)
      .catch((err) => toast.error(err.message));
  }

  useEffect(() => {
    if (!repo) return;
    setLoadingPrompt(true);
    api
      .getPrReviewPrompt(repo, kind)
      .then((data) => {
        const effectiveText = data.isDefault ? data.defaultPromptText || "" : data.promptText || "";
        setDefaultPromptText(data.defaultPromptText || "");
        setIsDefault(Boolean(data.isDefault));
        setPromptText(effectiveText);
        setSavedPromptText(effectiveText);
        setSource(data.source || "typed");
        setFilename(data.filename || null);
        setUpdatedAt(data.updatedAt || null);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoadingPrompt(false));
  }, [repo, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setPromptText(String(reader.result || ""));
      setSource("uploaded");
      setFilename(file.name);
    };
    reader.onerror = () => toast.error("Could not read that file.");
    reader.readAsText(file);
    e.target.value = "";
  }

  async function handleSave() {
    if (!repo) return;
    if (!promptText.trim()) return toast.error("The prompt can't be empty.");
    setSaving(true);
    try {
      const saved = await api.savePrReviewPrompt(repo, { kind, promptText, source, filename });
      setIsDefault(false);
      setSavedPromptText(promptText);
      setUpdatedAt(saved.updatedAt);
      toast.success(`Saved custom "${skillLabel(kind)}" skill for ${repo}.`);
      refreshOverrides();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleResetToDefault() {
    if (!repo) return;
    setSaving(true);
    try {
      await api.deletePrReviewPrompt(repo, kind);
      setIsDefault(true);
      setPromptText(defaultPromptText);
      setSavedPromptText(defaultPromptText);
      setSource("typed");
      setFilename(null);
      setUpdatedAt(null);
      toast.success(`Reverted ${repo} to the default "${skillLabel(kind)}" skill.`);
      refreshOverrides();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRow(targetRepo, targetKind) {
    try {
      await api.deletePrReviewPrompt(targetRepo, targetKind);
      toast.success(`Reverted ${targetRepo} to the default "${skillLabel(targetKind)}" skill.`);
      refreshOverrides();
      if (targetRepo === repo && targetKind === kind) {
        setIsDefault(true);
        setPromptText(defaultPromptText);
        setSavedPromptText(defaultPromptText);
        setSource("typed");
        setFilename(null);
        setUpdatedAt(null);
      }
    } catch (err) {
      toast.error(err.message);
    }
  }

  const dirty = promptText !== savedPromptText;
  const currentSkill = skills.find((s) => s.kind === kind);
  function skillLabel(k) {
    return skills.find((s) => s.kind === k)?.label || k;
  }

  return (
    <div className="page">
      <h2>Prompts config</h2>
      <p className="muted">
        Each PR review uses the <strong>Base</strong> skill plus up to two <strong>type skills</strong> the app
        picks from the PR itself (changed files, branch, title, ticket): Feature, Export / report, Bug fix, or
        DB / batch / integration. Every skill has a built-in default; override any of them per Bitbucket repo —
        type your own or upload a .md file — to add house rules. The output format (JSON keys, factuality rules)
        always stays enforced regardless of what you write here.
      </p>

      <div className="form-grid" style={{ maxWidth: 900 }}>
        <div className="field">
          <label className="field-label" htmlFor="p-repo">
            Repo
          </label>
          <div className="field-input">
            <select id="p-repo" value={repo} onChange={(e) => setRepo(e.target.value)} disabled={loadingRepos}>
              {!repos.length && <option value="">No repos found</option>}
              {repos.map((r) => {
                const count = overrides.filter((o) => o.repo === r.slug).length;
                return (
                  <option key={r.slug} value={r.slug}>
                    {r.name}
                    {count ? ` (${count} custom)` : ""}
                  </option>
                );
              })}
            </select>
            {!loadingPrompt && (
              <span className="muted small">
                {isDefault ? "Using the built-in default for this skill." : `Custom prompt saved${updatedAt ? ` · ${formatUpdatedAt(updatedAt)}` : ""}${filename ? ` · from ${filename}` : ""}.`}
              </span>
            )}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="p-skill">
            Skill
          </label>
          <div className="field-input">
            <select id="p-skill" value={kind} onChange={(e) => setKind(e.target.value)} disabled={!skills.length}>
              {(skills.length ? skills : [{ kind: "base", label: "Base — every PR" }]).map((s) => {
                const custom = overrides.some((o) => o.repo === repo && o.kind === s.kind);
                return (
                  <option key={s.kind} value={s.kind}>
                    {s.label}
                    {custom ? " (custom)" : ""}
                  </option>
                );
              })}
            </select>
            {currentSkill?.appliesWhen ? (
              <span className="muted small">Applied when: {currentSkill.appliesWhen}</span>
            ) : null}
          </div>
        </div>

        <div className="field">
          <label className="field-label" htmlFor="p-text" style={{ alignSelf: "start", paddingTop: 6 }}>
            Prompt
          </label>
          <div className="field-input" style={{ alignSelf: "start" }}>
            <textarea
              id="p-text"
              value={promptText}
              onChange={(e) => {
                setPromptText(e.target.value);
                setSource("typed");
              }}
              disabled={loadingPrompt}
              rows={22}
              style={{ fontFamily: "monospace", fontSize: 13, resize: "vertical" }}
              placeholder="Describe how this kind of PR should be reviewed in this repo…"
            />
            <div className="field-input-row" style={{ marginTop: 4 }}>
              <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loadingPrompt}>
                Upload .md file
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,text/markdown,text/plain"
                onChange={handleFileUpload}
                style={{ display: "none" }}
              />
            </div>
            <span className="muted small">
              Markdown or plain text, up to 20,000 characters per skill. A custom skill replaces the default of the
              same kind for this repo only — evidence, diff, review history, and the required JSON output shape are
              always added by the app.
            </span>
          </div>
        </div>

        <div className="form-actions">
          <button type="button" onClick={handleSave} disabled={saving || loadingPrompt || !dirty}>
            {saving ? "Saving…" : "Save for this repo"}
          </button>
          <button type="button" onClick={handleResetToDefault} disabled={saving || loadingPrompt || isDefault}>
            Reset to default
          </button>
        </div>
      </div>

      {overrides.length > 0 && (
        <>
          <h3 style={{ marginTop: 28 }}>Custom skills</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Repo</th>
                  <th>Skill</th>
                  <th>Source</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={`${o.repo}::${o.kind}`}>
                    <td>{o.repo}</td>
                    <td>{skillLabel(o.kind)}</td>
                    <td>{o.source === "uploaded" ? `Uploaded (${o.filename || "file"})` : "Typed"}</td>
                    <td>{formatUpdatedAt(o.updatedAt) || "—"}</td>
                    <td>
                      <button type="button" className="link-button" onClick={() => {
                          setRepo(o.repo);
                          setKind(o.kind || "base");
                        }}>
                        Edit
                      </button>{" "}
                      <button type="button" className="link-button" onClick={() => handleDeleteRow(o.repo, o.kind || "base")}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
