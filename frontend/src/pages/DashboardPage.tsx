import { useCallback, useEffect, useState } from "react";
import { fetchDashboard } from "../api";

interface DashboardPageProps {
  onError: (msg: string) => void;
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

  return (
    <div className="dashboard-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Dashboard</h1>
          <span className="pill pill-purple">TỔNG QUAN</span>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={loading}>
          {loading ? "…" : "Làm mới"}
        </button>
      </header>

      <div className="info-grid">
        <div className="info-card">
          <span>Hàng đợi</span>
          <code>
            {queue.running ?? 0} chạy · {queue.pending ?? 0} chờ · max {queue.max_concurrent ?? "?"}
          </code>
        </div>
        <div className="info-card">
          <span>Task (gần đây)</span>
          <code>
            {String(tasks.total_tracked ?? 0)} · OK {byStatus.completed ?? 0} · Fail {byStatus.failed ?? 0}
            {tasks.success_rate_pct != null ? ` · ${tasks.success_rate_pct}%` : ""}
          </code>
        </div>
        <div className="info-card">
          <span>Accounts</span>
          <code>
            {String(accounts.enabled ?? 0)}/{String(accounts.total ?? 0)} bật · Flow ảnh{" "}
            {String(accounts.flow_image_ready ?? 0)} · video {String(accounts.flow_video_ready ?? 0)}
          </code>
        </div>
        <div className="info-card">
          <span>Auth Helper</span>
          <code>
            {ext.connected ? "Online" : "Offline"} · Flow {String(ext.flow_tab ?? "…")} · Grok{" "}
            {String(ext.grok_tab ?? "…")}
          </code>
        </div>
        <div className="info-card">
          <span>Uptime backend</span>
          <code>{String(data?.uptime ?? 0)}s</code>
        </div>
      </div>

      <section className="panel-card" style={{ marginTop: 16 }}>
        <h2>Tài khoản</h2>
        {items.length === 0 ? (
          <p className="muted">Chưa có account — Settings hoặc Login browser.</p>
        ) : (
          <div className="account-list">
            {items.map((a) => (
              <article key={String(a.id)} className="account-card">
                <div>
                  <strong>{String(a.label)}</strong>
                  <p>
                    {String(a.provider)} · {a.enabled ? "Bật" : "Tắt"}
                    {a.in_cooldown ? " · Cooldown" : ""}
                  </p>
                  {a.last_error ? (
                    <p className="account-error">{String(a.last_error).slice(0, 120)}</p>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel-card" style={{ marginTop: 16 }}>
        <h2>Lỗi gần đây</h2>
        {recentFailed.length === 0 ? (
          <p className="muted">Không có task failed gần đây.</p>
        ) : (
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {recentFailed.map((f) => (
              <li key={String(f.task_id)}>
                <code>{String(f.task_id)}</code> [{String(f.type)}] {String(f.prompt)} —{" "}
                {String(f.error || "")}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
