import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import { useToast } from "../context/ToastContext.jsx";
import Markdown from "../components/Markdown.jsx";
import { CompletenessBadge } from "../components/PrReviewPanel.jsx";

const METRIC_LABELS = [
  ["totalPRs", "Total PRs"],
  ["mergedPRs", "Merged"],
  ["approvalRate", "Approval rate"],
  ["linkedTickets", "Linked tickets"],
  ["storyPoints", "Story points"],
  ["avgReviewCommentsPerPr", "Avg comments / PR"],
  ["linesAdded", "Lines added"],
  ["linesRemoved", "Lines removed"],
  ["reopenedTicketCount", "Reopen events"],
  ["avgDaysToReworkPr", "Avg days to fix (rework)"],
  ["savedReviews", "Saved PR reviews"],
];

function formatMetric(key, value) {
  if (value === null || value === undefined) return "—";
  if (key === "approvalRate") return `${Math.round(value * 100)}%`;
  if (key === "avgDaysToReworkPr") return `${value}d`;
  return value;
}

function rangeText(review) {
  return `${review.from || "all time"} → ${review.to || "all time"}`;
}

function downloadReport(review, fallbackAuthor) {
  const blob = new Blob([review.review], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const rangeLabel = `${review.from || "all-time"}_to_${review.to || "all-time"}`;
  a.href = url;
  a.download = `performance-review_${review.authorUsername || review.author || fallbackAuthor}_${rangeLabel}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Coverage, metrics, per-PR table and the AI report of one member review. */
function MemberReviewResult({ result }) {
  return (
    <>
      {result.coverage && (
        <div className="banner banner-info" style={{ marginBottom: 16 }}>
          <strong>Saved PR reviews:</strong> {result.coverage.savedReviews} review(s)
          {result.coverage.syncedPRs ? ` · ${result.coverage.syncedPRs} synced PR(s) in range` : ""}
          {result.coverage.unreviewedCount
            ? ` · ${result.coverage.unreviewedCount} synced PR(s) not yet reviewed`
            : ""}
          .
        </div>
      )}

      <h3 style={{ marginBottom: 8 }}>Delivery metrics</h3>
      <div className="metric-grid">
        {METRIC_LABELS.map(([key, label]) => (
          <div className="metric-card" key={key}>
            <div className="metric-value">{formatMetric(key, result.metrics?.[key])}</div>
            <div className="metric-label">{label}</div>
          </div>
        ))}
      </div>

      {result.prReviews?.length > 0 && (
        <>
          <h3 style={{ marginTop: 24, marginBottom: 8 }}>PR reviews in range</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PR</th>
                  <th>Title</th>
                  <th>Complexity</th>
                  <th>Completeness</th>
                  <th>Strengths</th>
                  <th>Improvements</th>
                </tr>
              </thead>
              <tbody>
                {result.prReviews.map((r) => (
                  <tr key={`${r.repo}#${r.prId}`}>
                    <td>
                      <a href={r.link} target="_blank" rel="noreferrer">
                        {r.repo}#{r.prId}
                      </a>
                    </td>
                    <td>{r.title}</td>
                    <td>{r.ticketComplexity || "—"}</td>
                    <td>
                      <CompletenessBadge value={r.codeCompleteness} />
                    </td>
                    <td className="muted small">{(r.strengths || []).slice(0, 2).join("; ") || "—"}</td>
                    <td className="muted small">
                      {(r.improvements || r.weaknesses || []).slice(0, 2).join("; ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h3 style={{ marginTop: 24, marginBottom: 8 }}>AI report (from saved PR reviews)</h3>
      <div className="detail-panel">
        <Markdown text={result.review} />
      </div>
    </>
  );
}

/** A saved member review in a modal, same shell as the Review PR dialog. */
function MemberReviewDialog({ review, fallbackAuthor, onClose }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const node = dialogRef.current;
    if (!node) return undefined;
    if (!node.open) node.showModal();

    function onCancel(event) {
      event.preventDefault();
      onCloseRef.current?.();
    }
    node.addEventListener("cancel", onCancel);
    return () => {
      node.removeEventListener("cancel", onCancel);
      if (node.open) node.close();
    };
  }, []);

  function handleBackdropClick(event) {
    if (event.target === dialogRef.current) onCloseRef.current?.();
  }

  const reviewedAt = review.reviewedAt ? new Date(review.reviewedAt).toLocaleString() : null;

  return createPortal(
    <dialog
      ref={dialogRef}
      className="review-dialog review-dialog-wide"
      onClick={handleBackdropClick}
      aria-labelledby="member-review-dialog-title"
    >
      <div className="review-dialog-inner">
        <header className="review-dialog-header">
          <div>
            <h3 id="member-review-dialog-title">Member review · {review.author || fallbackAuthor}</h3>
            <p className="muted small review-dialog-meta">
              Range: {rangeText(review)}
              {reviewedAt ? ` · reviewed ${reviewedAt}` : ""}
              {review.provider ? ` · ${review.provider}` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => downloadReport(review, fallbackAuthor)}>
              Download (.md)
            </button>
            <button type="button" onClick={() => onCloseRef.current?.()} aria-label="Close review">
              Close
            </button>
          </div>
        </header>
        <div className="review-dialog-body">
          <MemberReviewResult result={review} />
        </div>
      </div>
    </dialog>,
    document.body
  );
}

export default function PerformanceReviewPage({ active = true }) {
  const toast = useToast();
  const [authors, setAuthors] = useState([]);
  const [author, setAuthor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [openingId, setOpeningId] = useState(null);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    if (!active) return;
    api
      .listAiReviewAuthors()
      .then(setAuthors)
      .catch((err) => toast.error(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  function selectedIdentity() {
    const selected = authors.find((a) => (a.authorUsername || a.author) === author);
    return { author: selected?.author || author, authorUsername: selected?.authorUsername || null };
  }

  useEffect(() => {
    setViewing(null);
    setHistory([]);
    if (!author) return;
    let cancelled = false;
    setHistoryLoading(true);
    api
      .listMemberReviews(selectedIdentity())
      .then((rows) => !cancelled && setHistory(rows))
      .catch((err) => !cancelled && toast.error(err.message))
      .finally(() => !cancelled && setHistoryLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [author]);

  async function handleRun(e) {
    e.preventDefault();
    if (!author) return toast.error("Choose a person first.");
    setLoading(true);
    try {
      const res = await api.runAiReview({ ...selectedIdentity(), from, to, mode: "pr-reviews" });
      setViewing(res);
      setHistory((prev) => [{ id: res.id, from: res.from, to: res.to, reviewedAt: res.reviewedAt }, ...prev]);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleOpen(id) {
    setOpeningId(id);
    try {
      setViewing(await api.getMemberReview(id));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div className="page">
      <h2>Review member</h2>
      <p className="muted">
        Synthesize <strong>saved per-PR reviews</strong> in the date range (strengths, improvements, signals).
        Review individual PRs first on Review PR.
      </p>

      <form className="filter-bar" onSubmit={handleRun}>
        <label>
          Person
          <select value={author} onChange={(e) => setAuthor(e.target.value)}>
            <option value="">Select…</option>
            {authors.map((a) => (
              <option key={a.authorUsername || a.author} value={a.authorUsername || a.author}>
                {a.author && a.authorUsername && a.author !== a.authorUsername
                  ? `${a.author} (${a.authorUsername})`
                  : a.author || a.authorUsername}
              </option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="submit" disabled={loading || !authors.length}>
          {loading ? "Reviewing…" : "Run review"}
        </button>
      </form>

      {!authors.length && (
        <p className="muted">
          No people yet. Connect Bitbucket in Settings, then either Sync PRs or wait for workspace members to
          load. If the list is still empty, the Bitbucket token may be missing{" "}
          <code>read:workspace:bitbucket</code>.
        </p>
      )}

      {author && (
        <>
          <h3 style={{ marginBottom: 8 }}>Previous reviews</h3>
          {historyLoading ? (
            <p className="muted">Loading previous reviews…</p>
          ) : history.length ? (
            <div className="table-wrap" style={{ marginBottom: 24 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Reviewed at</th>
                    <th>Range</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td className="cell-nowrap">{new Date(h.reviewedAt).toLocaleString()}</td>
                      <td className="cell-nowrap">{rangeText(h)}</td>
                      <td>
                        <button
                          type="button"
                          className="btn-compact"
                          disabled={openingId === h.id}
                          onClick={() => handleOpen(h.id)}
                        >
                          {openingId === h.id ? "Opening…" : "View"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="muted">No previous reviews for this person yet.</p>
          )}
        </>
      )}

      {loading && (
        <p className="muted">Loading saved PR reviews and asking the AI agent to synthesize them…</p>
      )}

      {!loading && !author && (
        <p className="muted">
          Pick a person and click Run review. Review that person&apos;s PRs first so there is something to
          synthesize.
        </p>
      )}

      {viewing && <MemberReviewDialog review={viewing} fallbackAuthor={author} onClose={() => setViewing(null)} />}
    </div>
  );
}
