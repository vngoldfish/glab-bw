import { useState } from "react";
import {
  Account,
  Provider,
  createAccount,
  deleteAccount,
  updateAccount,
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

function formatCooldown(sec?: number): string {
  if (!sec || sec <= 0) return "";
  const m = Math.ceil(sec / 60);
  if (m < 60) return `~${m} phút`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `~${h}h ${rm}m` : `~${h}h`;
}

export default function SettingsPage({ accounts, onRefresh, onError }: SettingsPageProps) {
  const [loading, setLoading] = useState(false);
  const [newProvider, setNewProvider] = useState<Provider>("flow");
  const [newLabel, setNewLabel] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newCookie, setNewCookie] = useState("");
  const [newSessionToken, setNewSessionToken] = useState("");

  const flowAccounts = accounts.filter((a) => a.provider === "flow");
  const flowReady = flowAccounts.filter((a) => a.enabled && a.has_credentials && !a.in_cooldown);

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

  async function handleToggle(account: Account) {
    setLoading(true);
    onError("");
    try {
      await updateAccount(account.id, { enabled: !account.enabled });
      await onRefresh();
    } catch (err) {
      onError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleClearCooldown(account: Account) {
    setLoading(true);
    onError("");
    try {
      await updateAccount(account.id, { clear_cooldown: true });
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
          <span className="pill pill-green">
            Flow sẵn sàng: {flowReady.length}/{flowAccounts.length}
          </span>
        </div>
      </header>

      <section className="panel-card">
        <h2>Xoay vòng tài khoản Flow (ảnh + video)</h2>
        <p className="muted" style={{ marginTop: 0, lineHeight: 1.5 }}>
          Thêm <strong>nhiều account Flow</strong> (mỗi account = cookie / session-token riêng).
          App <strong>round-robin</strong> giữa các account đang bật. Khi một account{" "}
          <strong>hết quota</strong>, app tự cooldown ~1 giờ và chuyển sang account khác.
        </p>
        <ol className="muted" style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.55 }}>
          <li>Đăng xuất Google / dùng profile Chrome khác → đăng nhập account mới trên labs.google</li>
          <li>Copy cookie <code>__Secure-next-auth.session-token</code> (hoặc export JSON cookie)</li>
          <li>Dán vào form bên dưới → <strong>Thêm tài khoản</strong> (không xóa account cũ)</li>
          <li>Account hết quota: tắt hoặc để cooldown; account còn quota sẽ được dùng</li>
        </ol>
      </section>

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
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="email@gmail.com hoặc Account #2"
            />
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
              Cookie Google Flow (JSON export hoặc session token) — account MỚI
              <textarea
                rows={6}
                value={newSessionToken}
                onChange={(e) => setNewSessionToken(e.target.value)}
                placeholder="Dán JSON cookie hoặc __Secure-next-auth.session-token (eyJ...) của tài khoản khác"
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
            <article
              key={account.id}
              className={`account-card${account.in_cooldown ? " account-card--cooldown" : ""}${!account.enabled ? " account-card--off" : ""}`}
            >
              <div>
                <strong>{account.label}</strong>
                <p>{PROVIDER_LABELS[account.provider]}</p>
                <small>
                  {account.enabled ? "Đang bật" : "Tắt"} ·
                  {account.has_credentials ? " Đã cấu hình" : " Chưa cấu hình"}
                  {account.image_enabled ? " · Ảnh" : ""}
                  {account.video_enabled ? " · Video" : ""}
                  {account.in_cooldown
                    ? ` · Cooldown ${formatCooldown(account.cooldown_left_sec)}`
                    : ""}
                </small>
                {account.last_error && (
                  <p className="account-error" title={account.last_error}>
                    Lỗi gần nhất: {account.last_error.slice(0, 120)}
                    {account.last_error.length > 120 ? "…" : ""}
                  </p>
                )}
              </div>
              <div className="account-card-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleToggle(account)}
                  disabled={loading}
                  title={account.enabled ? "Tắt khỏi vòng xoay" : "Bật lại"}
                >
                  {account.enabled ? "Tắt" : "Bật"}
                </button>
                {account.in_cooldown && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleClearCooldown(account)}
                    disabled={loading}
                    title="Xóa cooldown, thử lại ngay"
                  >
                    Bỏ cooldown
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost danger btn-sm"
                  onClick={() => handleDeleteAccount(account.id)}
                  disabled={loading}
                >
                  Xóa
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
