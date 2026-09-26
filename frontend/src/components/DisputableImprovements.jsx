import React, { useState } from "react";
import { api } from "../api.js";
import SeverityText from "./SeverityText.jsx";

/**
 * The one place to dispute review items (used by the Exceptions dialog on the PR table).
 * The team rejects an item (e.g. intended project behaviour): it leaves the report, is kept
 * under "Disputed" with the reason, and later reviews in this repo are told not to raise it
 * again. Restore undoes it.
 */
export default function DisputableImprovements({ review, onChange }) {
  const items = review.improvements || review.weaknesses || [];
  const disputes = review.disputes || [];
  const signals = review.signals || [];
  const [openIndex, setOpenIndex] = useState(null);
  const [reason, setReason] = useState("");
  const [removeSignals, setRemoveSignals] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function open(i) {
    setOpenIndex(i);
    setReason("");
    setRemoveSignals([]);
    setError("");
  }

  function toggleSignal(signal) {
    setRemoveSignals((prev) => (prev.includes(signal) ? prev.filter((s) => s !== signal) : [...prev, signal]));
  }

  async function submit(i) {
    if (!reason.trim()) return setError("Please give a reason.");
    setBusy(true);
    setError("");
    try {
      const updated = await api.disputePrReviewItem(review.repo, review.prId, {
        index: i,
        item: items[i],
        reason: reason.trim(),
        removeSignals,
      });
      setOpenIndex(null);
      onChange(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function restore(d) {
    setBusy(true);
    setError("");
    try {
      onChange(await api.restorePrReviewItem(review.repo, review.prId, d));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {items.length ? (
        <ul className="compact-list">
          {items.map((item, i) => (
            <li key={`${i}-${item}`}>
              <SeverityText item={item} />{" "}
              {openIndex === i ? null : (
                <button type="button" className="link-button small" onClick={() => open(i)} disabled={busy}>
                  Dispute
                </button>
              )}
              {openIndex === i ? (
                <div className="dispute-form">
                  <textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why is this not an issue? e.g. intended behaviour per spec §3, agreed with BA"
                    autoFocus
                  />
                  {signals.length ? (
                    <div className="muted small">
                      Also remove signal:{" "}
                      {signals.map((sig) => (
                        <label key={sig} style={{ marginRight: 10, whiteSpace: "nowrap" }}>
                          <input
                            type="checkbox"
                            checked={removeSignals.includes(sig)}
                            onChange={() => toggleSignal(sig)}
                          />{" "}
                          {sig}
                        </label>
                      ))}
                    </div>
                  ) : null}
                  <div className="dispute-actions">
                    <button type="button" onClick={() => submit(i)} disabled={busy || !reason.trim()}>
                      {busy ? "Saving…" : "Remove from report"}
                    </button>
                    <button type="button" onClick={() => setOpenIndex(null)} disabled={busy}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None recorded.</p>
      )}

      {disputes.length ? (
        <div className="disputed-list">
          <div className="muted small" style={{ marginTop: 8 }}>
            Disputed by the team ({disputes.length}) — removed from the report:
          </div>
          <ul className="compact-list">
            {disputes.map((d, i) => (
              <li key={`${i}-${d.item}`} className="muted small">
                <s>{d.item}</s> — {d.reason}
                {d.by ? ` (${d.by})` : ""}{" "}
                <button type="button" className="link-button small" onClick={() => restore(i)} disabled={busy}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <p className="small" style={{ color: "var(--danger, #e5484d)" }}>{error}</p> : null}
    </>
  );
}

