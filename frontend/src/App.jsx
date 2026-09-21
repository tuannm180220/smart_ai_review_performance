import React, { useEffect, useRef, useState } from "react";
import { ToastProvider } from "./context/ToastContext.jsx";
import { ConfigStatusProvider, useConfigStatus } from "./context/ConfigStatusContext.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import SyncPage from "./pages/SyncPage.jsx";
import PerformanceReviewPage from "./pages/PerformanceReviewPage.jsx";
import PromptsPage from "./pages/PromptsPage.jsx";
import { UserMenu } from "./pages/LoginPage.jsx";

const TABS = [
  { key: "sync", label: "Review PR", Component: SyncPage, requires: "integrations" },
  { key: "aiReview", label: "Review member", Component: PerformanceReviewPage, requires: "integrations" },
  { key: "prompts", label: "Review prompts", Component: PromptsPage, requires: "integrations" },
  { key: "settings", label: "Settings", Component: SettingsPage, requires: null },
];

const LOCK_TOOLTIP = "Connect Jira and Bitbucket successfully in Settings first";
const LOCK_MESSAGE = "This page needs a successful Jira + Bitbucket connection.";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="page">
          <div className="banner banner-error">
            Something went wrong rendering this page: {this.state.error.message}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function isLocked(t, configStatus) {
  if (t.requires === "integrations") {
    return !configStatus.loaded || !configStatus.jiraConnected || !configStatus.bitbucketConnected;
  }
  return false;
}

function Shell() {
  const [tab, setTab] = useState("settings");
  const pickedInitialTab = useRef(false);
  const configStatus = useConfigStatus();
  const settingsOk = configStatus.jiraConnected && configStatus.bitbucketConnected;

  useEffect(() => {
    if (!configStatus.loaded) return;

    if (!pickedInitialTab.current) {
      pickedInitialTab.current = true;
      setTab(settingsOk ? "sync" : "settings");
      return;
    }

    const active = TABS.find((t) => t.key === tab);
    if (active && isLocked(active, configStatus)) setTab("settings");
  }, [tab, configStatus, settingsOk]);

  return (
    <div className="app-shell">
      {!configStatus.loaded && (
        <div className="boot-mask" role="status" aria-label="Loading" aria-live="polite">
          <div className="boot-spinner" aria-hidden="true" />
        </div>
      )}
      <header className="app-header">
        <div className="app-header-row">
          <h1>AI Review Performance</h1>
          <UserMenu />
        </div>
        <nav className="tab-nav">
          {TABS.map((t) => {
            const locked = isLocked(t, configStatus);
            return (
              <button
                key={t.key}
                className={t.key === tab ? "tab active" : "tab"}
                onClick={() => setTab(t.key)}
                disabled={locked}
                title={locked ? LOCK_TOOLTIP : undefined}
                type="button"
              >
                {t.label}
                {locked ? " 🔒" : ""}
              </button>
            );
          })}
        </nav>
      </header>
      <main>
        {TABS.map((t) => {
          const locked = isLocked(t, configStatus);
          return (
            <div key={t.key} style={{ display: t.key === tab ? "block" : "none" }}>
              <ErrorBoundary>
                {locked ? (
                  <div className="page">
                    <div className="banner banner-info">
                      {LOCK_MESSAGE}{" "}
                      <button type="button" className="link-button" onClick={() => setTab("settings")}>
                        Go to Settings
                      </button>
                    </div>
                  </div>
                ) : (
                  <t.Component active={t.key === tab} />
                )}
              </ErrorBoundary>
            </div>
          );
        })}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ConfigStatusProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </ConfigStatusProvider>
  );
}
