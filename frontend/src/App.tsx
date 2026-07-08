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
import Sidebar from "./components/Sidebar";
import ExtensionPage from "./pages/ExtensionPage";
import PlaceholderPage from "./pages/PlaceholderPage";
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
        <Sidebar extensionConnected={extension?.connected ?? false} />
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
              <span>Flow: {extension?.flow_tab ?? "..."}</span>
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
            <Routes>
              <Route path="/" element={<Navigate to={DEFAULT_ROUTE} replace />} />
              <Route
                path={NAV_ROUTES["flow-image"]}
                element={
                  <div className="page-panel">
                    <FlowImagePage
                      activeCount={Math.max(activeCount, extension?.connected ? 1 : 0)}
                      onError={setError}
                    />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES.references}
                element={
                  <div className="page-panel">
                    <ReferenceLibraryPage onError={setError} />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES["flow-video"]}
                element={
                  <div className="page-panel">
                    <PlaceholderPage
                      title="Flow Video"
                      subtitle="Tạo video Veo 3.1 hàng loạt — tính năng đang được phát triển."
                    />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES.grok}
                element={
                  <div className="page-panel">
                    <PlaceholderPage
                      title="Media Grok"
                      subtitle="Tạo ảnh/video Grok — tính năng đang được phát triển."
                    />
                  </div>
                }
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