import type { ExtensionStatus } from "../api";

interface ExtensionPageProps {
  extension: ExtensionStatus | null;
}

export default function ExtensionPage({ extension }: ExtensionPageProps) {
  return (
    <div className="extension-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Auth Helper</h1>
          <span className={`pill ${extension?.connected ? "pill-green" : "pill-red"}`}>
            {extension?.connected ? "Đã kết nối" : "Chưa kết nối"}
          </span>
        </div>
      </header>

      <p className="muted">
        G-Labs <strong>không</strong> dùng API AI chính thức. Extension Chrome đóng vai trò cầu nối
        giữa app và phiên đăng nhập trên <code>labs.google/fx/tools/flow</code>.
      </p>

      <div className="info-grid">
        <div className="info-card">
          <span>Bridge server</span>
          <code>http://127.0.0.1:18923</code>
        </div>
        <div className="info-card">
          <span>Extension</span>
          <code>{extension?.connected ? "Connected" : "Disconnected"}</code>
        </div>
        <div className="info-card">
          <span>Flow tab</span>
          <code>{extension?.flow_tab ?? "closed"}</code>
        </div>
        <div className="info-card">
          <span>reCAPTCHA tokens</span>
          <code>{extension?.token_count ?? 0}</code>
        </div>
      </div>

      <ol className="steps">
        <li>Cài extension <strong>G-Labs Automation - Auth Helper</strong> trên Chrome</li>
        <li>Chạy <code>.\start-backend.ps1</code> (mở port 18923 + 8765)</li>
        <li>Đăng nhập Google và mở <code>labs.google/fx/tools/flow</code></li>
        <li>Thêm tài khoản Flow trong Cài Đặt với session token</li>
        <li>Extension poll <code>/sync/theme</code> → giải reCAPTCHA → app gọi Google Flow API</li>
      </ol>
    </div>
  );
}