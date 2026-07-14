import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchDashboard, clearDashboardHistory } from "../api";
import {
  Activity,
  Users,
  Puzzle,
  Server,
  RefreshCw,
  Sparkles,
  Trash2,
  ChevronDown,
  Image as ImageIcon,
  Film,
  GitBranch,
  Layers,
  MessageSquare,
  Scissors,
  Briefcase,
  Settings,
  ExternalLink,
  ShieldAlert
} from "lucide-react";

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
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);

  // Collapsible states
  const [errorsCollapsed, setErrorsCollapsed] = useState(false);
  const [creditsCollapsed, setCreditsCollapsed] = useState(false);

  // Pagination states
  const [tasksPage, setTasksPage] = useState(1);
  const TASKS_PER_PAGE = 5;

  const [errorsPage, setErrorsPage] = useState(1);
  const ERRORS_PER_PAGE = 8;

  const handleClearHistory = async (type: "completed" | "failed" | "all") => {
    if (!window.confirm("Bạn có chắc chắn muốn xóa lịch sử này không?")) return;
    try {
      await clearDashboardHistory(type);
      if (type === "completed" || type === "all") setTasksPage(1);
      if (type === "failed" || type === "all") setErrorsPage(1);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };

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
  const tasks = (data?.tasks || {}) as Record<string, any>;
  const byStatus = (tasks.by_status || {}) as Record<string, number>;
  const accounts = (data?.accounts || {}) as Record<string, any>;
  const ext = (data?.extension || {}) as Record<string, any>;
  const credits = (data?.credits || {}) as any;
  const workflowRuns = (data?.workflow_runs || []) as Array<Record<string, any>>;
  const standaloneTasks = (data?.standalone_tasks || []) as Array<Record<string, any>>;
  const recentFailed = (tasks.recent_failed || []) as Array<Record<string, any>>;
  const items = (accounts.items || []) as Array<Record<string, any>>;

  const totalTasks = standaloneTasks.length;
  const totalTasksPages = Math.max(1, Math.ceil(totalTasks / TASKS_PER_PAGE));
  const activeTasksPage = Math.min(tasksPage, totalTasksPages);
  const displayedTasks = standaloneTasks.slice(
    (activeTasksPage - 1) * TASKS_PER_PAGE,
    activeTasksPage * TASKS_PER_PAGE
  );

  const totalErrors = recentFailed.length;
  const totalErrorsPages = Math.max(1, Math.ceil(totalErrors / ERRORS_PER_PAGE));
  const activeErrorsPage = Math.min(errorsPage, totalErrorsPages);
  const displayedErrors = recentFailed.slice(
    (activeErrorsPage - 1) * ERRORS_PER_PAGE,
    activeErrorsPage * ERRORS_PER_PAGE
  );

  // Success rate circle calculation
  const completedCount = byStatus.completed || 0;
  const failedCount = byStatus.failed || 0;
  const totalCompletedFailed = completedCount + failedCount;
  const successRate = totalCompletedFailed
    ? Math.round((completedCount / totalCompletedFailed) * 100)
    : 0;
  const circleCircumference = 2 * Math.PI * 18; // radius 18
  const strokeDashoffset = circleCircumference - (successRate / 100) * circleCircumference;

  // Max usage for credits chart
  const modelStats = [
    { name: "Gemini Omni Flash", key: "omni_flash", rate: "12 credit/lượt" },
    { name: "Veo 3.1 Lite", key: "veo_31_lite", rate: "5 credit/lượt" },
    { name: "Veo 3.1 Fast", key: "veo_31_fast", rate: "10 credit/lượt" },
    { name: "Veo 3.1 Quality", key: "veo_31_quality", rate: "100 credit/lượt" },
    { name: "Model Ảnh Free", key: "free_image", rate: "0 credit/lượt" },
    { name: "Model Video Free", key: "free_video", rate: "0 credit/lượt" }
  ];

  const modelCreditsValues = modelStats.map(m => credits.models?.[m.key]?.credits || 0);
  const maxModelCredits = Math.max(...modelCreditsValues, 1);

  if (loading && !data) {
    return (
      <div className="dashboard-page" style={{ paddingTop: 24 }}>
        <div className="db-hero skeleton" style={{ height: 120 }} />
        <div className="info-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="info-card skeleton" style={{ minHeight: 110 }} />
          ))}
        </div>
      </div>
    );
  }

  // Check overall server status for the header banner glow
  const allServicesOnline = ext.connected && data?.uptime > 0;

  return (
    <div className="dashboard-page" style={{ paddingTop: 24 }}>
      {/* ─── 1. COMMAND HERO BANNER ─── */}
      <section className="db-hero">
        {allServicesOnline && <div className="db-hero-glow" />}
        <div className="db-hero-header">
          <div className="db-hero-title-group">
            <h1>Trung Tâm Điều Khiển Hệ Thống</h1>
            <p>Theo dõi tổng thể tác vụ, tài khoản và tín hiệu truyền dữ liệu thời gian thực</p>
          </div>
          
          <div className="db-status-group">
            {/* Status indicators */}
            <div className="db-status-badge online">
              <div className="db-status-dot-blink" />
              <span>Backend Online</span>
            </div>

            <div className={`db-status-badge ${ext.connected ? "online" : "offline"}`}>
              <div className={ext.connected ? "db-status-dot-blink" : ""} style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "currentColor" }} />
              <span>Auth Helper: {ext.connected ? "OK" : "Mất kết nối"}</span>
            </div>

            <div className={`db-status-badge ${ext.flow_tab === "open" ? "online" : "offline"}`}>
              <div className={ext.flow_tab === "open" ? "db-status-dot-blink" : ""} style={{ width: 6, height: 6, borderRadius: "50%", backgroundColor: "currentColor" }} />
              <span>Flow Tab: {ext.flow_tab === "open" ? "Mở" : "Đóng"}</span>
            </div>

            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}
              onClick={() => void load()}
              disabled={loading}
            >
              <RefreshCw size={13} className={loading ? "st-spin" : ""} />
              Làm mới
            </button>
          </div>
        </div>
      </section>

      {/* ─── 2. QUICK NAVIGATION GRID ─── */}
      <section style={{ marginBottom: 24 }}>
        <div className="section-header" style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: "14px", fontWeight: 750, color: "var(--purple-bright)", textTransform: "uppercase", letterSpacing: "0.05em", margin: 0 }}>Điều hướng nhanh</h2>
        </div>
        <div className="db-nav-grid">
          <Link to="/flow-image" className="db-nav-card">
            <div className="db-nav-icon"><ImageIcon size={18} /></div>
            <div className="db-nav-info">
              <h3>Flow Ảnh</h3>
              <p>Tạo ảnh hàng loạt từ prompt, reference</p>
            </div>
          </Link>
          
          <Link to="/flow-video" className="db-nav-card">
            <div className="db-nav-icon"><Film size={18} /></div>
            <div className="db-nav-info">
              <h3>Flow Video</h3>
              <p>Gen video chất lượng cao Veo 3.1</p>
            </div>
          </Link>

          <Link to="/workflow" className="db-nav-card">
            <div className="db-nav-icon"><GitBranch size={18} /></div>
            <div className="db-nav-info">
              <h3>Workflow Editor</h3>
              <p>Xây dựng quy trình tự động hóa node</p>
            </div>
          </Link>

          <Link to="/video-editor" className="db-nav-card">
            <div className="db-nav-icon"><Scissors size={18} /></div>
            <div className="db-nav-info">
              <h3>Dựng Video</h3>
              <p>Ghép nối clip, chèn nhạc tự động</p>
            </div>
          </Link>

          <Link to="/references" className="db-nav-card">
            <div className="db-nav-icon"><Layers size={18} /></div>
            <div className="db-nav-info">
              <h3>Thư viện Reference</h3>
              <p>Quản lý ảnh mẫu, tư liệu đầu vào</p>
            </div>
          </Link>

          <Link to="/prompt-hub" className="db-nav-card">
            <div className="db-nav-icon"><MessageSquare size={18} /></div>
            <div className="db-nav-info">
              <h3>Prompt Hub</h3>
              <p>Kho lưu trữ ý tưởng, prompt tối ưu</p>
            </div>
          </Link>

          <Link to="/projects" className="db-nav-card">
            <div className="db-nav-icon"><Briefcase size={18} /></div>
            <div className="db-nav-info">
              <h3>Dự án</h3>
              <p>Quản lý các dự án gen hàng loạt</p>
            </div>
          </Link>

          <Link to="/settings" className="db-nav-card">
            <div className="db-nav-icon"><Settings size={18} /></div>
            <div className="db-nav-info">
              <h3>Cài đặt</h3>
              <p>Tài khoản, API key và Port config</p>
            </div>
          </Link>
        </div>
      </section>

      {/* ─── 3. METRICS / STATS GRID ─── */}
      <div className="info-grid" style={{ marginBottom: 24 }}>
        <div className="info-card">
          <div className="info-card-header">
            <span>Hàng đợi (Queue)</span>
            <Activity size={15} style={{ color: queue.running > 0 ? "var(--cyan)" : "var(--muted)" }} className={queue.running > 0 ? "st-pulse" : ""} />
          </div>
          <div className="info-card-value">
            {queue.running ?? 0} <span className="value-unit">chạy</span> · {queue.pending ?? 0} <span className="value-unit">chờ</span>
          </div>
          <div className="info-card-footer">
            Giới hạn tối đa song song: {queue.max_concurrent ?? "?"}
          </div>
        </div>

        <div className="info-card" style={{ display: "flex", flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ flex: 1 }}>
            <div className="info-card-header">
              <span>Tác vụ gần đây</span>
            </div>
            <div className="info-card-value">
              {completedCount} <span className="value-unit" style={{ color: "var(--green)" }}>xong</span> · {failedCount} <span className="value-unit" style={{ color: "var(--red)" }}>lỗi</span>
            </div>
            <div className="info-card-footer">
              Tổng tracked: {tasks.total_tracked ?? 0}
            </div>
          </div>
          {totalCompletedFailed > 0 && (
            <div style={{ position: "relative", width: 50, height: 50 }}>
              <svg width="50" height="50" viewBox="0 0 44 44" style={{ transform: "rotate(-90deg)" }}>
                <circle cx="22" cy="22" r="18" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="4" />
                <circle
                  cx="22"
                  cy="22"
                  r="18"
                  fill="none"
                  stroke={successRate > 75 ? "var(--green)" : successRate > 40 ? "var(--yellow)" : "var(--red)"}
                  strokeWidth="4"
                  strokeDasharray={circleCircumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                  style={{ transition: "stroke-dashoffset 0.8s ease" }}
                />
              </svg>
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 700 }}>
                {successRate}%
              </div>
            </div>
          )}
        </div>

        <div className="info-card">
          <div className="info-card-header">
            <span>Tài khoản Google</span>
            <Users size={15} style={{ color: "var(--blue)" }} />
          </div>
          <div className="info-card-value">
            {accounts.enabled ?? 0}<span className="value-unit"> / {accounts.total ?? 0} bật</span>
          </div>
          <div className="info-card-footer">
            Ảnh: {accounts.flow_image_ready ?? 0} · Video: {accounts.flow_video_ready ?? 0} sẵn sàng
          </div>
        </div>

        <div className="info-card">
          <div className="info-card-header">
            <span>Auth Bridge</span>
            <Puzzle size={15} style={{ color: ext.connected ? "var(--green)" : "var(--red)" }} />
          </div>
          <div className="info-card-value" style={{ color: ext.connected ? "var(--green)" : "inherit" }}>
            {ext.connected ? "Hoạt động" : "Ngoại tuyến"}
          </div>
          <div className="info-card-footer">
            Kênh: {ext.extensions > 0 ? `${ext.extensions} helper` : "Chưa kết nối"}
          </div>
        </div>

        <div className="info-card">
          <div className="info-card-header">
            <span>Tiêu thụ Credit</span>
            <Sparkles size={15} style={{ color: "var(--yellow)" }} />
          </div>
          <div className="info-card-value" style={{ color: "var(--yellow)" }}>
            {(credits.total_credits ?? 0).toLocaleString()} <span className="value-unit">cr</span>
          </div>
          <div className="info-card-footer">
            Trung bình: {credits.total_runs ? Math.round((credits.total_credits || 0) / credits.total_runs) : 0} credit/lượt
          </div>
        </div>

        <div className="info-card">
          <div className="info-card-header">
            <span>Uptime Server</span>
            <Server size={15} style={{ color: "var(--cyan)" }} />
          </div>
          <div className="info-card-value">
            {formatUptime(data?.uptime)}
          </div>
          <div className="info-card-footer">
            Cổng API: 8765 · Auth: 18923
          </div>
        </div>
      </div>

      {/* ─── 4. TÀI KHOẢN GRID ─── */}
      <section className="panel-card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Users size={16} style={{ color: "var(--purple-bright)" }} />
            <h2 style={{ margin: 0, fontSize: "15px" }}>Chi tiết Tài khoản & Tín dụng</h2>
          </div>
          <Link to="/settings" style={{ fontSize: "12px", color: "var(--purple-bright)", textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
            Quản lý <ExternalLink size={12} />
          </Link>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">👤</div>
            <h3 className="empty-state-title">Chưa liên kết tài khoản</h3>
            <p className="empty-state-desc">Hãy thêm tài khoản Google trong phần Cài đặt hoặc thông qua Extension Helper.</p>
          </div>
        ) : (
          <div className="dash-account-grid">
            {items.map((a) => {
              const maxFlowCredits = 50000;
              const remaining = Number(a.credits_remaining ?? 0);
              const pctRemaining = Math.min(100, Math.max(0, (remaining / maxFlowCredits) * 100));

              return (
                <article
                  key={String(a.id)}
                  className={`dash-account-card ${!a.enabled ? "account-card--off" : ""} ${a.in_cooldown ? "account-card--cooldown" : ""}`}
                  style={{ display: "flex", flexDirection: "column", gap: 10, padding: 16 }}
                >
                  <div className="db-account-header">
                    <div className="db-account-avatar">
                      {a.label ? String(a.label).slice(0, 2) : "G"}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong className="dash-status-label" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {String(a.label)}
                      </strong>
                      <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                        {String(a.provider).toUpperCase()} · {a.enabled ? (a.in_cooldown ? "Cooldown" : "Sẵn sàng") : "Đang tắt"}
                      </span>
                    </div>
                    <span className={`dash-status-dot ${a.enabled ? (a.in_cooldown ? "cooldown" : "active") : "error"}`} />
                  </div>

                  {a.enabled && a.credits_remaining !== undefined && a.credits_remaining !== null && (
                    <div className="db-progress-container">
                      <div className="db-progress-header">
                        <span style={{ color: "var(--green)" }}>Còn lại: <strong>{remaining.toLocaleString()}</strong> credit</span>
                        <span>{Math.round(pctRemaining)}%</span>
                      </div>
                      <div className="db-progress-bar">
                        <div
                          className="db-progress-fill"
                          style={{
                            width: `${pctRemaining}%`,
                            background: pctRemaining < 20 ? "var(--red)" : pctRemaining < 50 ? "var(--yellow)" : "linear-gradient(90deg, var(--green) 0%, var(--cyan) 100%)"
                          }}
                        />
                      </div>
                    </div>
                  )}

                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "var(--text-secondary)", borderTop: "1px solid rgba(255,255,255,0.03)", paddingTop: 8 }}>
                    <span>Chạy: <strong>{Number(a.total_runs || 0)}</strong> lượt</span>
                    <span>Tiêu thụ: <strong>{Number(a.total_credits || 0)}</strong> cr</span>
                  </div>

                  {a.last_error && (
                    <div className="dash-error-text" style={{ fontSize: "11px", marginTop: 4, display: "flex", gap: 4, alignItems: "flex-start", background: "rgba(239,68,68,0.04)", padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.1)" }}>
                      <ShieldAlert size={12} style={{ flexShrink: 0, marginTop: 2, color: "var(--red)" }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{String(a.last_error)}</span>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── 5. TIẾN ĐỘ WORKFLOW (REALTIME) ─── */}
      <section className="panel-card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <GitBranch size={16} style={{ color: "var(--purple-bright)" }} />
          <h2 style={{ margin: 0, fontSize: "15px" }}>Tiến độ Workflow (Thời gian thực)</h2>
        </div>
        {workflowRuns.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="empty-state-icon">⚙️</div>
            <h3 className="empty-state-title">Chưa chạy workflow nào</h3>
            <p className="empty-state-desc">Khởi chạy dự án từ mục Workflow Editor để xem tiến độ tự động hóa.</p>
          </div>
        ) : (
          <div className="db-task-list">
            {workflowRuns.map((r) => {
              const total = r.progress?.total || 1;
              const done = r.progress?.done || 0;
              const pct = Math.min(100, Math.round((done / total) * 100));
              const isRunning = r.status === "running" || r.status === "pending";

              return (
                <div key={r.run_id} className="db-task-card">
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
                          style={{ fontWeight: 700, color: "#fff", textDecoration: "none", fontSize: "13.5px" }}
                          className="hover-underline"
                        >
                          📂 {r.project_name}
                        </Link>
                      ) : (
                        <span style={{ fontWeight: 700, color: "#fff", fontSize: "13.5px" }}>📂 {r.project_name}</span>
                      )}
                    </div>
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                      Bắt đầu: {fmtTime(r.started_at)} {r.finished_at ? `· Xong: ${fmtTime(r.finished_at)}` : ""}
                    </span>
                  </div>

                  {isRunning ? (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11.5px", marginBottom: 3 }}>
                        <span style={{ color: "var(--text-secondary)" }}>
                          {r.progress?.current ? `Đang xử lý: ${r.progress.current}` : "Đang chạy..."}
                        </span>
                        <span style={{ fontWeight: 700, color: "var(--purple-bright)" }}>{pct}% ({done}/{total} node)</span>
                      </div>
                      <div className="db-progress-bar">
                        <div
                          className="db-progress-fill"
                          style={{
                            width: `${pct}%`,
                            background: "linear-gradient(90deg, var(--purple) 0%, var(--cyan) 100%)"
                          }}
                        />
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: "12px", color: "var(--muted)" }}>
                      Trạng thái cuối: Hoàn thành {done}/{total} node workflow
                    </div>
                  )}

                  {r.status === "failed" && r.error && (
                    <div style={{ fontSize: "11.5px", color: "var(--red)", background: "rgba(239, 68, 68, 0.04)", padding: "6px 10px", borderRadius: 6, border: "1px solid rgba(239, 68, 68, 0.08)", marginTop: 2 }}>
                      ❌ Lỗi: {r.error}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ─── 6. TIẾN ĐỘ FLOW ẢNH / FLOW VIDEO ─── */}
      <section className="panel-card" style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Activity size={16} style={{ color: "var(--cyan)" }} />
            <h2 style={{ margin: 0, fontSize: "15px" }}>Tiến độ Flow Tác vụ Đơn lẻ</h2>
          </div>
          {standaloneTasks.length > 0 && (
            <button
              onClick={() => handleClearHistory("completed")}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--border)",
                color: "var(--muted)",
                borderRadius: 8,
                padding: "4px 10px",
                fontSize: "11px",
                cursor: "pointer",
                transition: "all 0.2s"
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.05)";
                e.currentTarget.style.color = "var(--red)";
                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.03)";
                e.currentTarget.style.color = "var(--muted)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <Trash2 size={11} />
              Dọn hoàn thành
            </button>
          )}
        </div>

        {standaloneTasks.length === 0 ? (
          <div className="empty-state" style={{ padding: 24 }}>
            <div className="empty-state-icon">⚡</div>
            <h3 className="empty-state-title">Chưa có tác vụ đơn lẻ</h3>
            <p className="empty-state-desc">Các tác vụ khởi tạo từ Flow Ảnh / Flow Video sẽ hiển thị tiến độ tại đây.</p>
          </div>
        ) : (
          <div className="db-task-list">
            {displayedTasks.map((t) => {
              const isRunning = t.status === "running" || t.status === "pending";
              const isVideo = t.task_type === "video";
              const targetRoute = isVideo ? "/flow-video" : "/flow-image";
              const labelText = isVideo ? "Flow Video" : "Flow Ảnh";

              return (
                <div key={t.task_id} className="db-task-card">
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
                        style={{ fontSize: "9px", padding: "1px 6px" }}
                      >
                        {t.status === "running" ? "ĐANG CHẠY" : t.status === "pending" ? "ĐANG CHỜ" : t.status === "completed" ? "HOÀN THÀNH" : "THẤT BẠI"}
                      </span>
                      <Link
                        to={targetRoute}
                        style={{ fontWeight: 700, color: "#fff", textDecoration: "none", fontSize: "13px" }}
                        className="hover-underline"
                      >
                        {isVideo ? "🎬" : "🖼️"} {labelText} · <span style={{ color: "var(--cyan)" }}>{t.model}</span>
                      </Link>
                    </div>
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                      {fmtTime(t.created_at)} {t.completed_at ? `→ ${fmtTime(t.completed_at)}` : ""}
                    </span>
                  </div>

                  <div style={{ fontSize: "12px", color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Prompt: <span style={{ color: "#fff" }}>{t.prompt}</span>
                  </div>

                  {isRunning && (
                    <div style={{ marginTop: 4 }}>
                      <div className="db-progress-bar" style={{ height: 3 }}>
                        <div
                          className="db-progress-fill"
                          style={{
                            width: "100%",
                            background: "linear-gradient(90deg, transparent, var(--cyan), transparent)",
                            animation: "pulse 1.5s infinite"
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {t.status === "failed" && t.error && (
                    <div style={{ fontSize: "11px", color: "var(--red)", background: "rgba(239, 68, 68, 0.04)", padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(239, 68, 68, 0.08)", marginTop: 2 }}>
                      ❌ Lỗi: {t.error}
                    </div>
                  )}
                </div>
              );
            })}

            {totalTasksPages > 1 && (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 12 }}>
                <button
                  disabled={activeTasksPage === 1}
                  onClick={() => setTasksPage(prev => Math.max(1, prev - 1))}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--border)",
                    color: activeTasksPage === 1 ? "rgba(255,255,255,0.2)" : "#fff",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: "11px",
                    cursor: activeTasksPage === 1 ? "default" : "pointer"
                  }}
                >
                  Trước
                </button>
                <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                  Trang {activeTasksPage} / {totalTasksPages}
                </span>
                <button
                  disabled={activeTasksPage === totalTasksPages}
                  onClick={() => setTasksPage(prev => Math.min(totalTasksPages, prev + 1))}
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid var(--border)",
                    color: activeTasksPage === totalTasksPages ? "rgba(255,255,255,0.2)" : "#fff",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: "11px",
                    cursor: activeTasksPage === totalTasksPages ? "default" : "pointer"
                  }}
                >
                  Sau
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* ─── 7. CREDIT STATISTICS CHART (COLLAPSIBLE) ─── */}
      <section className="panel-card" style={{ marginBottom: 24 }}>
        <div className="db-collapsible-header" onClick={() => setCreditsCollapsed(!creditsCollapsed)}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Sparkles size={16} style={{ color: "var(--yellow)" }} />
            <h2 style={{ margin: 0, fontSize: "15px" }}>Thống kê Tín dụng theo Model</h2>
          </div>
          <button className={`db-collapse-btn ${creditsCollapsed ? "" : "active"}`} type="button">
            <ChevronDown size={16} />
          </button>
        </div>

        {!creditsCollapsed && (
          <div style={{ marginTop: 16 }}>
            <div className="db-credits-chart">
              {modelStats.map((m) => {
                const stat = credits.models?.[m.key] || { runs: 0, credits: 0 };
                const barPct = Math.min(100, Math.max(2, (stat.credits / maxModelCredits) * 100));

                return (
                  <div
                    key={m.key}
                    style={{
                      background: "rgba(255,255,255,0.01)",
                      border: "1px solid var(--border)",
                      borderRadius: 10,
                      padding: 14,
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between"
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 700, fontSize: "13px", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>{m.name}</span>
                        <span style={{ fontSize: "10px", color: "var(--muted)", fontWeight: 500 }}>{m.rate}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11.5px", marginTop: 12, color: "var(--text-secondary)" }}>
                        <span>Lượt chạy:</span>
                        <span style={{ fontWeight: 700, color: "#fff" }}>{stat.runs || 0}</span>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11.5px", marginTop: 3, color: "var(--text-secondary)" }}>
                        <span>Tiêu thụ:</span>
                        <span style={{ color: "var(--yellow)", fontWeight: 700 }}>{(stat.credits || 0).toLocaleString()} cr</span>
                      </div>
                    </div>

                    <div className="db-chart-bar-container">
                      <div
                        className="db-chart-bar-fill"
                        style={{
                          width: `${barPct}%`,
                          background: "linear-gradient(90deg, var(--purple) 0%, var(--cyan) 100%)"
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* ─── 8. RECENT ERRORS (COLLAPSIBLE) ─── */}
      <section className="panel-card" style={{ marginBottom: 24 }}>
        <div className="db-collapsible-header" onClick={() => setErrorsCollapsed(!errorsCollapsed)}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ShieldAlert size={16} style={{ color: "var(--red)" }} />
            <h2 style={{ margin: 0, fontSize: "15px" }}>Lịch sử Lỗi hệ thống ({recentFailed.length})</h2>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {recentFailed.length > 0 && !errorsCollapsed && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleClearHistory("failed");
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "rgba(239, 68, 68, 0.05)",
                  border: "1px solid rgba(239, 68, 68, 0.15)",
                  color: "var(--red)",
                  borderRadius: 6,
                  padding: "2px 8px",
                  fontSize: "11px",
                  cursor: "pointer",
                  transition: "all 0.2s"
                }}
              >
                <Trash2 size={11} />
                Xóa lỗi
              </button>
            )}
            <button className={`db-collapse-btn ${errorsCollapsed ? "" : "active"}`} type="button">
              <ChevronDown size={16} />
            </button>
          </div>
        </div>

        {!errorsCollapsed && (
          <div style={{ marginTop: 16 }}>
            {recentFailed.length === 0 ? (
              <div className="empty-state" style={{ padding: 24 }}>
                <div className="empty-state-icon">✨</div>
                <h3 className="empty-state-title">Hoạt động ổn định</h3>
                <p className="empty-state-desc">Không ghi nhận sự cố hay lỗi tác vụ nào gần đây.</p>
              </div>
            ) : (
              <div>
                <ul className="dash-log-list" style={{ border: "1px solid var(--border)", borderRadius: 10, background: "rgba(0,0,0,0.15)", padding: 4 }}>
                  {displayedErrors.map((f) => (
                    <li key={String(f.task_id)} className="dash-log-item" style={{ borderBottom: "1px solid rgba(255,255,255,0.02)", padding: "8px 12px", display: "flex", alignItems: "center", gap: 12 }}>
                      <span className="dash-log-time" style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "monospace" }}>
                        {String(f.task_id).slice(-8)}
                      </span>
                      <span className="pill pill-red" style={{ fontSize: 9, padding: "1px 5px", textTransform: "uppercase" }}>{String(f.type)}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "12px", color: "var(--text-secondary)" }}>
                        {String(f.prompt)}
                      </span>
                      <span className="dash-error-text" style={{ maxWidth: "350px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px", color: "var(--red)", fontWeight: 500 }}>
                        {String(f.error || "")}
                      </span>
                    </li>
                  ))}
                </ul>

                {totalErrorsPages > 1 && (
                  <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 12, marginTop: 12 }}>
                    <button
                      disabled={activeErrorsPage === 1}
                      onClick={() => setErrorsPage(prev => Math.max(1, prev - 1))}
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid var(--border)",
                        color: activeErrorsPage === 1 ? "rgba(255,255,255,0.2)" : "#fff",
                        borderRadius: 6,
                        padding: "4px 10px",
                        fontSize: "11px",
                        cursor: activeErrorsPage === 1 ? "default" : "pointer"
                      }}
                    >
                      Trước
                    </button>
                    <span style={{ fontSize: "11px", color: "var(--muted)" }}>
                      Trang {activeErrorsPage} / {totalErrorsPages}
                    </span>
                    <button
                      disabled={activeErrorsPage === totalErrorsPages}
                      onClick={() => setErrorsPage(prev => Math.min(totalErrorsPages, prev + 1))}
                      style={{
                        background: "rgba(255,255,255,0.03)",
                        border: "1px solid var(--border)",
                        color: activeErrorsPage === totalErrorsPages ? "rgba(255,255,255,0.2)" : "#fff",
                        borderRadius: 6,
                        padding: "4px 10px",
                        fontSize: "11px",
                        cursor: activeErrorsPage === totalErrorsPages ? "default" : "pointer"
                      }}
                    >
                      Sau
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
