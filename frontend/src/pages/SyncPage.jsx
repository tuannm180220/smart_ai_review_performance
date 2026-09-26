import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useToast } from "../context/ToastContext.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import PrReviewPanel, { CompletenessBadge } from "../components/PrReviewPanel.jsx";
import ExceptionsDialog from "../components/ExceptionsDialog.jsx";
import { defaultFrom, defaultTo } from "../lib/dates.js";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatLocal(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

const PR_STATES = [
  { value: "OPEN", label: "Open" },
  { value: "MERGED", label: "Merged" },
  { value: "DECLINED", label: "Declined" },
  { value: "SUPERSEDED", label: "Superseded" },
];

const SORT_OPTIONS = [
  { value: "createdAt", label: "Created date" },
  { value: "author", label: "Author" },
  { value: "ticketStatus", label: "Ticket status" },
  { value: "jiraKey", label: "Ticket" },
];

function ticketBrowseUrl(jiraBaseUrl, key) {
  if (!jiraBaseUrl || !key) return null;
  return `${jiraBaseUrl.replace(/\/+$/, "")}/browse/${encodeURIComponent(key)}`;
}

/**
 * "Exceptions" column: declared intended behaviours for this PR (applied on the next review)
 * plus items disputed in the saved report. Warns when the review predates the exceptions.
 */
function ExceptionsCell({ exception, status, onOpen }) {
  const disputed = status?.disputesCount || 0;
  const stale = Boolean(status) && (exception?.updatedAt || null) !== (status.exceptionsAppliedAt || null);
  if (!exception && !disputed) {
    return (
      <button
        type="button"
        className="link-button small"
        onClick={onOpen}
        title={status ? "Declare exceptions or dispute items of the current report" : "Declare intended behaviours before review"}
      >
        {status ? "+ Add / Dispute" : "+ Add"}
      </button>
    );
  }
  return (
    <button type="button" className="exceptions-open" onClick={onOpen} title="View / edit exceptions">
      {exception ? (
        <span>
          {exception.itemCount} item{exception.itemCount === 1 ? "" : "s"}
          {exception.filename ? <span className="muted small"> · {exception.filename}</span> : null}
        </span>
      ) : null}
      {disputed ? (
        <span className="muted small">
          {exception ? " · " : ""}
          {disputed} disputed
        </span>
      ) : null}
      {stale ? <span className="badge badge-orange exceptions-stale">re-review</span> : null}
    </button>
  );
}

export default function SyncPage() {
  const toast = useToast();
  const [repos, setRepos] = useState([]);
  const [repo, setRepo] = useState("");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [syncing, setSyncing] = useState(false);
  const [records, setRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(false);

  const [filterAuthor, setFilterAuthor] = useState("");
  const [filterState, setFilterState] = useState("");
  const [sortBy, setSortBy] = useState("createdAt");
  const [sortDir, setSortDir] = useState("desc");
  const [notConfigured, setNotConfigured] = useState(false);
  const [reviewStatuses, setReviewStatuses] = useState({});
  const [reviewingKey, setReviewingKey] = useState(null);
  const [openReview, setOpenReview] = useState(null);
  const [exceptionStatuses, setExceptionStatuses] = useState({});
  const [openExceptions, setOpenExceptions] = useState(null); // { record, review }
  const [jiraBaseUrl, setJiraBaseUrl] = useState("");

  useEffect(() => {
    api
      .listRepos()
      .then((r) => {
        setRepos(r);
        if (r.length && !repo) setRepo(r[0].slug);
      })
      .catch((err) => {
        if (err.code === "NOT_CONFIGURED") setNotConfigured(true);
        else toast.error(err.message);
      });
    api
      .getConfig()
      .then((cfg) => setJiraBaseUrl(cfg.jiraBaseUrl || ""))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadRecords(forRepo) {
    setLoadingRecords(true);
    try {
      const r = await api.getRecords(forRepo);
      setRecords(r);
      try {
        setReviewStatuses(await api.listPrReviewStatuses(forRepo));
      } catch {
        setReviewStatuses({});
      }
      try {
        setExceptionStatuses(await api.listPrExceptions(forRepo));
      } catch {
        setExceptionStatuses({});
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoadingRecords(false);
    }
  }

  useEffect(() => {
    if (repo) loadRecords(repo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  async function handleSync(e) {
    e.preventDefault();
    if (!repo) return toast.error("Choose a repository first.");
    setSyncing(true);
    try {
      const result = await api.sync({ repo, from, to });
      toast.success(`Synced ${result.synced} PR(s), ${result.failed} failed.`);
      if (result.failed > 0) {
        toast.error(`${result.failed} PR(s) failed to sync — check backend logs.`);
      }
      await loadRecords(repo);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSyncing(false);
    }
  }

  const authorOptions = useMemo(() => {
    const seen = new Map();
    for (const r of records) {
      const value = r.authorUsername || r.author;
      if (!value || seen.has(value)) continue;
      const label =
        r.author && r.authorUsername && r.author !== r.authorUsername
          ? `${r.author} (${r.authorUsername})`
          : r.author || r.authorUsername;
      seen.set(value, label);
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [records]);

  useEffect(() => {
    if (filterAuthor && !authorOptions.some((o) => o.value === filterAuthor)) setFilterAuthor("");
  }, [authorOptions, filterAuthor]);

  const visibleRecords = useMemo(() => {
    let rows = [...records];
    if (filterAuthor) {
      rows = rows.filter((r) => (r.authorUsername || r.author) === filterAuthor || r.author === filterAuthor);
    }
    if (filterState) {
      rows = rows.filter((r) => r.state === filterState);
    }
    rows.sort((a, b) => {
      const av = a[sortBy] ?? "";
      const bv = b[sortBy] ?? "";
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [records, filterAuthor, filterState, sortBy, sortDir]);

  async function handleReviewRecord(record) {
    const key = `${record.repo}#${record.prId}`;
    setReviewingKey(key);
    try {
      const review = await api.reviewPullRequest(record.repo, record.prId);
      setReviewStatuses((prev) => ({
        ...prev,
        [key]: statusFromReview(review),
      }));
      setOpenReview(review);
      toast.success(`Saved review for #${record.prId}.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setReviewingKey(null);
    }
  }

  function statusFromReview(review) {
    return {
      reviewedAt: review.reviewedAt,
      ticketComplexity: review.ticketComplexity,
      codeCompleteness: review.codeCompleteness,
      disputesCount: (review.disputes || []).length,
      exceptionsAppliedAt: review.exceptionsApplied?.updatedAt || null,
    };
  }

  function handleReviewChanged(review) {
    const key = `${review.repo}#${review.prId}`;
    setReviewStatuses((prev) => ({ ...prev, [key]: statusFromReview(review) }));
    setOpenExceptions((prev) => (prev && `${prev.record.repo}#${prev.record.prId}` === key ? { ...prev, review } : prev));
  }

  async function handleOpenExceptions(record) {
    const key = `${record.repo}#${record.prId}`;
    let review = null;
    if (reviewStatuses[key]) {
      try {
        review = await api.getPrReview(record.repo, record.prId);
      } catch {
        review = null;
      }
    }
    setOpenExceptions({ record, review });
  }

  async function handleViewReview(record) {
    try {
      setOpenReview(await api.getPrReview(record.repo, record.prId));
    } catch (err) {
      toast.error(err.message);
    }
  }

  return (
    <div className="page">
      <div className="page-heading">
        <h2>Review PR</h2>
        {records.length > 0 && (
          <span className="muted small">
            {visibleRecords.length === records.length
              ? `${records.length} PR${records.length === 1 ? "" : "s"}`
              : `${visibleRecords.length} of ${records.length} PRs`}
          </span>
        )}
      </div>

      {notConfigured && (
        <div className="banner banner-info">
          Bitbucket is not configured yet. Fill in Settings to sync pull requests.
        </div>
      )}

      <div className="toolbar-panel">
        <form className="filter-bar" onSubmit={handleSync}>
          <label>
            Repo
            <select value={repo} onChange={(e) => setRepo(e.target.value)}>
              <option value="">Select…</option>
              {repos.map((r) => (
                <option key={r.slug} value={r.slug}>
                  {r.name}
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
          <button type="submit" disabled={syncing}>
            {syncing ? "Syncing…" : "Sync"}
          </button>
        </form>
        <p className="muted small toolbar-hint">Defaults to the last 7 days — widen the range to pull older PRs.</p>
      </div>

      <div className="toolbar-panel">
        <div className="filter-bar">
          <label>
            Author
            <select value={filterAuthor} onChange={(e) => setFilterAuthor(e.target.value)}>
              <option value="">All</option>
              {authorOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            State
            <select value={filterState} onChange={(e) => setFilterState(e.target.value)}>
              <option value="">All</option>
              {PR_STATES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort by
            <span className="field-input-row">
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}>
                {sortDir === "asc" ? "↑ Asc" : "↓ Desc"}
              </button>
            </span>
          </label>
        </div>
      </div>

      {loadingRecords ? (
        <p className="muted">Loading persisted records…</p>
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>PR</th>
                <th>Title</th>
                <th>Author</th>
                <th>State</th>
                <th>Created</th>
                <th>Merged</th>
                <th>Ticket</th>
                <th>Status</th>
                <th>Pts</th>
                <th>Reopened</th>
                <th>Completeness</th>
                <th title="Intended behaviours the AI review must not report for this PR">Exceptions</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {visibleRecords.map((r) => {
                const key = `${r.repo}#${r.prId}`;
                const status = reviewStatuses[key];
                const ticketHref = ticketBrowseUrl(jiraBaseUrl, r.jiraKey);
                const reviewing = reviewingKey === key;
                return (
                  <tr key={key} className={r.linkStatus !== "linked" ? "row-flagged" : ""}>
                    <td className="cell-id">
                      {r.link ? (
                        <a className="pr-link" href={r.link} target="_blank" rel="noreferrer">
                          #{r.prId}
                        </a>
                      ) : (
                        `#${r.prId}`
                      )}
                    </td>
                    <td className="cell-title" title={r.title}>
                      {r.link ? (
                        <a className="pr-link cell-title-text" href={r.link} target="_blank" rel="noreferrer">
                          {r.title}
                        </a>
                      ) : (
                        <span className="cell-title-text">{r.title}</span>
                      )}
                    </td>
                    <td className="cell-nowrap">{r.author}</td>
                    <td>
                      <StatusBadge value={r.state} />
                    </td>
                    <td className="cell-nowrap" title={formatLocal(r.createdAt)}>
                      {formatDate(r.createdAt)}
                    </td>
                    <td className="cell-nowrap" title={formatLocal(r.mergedAt)}>
                      {formatDate(r.mergedAt)}
                    </td>
                    <td className="cell-nowrap">
                      {r.jiraKey ? (
                        ticketHref ? (
                          <a className="ticket-link" href={ticketHref} target="_blank" rel="noreferrer">
                            {r.jiraKey}
                          </a>
                        ) : (
                          <span className="ticket-link">{r.jiraKey}</span>
                        )
                      ) : (
                        <span className="muted">—</span>
                      )}
                      {r.multipleKeysDetected && (
                        <span className="badge badge-orange" style={{ marginLeft: 6 }} title={r.jiraKeyCandidates?.join(", ")}>
                          multiple
                        </span>
                      )}
                    </td>
                    <td>{r.ticketStatus ? <StatusBadge value={r.ticketStatus} /> : <span className="muted">—</span>}</td>
                    <td className="cell-id">{r.storyPoints ?? "—"}</td>
                    <td>
                      {r.reopened ? (
                        <span className="badge badge-orange" title={r.reopenDates?.map(formatLocal).join(", ")}>
                          {r.reopenCount}×
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {status ? (
                        <button
                          type="button"
                          className="score-open"
                          onClick={() => handleViewReview(r)}
                          title="View review"
                        >
                          <CompletenessBadge value={status.codeCompleteness} empty="Reviewed" />
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <ExceptionsCell
                        exception={exceptionStatuses[key]}
                        status={status}
                        onOpen={() => handleOpenExceptions(r)}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn-compact"
                        disabled={reviewing}
                        onClick={() => handleReviewRecord(r)}
                      >
                        {reviewing ? "Reviewing…" : status ? "Re-review" : "Review"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visibleRecords.length === 0 && (
                <tr>
                  <td colSpan={13} className="muted">
                    {records.length
                      ? "No records match the current filters."
                      : "No records yet — run a Sync above."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {openReview && <PrReviewPanel review={openReview} onClose={() => setOpenReview(null)} />}
      {openExceptions && (
        <ExceptionsDialog
          record={openExceptions.record}
          review={openExceptions.review}
          onReviewChanged={handleReviewChanged}
          onClose={() => setOpenExceptions(null)}
          onSaved={(st) =>
            setExceptionStatuses((prev) => {
              const next = { ...prev };
              const k = `${openExceptions.record.repo}#${openExceptions.record.prId}`;
              if (st) next[k] = st;
              else delete next[k];
              return next;
            })
          }
        />
      )}
    </div>
  );
}
