import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listWorkflows,
  deleteWorkflow,
  type WorkflowMeta
} from "../api";
import { useUiDialog } from "../components/UiDialog";
import { NAV_ROUTES } from "../routes";

interface PresetTemplate {
  key: string;
  name: string;
  description: string;
  nodesSummary: string[];
}

const PRESET_TEMPLATES: PresetTemplate[] = [
  {
    key: "default",
    name: "Mẫu: Prompt → Ảnh → Video",
    description: "Luồng tạo video từ prompt cơ bản: Prompt -> Sinh ảnh -> Sinh video từ ảnh đầu.",
    nodesSummary: ["Prompt", "Tạo ảnh", "Tạo video"]
  },
  {
    key: "video-chain",
    name: "Mẫu: Nối video (frame cuối)",
    description: "Sinh video tiếp nối bằng cách trích xuất frame cuối của video trước làm ảnh đầu cho video tiếp theo.",
    nodesSummary: ["Prompt 1", "Tạo ảnh", "Video 1", "Tách frame cuối", "Prompt 2", "Video 2"]
  },
  {
    key: "product-isolate",
    name: "Mẫu: Bóc tách sản phẩm",
    description: "Nhận ảnh sản phẩm gốc có nền phức tạp, dùng Prompt AI để cô lập sản phẩm trên nền trắng studio.",
    nodesSummary: ["Ảnh gốc sản phẩm", "Prompt tách nền", "Tạo ảnh sạch nền"]
  },
  {
    key: "product-placement",
    name: "Mẫu: Ghép sản phẩm vào nhân vật",
    description: "Kết hợp đồng thời ảnh sản phẩm và ảnh nhân vật cùng prompt để vẽ ra ảnh nhân vật mặc/cầm sản phẩm.",
    nodesSummary: ["Ảnh sản phẩm", "Ảnh nhân vật", "Prompt ghép cảnh", "Tạo ảnh ghép"]
  },
  {
    key: "multi-product-isolate",
    name: "Mẫu: Tách nhiều sản phẩm",
    description: "Từ một bức ảnh chụp chung set nhiều đồ đạc, xử lý song song để tách sạch và cô lập từng món đồ thành các ảnh riêng biệt.",
    nodesSummary: ["Ảnh gốc nhiều đồ", "Tách Giày (1:1)", "Tách Túi (1:1)", "Tách Kính (1:1)"]
  }
];

export default function WorkflowTemplatesPage({ onError }: { onError: (msg: string) => void }) {
  const [customTemplates, setCustomTemplates] = useState<WorkflowMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const dialog = useUiDialog();
  const navigate = useNavigate();

  async function loadCustomTemplates() {
    try {
      setLoading(true);
      const data = await listWorkflows();
      setCustomTemplates(data);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCustomTemplates();
  }, []);

  async function handleDeleteCustom(id: string, name: string) {
    const ok = await dialog.confirm({
      title: "Xóa mẫu custom?",
      message: `Bạn có chắc chắn muốn xóa mẫu "${name}"? Thao tác này không thể hoàn tác.`,
      confirmLabel: "Xóa",
      cancelLabel: "Hủy",
      tone: "danger",
    });
    if (!ok) return;

    try {
      await deleteWorkflow(id);
      void loadCustomTemplates();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleApplyPreset(key: string, name: string) {
    const ok = await dialog.confirm({
      title: "Áp dụng mẫu?",
      message: `Bạn có chắc chắn muốn áp dụng mẫu "${name}"? Graph hiện tại trong trình chỉnh sửa sẽ bị thay thế.`,
      confirmLabel: "Áp dụng",
      cancelLabel: "Hủy",
      tone: "default",
    });
    if (!ok) return;

    navigate(`${NAV_ROUTES.workflow}?template=${key}`);
  }

  async function handleApplyCustom(id: string, name: string) {
    const ok = await dialog.confirm({
      title: "Áp dụng mẫu?",
      message: `Bạn có chắc chắn muốn áp dụng mẫu "${name}"? Graph hiện tại trong trình chỉnh sửa sẽ bị thay thế.`,
      confirmLabel: "Áp dụng",
      cancelLabel: "Hủy",
      tone: "default",
    });
    if (!ok) return;

    navigate(`${NAV_ROUTES.workflow}?customTemplate=${id}`);
  }

  const filteredPresets = PRESET_TEMPLATES.filter((t) =>
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredCustoms = customTemplates.filter((t) =>
    (t.name || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="workflow-templates-page" style={{ padding: 24, overflowY: "auto", height: "100%" }}>
      <div className="page-header" style={{ display: "flex", justifyContent: "between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "var(--text)" }}>Quản Lý Mẫu Graph Workflow</h1>
          <p style={{ margin: "4px 0 0 0", color: "var(--text-secondary)", fontSize: 13 }}>
            Lựa chọn mẫu cấu trúc node có sẵn hoặc mẫu bạn tự thiết kế để áp dụng nhanh vào không gian làm việc.
          </p>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Tìm kiếm mẫu..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="wf-input"
            style={{ width: 260 }}
          />
          <button
            type="button"
            className="wf-btn wf-btn-primary"
            onClick={() => navigate(NAV_ROUTES.workflow)}
            style={{ display: "flex", alignItems: "center", gap: 6 }}
          >
            ← Trở lại Editor
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
        {/* Section 1: Presets */}
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 10, marginBottom: 16, color: "#a78bfa", display: "flex", alignItems: "center", gap: 8 }}>
            <span>🛠️ Mẫu Hệ Thống (Presets)</span>
            <span className="pill pill-purple" style={{ fontSize: 10 }}>{PRESET_TEMPLATES.length} mẫu</span>
          </h2>
          {filteredPresets.length === 0 ? (
            <p className="muted" style={{ padding: 12 }}>Không tìm thấy mẫu hệ thống phù hợp.</p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
              {filteredPresets.map((preset) => (
                <div key={preset.key} className="wf-panel-card" style={{ display: "flex", flexDirection: "column", justifyContent: "between", padding: 18, transition: "transform 0.2s, box-shadow 0.2s" }}>
                  <div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 8px 0", color: "var(--text)" }}>{preset.name}</h3>
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45, margin: "0 0 16px 0", minHeight: 40 }}>
                      {preset.description}
                    </p>
                  </div>
                  <div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
                      {preset.nodesSummary.map((node, i) => (
                        <span key={i} className="pill" style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)", color: "#c084fc", fontSize: 10 }}>
                          {node}
                        </span>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="wf-btn wf-btn-primary"
                        style={{ flex: 1, justifyContent: "center" }}
                        onClick={() => void handleApplyPreset(preset.key, preset.name)}
                      >
                        Áp dụng mẫu này
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 2: Custom Saved Workflows */}
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700, borderBottom: "1px solid rgba(255,255,255,0.06)", paddingBottom: 10, marginBottom: 16, color: "#14b8a6", display: "flex", alignItems: "center", gap: 8 }}>
            <span>📂 Mẫu Của Tôi (Custom)</span>
            <span className="pill pill-green" style={{ fontSize: 10 }}>{customTemplates.length} mẫu</span>
          </h2>
          {loading ? (
            <p className="muted" style={{ padding: 12 }}>Đang tải danh sách mẫu của bạn...</p>
          ) : filteredCustoms.length === 0 ? (
            <div className="wf-panel-card" style={{ padding: 24, textAlign: "center" }}>
              <p className="muted" style={{ margin: "0 0 12px 0", fontSize: 13 }}>
                Bạn chưa lưu mẫu workflow riêng nào.
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)" }}>
                Mẹo: Trong trang <strong>Workflow Editor</strong>, bạn có thể thiết kế một bộ node theo ý mình rồi bấm <strong>💾 Lưu</strong> để quản lý dự án, hoặc sử dụng các mẫu hệ thống ở trên để bắt đầu!
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: 16 }}>
              {filteredCustoms.map((custom) => (
                <div key={custom.id} className="wf-panel-card" style={{ display: "flex", flexDirection: "column", justifyContent: "between", padding: 18 }}>
                  <div>
                    <div style={{ display: "flex", justifyContent: "between", alignItems: "start", margin: "0 0 8px 0" }}>
                      <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: "var(--text)" }}>{custom.name}</h3>
                      <span className="muted" style={{ fontSize: 10 }}>
                        {custom.node_count ?? 0} nodes
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45, margin: "0 0 16px 0", minHeight: 20 }}>
                      {custom.description || "Không có mô tả."}
                    </p>
                  </div>
                  <div>
                    <div style={{ display: "flex", justifyContent: "between", alignItems: "center", fontSize: 11, color: "var(--text-secondary)", marginBottom: 16 }}>
                      <span>Cập nhật: {custom.updated_at ? new Date(custom.updated_at * 1000).toLocaleString("vi-VN") : "---"}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="wf-btn wf-btn-primary"
                        style={{ flex: 1, justifyContent: "center" }}
                        onClick={() => void handleApplyCustom(custom.id, custom.name || "Không tên")}
                      >
                        Áp dụng mẫu này
                      </button>
                      <button
                        type="button"
                        className="wf-btn wf-btn-secondary"
                        style={{ color: "#ef4444", borderColor: "rgba(239,68,68,0.2)" }}
                        onClick={() => void handleDeleteCustom(custom.id, custom.name || "Không tên")}
                      >
                        Xóa
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
