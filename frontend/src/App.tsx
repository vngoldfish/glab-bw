import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
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
import ProgressTracker from "./components/ProgressTracker";
import Sidebar from "./components/Sidebar";
import DashboardPage from "./pages/DashboardPage";
import WorkflowPage from "./pages/WorkflowPage";

// Lazy-loaded pages — reduces initial bundle
const DocsPage = lazy(() => import("./pages/DocsPage"));
const ApiDocsPage = lazy(() => import("./pages/ApiDocsPage"));
const ExtensionPage = lazy(() => import("./pages/ExtensionPage"));
const ProjectsPage = lazy(() => import("./pages/ProjectsPage"));
const ProjectMediaPage = lazy(() => import("./pages/ProjectMediaPage"));
const PromptHubPage = lazy(() => import("./pages/PromptHubPage"));
import ReferenceLibraryPage from "./pages/ReferenceLibraryPage";
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const VideoEditorPage = lazy(() => import("./pages/VideoEditorPage"));
const WebhookPage = lazy(() => import("./pages/WebhookPage"));
const WorkflowTemplatesPage = lazy(() => import("./pages/WorkflowTemplatesPage"));
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

function Toast({
  message,
  onClose,
  duration,
  type,
}: {
  message: string;
  onClose: () => void;
  duration: number;
  type: "warn" | "error";
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        setIsClosing(true);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [duration]);

  useEffect(() => {
    if (isClosing) {
      const timeout = setTimeout(() => {
        onClose();
      }, 350); // Matches CSS animation duration
      return () => clearTimeout(timeout);
    }
  }, [isClosing, onClose]);

  return (
    <div className={`toast-${type} ${isClosing ? "toast-dismiss" : ""}`}>
      <span>{message}</span>
      <button type="button" onClick={() => setIsClosing(true)}>
        ✕
      </button>
      <div className="toast-progress" style={{ width: `${progress}%` }} />
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const [apiKey, setApiKey] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [extension, setExtension] = useState<ExtensionStatus | null>(null);
  const [error, setError] = useState("");
  const [sessionWarn, setSessionWarn] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem("sidebar_collapsed") === "true";
  });

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      localStorage.setItem("sidebar_collapsed", String(!prev));
      return !prev;
    });
  };

  const activeCount = useMemo(
    () => accounts.filter((a) => a.enabled && a.has_credentials).length,
    [accounts],
  );

  const readyChip = useMemo(() => readinessChip(health), [health]);

  const refresh = useCallback(async () => {
    const results = await Promise.allSettled([
      fetchAppInfo(),
      fetchAccounts(),
      fetchHealth(),
      fetchExtensionStatus(),
    ]);

    const errors: string[] = [];

    if (results[0].status === "fulfilled") {
      setApiKey(results[0].value.api_key);
    } else {
      errors.push("Không lấy được thông tin cấu hình: " + (results[0].reason?.message || String(results[0].reason)));
    }

    if (results[1].status === "fulfilled") {
      setAccounts(results[1].value);
    } else {
      errors.push("Không tải được danh sách tài khoản: " + (results[1].reason?.message || String(results[1].reason)));
    }

    if (results[2].status === "fulfilled") {
      const h = results[2].value;
      setHealth(h);
      if (h.flow_session_ok === false) {
        const hint =
          h.session?.hint ||
          h.readiness_reasons?.find((r) => r.toLowerCase().includes("session") || r.includes("Cookie")) ||
          "Cookie/session Flow có thể hết hạn — vào Settings dán lại session-token";
        setSessionWarn(hint);
      } else {
        setSessionWarn("");
      }
    } else {
      errors.push("Không kiểm tra được trạng thái session: " + (results[2].reason?.message || String(results[2].reason)));
    }

    if (results[3].status === "fulfilled") {
      setExtension(results[3].value);
    } else {
      errors.push("Không kiểm tra được extension: " + (results[3].reason?.message || String(results[3].reason)));
    }

    if (errors.length > 0) {
      setError(errors.join(" | "));
    } else {
      setError("");
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
      <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <a href="#main-content" className="skip-to-content">
          Bỏ qua đến nội dung chính
        </a>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={toggleSidebar}
          extensionConnected={extension?.connected ?? false}
          flowTab={extension?.flow_tab ?? "…"}
          grokTab={extension?.grok_tab ?? "…"}
        />
        <main className="main-area" id="main-content">
          <div className="titlebar">
            <div className="titlebar-brand">
              <span>Bawui APP 1</span>
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
          <div aria-live="polite" style={{ display: "flex", flexDirection: "column" }}>
            {sessionWarn && (
              <Toast
                message={sessionWarn}
                onClose={() => setSessionWarn("")}
                duration={8000}
                type="warn"
              />
            )}
            {error && (
              <Toast
                message={error}
                onClose={() => setError("")}
                duration={12000}
                type="error"
              />
            )}
          </div>
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
            <Suspense fallback={<div className="page-panel" style={{ display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.5 }}>Đang tải…</div>}>
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
                path="/workflow/:projectId?"
                element={
                  <div className="page-panel" style={{ height: "100%" }}>
                    <WorkflowPage onError={setError} />
                  </div>
                }
              />
              <Route
                path={NAV_ROUTES["workflow-templates"]}
                element={
                  <div className="page-panel">
                    <WorkflowTemplatesPage onError={setError} />
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
                path={NAV_ROUTES["project-media"]}
                element={
                  <div className="page-panel">
                    <ProjectMediaPage onError={setError} />
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
            </Suspense>
          </div>
        </main>
        <ProgressTracker />
      </div>
    </ReferenceLibraryProvider>
  );
}
