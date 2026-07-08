import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { NavPage } from "./types";

export default function App() {
  const [page, setPage] = useState<NavPage>("flow-image");
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

  function navigate(next: NavPage) {
    if (next === "flow-video" || next === "grok") {
      setPage(next);
      return;
    }
    setPage(next);
    setError("");
  }

  function pageClass(id: NavPage) {
    return `page-panel${page === id ? "" : " page-panel-hidden"}`;
  }

  return (
    <ReferenceLibraryProvider>
    <div className="app-shell">
      <Sidebar
        page={page}
        onNavigate={navigate}
        extensionConnected={extension?.connected ?? false}
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
            <span>Flow: {extension?.flow_tab ?? "..."}</span>
            <span>:8765</span>
          </div>
        </div>
        {error && (
          <div className="toast-error">
            <span>{error}</span>
            <button type="button" onClick={() => setError("")}>✕</button>
          </div>
        )}
        <div className="page-content">
          <div className={pageClass("flow-image")}>
            <FlowImagePage
              activeCount={Math.max(activeCount, extension?.connected ? 1 : 0)}
              onError={setError}
              onOpenReferences={() => navigate("references")}
            />
          </div>
          <div className={pageClass("references")}>
            <ReferenceLibraryPage onError={setError} />
          </div>
          <div className={pageClass("flow-video")}>
            <PlaceholderPage
              title="Flow Video"
              subtitle="Tạo video Veo 3.1 hàng loạt — tính năng đang được phát triển."
            />
          </div>
          <div className={pageClass("grok")}>
            <PlaceholderPage
              title="Media Grok"
              subtitle="Tạo ảnh/video Grok — tính năng đang được phát triển."
            />
          </div>
          <div className={pageClass("webhook")}>
            <WebhookPage apiKey={apiKey} health={health} />
          </div>
          <div className={pageClass("extension")}>
            <ExtensionPage extension={extension} />
          </div>
          <div className={pageClass("settings")}>
            <SettingsPage
              accounts={accounts}
              onRefresh={refresh}
              onError={setError}
            />
          </div>
        </div>
      </main>
    </div>
    </ReferenceLibraryProvider>
  );
}