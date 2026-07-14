import { useCallback, useEffect, useState } from "react";
import { fetchDashboard } from "../api";
import {
  Coins,
  RefreshCw,
  Search,
  ExternalLink,
  ShieldAlert,
  Sparkles,
  Zap,
  Activity,
  History,
  Info
} from "lucide-react";

interface CreditsPageProps {
  onError: (msg: string) => void;
}

function fmtTime(ts?: number) {
  if (!ts) return "—";
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("vi-VN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function CreditsPage({ onError }: CreditsPageProps) {
  const [data, setData] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Filter/Search states
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [historyTab, setHistoryTab] = useState<"local" | "google">("google");

  const load = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetchDashboard();
      setData(res);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
    const interval = setInterval(() => void load(true), 10000);
    return () => clearInterval(interval);
  }, [load]);

  if (loading && !data) {
    return (
      <div className="dashboard-loading" style={{ padding: "40px", textAlign: "center" }}>
        <RefreshCw className="spin" size={32} style={{ color: "var(--color-primary)", marginBottom: "12px" }} />
        <p style={{ color: "var(--color-text-secondary)", fontSize: "14px" }}>Đang đồng bộ thông tin tín dụng...</p>
      </div>
    );
  }

  const accounts = data?.accounts?.items || [];
  const credits = data?.credits || { total_runs: 0, total_credits: 0, models: {}, accounts: {} };
  const tasks = data?.standalone_tasks || [];

  // Flow accounts summary
  const flowAccounts = accounts.filter((a: any) => a.provider === "flow");
  const mainAccount = flowAccounts[0] || null;
  const creditsRemaining = mainAccount ? mainAccount.credits_remaining ?? 25000 : 25000;
  const creditsTotal = 25000; // standard Gemini monthly quota limit
  const creditsUsed = Math.max(0, creditsTotal - creditsRemaining);
  const creditsUsedPercent = Math.min(100, Math.round((creditsRemaining / creditsTotal) * 100));

  // Filter tasks
  const filteredTasks = tasks.filter((t: any) => {
    const matchesSearch = (t.prompt || "").toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (t.task_id || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = statusFilter === "all" || t.status === statusFilter;
    const matchesType = typeFilter === "all" || t.task_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  // Google One history from backend
  const g1History = data?.google_one_history || { last_sync_at: 0, transactions: [] };
  const g1Transactions = g1History.transactions || [];

  // Filter Google One transactions
  const filteredG1Transactions = g1Transactions.filter((tx: any) => {
    const matchesSearch = (tx.model || "").toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (tx.id || "").toLowerCase().includes(searchTerm.toLowerCase());
    const isVideo = (tx.model || "").toLowerCase().includes("t2v") || 
                    (tx.model || "").toLowerCase().includes("veo") || 
                    (tx.model || "").toLowerCase().includes("abra") || 
                    (tx.model || "").toLowerCase().includes("omni");
    const isImage = (tx.model || "").toLowerCase().includes("image") || 
                    (tx.model || "").toLowerCase().includes("pix") || 
                    (tx.model || "").toLowerCase().includes("banana");
    const matchesType = typeFilter === "all" || 
                        (typeFilter === "video" && isVideo) || 
                        (typeFilter === "image" && isImage);
    return matchesSearch && matchesType;
  });

  // Calculate current month statistics
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const monthNames = [
    "Tháng 1", "Tháng 2", "Tháng 3", "Tháng 4", "Tháng 5", "Tháng 6",
    "Tháng 7", "Tháng 8", "Tháng 9", "Tháng 10", "Tháng 11", "Tháng 12"
  ];
  const currentMonthName = monthNames[currentMonth];

  const tasksThisMonth = tasks.filter((t: any) => {
    if (!t.created_at) return false;
    const d = new Date(t.created_at * 1000);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  let monthlyCreditsUsed = 0;
  let monthlyRunsCount = tasksThisMonth.length;
  let monthlyCompletedCount = 0;
  let monthlyFailedCount = 0;

  tasksThisMonth.forEach((t: any) => {
    if (t.status === "completed") {
      monthlyCompletedCount++;
      const m = (t.model || "").toLowerCase();
      if (m.includes("relaxed") || m.includes("free")) {
        // 0 credits
      } else if (m.includes("quality")) {
        monthlyCreditsUsed += 100;
      } else if (m.includes("fast")) {
        monthlyCreditsUsed += 10;
      } else if (m.includes("lite")) {
        monthlyCreditsUsed += 5;
      } else if (m.includes("omni") || m.includes("abra")) {
        monthlyCreditsUsed += 12;
      }
    } else if (t.status === "failed") {
      monthlyFailedCount++;
    }
  });

  return (
    <div style={{ flex: 1, overflowY: "auto", paddingBottom: "100px" }}>
      <div className="credits-page" style={{ padding: "24px", maxWidth: "1200px", margin: "0 auto" }}>
      
      {/* Header section with title and manual refresh */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600, display: "flex", alignItems: "center", gap: "10px" }}>
            <Coins size={28} style={{ color: "var(--color-primary)" }} /> Lịch Sử Hoạt Động & Tín Dụng
          </h1>
          <p style={{ margin: "4px 0 0 0", color: "var(--color-text-secondary)", fontSize: "13px" }}>
            Theo dõi chi tiết số lượt chạy và dung lượng tín dụng khả dụng của tài khoản Google Flow AI.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => void load()}
          disabled={refreshing}
          style={{ display: "flex", alignItems: "center", gap: "8px" }}
        >
          <RefreshCw className={refreshing ? "spin" : ""} size={14} />
          {refreshing ? "Đang đồng bộ..." : "Đồng bộ ngay"}
        </button>
      </div>

      {/* Main Grid: Google One Credits Activity layout */}
      <div className="credits-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>
        
        {/* Left Column: Google One Style circular quota gauge & Account info */}
        <div className="credits-left-col" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          
          {/* Google One Style circular progress card */}
          <div className="card" style={{ padding: "28px", borderRadius: "16px", background: "linear-gradient(135deg, rgba(30, 41, 59, 0.4) 0%, rgba(15, 23, 42, 0.6) 100%)", backdropFilter: "blur(12px)", border: "1px solid rgba(255, 255, 255, 0.05)", boxShadow: "0 8px 32px rgba(0, 0, 0, 0.2)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <span style={{ fontSize: "15px", fontWeight: 600, color: "var(--color-text-secondary)", display: "flex", alignItems: "center", gap: "8px" }}>
                <Sparkles size={18} style={{ color: "#f59e0b" }} /> Hoạt Động AI Google Advanced
              </span>
              <span className="badge badge-success" style={{ padding: "4px 10px", fontSize: "11px", background: "rgba(16, 185, 129, 0.15)", color: "#10b981", borderRadius: "100px" }}>
                Đang hoạt động
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", gap: "24px", margin: "16px 0" }}>
              
              {/* SVG Circular Progress Gauge */}
              <div style={{ position: "relative", width: "150px", height: "150px" }}>
                <svg width="150" height="150" viewBox="0 0 150 150">
                  <circle
                    cx="75"
                    cy="75"
                    r="60"
                    fill="transparent"
                    stroke="rgba(255,255,255,0.03)"
                    strokeWidth="10"
                  />
                  <circle
                    cx="75"
                    cy="75"
                    r="60"
                    fill="transparent"
                    stroke="url(#googleOneGradient)"
                    strokeWidth="12"
                    strokeDasharray={2 * Math.PI * 60}
                    strokeDashoffset={2 * Math.PI * 60 * (1 - creditsUsedPercent / 100)}
                    strokeLinecap="round"
                    transform="rotate(-90 75 75)"
                  />
                  <defs>
                    <linearGradient id="googleOneGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#4285F4" />
                      <stop offset="30%" stopColor="#EA4335" />
                      <stop offset="60%" stopColor="#FBBC05" />
                      <stop offset="100%" stopColor="#34A853" />
                    </linearGradient>
                  </defs>
                </svg>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
                  <span style={{ fontSize: "28px", fontWeight: 700, color: "#fff", lineHeight: 1 }}>{creditsUsedPercent}%</span>
                  <span style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "4px" }}>Khả dụng</span>
                </div>
              </div>

              {/* Text Stats */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>Còn lại trong tháng:</div>
                  <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-primary)" }}>{creditsRemaining.toLocaleString()} credits</div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>Đã tiêu thụ:</div>
                  <div style={{ fontSize: "14px", fontWeight: 500, color: "rgba(255,255,255,0.7)" }}>{creditsUsed.toLocaleString()} / {creditsTotal.toLocaleString()} credits</div>
                </div>
                <div>
                  <div style={{ fontSize: "12px", color: "var(--color-text-secondary)" }}>Tổng số lượt đã chạy:</div>
                  <div style={{ fontSize: "14px", fontWeight: 600, color: "#10b981" }}>{credits.total_runs ?? 0} lượt</div>
                </div>
              </div>
            </div>

            {/* Helper Info Banner */}
            <div style={{ marginTop: "24px", display: "flex", gap: "10px", padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <Info size={16} style={{ color: "var(--color-primary)", flexShrink: 0, marginTop: "2px" }} />
              <p style={{ margin: 0, fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.5 }}>
                Hạn mức tín dụng được làm mới tự động vào chu kỳ hàng tháng theo tài khoản Google One AI Premium của bạn. Truy cập <a href="https://one.google.com/ai/activity" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-primary)", textDecoration: "underline", display: "inline-flex", alignItems: "center", gap: "2px" }}>Google One AI Activity <ExternalLink size={10} /></a> để quản lý chính thức.
              </p>
            </div>
          </div>

          {/* Monthly Consumption Card */}
          <div className="card" style={{ padding: "20px", borderRadius: "12px", background: "linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(30, 41, 59, 0.2) 100%)", border: "1px solid rgba(59, 130, 246, 0.15)" }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "15px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
              <Activity size={16} style={{ color: "var(--color-primary)" }} /> Tiêu thụ tháng này ({currentMonthName} / {currentYear})
            </h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.02)" }}>
                <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>Tín dụng đã tiêu (Thực tế tài khoản):</span>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "var(--color-primary)", marginTop: "4px" }}>{creditsUsed.toLocaleString()} credits</div>
                <div style={{ fontSize: "10px", color: "var(--color-text-secondary)", marginTop: "2px" }}>* Đồng bộ từ Google (gồm cả chạy trên web)</div>
              </div>
              <div style={{ padding: "12px", borderRadius: "8px", background: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.02)" }}>
                <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>Lượt chạy (Ghi nhận trên G-Labs):</span>
                <div style={{ fontSize: "20px", fontWeight: 700, color: "#fff", marginTop: "4px" }}>{monthlyRunsCount} lượt</div>
                <div style={{ fontSize: "10px", color: "var(--color-text-secondary)", marginTop: "2px" }}>Thành công: <span style={{ color: "#10b981" }}>{monthlyCompletedCount}</span> · Lỗi: <span style={{ color: "#ef4444" }}>{monthlyFailedCount}</span></div>
              </div>
            </div>
          </div>

          {/* Account Detail List Card */}
          <div className="card" style={{ padding: "20px", borderRadius: "12px" }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "15px", fontWeight: 600 }}>Tài khoản đang liên kết</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {flowAccounts.length === 0 ? (
                <div style={{ padding: "16px", textAlign: "center", color: "var(--color-text-secondary)", fontSize: "13px" }}>
                  Chưa cấu hình tài khoản Google Flow nào trong Cài Đặt.
                </div>
              ) : (
                flowAccounts.map((acc: any) => (
                  <div key={acc.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px", borderRadius: "8px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "13px" }}>{acc.label}</div>
                      <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "2px" }}>ID: {acc.id.slice(0, 8)}... · Google Flow Provider</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--color-primary)" }}>{(acc.credits_remaining ?? 0).toLocaleString()}</div>
                      <div style={{ fontSize: "10px", color: "var(--color-text-secondary)" }}>credits còn lại</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Model credits consumption card */}
          <div className="card" style={{ padding: "20px", borderRadius: "12px" }}>
            <h3 style={{ margin: "0 0 16px 0", fontSize: "15px", fontWeight: 600, display: "flex", alignItems: "center", gap: "6px" }}>
              <Zap size={16} style={{ color: "var(--color-primary)" }} /> Chi phí tiêu thụ theo Model
            </h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              
              {/* Veo 3.1 Quality */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                  <span>Veo 3.1 Quality (Video cao cấp)</span>
                  <span style={{ fontWeight: 600 }}>100 credits / lượt</span>
                </div>
                <div style={{ height: "4px", width: "100%", borderRadius: "2px", background: "rgba(255,255,255,0.05)" }}>
                  <div style={{ height: "100%", width: "100%", borderRadius: "2px", background: "#ec4899" }} />
                </div>
              </div>

              {/* Veo 3.1 Fast */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                  <span>Veo 3.1 Fast (Video nhanh)</span>
                  <span style={{ fontWeight: 600 }}>10 credits / lượt</span>
                </div>
                <div style={{ height: "4px", width: "100%", borderRadius: "2px", background: "rgba(255,255,255,0.05)" }}>
                  <div style={{ height: "100%", width: "10%", borderRadius: "2px", background: "#ff007f" }} />
                </div>
              </div>

              {/* Gemini Omni Flash */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                  <span>Gemini Omni Flash (Video tốc độ)</span>
                  <span style={{ fontWeight: 600 }}>12 credits / lượt</span>
                </div>
                <div style={{ height: "4px", width: "100%", borderRadius: "2px", background: "rgba(255,255,255,0.05)" }}>
                  <div style={{ height: "100%", width: "12%", borderRadius: "2px", background: "var(--color-primary)" }} />
                </div>
              </div>

              {/* Veo 3.1 Lite */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                  <span>Veo 3.1 Lite (Video tiết kiệm)</span>
                  <span style={{ fontWeight: 600 }}>5 credits / lượt</span>
                </div>
                <div style={{ height: "4px", width: "100%", borderRadius: "2px", background: "rgba(255,255,255,0.05)" }}>
                  <div style={{ height: "100%", width: "5%", borderRadius: "2px", background: "#a855f7" }} />
                </div>
              </div>

              {/* Nano Banana Pro / Lite */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", marginBottom: "4px" }}>
                  <span>Nano Banana / Relaxed Mode (Ảnh / Video 0đ)</span>
                  <span style={{ fontWeight: 600 }}>0 credits (Miễn phí hoàn toàn)</span>
                </div>
                <div style={{ height: "4px", width: "100%", borderRadius: "2px", background: "rgba(255,255,255,0.05)" }}>
                  <div style={{ height: "100%", width: "0%", borderRadius: "2px", background: "#10b981" }} />
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Right Column: AI Live Activity Logs matching Google One layout */}
        <div className="credits-right-col" style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          
          <div className="card" style={{ padding: "20px", borderRadius: "12px", minHeight: "580px", display: "flex", flexDirection: "column" }}>
            
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
                <History size={18} style={{ color: "var(--color-primary)" }} /> Nhật ký hoạt động AI
              </h3>
              <a
                href="https://one.google.com/ai/activity"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-secondary btn-xs"
                style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", padding: "4px 8px" }}
              >
                Mở Google One Activity <ExternalLink size={10} />
              </a>
            </div>

            {/* History Tab Selector */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px", borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: "10px" }}>
              <button
                type="button"
                className={`btn btn-xs ${historyTab === "google" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setHistoryTab("google")}
                style={{ fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}
              >
                <Coins size={12} /> Lịch sử Google One ({g1Transactions.length})
              </button>
              <button
                type="button"
                className={`btn btn-xs ${historyTab === "local" ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setHistoryTab("local")}
                style={{ fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}
              >
                <History size={12} /> Tác vụ G-Labs ({filteredTasks.length})
              </button>
            </div>

            {/* Filter controls */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "16px" }}>
              
              {/* Search bar */}
              <div style={{ position: "relative", flex: 1, minWidth: "150px" }}>
                <Search size={14} style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", color: "var(--color-text-secondary)" }} />
                <input
                  type="text"
                  placeholder={historyTab === "google" ? "Tìm theo model..." : "Tìm prompt..."}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "6px 10px 6px 30px",
                    borderRadius: "6px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(0,0,0,0.2)",
                    fontSize: "12px",
                    color: "#fff"
                  }}
                />
              </div>

              {/* Type Filter */}
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                style={{
                  padding: "6px 10px",
                  borderRadius: "6px",
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "rgba(0,0,0,0.2)",
                  fontSize: "12px",
                  color: "#fff"
                }}
              >
                <option value="all">Mọi loại hình</option>
                <option value="image">Tạo ảnh (Image)</option>
                <option value="video">Tạo video (Video)</option>
              </select>

              {/* Status Filter (only for local history) */}
              {historyTab === "local" && (
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "6px",
                    border: "1px solid rgba(255,255,255,0.08)",
                    background: "rgba(0,0,0,0.2)",
                    fontSize: "12px",
                    color: "#fff"
                  }}
                >
                  <option value="all">Mọi trạng thái</option>
                  <option value="completed">Thành công (Completed)</option>
                  <option value="failed">Thất bại (Failed)</option>
                  <option value="running">Đang chạy (Running)</option>
                  <option value="queued">Đang chờ (Queued)</option>
                </select>
              )}
            </div>

            {/* Logs List Container */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", maxHeight: "450px" }}>
              {historyTab === "google" ? (
                filteredG1Transactions.length === 0 ? (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", color: "var(--color-text-secondary)", minHeight: "200px", padding: "20px", textAlign: "center" }}>
                    <History size={32} style={{ opacity: 0.15, marginBottom: "10px" }} />
                    <span style={{ fontSize: "13px", fontWeight: 600 }}>Không tìm thấy lịch sử nào trên Google One.</span>
                    <span style={{ fontSize: "11px", opacity: 0.7, marginTop: "6px", lineHeight: 1.4 }}>
                      Đang đồng bộ ngầm qua Chrome Extension... Hãy F5 hoặc thao tác trên trang Google Flow ở tab khác để kích hoạt cào dữ liệu mới nhất.
                    </span>
                  </div>
                ) : (
                  filteredG1Transactions.map((tx: any) => {
                    let modelLabel = tx.model;
                    if (tx.model.includes("quality")) modelLabel = "Veo 3.1 Quality";
                    else if (tx.model.includes("fast")) modelLabel = "Veo 3.1 Fast";
                    else if (tx.model.includes("lite")) modelLabel = "Veo 3.1 Lite";
                    else if (tx.model.includes("omni") || tx.model.includes("abra")) modelLabel = "Gemini Omni Flash";
                    else if (tx.model.includes("imagen") || tx.model.includes("pix")) modelLabel = "Imagen 3";
                    else if (tx.model.includes("gemini")) modelLabel = "Gemini Advanced";

                    return (
                      <div
                        key={tx.id}
                        style={{
                          padding: "12px 14px",
                          borderRadius: "8px",
                          background: "rgba(255, 255, 255, 0.01)",
                          border: "1px solid rgba(255, 255, 255, 0.03)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center"
                        }}
                      >
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 600, color: "#f8fafc" }}>
                            {modelLabel}
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--color-text-secondary)", marginTop: "4px" }}>
                            {fmtTime(tx.timestamp)} · ID: {tx.id.slice(0, 8)}...
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontSize: "14px", fontWeight: 700, color: tx.credits > 0 ? "#ef4444" : "#10b981" }}>
                            {tx.credits > 0 ? `-${tx.credits}` : "0"} credits
                          </div>
                          <div style={{ fontSize: "10px", color: "#10b981", marginTop: "2px" }}>Thành công</div>
                        </div>
                      </div>
                    );
                  })
                )
              ) : (
                filteredTasks.length === 0 ? (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", color: "var(--color-text-secondary)", minHeight: "200px" }}>
                    <History size={32} style={{ opacity: 0.15, marginBottom: "10px" }} />
                    <span style={{ fontSize: "13px" }}>Không tìm thấy lịch sử hoạt động AI nào.</span>
                  </div>
                ) : (
                  filteredTasks.map((t: any) => {
                    let statusBadge = null;
                    if (t.status === "completed") {
                      statusBadge = <span className="badge badge-success" style={{ fontSize: "10px", padding: "2px 8px" }}>Hoàn tất</span>;
                    } else if (t.status === "failed") {
                      statusBadge = <span className="badge badge-danger" style={{ fontSize: "10px", padding: "2px 8px" }}>Thất bại</span>;
                    } else if (t.status === "running") {
                      statusBadge = <span className="badge badge-primary spin" style={{ fontSize: "10px", padding: "2px 8px" }}>Đang chạy</span>;
                    } else {
                      statusBadge = <span className="badge badge-warning" style={{ fontSize: "10px", padding: "2px 8px" }}>Đang chờ</span>;
                    }

                    return (
                      <div
                        key={t.task_id}
                        style={{
                          padding: "12px 14px",
                          borderRadius: "8px",
                          background: "rgba(255, 255, 255, 0.01)",
                          border: "1px solid rgba(255, 255, 255, 0.03)",
                          display: "flex",
                          flexDirection: "column",
                          gap: "6px"
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>
                            {fmtTime(t.created_at)}
                          </span>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span style={{ fontSize: "10px", background: "rgba(255,255,255,0.04)", padding: "2px 6px", borderRadius: "4px", color: "var(--color-text-secondary)" }}>
                              {t.model}
                            </span>
                            {statusBadge}
                          </div>
                        </div>

                        <div style={{ fontSize: "13px", fontWeight: 500, color: "#f8fafc", wordBreak: "break-word" }}>
                          {t.prompt}
                        </div>

                        {t.error && (
                          <div style={{ display: "flex", gap: "6px", alignItems: "start", marginTop: "4px", padding: "8px", borderRadius: "4px", background: "rgba(239, 68, 68, 0.05)", border: "1px solid rgba(239, 68, 68, 0.1)" }}>
                            <ShieldAlert size={14} style={{ color: "#ef4444", flexShrink: 0, marginTop: "1px" }} />
                            <div style={{ fontSize: "11px", color: "#fca5a5", wordBreak: "break-word" }}>{t.error}</div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )
              )}
            </div>

          </div>

        </div>

      </div>

    </div>
    </div>
  );
}
