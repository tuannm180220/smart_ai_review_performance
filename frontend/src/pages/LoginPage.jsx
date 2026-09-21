import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../api.js";
import { setSession, isAuthed, clearSession, getAppEmail } from "../auth.js";

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [allowRegister, setAllowRegister] = useState(true);
  const [multiTenant, setMultiTenant] = useState(true);
  const [statusLoaded, setStatusLoaded] = useState(false);

  useEffect(() => {
    api
      .authStatus()
      .then((s) => {
        setMultiTenant(Boolean(s.multiTenant));
        setAllowRegister(Boolean(s.allowRegister));
        if (!s.multiTenant) {
          navigate("/", { replace: true });
        }
      })
      .catch(() => {
        setMultiTenant(false);
        navigate("/", { replace: true });
      })
      .finally(() => setStatusLoaded(true));
  }, [navigate]);

  useEffect(() => {
    if (statusLoaded && multiTenant && isAuthed()) {
      navigate(location.state?.from || "/", { replace: true });
    }
  }, [statusLoaded, multiTenant, navigate, location.state]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = mode === "register" ? await api.register(email, password) : await api.login(email, password);
      setSession(res.token, res.email);
      navigate(location.state?.from || "/", { replace: true });
    } catch (err) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  }

  if (!statusLoaded) {
    return (
      <div className="admin-login-shell">
        <div className="boot-spinner" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div className="admin-login-shell">
      <form className="admin-login-card" onSubmit={handleSubmit}>
        <h1>AI Review Performance</h1>
        <p className="muted">{mode === "register" ? "Create an account for your own Atlassian settings and data." : "Sign in to your workspace."}</p>

        <label className="admin-login-field">
          Email
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            required
          />
        </label>

        <label className="admin-login-field">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            minLength={8}
            required
          />
        </label>

        {error && <p className="error-text">{error}</p>}

        <button type="submit" disabled={loading}>
          {loading ? "Please wait…" : mode === "register" ? "Create account" : "Sign in"}
        </button>

        {allowRegister && (
          <p className="muted" style={{ marginTop: 16, marginBottom: 0 }}>
            {mode === "login" ? (
              <>
                No account?{" "}
                <button type="button" className="link-button" onClick={() => setMode("register")}>
                  Register
                </button>
              </>
            ) : (
              <>
                Already registered?{" "}
                <button type="button" className="link-button" onClick={() => setMode("login")}>
                  Sign in
                </button>
              </>
            )}
          </p>
        )}
      </form>
    </div>
  );
}

export function AppAuthGate({ children }) {
  const [ready, setReady] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await api.authStatus();
        if (cancelled) return;
        if (!status.multiTenant) {
          setNeedsAuth(false);
          setReady(true);
          return;
        }
        if (!isAuthed()) {
          setNeedsAuth(true);
          setReady(true);
          navigate("/login", { replace: true, state: { from: location.pathname } });
          return;
        }
        try {
          await api.me();
          if (!cancelled) {
            setNeedsAuth(false);
            setReady(true);
          }
        } catch {
          clearSession();
          if (!cancelled) {
            setNeedsAuth(true);
            setReady(true);
            navigate("/login", { replace: true, state: { from: location.pathname } });
          }
        }
      } catch {
        if (!cancelled) {
          setNeedsAuth(false);
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate, location.pathname]);

  if (!ready) {
    return (
      <div className="boot-mask" role="status" aria-label="Loading">
        <div className="boot-spinner" aria-hidden="true" />
      </div>
    );
  }

  if (needsAuth) return null;
  return children;
}

export function UserMenu() {
  const navigate = useNavigate();
  const email = getAppEmail();
  if (!email) return null;
  return (
    <div className="user-menu">
      <span className="muted">{email}</span>
      <button
        type="button"
        className="link-button"
        onClick={() => {
          clearSession();
          navigate("/login", { replace: true });
        }}
      >
        Sign out
      </button>
    </div>
  );
}
