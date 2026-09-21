import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Markdown from "./Markdown.jsx";
import StatusBadge from "./StatusBadge.jsx";

const COMPLETENESS_TONE = {
  incomplete: "badge-red",
  adequate: "badge-orange",
  solid: "badge-green",
  excellent: "badge-green",
};

export function CompletenessBadge({ value, empty = "—" }) {
  if (!value) return <span className="muted">{empty}</span>;
  return <StatusBadge value={value} tone={COMPLETENESS_TONE[value] || "badge-gray"} />;
}

function BulletList({ items, empty }) {
  if (!items?.length) return <p className="muted">{empty}</p>;
  return (
    <ul className="compact-list">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function diffCoverageLabel(coverage) {
  if (!coverage) return "";
  if (coverage.error) return " · diff unavailable";
  const n = coverage.included?.length || 0;
  if (!n) return " · no source files in diff";
  return ` · ${n} file${n === 1 ? "" : "s"} from Bitbucket diff${coverage.truncated ? " (truncated)" : ""}`;
}

function formatReviewedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function clipDisplay(text, max) {
  if (!text) return "";
  const value = String(text).trim();
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.55 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

export default function PrReviewPanel({ review, onClose }) {
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

  if (!review) return null;

  function handleBackdropClick(event) {
    if (event.target === dialogRef.current) onCloseRef.current?.();
  }

  const reviewedAt = formatReviewedAt(review.reviewedAt);
  const ticket = review.jiraKey
    ? `${review.jiraKey}${review.storyPoints != null ? ` (${review.storyPoints} pts)` : ""}`
    : null;

  const summary = clipDisplay(review.summary, 220);
  const rationale = clipDisplay(review.scoreRationale, 160);
  const strengths = (review.strengths || []).slice(0, 3);
  const improvements = (review.improvements || review.weaknesses || []).slice(0, 4);
  const signals = review.signals || [];
  const relatedPrs = review.relatedPrs || [];

  return createPortal(
    <dialog
      ref={dialogRef}
      className="review-dialog"
      onClick={handleBackdropClick}
      aria-labelledby="review-dialog-title"
    >
      <div className="review-dialog-inner">
        <header className="review-dialog-header">
          <div>
            <h3 id="review-dialog-title">
              PR #{review.prId}
              {review.title ? ` ${review.title}` : ""}
            </h3>
            <p className="muted small review-dialog-meta">
              {[review.author, review.repo, review.state].filter(Boolean).join(" · ")}
              {ticket ? ` · ticket ${ticket}` : ""}
              {reviewedAt ? ` · reviewed ${reviewedAt}` : ""}
              {diffCoverageLabel(review.diffCoverage)}
            </p>
          </div>
          <button type="button" onClick={() => onCloseRef.current?.()} aria-label="Close review">
            Close
          </button>
        </header>

        <div className="review-dialog-body">
          <div className="review-dialog-metrics">
            <div className="metric-card">
              <div className="metric-value">{review.ticketComplexity || "—"}</div>
              <div className="metric-label">Ticket complexity</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">
                <CompletenessBadge value={review.codeCompleteness} />
              </div>
              <div className="metric-label">Code completeness</div>
            </div>
          </div>

          {summary || rationale ? (
            <p className="review-dialog-summary">
              {summary || rationale}
              {summary && rationale && rationale !== summary ? <span className="muted"> {rationale}</span> : null}
            </p>
          ) : null}

          <div className="review-dialog-lists">
            <section className="detail-section">
              <h4>Strengths</h4>
              <BulletList items={strengths} empty="None recorded." />
            </section>
            <section className="detail-section">
              <h4>Improvements</h4>
              <BulletList items={improvements} empty="None recorded." />
            </section>
          </div>

          {signals.length ? (
            <p className="muted small" style={{ marginTop: 10 }}>
              {signals.map((s) => (
                <span key={s} className="badge badge-gray" style={{ marginRight: 6 }}>
                  {s}
                </span>
              ))}
            </p>
          ) : null}

          {relatedPrs.length ? (
            <section className="detail-section" style={{ marginTop: 10 }}>
              <h4>Related PRs referenced</h4>
              <ul className="compact-list">
                {relatedPrs.map((r) => (
                  <li key={`${r.repo}-${r.prId}`}>
                    {r.link ? (
                      <a href={r.link} target="_blank" rel="noreferrer">
                        #{r.prId} {r.title}
                      </a>
                    ) : (
                      <span>
                        #{r.prId} {r.title}
                      </span>
                    )}
                    <span className="muted small"> · {Math.round((r.similarity || 0) * 100)}% similar</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {!review.summary &&
          !review.scoreRationale &&
          !review.strengths?.length &&
          !review.improvements?.length &&
          !review.weaknesses?.length &&
          review.reviewDocument ? (
            <section className="detail-section">
              <Markdown text={review.reviewDocument} />
            </section>
          ) : null}

          {review.link ? (
            <p className="muted small" style={{ marginTop: 16 }}>
              <a href={review.link} target="_blank" rel="noreferrer">
                Open pull request
              </a>
            </p>
          ) : null}
        </div>
      </div>
    </dialog>,
    document.body
  );
}
