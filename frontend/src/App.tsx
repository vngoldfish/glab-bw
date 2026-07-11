import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  Account,
  fetchAccounts,
  fetchAppInfo,
  fetchExtensionStatus,
  fetchHealth,
  type ExtensionStatus,
  type HealthStatus,
} from "./api";
import FlowImagePage from "./components/FlowImagePage";
import FlowVideoPage from "./components/FlowVideoPage";
import Sidebar from "./components/Sidebar";
import DashboardPage from "./pages/DashboardPage";
import DocsPage from "./pages/DocsPage";
import ApiDocsPage from "./pages/ApiDocsPage";
import ExtensionPage from "./pages/ExtensionPage";
import ProjectsPage from "./pages/ProjectsPage";
import PromptHubPage from "./pages/PromptHubPage";
import ReferenceLibraryPage from "./pages/ReferenceLibraryPage";
import SettingsPage from "./pages/SettingsPage";
import VideoEditorPage from "./pages/VideoEditorPage";
import WebhookPage from "./pages/WebhookPage";
import WorkflowPage from "./pages/WorkflowPage";
import { ReferenceLibraryProvider } from "./referenceLibraryContext";
import { DEFAULT_ROUTE, NAV_ROUTES } from "./routes";

function readinessChip(health: HealthStatus | null): {
  className: string;
  label: string;
  title: string;
} {
  if (!health) {
    return { className: "warn", label: "Đang kiểm tra…", title: "Chưa có health" };
  }
  if (health.ready_to_generate) {
    const img = health.flow_image_ready ?? 0;
    const vid = health.flow_video_ready ?? 0;
    return {
      className: "online",
      label: "Sẵn sàng gen",
      title: `Flow ảnh: ${img} · video: ${vid} · disk: ${health.disk_free_gb ?? "?"} GB`,
    };
  }
  const reasons = health.readiness_reasons?.length
    ? health.readiness_reasons.join(" · ")
    : "Chưa sẵn sàng";
  const critical =
    !health.extension_connected ||
    health.flow_session_ok === false ||
    health.disk_ok === false;
  return {
    className: critical ? "offline" : "warn",
    label: critical ? "Chưa sẵn sàng" : "Thiếu điều kiện",
    title: reasons,
  };
}

export default function App() {
  const location = useLocation();
  const [apiKey, setApiKey] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [extension, setExtension] = useState<ExtensionStatus | null>(null);
  const [error, setError] = useState("");
  const [sessionWarn, setSessionWarn] = useState("");

  const activeCount = useMemo(
    () => accounts.filter((a) => a.enabled && a.has_credentials).length,
    [accounts],
  );

  const readyChip = useMemo(() => readinessChip(health), [health]);

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
    if (h.flow_session_ok === false) {
      const hint =
        h.session?.hint ||
        h.readiness_reasons?.find((r) => r.toLowerCase().includes("session") || r.includes("Cookie")) ||
        "Cookie/session Flow có thể hết hạn — vào Settings dán lại session-token";
      setSessionWarn(hint);
    } else {
      setSessionWarn("");
    }
  }, []);

  useEffect(() => {
    refresh().catch((err) =>
      setError(err instanceof Error ? err.message : String(err)),
    );
    const timer = setInterval(() => {
      Promise.all([fetchExtensionStatus(), fetchHealth()])
        .then(([ext, h]) => {
          setExtension(ext);
          setHealth(h);
          if (h.flow_session_ok === false) {
            setSessionWarn(
              h.session?.hint ||
                "Cookie/session Flow có thể hết hạn — Settings → dán lại session-token",
            );
          } else {
            setSessionWarn("");
          }
        })
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
              <span className="titlebar-version">v0.2.0</span>
            </div>
            <div className="titlebar-meta">
              <span
                className={`titlebar-chip ${readyChip.className}`}
                title={readyChip.title}
              >
                <span className="status-dot" />
                {readyChip.label}
              </span>
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
              {typeof health?.disk_free_gb === "number" && health.disk_free_gb < 5 && (
                <span
                  className={`titlebar-chip ${health.disk_free_gb < 2 ? "offline" : "warn"}`}
                  title="Dung lượng ổ đĩa còn lại"
                >
                  Disk {health.disk_free_gb} GB
                </span>
              )}
              <span>:8765</span>
            </div>
          </div>
          {sessionWarn && (
            <div className="toast-warn">
              <span>{sessionWarn}</span>
              <button type="button" onClick={() => setSessionWarn("")}>
                ✕
              </button>
            </div>
          )}
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
                path={NAV_ROUTES.dashboard}
                element={
                  <div className="page-panel">
                    <DashboardPage onError={setError} />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES["prompt-hub"]}
                element={
                  <div className="page-panel">
                    <PromptHubPage onError={setError} />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES.workflow}
                element={
                  <div className="page-panel" style={{ height: "100%" }}>
                    <WorkflowPage onError={setError} />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES.projects}
                element={
                  <div className="page-panel">
                    <ProjectsPage onError={setError} />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES["video-editor"]}
                element={
                  <div className="page-panel">
                    <VideoEditorPage onError={setError} />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES.docs}
                element={
                  <div className="page-panel">
                    <DocsPage />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES["api-docs"]}
                element={
                  <div className="page-panel">
                    <ApiDocsPage />
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
