import { useState } from "react";
import {
  Account,
  Provider,
  createAccount,
  deleteAccount,
} from "../api";
import { parseFlowCookieInput } from "../cookie";

const PROVIDER_LABELS: Record<Provider, string> = {
  flow: "Google Flow / Veo",
  grok: "Grok AI",
  meta: "Meta AI",
  openai: "OpenAI",
};

interface SettingsPageProps {
  accounts: Account[];
  onRefresh: () => Promise<void>;
  onError: (msg: string) => void;
}

export default function SettingsPage({ accounts, onRefresh, onError }: SettingsPageProps) {
  const [loading, setLoading] = useState(false);
  const [newProvider, setNewProvider] = useState<Provider>("flow");
  const [newLabel, setNewLabel] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newCookie, setNewCookie] = useState("");
  const [newSessionToken, setNewSessionToken] = useState("");

  async function handleAddAccount() {
    if (!newLabel.trim() && newProvider !== "flow") {
      onError("Nhập tên tài khoản");
      return;
    }
    setLoading(true);
    onError("");
    try {
      let label = newLabel.trim();
      let credentials: Record<string, string>;
      if (newProvider === "openai") {
        credentials = { api_key: newApiKey.trim() };
      } else if (newProvider === "flow") {
        const parsed = parseFlowCookieInput(newSessionToken);
        credentials = { session_token: parsed.session_token };
        if (!label && parsed.email) label = parsed.email;
      } else {
        credentials = { cookie: newCookie.trim() };
      }
      await createAccount({
        provider: newProvider,
        label: label || "Account",
        credentials,
        image_enabled: true,
        video_enabled: newProvider !== "openai",
      });
      setNewLabel("");
      setNewApiKey("");
      setNewCookie("");
      setNewSessionToken("");
      await onRefresh();
    } catch (err) {
      onError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAccount(id: string) {
    setLoading(true);
    onError("");
    try {
      await deleteAccount(id);
      await onRefresh();
    } catch (err) {
      onError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Cài Đặt</h1>
          <span className="pill pill-purple">TÀI KHOẢN</span>
        </div>
      </header>

      <section className="panel-card">
        <h2>Thêm tài khoản</h2>
        <div className="form-grid">
          <label>
            Provider
            <select value={newProvider} onChange={(e) => setNewProvider(e.target.value as Provider)}>
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label>
            Tên hiển thị
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Account #1" />
          </label>
          {newProvider === "openai" ? (
            <label>
              API Key
              <input
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="sk-..."
              />
            </label>
          ) : newProvider === "flow" ? (
            <label className="span-2">
              Cookie Google Flow (JSON export hoặc session token)
              <textarea
                rows={6}
                value={newSessionToken}
                onChange={(e) => setNewSessionToken(e.target.value)}
                placeholder="Dán JSON cookie hoặc __Secure-next-auth.session-token (eyJ...)"
              />
            </label>
          ) : (
            <label className="span-2">
              Session / Cookie
              <textarea
                rows={4}
                value={newCookie}
                onChange={(e) => setNewCookie(e.target.value)}
                placeholder="Dán cookie hoặc session token..."
              />
            </label>
          )}
        </div>
        <button type="button" className="btn btn-primary" onClick={handleAddAccount} disabled={loading}>
          Thêm tài khoản
        </button>
      </section>

      <section className="panel-card">
        <h2>Danh sách tài khoản ({accounts.length})</h2>
        <div className="account-list">
          {accounts.length === 0 && <p className="muted">Chưa có tài khoản nào.</p>}
          {accounts.map((account) => (
            <article key={account.id} className="account-card">
              <div>
                <strong>{account.label}</strong>
                <p>{PROVIDER_LABELS[account.provider]}</p>
                <small>
                  {account.enabled ? "Đang bật" : "Tắt"} ·
                  {account.has_credentials ? " Đã cấu hình" : " Chưa cấu hình"}
                </small>
              </div>
              <button
                type="button"
                className="btn btn-ghost danger"
                onClick={() => handleDeleteAccount(account.id)}
                disabled={loading}
              >
                Xóa
              </button>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}