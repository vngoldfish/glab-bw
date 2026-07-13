import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchDashboard } from "../api";
import { Activity, CheckCircle2, Users, Puzzle, Server, RefreshCw, Sparkles } from "lucide-react";

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

function fmtTime(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
  const credits = (data?.credits || {}) as any;
  const workflowRuns = (data?.workflow_runs || []) as Array<Record<string, any>>;
  const standaloneTasks = (data?.standalone_tasks || []) as Array<Record<string, any>>;
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
            <span>Credit tiêu thụ</span>
            <Sparkles size={16} style={{ color: "var(--amber-bright)" }} />
          </div>
          <div className="info-card-value" style={{ color: "var(--amber-bright)" }}>
            {Number(credits.total_credits ?? 0)} <span className="value-unit">credit</span>
          </div>
          <div className="info-card-footer">
            Tổng: {Number(credits.total_runs ?? 0)} lượt chạy
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
                    <div style={{ fontSize: "11.5px", color: "var(--amber-bright)", marginTop: 4, display: "flex", gap: 8 }}>
                      <span>Lượt chạy: <strong>{Number(a.total_runs || 0)}</strong></span>
                      <span>•</span>
                      <span>Tiêu thụ: <strong>{Number(a.total_credits || 0)} credit</strong></span>
                    </div>
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
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Activity size={18} style={{ color: "var(--purple-bright)" }} />
          <h2 style={{ margin: 0 }}>Tiến độ chạy Workflow (Thời gian thực)</h2>
        </div>
        {workflowRuns.length === 0 ? (
          <div className="empty-state" style={{ padding: "24px" }}>
            <div className="empty-state-icon">⚙️</div>
            <h3 className="empty-state-title">Chưa chạy workflow nào</h3>
            <p className="empty-state-desc">Hãy mở trang Workflow Editor và khởi chạy một project để theo dõi tiến trình.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {workflowRuns.map((r) => {
              const total = r.progress?.total || 1;
              const done = r.progress?.done || 0;
              const pct = Math.min(100, Math.round((done / total) * 100));
              const isRunning = r.status === "running" || r.status === "pending";

              return (
                <div
                  key={r.run_id}
                  style={{
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                    borderRadius: 8,
                    padding: "12px 16px"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        className={`pill ${
                          r.status === "completed"
                            ? "pill-green"
                            : r.status === "failed"
                              ? "pill-red"
                              : r.status === "pending"
                                ? "pill-yellow"
                                : "pill-blue"
                        }`}
                        style={{ fontSize: "10px", padding: "2px 8px" }}
                      >
                        {r.status === "running" ? "ĐANG CHẠY" : r.status === "pending" ? "ĐANG CHỜ" : r.status === "completed" ? "HOÀN THÀNH" : "THẤT BẠI"}
                      </span>
                      {r.project_id ? (
                        <Link
                          to={`/workflow/${r.project_id}`}
                          style={{ fontWeight: 600, color: "#fff", textDecoration: "none", fontSize: "14px" }}
                          className="hover-underline"
                        >
                          📂 {r.project_name}
                        </Link>
                      ) : (
                        <span style={{ fontWeight: 600, color: "#fff", fontSize: "14px" }}>📂 {r.project_name}</span>
                      )}
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      Bắt đầu: {fmtTime(r.started_at)} {r.finished_at ? `· Xong: ${fmtTime(r.finished_at)}` : ""}
                    </span>
                  </div>

                  {isRunning && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: 4 }}>
                        <span style={{ color: "var(--text-secondary)" }}>
                          {r.progress?.current ? `Đang xử lý: ${r.progress.current}` : "Đang chạy..."}
                        </span>
                        <span style={{ fontWeight: 600, color: "var(--purple-bright)" }}>{pct}% ({done}/{total} node)</span>
                      </div>
                      <div style={{ height: 6, background: "rgba(255, 255, 255, 0.05)", borderRadius: 3, overflow: "hidden" }}>
                        <div
                          className="st-progress-bar-fill"
                          style={{
                            width: `${pct}%`,
                            height: "100%",
                            background: "linear-gradient(90deg, var(--purple-bright), var(--cyan))",
                            transition: "width 0.4s ease"
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {r.status === "failed" && r.error && (
                    <div style={{ marginTop: 8, fontSize: "12px", color: "var(--red)", background: "rgba(239, 68, 68, 0.05)", padding: "6px 10px", borderRadius: 4, border: "1px solid rgba(239, 68, 68, 0.1)" }}>
                      ❌ Lỗi: {r.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel-card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Activity size={18} style={{ color: "var(--blue)" }} />
          <h2 style={{ margin: 0 }}>Tiến độ Flow Ảnh / Flow Video (Thời gian thực)</h2>
        </div>
        {standaloneTasks.length === 0 ? (
          <div className="empty-state" style={{ padding: "24px" }}>
            <div className="empty-state-icon">⚡</div>
            <h3 className="empty-state-title">Chưa tạo ảnh hay video nào</h3>
            <p className="empty-state-desc">Hãy sử dụng Flow Ảnh hoặc Flow Video để tạo nội dung.</p>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {standaloneTasks.map((t) => {
              const isRunning = t.status === "running" || t.status === "pending";
              const isVideo = t.task_type === "video";
              const targetRoute = isVideo ? "/flow-video" : "/flow-image";
              const labelText = isVideo ? "Flow Video" : "Flow Ảnh";

              return (
                <div
                  key={t.task_id}
                  style={{
                    background: "rgba(255, 255, 255, 0.02)",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                    borderRadius: 8,
                    padding: "12px 16px"
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        className={`pill ${
                          t.status === "completed"
                            ? "pill-green"
                            : t.status === "failed"
                              ? "pill-red"
                              : t.status === "pending"
                                ? "pill-yellow"
                                : "pill-blue"
                        }`}
                        style={{ fontSize: "10px", padding: "2px 8px" }}
                      >
                        {t.status === "running" ? "ĐANG CHẠY" : t.status === "pending" ? "ĐANG CHỜ" : t.status === "completed" ? "HOÀN THÀNH" : "THẤT BẠI"}
                      </span>
                      <Link
                        to={targetRoute}
                        style={{ fontWeight: 600, color: "#fff", textDecoration: "none", fontSize: "14px" }}
                        className="hover-underline"
                      >
                        🔮 {labelText} · {t.model}
                      </Link>
                    </div>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      Bắt đầu: {fmtTime(t.created_at)} {t.completed_at ? `· Xong: ${fmtTime(t.completed_at)}` : ""}
                    </span>
                  </div>

                  <div style={{ marginTop: 8, fontSize: "13px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Prompt: <span style={{ color: "#fff" }}>{t.prompt}</span>
                  </div>

                  {isRunning && (
                    <div style={{ marginTop: 10 }}>
                      <div className="st-progress-bar-fill st-spin" style={{ height: 3, width: "30px", background: "var(--purple-bright)", borderRadius: 1.5 }}></div>
                    </div>
                  )}

                  {t.status === "failed" && t.error && (
                    <div style={{ marginTop: 8, fontSize: "12px", color: "var(--red)", background: "rgba(239, 68, 68, 0.05)", padding: "6px 10px", borderRadius: 4, border: "1px solid rgba(239, 68, 68, 0.1)" }}>
                      ❌ Lỗi: {t.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="panel-card" style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <Sparkles size={18} style={{ color: "var(--amber-bright)" }} />
          <h2 style={{ margin: 0 }}>Thống kê Credit sử dụng (Theo mô hình)</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#fff" }}>Gemini Omni Flash</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>Giá: 12 credit/lượt</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span>Lượt chạy:</span>
              <span style={{ fontWeight: 600 }}>{credits.models?.omni_flash?.runs || 0}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
              <span>Credit tiêu thụ:</span>
              <span style={{ color: "var(--amber-bright)", fontWeight: 600 }}>{credits.models?.omni_flash?.credits || 0}</span>
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#fff" }}>Veo 3.1 Lite</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>Giá: 5 credit/lượt</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span>Lượt chạy:</span>
              <span style={{ fontWeight: 600 }}>{credits.models?.veo_31_lite?.runs || 0}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
              <span>Credit tiêu thụ:</span>
              <span style={{ color: "var(--amber-bright)", fontWeight: 600 }}>{credits.models?.veo_31_lite?.credits || 0}</span>
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#fff" }}>Veo 3.1 Fast</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>Giá: 10 credit/lượt</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span>Lượt chạy:</span>
              <span style={{ fontWeight: 600 }}>{credits.models?.veo_31_fast?.runs || 0}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
              <span>Credit tiêu thụ:</span>
              <span style={{ color: "var(--amber-bright)", fontWeight: 600 }}>{credits.models?.veo_31_fast?.credits || 0}</span>
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#fff" }}>Veo 3.1 Quality</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>Giá: 100 credit/lượt</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span>Lượt chạy:</span>
              <span style={{ fontWeight: 600 }}>{credits.models?.veo_31_quality?.runs || 0}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
              <span>Credit tiêu thụ:</span>
              <span style={{ color: "var(--amber-bright)", fontWeight: 600 }}>{credits.models?.veo_31_quality?.credits || 0}</span>
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#fff" }}>Model Ảnh Miễn Phí</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>Giá: Miễn phí (0 credit)</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span>Lượt chạy:</span>
              <span style={{ fontWeight: 600 }}>{credits.models?.free_image?.runs || 0}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
              <span>Credit tiêu thụ:</span>
              <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>0</span>
            </div>
          </div>

          <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#fff" }}>Model Video Miễn Phí</div>
            <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>Giá: Miễn phí (0 credit)</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span>Lượt chạy:</span>
              <span style={{ fontWeight: 600 }}>{credits.models?.free_video?.runs || 0}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
              <span>Credit tiêu thụ:</span>
              <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>0</span>
            </div>
          </div>
        </div>
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
