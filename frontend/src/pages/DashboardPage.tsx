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
          <p className="muted">Chưa có account — Settings hoặc Login browser.</p>
        ) : (
          <div className="account-list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 14 }}>
            {items.map((a) => {
              const classes = ["account-card"];
              if (!a.enabled) classes.push("account-card--off");
              if (a.in_cooldown) classes.push("account-card--cooldown");
              return (
                <article key={String(a.id)} className={classes.join(" ")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span className={`status-dot ${a.enabled ? "online" : "offline"}`} style={{ width: 8, height: 8 }} />
                    <div>
                      <strong style={{ display: "block", fontSize: "14px", fontWeight: "700" }}>{String(a.label)}</strong>
                      <p style={{ margin: "4px 0 0", fontSize: "12px", color: "var(--muted)" }}>
                        {String(a.provider)} · {a.enabled ? "Hoạt động" : "Tắt"}
                        {a.in_cooldown ? " · Cooldown" : ""}
                      </p>
                      {a.last_error ? (
                        <p className="account-error" style={{ color: "var(--red)", marginTop: 6, fontSize: "11px", lineHeight: "1.3" }}>
                          {String(a.last_error).slice(0, 120)}
                        </p>
                      ) : null}
                    </div>
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
          <p className="muted">Không có task failed gần đây.</p>
        ) : (
          <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
            {recentFailed.map((f) => (
              <li key={String(f.task_id)} style={{ marginBottom: 6 }}>
                <code style={{ background: "rgba(255,255,255,0.04)", padding: "2px 6px", borderRadius: 4, marginRight: 8 }}>
                  {String(f.task_id)}
                </code> 
                <span className="pill pill-red" style={{ fontSize: 9, padding: "2px 6px", marginRight: 8 }}>{String(f.type)}</span>
                <span style={{ color: "var(--text-secondary)" }}>{String(f.prompt)}</span> —{" "}
                <span style={{ color: "var(--red-bright, #f87171)", fontSize: "13px" }}>{String(f.error || "")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
