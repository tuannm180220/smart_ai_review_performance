import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useToast } from "../context/ToastContext.jsx";
import Markdown from "../components/Markdown.jsx";
import { CompletenessBadge } from "../components/PrReviewPanel.jsx";
import SeverityText from "../components/SeverityText.jsx";

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

export default function PerformanceReviewPage({ active = true }) {
  const toast = useToast();
  const [authors, setAuthors] = useState([]);
  const [author, setAuthor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!active) return;
    api
      .listAiReviewAuthors()
      .then(setAuthors)
      .catch((err) => toast.error(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function handleRun(e) {
    e.preventDefault();
    if (!author) return toast.error("Choose a person first.");
    const selected = authors.find((a) => (a.authorUsername || a.author) === author);
    setLoading(true);
    setResult(null);
    try {
      const res = await api.runAiReview({
        author: selected?.author || author,
        authorUsername: selected?.authorUsername || null,
        from,
        to,
        mode: "pr-reviews",
      });
      setResult(res);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleDownload() {
    if (!result) return;
    const blob = new Blob([result.review], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const rangeLabel = `${result.from || "all-time"}_to_${result.to || "all-time"}`;
    a.href = url;
    a.download = `performance-review_${author}_${rangeLabel}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
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

      {loading && (
        <p className="muted">Loading saved PR reviews and asking the AI agent to synthesize them…</p>
      )}

      {result && (
        <>
          {result.coverage && (
            <div className="banner banner-info" style={{ marginBottom: 16 }}>
              <strong>Saved PR reviews:</strong> {result.coverage.savedReviews} review(s)
              {result.coverage.syncedPRs
                ? ` · ${result.coverage.syncedPRs} synced PR(s) in range`
                : ""}
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
                <div className="metric-value">{formatMetric(key, result.metrics[key])}</div>
                <div className="metric-label">{label}</div>
              </div>
            ))}
          </div>

          {result.prReviews?.length > 0 && (
            <>
              <h3 style={{ marginTop: 24, marginBottom: 8 }}>PR reviews in range</h3>
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
                        {(r.improvements || r.weaknesses || []).length
                          ? (r.improvements || r.weaknesses).slice(0, 2).map((item, i) => (
                              <div key={i}>
                                <SeverityText item={item} />
                              </div>
                            ))
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <h3 style={{ marginTop: 24, marginBottom: 8 }}>AI report (from saved PR reviews)</h3>
          <div className="detail-panel">
            <div
              className="muted small"
              style={{
                marginBottom: 8,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <span>
                Provider: {result.provider} · Range: {result.from || "all time"} → {result.to || "all time"}
              </span>
              <button type="button" onClick={handleDownload}>
                Download report (.md)
              </button>
            </div>
            <Markdown text={result.review} />
          </div>
        </>
      )}

      {!loading && !result && (
        <p className="muted">
          Pick a person and click Run review. Review that person&apos;s PRs first so there is something to
          synthesize.
        </p>
      )}
    </div>
  );
}
