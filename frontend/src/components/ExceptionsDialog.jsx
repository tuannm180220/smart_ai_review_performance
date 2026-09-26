import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import DisputableImprovements from "./DisputableImprovements.jsx";

const TEMPLATE_HINT = `- Intended: GET /members is public by design (spec 4.1) — do not flag missing permission
- Agreed: export is capped at 5,000 rows, streaming not needed (BA, 2026-09-10)
- Out of scope: tests for legacy/report-v1 (follow-up ticket PROJ-99)`;

/**
 * Per-PR review exceptions: what the AI must treat as intended behaviour for this PR.
 * Typed or uploaded as .md, ideally BEFORE the first review; applied on the next (re-)review.
 * When the PR already has a review, this is also the ONE place to dispute its items
 * (remove from the report with a reason) and restore them.
 */
export default function ExceptionsDialog({ record, review, onClose, onSaved, onReviewChanged }) {
  const reviewed = Boolean(review);
  const dialogRef = useRef(null);
  const fileRef = useRef(null);
  const [text, setText] = useState("");
  const [savedText, setSavedText] = useState("");
  const [source, setSource] = useState("typed");
  const [filename, setFilename] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const node = dialogRef.current;
    if (node && !node.open) node.showModal();
    function onCancel(e) {
      e.preventDefault();
      onClose();
    }
    node?.addEventListener("cancel", onCancel);
    return () => node?.removeEventListener("cancel", onCancel);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    api
      .getPrException(record.repo, record.prId)
      .then((e) => {
        if (!alive) return;
        setText(e.text || "");
        setSavedText(e.text || "");
        setSource(e.source || "typed");
        setFilename(e.filename || null);
        setUpdatedAt(e.updatedAt || null);
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [record.repo, record.prId]);

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result || ""));
      setSource("uploaded");
      setFilename(file.name);
    };
    reader.onerror = () => setError("Could not read that file.");
    reader.readAsText(file);
    e.target.value = "";
  }

  async function save() {
    setBusy(true);
    setError("");
    try {
      let status = null;
      if (text.trim()) {
        const saved = await api.savePrException(record.repo, record.prId, { text, source, filename });
        status = saved.status;
      } else if (savedText) {
        await api.deletePrException(record.repo, record.prId);
      }
      onSaved(status);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function clearAll() {
    setBusy(true);
    setError("");
    try {
      await api.deletePrException(record.repo, record.prId);
      onSaved(null);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const dirty = text !== savedText;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="review-dialog"
      onClick={(e) => e.target === dialogRef.current && onClose()}
      aria-labelledby="exceptions-title"
    >
      <div className="review-dialog-inner">
        <header className="review-dialog-header">
          <div>
            <h3 id="exceptions-title">Review exceptions — PR #{record.prId}</h3>
            <p className="muted small review-dialog-meta">
              {[record.repo, record.title].filter(Boolean).join(" · ")}
              {updatedAt ? ` · saved ${new Date(updatedAt).toLocaleString()}` : ""}
              {filename ? ` · from ${filename}` : ""}
            </p>
          </div>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="review-dialog-body">
          <p className="muted small" style={{ marginTop: 0 }}>
            List intended behaviours or agreed deviations for this PR — one per line. The AI review treats them as
            project decisions and will not report them. Saving does not start a review — changes apply the next time
            you click <strong>{reviewed ? "Re-review" : "Review"}</strong> in the PR list.
          </p>

          <textarea
            className="exceptions-text"
            rows={9}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setSource("typed");
            }}
            disabled={loading || busy}
            placeholder={TEMPLATE_HINT}
          />
          <div className="field-input-row" style={{ marginTop: 6, gap: 8, display: "flex", flexWrap: "wrap" }}>
            <button type="button" onClick={() => fileRef.current?.click()} disabled={loading || busy}>
              Upload .md file
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              onChange={handleFile}
              style={{ display: "none" }}
            />
            <span className="muted small" style={{ alignSelf: "center" }}>
              Markdown or plain text, up to 10,000 characters.
            </span>
          </div>

          {review ? (
            <section className="detail-section" style={{ marginTop: 16 }}>
              <h4>Items in the current report</h4>
              <p className="muted small" style={{ marginTop: 0 }}>
                Found after the review? Dispute an item to remove it from the report now; it is also remembered so
                later reviews in this repo do not raise it again.
              </p>
              <DisputableImprovements review={review} onChange={onReviewChanged} />
            </section>
          ) : null}

          {error ? <p className="small" style={{ color: "var(--danger, #e5484d)" }}>{error}</p> : null}

          <div className="dispute-actions" style={{ marginTop: 14 }}>
            <button type="button" onClick={() => save()} disabled={loading || busy || !dirty}>
              {busy ? "Saving…" : "Save"}
            </button>
            {savedText ? (
              <button type="button" onClick={clearAll} disabled={loading || busy}>
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </dialog>,
    document.body
  );
}
