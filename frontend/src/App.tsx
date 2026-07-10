import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  Account,
  fetchAccounts,
  fetchAppInfo,
  fetchExtensionStatus,
  fetchHealth,
  type ExtensionStatus,
} from "./api";
import FlowImagePage from "./components/FlowImagePage";
import FlowVideoPage from "./components/FlowVideoPage";
import Sidebar from "./components/Sidebar";
import ExtensionPage from "./pages/ExtensionPage";
import ReferenceLibraryPage from "./pages/ReferenceLibraryPage";
import SettingsPage from "./pages/SettingsPage";
import WebhookPage from "./pages/WebhookPage";
import { ReferenceLibraryProvider } from "./referenceLibraryContext";
import { DEFAULT_ROUTE, NAV_ROUTES } from "./routes";

export default function App() {
  const location = useLocation();
  const [apiKey, setApiKey] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [extension, setExtension] = useState<ExtensionStatus | null>(null);
  const [error, setError] = useState("");

  const activeCount = useMemo(
    () => accounts.filter((a) => a.enabled && a.has_credentials).length,
    [accounts],
  );

  const refresh = useCallback(async () => {
    const [info, accs, h, ext] = await Promise.all([
      fetchAppInfo(),
      fetchAccounts(),
      fetchHealth(),
      fetchExtensionStatus(),
    ]);
    setApiKey(info.api_key);
    setAccounts(accs);
    setHealth(h);
    setExtension(ext);
  }, []);

  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
    const timer = setInterval(() => {
      fetchExtensionStatus()
        .then(setExtension)
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    setError("");
  }, [location.pathname]);

  return (
    <ReferenceLibraryProvider>
      <div className="app-shell">
        <Sidebar
          extensionConnected={extension?.connected ?? false}
          flowTab={extension?.flow_tab ?? "…"}
          grokTab={extension?.grok_tab ?? "…"}
        />
        <main className="main-area">
          <div className="titlebar">
            <div className="titlebar-brand">
              <span>G-Labs BW</span>
              <span className="titlebar-version">v0.1.0</span>
            </div>
            <div className="titlebar-meta">
              <span className={`titlebar-chip ${extension?.connected ? "online" : "offline"}`}>
                <span className="status-dot" />
                {extension?.connected ? "Auth OK" : "Auth off"}
              </span>
              <span title="labs.google — reCAPTCHA Flow (popup Tokens)">
                Flow: {extension?.flow_tab ?? "…"}
                {typeof extension?.token_count === "number" && extension.token_count > 0
                  ? ` · ${extension.token_count} tok`
                  : ""}
              </span>
              <span
                title="grok.com/imagine — gfetch/gws (popup Tokens không dùng cho Grok)"
                style={{
                  color:
                    extension?.grok_tab === "open"
                      ? "var(--success, #4ade80)"
                      : undefined,
                }}
              >
                Grok: {extension?.grok_tab ?? "…"}
                {extension?.has_statsig ? " · sig" : ""}
              </span>
              <span>:8765</span>
            </div>
          </div>
          {error && (
            <div className="toast-error">
              <span>{error}</span>
              <button type="button" onClick={() => setError("")}>
                ✕
              </button>
            </div>
          )}
          <div className="page-content">
            {/*
              Keep Flow pages mounted (hidden, not unmounted) so queue + in-flight
              jobs survive tab switches. Must use page-panel--inactive / [hidden]
              with display:none !important so they never stack in the layout.
            */}
            <div
              className={
                location.pathname === NAV_ROUTES["flow-image"]
                  ? "page-panel"
                  : "page-panel page-panel--inactive"
              }
              hidden={location.pathname !== NAV_ROUTES["flow-image"]}
              aria-hidden={location.pathname !== NAV_ROUTES["flow-image"]}
            >
              <FlowImagePage
                activeCount={Math.max(activeCount, extension?.connected ? 1 : 0)}
                onError={setError}
              />
            </div>
            <div
              className={
                location.pathname === NAV_ROUTES["flow-video"]
                  ? "page-panel"
                  : "page-panel page-panel--inactive"
              }
              hidden={location.pathname !== NAV_ROUTES["flow-video"]}
              aria-hidden={location.pathname !== NAV_ROUTES["flow-video"]}
            >
              <FlowVideoPage
                activeCount={Math.max(activeCount, extension?.connected ? 1 : 0)}
                onError={setError}
              />
            </div>
            <Routes>
              <Route path="/" element={<Navigate to={DEFAULT_ROUTE} replace />} />
              <Route path={NAV_ROUTES["flow-image"]} element={null} />
              <Route path={NAV_ROUTES["flow-video"]} element={null} />
              <Route
                path={NAV_ROUTES.references}
                element={
                  <div className="page-panel">
                    <ReferenceLibraryPage onError={setError} />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES.grok}
                element={<Navigate to={NAV_ROUTES["flow-image"]} replace />}
              />
              <Route
                path={NAV_ROUTES.webhook}
                element={
                  <div className="page-panel">
                    <WebhookPage apiKey={apiKey} health={health} />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES.extension}
                element={
                  <div className="page-panel">
                    <ExtensionPage extension={extension} />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES.settings}
                element={
                  <div className="page-panel">
                    <SettingsPage
                      accounts={accounts}
                      onRefresh={refresh}
                      onError={setError}
                    />
                  </div>
                }
              />
              <Route path="*" element={<Navigate to={DEFAULT_ROUTE} replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </ReferenceLibraryProvider>
  );
}