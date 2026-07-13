import { useCallback, useEffect, useState } from "react";
import { fetchDashboard } from "../api";
import { Activity, CheckCircle2, Users, Puzzle, Server, RefreshCw } from "lucide-react";

interface DashboardPageProps {
  onError: (msg: string) => void;
}

function formatUptime(secondsNum: unknown): string {
  const s = Number(secondsNum);
  if (isNaN(s)) return "0s";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export default function DashboardPage({ onError }: DashboardPageProps) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setData(await fetchDashboard());
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [load]);

  const queue = (data?.queue || {}) as Record<string, number>;
  const tasks = (data?.tasks || {}) as Record<string, unknown>;
  const byStatus = (tasks.by_status || {}) as Record<string, number>;
  const accounts = (data?.accounts || {}) as Record<string, unknown>;
  const ext = (data?.extension || {}) as Record<string, unknown>;
  const recentFailed = (tasks.recent_failed || []) as Array<Record<string, unknown>>;
  const items = (accounts.items || []) as Array<Record<string, unknown>>;

  if (loading && !data) {
    return (
      <div className="dashboard-page">
        <header className="page-header">
          <div className="page-title-group">
            <h1>Dashboard</h1>
            <span className="pill pill-purple">TỔNG QUAN</span>
          </div>
        </header>

        <div className="info-grid">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="info-card skeleton" style={{ minHeight: 110 }}>
              <div className="skeleton-text medium" style={{ height: 16, marginTop: 8 }} />
              <div className="skeleton-text short" style={{ height: 32, marginTop: 12 }} />
              <div className="skeleton-text medium" style={{ height: 14, marginTop: 12 }} />
            </div>
          ))}
        </div>

        <section className="panel-card" style={{ marginTop: 16 }}>
          <h2>Tài khoản</h2>
          <div className="dash-account-grid">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="dash-account-card skeleton" style={{ height: 74 }} />
            ))}
          </div>
        </section>

        <section className="panel-card" style={{ marginTop: 16 }}>
          <h2>Lỗi gần đây</h2>
          <div className="skeleton skeleton-text medium" style={{ height: 42, width: "100%" }} />
        </section>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Dashboard</h1>
          <span className="pill pill-purple">TỔNG QUAN</span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ display: "flex", alignItems: "center", gap: 6 }}
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? "st-spin" : ""} />
          Làm mới
        </button>
      </header>

      <div className="info-grid">
        <div className="info-card">
          <div className="info-card-header">
            <span>Hàng đợi</span>
            <Activity size={16} style={{ color: "var(--purple-bright)" }} />
          </div>
          <div className="info-card-value">
            {queue.running ?? 0} <span className="value-unit">chạy</span> · {queue.pending ?? 0} <span className="value-unit">chờ</span>
          </div>
          <div className="info-card-footer">
            Tối đa song song: {queue.max_concurrent ?? "?"}
          </div>
        </div>

        <div className="info-card">
          <div className="info-card-header">
            <span>Task (gần đây)</span>
            <CheckCircle2 size={16} style={{ color: "var(--green)" }} />
          </div>
          <div className="info-card-value">
            {byStatus.completed ?? 0} <span className="value-unit">xong</span> · {byStatus.failed ?? 0} <span className="value-unit">lỗi</span>
          </div>
          <div className="info-card-footer">
            Tổng: {String(tasks.total_tracked ?? 0)}
            {tasks.success_rate_pct != null ? ` · Tỉ lệ: ${tasks.success_rate_pct}%` : ""}
          </div>
        </div>

        <div className="info-card">
          <div className="info-card-header">
            <span>Tài khoản</span>
            <Users size={16} style={{ color: "var(--blue)" }} />
          </div>
          <div className="info-card-value">
            {String(accounts.enabled ?? 0)}<span className="value-unit">/{String(accounts.total ?? 0)} bật</span>
          </div>
          <div className="info-card-footer">
            Ảnh: {String(accounts.flow_image_ready ?? 0)} · Video: {String(accounts.flow_video_ready ?? 0)}
          </div>
        </div>

        <div className="info-card">
          <div className="info-card-header">
            <span>Auth Helper</span>
            <Puzzle size={16} style={{ color: ext.connected ? "var(--green)" : "var(--red)" }} />
          </div>
          <div className="info-card-value">
            {ext.connected ? "Đang chạy" : "Ngoại tuyến"}
          </div>
          <div className="info-card-footer">
            Flow: {String(ext.flow_tab ?? "…")} · Grok: {String(ext.grok_tab ?? "…")}
          </div>
        </div>

        <div className="info-card">
          <div className="info-card-header">
            <span>Uptime backend</span>
            <Server size={16} style={{ color: "var(--cyan)" }} />
          </div>
          <div className="info-card-value">
            {formatUptime(data?.uptime)}
          </div>
          <div className="info-card-footer">
            Cổng lắng nghe: 8765
          </div>
        </div>
      </div>

      <section className="panel-card" style={{ marginTop: 16 }}>
        <h2>Tài khoản</h2>
        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">👤</div>
            <h3 className="empty-state-title">Chưa có tài khoản nào</h3>
            <p className="empty-state-desc">Hãy liên kết tài khoản Google Labs bằng cách mở popup extension và đăng nhập.</p>
          </div>
        ) : (
          <div className="dash-account-grid">
            {items.map((a) => {
              return (
                <article
                  key={String(a.id)}
                  className={`dash-account-card ${!a.enabled ? "account-card--off" : ""} ${a.in_cooldown ? "account-card--cooldown" : ""}`}
                >
                  <span className={`dash-status-dot ${a.enabled ? (a.in_cooldown ? "cooldown" : "active") : "error"}`} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong className="dash-status-label" style={{ display: "block" }}>{String(a.label)}</strong>
                    <p className="dash-provider" style={{ margin: "2px 0 0" }}>
                      {String(a.provider)} · {a.enabled ? "Hoạt động" : "Tắt"}
                      {a.in_cooldown ? " · Cooldown" : ""}
                    </p>
                    {a.last_error ? (
                      <p className="dash-error-text" title={String(a.last_error)}>
                        {String(a.last_error)}
                      </p>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel-card" style={{ marginTop: 16 }}>
        <h2>Lỗi gần đây</h2>
        {recentFailed.length === 0 ? (
          <div className="empty-state" style={{ padding: "24px" }}>
            <div className="empty-state-icon">✨</div>
            <h3 className="empty-state-title">Hoạt động ổn định</h3>
            <p className="empty-state-desc">Không ghi nhận lỗi tác vụ nào trong thời gian gần đây.</p>
          </div>
        ) : (
          <ul className="dash-log-list">
            {recentFailed.map((f) => (
              <li key={String(f.task_id)} className="dash-log-item">
                <span className="dash-log-time">
                  {String(f.task_id).slice(-8)}
                </span>
                <span className="pill pill-red" style={{ fontSize: 9, padding: "2px 6px" }}>{String(f.type)}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {String(f.prompt)}
                </span>
                <span className="dash-error-text" style={{ maxWidth: "250px" }}>{String(f.error || "")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
