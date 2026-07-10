import type { ExtensionStatus } from "../api";

interface ExtensionPageProps {
  extension: ExtensionStatus | null;
}

export default function ExtensionPage({ extension }: ExtensionPageProps) {
  const grokOpen = extension?.grok_tab === "open";
  const flowOpen = extension?.flow_tab === "open";
  const hasStatsig = Boolean(extension?.has_statsig);
  const connected = Boolean(extension?.connected);
  const flowTokens = extension?.token_count ?? 0;

  return (
    <div className="extension-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Auth Helper</h1>
          <span className={`pill ${connected ? "pill-green" : "pill-red"}`}>
            {connected ? "Bridge OK" : "Bridge off"}
          </span>
          <span className={`pill ${flowOpen ? "pill-green" : "pill-purple"}`}>
            Flow: {extension?.flow_tab ?? "…"}
          </span>
          <span className={`pill ${grokOpen ? "pill-green" : "pill-purple"}`}>
            Grok: {extension?.grok_tab ?? "…"}
          </span>
          <span className={`pill ${hasStatsig ? "pill-green" : "pill-purple"}`}>
            statsig: {hasStatsig ? "OK" : "—"}
          </span>
        </div>
      </header>

      <section className="panel-card" style={{ borderColor: "rgba(99,102,241,0.35)" }}>
        <h2 style={{ marginTop: 0 }}>Popup extension ≠ Grok</h2>
        <p className="muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
          Popup <strong>G-Labs Auth Helper</strong> (110 Tokens, Labs Session, Verify…) chỉ đo{" "}
          <strong>Google Flow / reCAPTCHA</strong> trên <code>labs.google</code>.
          <br />
          <strong>Grok không dùng số Tokens đó</strong> — luôn có thể hiện 0 / trống cho Grok trong
          popup. Đó là bình thường, không phải lỗi.
        </p>
        <table className="info-table" style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
          <tbody>
            <tr>
              <td style={{ padding: "6px 0", color: "#94a3b8" }}>Popup «Tokens 110»</td>
              <td style={{ padding: "6px 0" }}>
                = reCAPTCHA Flow đã solve · <strong>không liên quan Grok</strong>
              </td>
            </tr>
            <tr>
              <td style={{ padding: "6px 0", color: "#94a3b8" }}>Popup «Labs Session»</td>
              <td style={{ padding: "6px 0" }}>
                = tab <code>labs.google</code> · Grok dùng tab <code>grok.com/imagine</code>
              </td>
            </tr>
            <tr>
              <td style={{ padding: "6px 0", color: "#94a3b8" }}>Grok trên extension</td>
              <td style={{ padding: "6px 0" }}>
                Icon nhỏ góc phải tab <code>grok.com</code> (FAB chữ G, xanh = bridge OK)
              </td>
            </tr>
            <tr>
              <td style={{ padding: "6px 0", color: "#94a3b8" }}>Grok trong app này</td>
              <td style={{ padding: "6px 0" }}>
                Title bar: <code>Grok: open</code> · trang này: statsig / tab
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="panel-card">
        <h2>1. Google Flow (reCAPTCHA) — đúng với popup 110 tokens</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Extension <strong>G-Labs Automation - Auth Helper</strong> — captcha cho labs.google.
          Số Tokens trong popup = số captcha đã giải (lưu local extension).
        </p>
        <ol className="steps">
          <li>Auth Helper bật · App Bridge Connected (như ảnh của bạn)</li>
          <li>Mở <code>labs.google/fx/tools/flow</code></li>
          <li>Cookie Flow trong Cài đặt → gen Flow Ảnh / Video</li>
        </ol>
        <p className="muted" style={{ marginBottom: 0 }}>
          Bridge app: reCAPTCHA tokens = <strong>{flowTokens}</strong> (có thể khác popup — popup
          đếm local, app đếm lúc solve qua bridge).
        </p>
      </section>

      <section className="panel-card">
        <h2>2. Grok — không có «Tokens» trong popup</h2>
        <p className="muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
          Cùng Auth Helper, nhưng Grok chạy <code>gfetch</code> / <code>gws</code> trong tab{" "}
          <code>grok.com</code> (cookie sso + anti-bot).{" "}
          <strong>Không tăng số Tokens reCAPTCHA.</strong>
        </p>
        <ol className="steps">
          <li>
            Chỉ cần <strong>G-Labs Automation - Auth Helper</strong> (giống app G-Labs gốc) —
            <em>không bắt buộc</em> extension-grok
          </li>
          <li>
            Mở{" "}
            <a href="https://grok.com/imagine" target="_blank" rel="noreferrer">
              https://grok.com/imagine
            </a>{" "}
            login SuperGrok — FAB chữ <strong>G</strong> xanh góc phải
          </li>
          <li>
            Title bar app: <strong>Grok: open</strong> · gen 1 clip trên web (lần đầu / khi code 7)
          </li>
          <li>
            Flow Video → Engine Grok → gen (app warm tab 1–2 lần, giống G-Labs)
          </li>
          <li>
            Ảnh = Imagine WS · Video = app-chat + Auth Helper injectStatsig
          </li>
        </ol>
        <p className="muted" style={{ marginBottom: 0 }}>
          Protocol: theme <code>g:1</code> → <code>/sync/grok-poll-task</code> →{" "}
          <code>/sync/grok-event</code>
        </p>
      </section>

      <div className="info-grid">
        <div className="info-card">
          <span>Bridge</span>
          <code>{connected ? "Connected" : "Off"}</code>
        </div>
        <div className="info-card">
          <span>Flow tab (labs.google)</span>
          <code>{extension?.flow_tab ?? "closed"}</code>
        </div>
        <div className="info-card">
          <span>Grok tab (grok.com)</span>
          <code>{extension?.grok_tab ?? "closed"}</code>
        </div>
        <div className="info-card">
          <span>Flow reCAPTCHA (app)</span>
          <code>{flowTokens}</code>
        </div>
        <div className="info-card">
          <span>Grok x-statsig-id</span>
          <code>{hasStatsig ? "ready" : "— (video warm khi gen)"}</code>
        </div>
        <div className="info-card">
          <span>Pending Grok tasks</span>
          <code>{extension?.pending_grok ?? 0}</code>
        </div>
      </div>
    </div>
  );
}
