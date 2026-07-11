import { useEffect, useState } from "react";
import {
  submitBatch,
  fetchAllProjectAssets,
  mediaUrl,
  type ProjectAsset
} from "../api";
import { useUiDialog } from "../components/UiDialog";

interface StoryboardPanel {
  id: string;
  image: string | null;
  imagePath?: string; // local absolute path if imported
  prompt: string;
  action: string;
  shotType: string;
  cameraMovement: string;
  duration: number;
}

interface StoryboardDoc {
  id: string;
  name: string;
  description: string;
  panels: StoryboardPanel[];
  updatedAt: number;
}

const SHOT_TYPES = [
  { value: "wide", label: "Cảnh toàn (Wide Shot)" },
  { value: "medium", label: "Cảnh trung (Medium Shot)" },
  { value: "close-up", label: "Cảnh cận (Close-Up)" },
  { value: "extreme-close", label: "Cảnh cận cực đại (Extreme Close-Up)" },
  { value: "bird-eye", label: "Góc nhìn từ trên cao (Bird's Eye)" },
  { value: "low-angle", label: "Góc máy thấp (Low Angle)" },
  { value: "high-angle", label: "Góc máy cao (High Angle)" },
  { value: "other", label: "Khác (Tự chọn)" }
];

const CAMERA_MOVEMENTS = [
  { value: "static", label: "Tĩnh (Static)" },
  { value: "pan-left", label: "Lia trái (Pan Left)" },
  { value: "pan-right", label: "Lia phải (Pan Right)" },
  { value: "tilt-up", label: "Ngước máy (Tilt Up)" },
  { value: "tilt-down", label: "Cúi máy (Tilt Down)" },
  { value: "zoom-in", label: "Thu phóng cận (Zoom In)" },
  { value: "zoom-out", label: "Thu phóng viễn (Zoom Out)" },
  { value: "dolly", label: "Đẩy máy (Dolly)" }
];

const LOCAL_STORAGE_KEY = "g-labs-storyboards";

export default function StoryboardPage({ onError }: { onError: (msg: string) => void }) {
  const [storyboards, setStoryboards] = useState<StoryboardDoc[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [generatingPanelId, setGeneratingPanelId] = useState<string | null>(null);

  // App project asset picker states
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [pickerTargetId, setPickerTargetId] = useState<string | null>(null);
  const [appImages, setAppImages] = useState<ProjectAsset[]>([]);
  const [loadingAppImages, setLoadingAppImages] = useState(false);

  const dialog = useUiDialog();

  // Load from localstorage
  useEffect(() => {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as StoryboardDoc[];
        setStoryboards(parsed);
        if (parsed.length > 0) {
          setActiveId(parsed[0].id);
        }
      } catch {
        /* ignore */
      }
    } else {
      // Create a default initial storyboard
      const initial: StoryboardDoc = {
        id: "default-storyboard",
        name: "Kịch bản phân cảnh mẫu #1",
        description: "Storyboard phân cảnh quảng cáo sản phẩm.",
        panels: [
          {
            id: "panel-1",
            image: null,
            prompt: "A beautiful studio product shot of a luxury watch, professional lighting, clean white background, 4k",
            action: "Giới thiệu cận cảnh sản phẩm đồng hồ dưới ánh sáng studio.",
            shotType: "close-up",
            cameraMovement: "static",
            duration: 3
          },
          {
            id: "panel-2",
            image: null,
            prompt: "A close-up shot of a model wearing a luxury watch, cinematic light, shallow depth of field, outdoor park, daytime",
            action: "Nhân vật nam đeo đồng hồ dạo bước trong công viên.",
            shotType: "medium",
            cameraMovement: "pan-right",
            duration: 4
          }
        ],
        updatedAt: Date.now()
      };
      setStoryboards([initial]);
      setActiveId(initial.id);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify([initial]));
    }
  }, []);

  const activeSb = storyboards.find((s) => s.id === activeId);

  function saveStoryboards(next: StoryboardDoc[]) {
    setStoryboards(next);
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next));
  }

  function handleCreateStoryboard() {
    const name = prompt("Nhập tên cho bảng phân cảnh mới:");
    if (!name || !name.trim()) return;
    const desc = prompt("Nhập mô tả ngắn (không bắt buộc):") || "";
    
    const newDoc: StoryboardDoc = {
      id: `sb_${Date.now()}`,
      name: name.trim(),
      description: desc.trim(),
      panels: [
        {
          id: `panel_${Date.now()}_1`,
          image: null,
          prompt: "A beautiful cinematic landscape shot",
          action: "Mô tả phân cảnh...",
          shotType: "wide",
          cameraMovement: "static",
          duration: 3
        }
      ],
      updatedAt: Date.now()
    };
    const nextList = [...storyboards, newDoc];
    saveStoryboards(nextList);
    setActiveId(newDoc.id);
  }

  async function handleDeleteStoryboard() {
    if (!activeSb) return;
    const ok = await dialog.confirm({
      title: "Xóa Storyboard?",
      message: `Bạn có chắc chắn muốn xóa "${activeSb.name}"? Hành động này không thể hoàn tác.`,
      confirmLabel: "Xóa",
      cancelLabel: "Hủy",
      tone: "danger",
    });
    if (!ok) return;

    const nextList = storyboards.filter((s) => s.id !== activeId);
    saveStoryboards(nextList);
    if (nextList.length > 0) {
      setActiveId(nextList[0].id);
    } else {
      setActiveId("");
    }
  }

  function updateActiveStoryboard(patch: Partial<StoryboardDoc>) {
    const next = storyboards.map((s) => {
      if (s.id === activeId) {
        return { ...s, ...patch, updatedAt: Date.now() };
      }
      return s;
    });
    saveStoryboards(next);
  }

  function updatePanel(panelId: string, patch: Partial<StoryboardPanel>) {
    if (!activeSb) return;
    const nextPanels = activeSb.panels.map((p) => {
      if (p.id === panelId) {
        return { ...p, ...patch };
      }
      return p;
    });
    updateActiveStoryboard({ panels: nextPanels });
  }

  function handleAddPanel() {
    if (!activeSb) return;
    const newPanel: StoryboardPanel = {
      id: `panel_${Date.now()}`,
      image: null,
      prompt: "",
      action: "",
      shotType: "medium",
      cameraMovement: "static",
      duration: 3
    };
    updateActiveStoryboard({ panels: [...activeSb.panels, newPanel] });
  }

  function handleDeletePanel(panelId: string) {
    if (!activeSb) return;
    if (activeSb.panels.length <= 1) {
      alert("Phải có ít nhất 1 phân cảnh trong storyboard!");
      return;
    }
    const nextPanels = activeSb.panels.filter((p) => p.id !== panelId);
    updateActiveStoryboard({ panels: nextPanels });
  }

  function handleMovePanel(index: number, direction: "up" | "down") {
    if (!activeSb) return;
    const list = [...activeSb.panels];
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= list.length) return;

    // Swap
    const temp = list[index];
    list[index] = list[targetIdx];
    list[targetIdx] = temp;

    updateActiveStoryboard({ panels: list });
  }

  async function handleGenerateImage(panel: StoryboardPanel) {
    if (!panel.prompt.trim()) {
      alert("Vui lòng điền Prompt mô tả ảnh trước khi vẽ!");
      return;
    }
    setGeneratingPanelId(panel.id);
    try {
      const result = await submitBatch(
        [
          {
            prompt: panel.prompt,
            provider: "image",
            params: {
              aspect_ratio: "16:9",
              save_mode: "flat",
              output_folder: "workflow/anh"
            }
          }
        ],
        1
      );
      const item = result.results[0];
      if (item?.status === "completed" && item.results?.length) {
        const generatedUrl = item.results[0];
        updatePanel(panel.id, { image: generatedUrl });
      } else {
        alert(item?.error || item?.error_detail || "Tạo ảnh thất bại. Vui lòng kiểm tra lại tài khoản sinh ảnh.");
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setGeneratingPanelId(null);
    }
  }

  async function openAssetPicker(panelId: string) {
    setPickerTargetId(panelId);
    setShowAssetPicker(true);
    setLoadingAppImages(true);
    try {
      const res = await fetchAllProjectAssets("image", 120);
      setAppImages(res.assets);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingAppImages(false);
    }
  }

  function handleSelectAsset(img: ProjectAsset) {
    if (!pickerTargetId) return;
    updatePanel(pickerTargetId, {
      image: mediaUrl(img.url),
      imagePath: img.path
    });
    setShowAssetPicker(false);
    setPickerTargetId(null);
  }

  function handlePrintStoryboard() {
    window.print();
  }

  return (
    <div className="storyboard-page" style={{ padding: 24, height: "100%", overflowY: "auto" }}>
      {/* Print-specific style override */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .storyboard-print-area, .storyboard-print-area * {
            visibility: visible;
          }
          .storyboard-print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }
          .no-print {
            display: none !important;
          }
          .print-card {
            page-break-inside: avoid;
            margin-bottom: 20px;
            border: 1px solid #000 !important;
            color: #000 !important;
            background: #fff !important;
          }
        }
      `}</style>

      {/* Header controls (No print) */}
      <div className="page-header no-print" style={{ display: "flex", justifyContent: "between", alignItems: "center", marginBottom: 24, flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "var(--text)" }}>Bảng Phân Cảnh (Storyboard Builder)</h1>
          <p style={{ margin: "4px 0 0 0", color: "var(--text-secondary)", fontSize: 13 }}>
            Thiết kế chuỗi khung cảnh cho kịch bản của bạn, vẽ ảnh minh họa tự động bằng AI và xuất báo cáo in ấn.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select
            value={activeId}
            onChange={(e) => setActiveId(e.target.value)}
            className="wf-select"
            style={{ width: 220 }}
          >
            {storyboards.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <button type="button" className="wf-btn" onClick={handleCreateStoryboard}>
            + Tạo bảng mới
          </button>
          {activeSb && (
            <>
              <button type="button" className="wf-btn wf-btn-secondary" onClick={handlePrintStoryboard}>
                🖨️ Xuất In / PDF
              </button>
              <button
                type="button"
                className="wf-btn"
                style={{ color: "#ef4444", borderColor: "rgba(239,68,68,0.2)" }}
                onClick={handleDeleteStoryboard}
              >
                Xóa bảng
              </button>
            </>
          )}
        </div>
      </div>

      {activeSb ? (
        <div className="storyboard-print-area" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Storyboard Info Card */}
          <div className="wf-panel-card" style={{ padding: 20, borderBottom: "3px solid var(--accent)", borderRadius: 12 }}>
            <h2 style={{ margin: "0 0 6px 0", fontSize: 18, color: "var(--text)" }}>{activeSb.name}</h2>
            <p style={{ margin: 0, color: "var(--text-secondary)", fontSize: 13 }}>{activeSb.description || "Chưa có mô tả kịch bản."}</p>
            <div className="no-print" style={{ marginTop: 12, display: "flex", justifyContent: "between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                Số phân cảnh: {activeSb.panels.length} · Cập nhật cuối: {new Date(activeSb.updatedAt).toLocaleString("vi-VN")}
              </span>
              <button type="button" className="wf-btn wf-btn-primary" onClick={handleAddPanel}>
                + Thêm phân cảnh mới
              </button>
            </div>
          </div>

          {/* Panels Grid */}
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            {activeSb.panels.map((panel, idx) => (
              <div
                key={panel.id}
                className="wf-panel-card print-card"
                style={{
                  display: "flex",
                  gap: 20,
                  padding: 20,
                  borderRadius: 12,
                  flexWrap: "wrap",
                  position: "relative"
                }}
              >
                {/* 1. Left Side: Shot Number and Controls (No Print) */}
                <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 40, alignItems: "center" }}>
                  <span style={{ fontSize: 24, fontWeight: 900, color: "var(--accent)" }}>#{idx + 1}</span>
                  <button
                    type="button"
                    className="wf-btn"
                    style={{ padding: "4px 8px" }}
                    onClick={() => handleMovePanel(idx, "up")}
                    disabled={idx === 0}
                    title="Di chuyển lên"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="wf-btn"
                    style={{ padding: "4px 8px" }}
                    onClick={() => handleMovePanel(idx, "down")}
                    disabled={idx === activeSb.panels.length - 1}
                    title="Di chuyển xuống"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="wf-btn"
                    style={{ padding: "4px 8px", color: "#ef4444", borderColor: "rgba(239,68,68,0.15)", marginTop: 16 }}
                    onClick={() => handleDeletePanel(panel.id)}
                    title="Xóa phân cảnh"
                  >
                    ✕ Xóa
                  </button>
                </div>

                {/* 2. Middle Side: Image Preview & Generation */}
                <div style={{ flex: "1 1 280px", maxWidth: 360, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div
                    style={{
                      width: "100%",
                      aspectRatio: "16/9",
                      background: "#0d1017",
                      border: "1px dashed rgba(255,255,255,0.08)",
                      borderRadius: 10,
                      overflow: "hidden",
                      position: "relative",
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center"
                    }}
                  >
                    {panel.image ? (
                      <img
                        src={panel.image}
                        alt={`Panel ${idx + 1}`}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    ) : (
                      <div className="muted" style={{ fontSize: 12, textAlign: "center", padding: 12 }}>
                        {generatingPanelId === panel.id ? "Đang vẽ ảnh..." : "Chưa có hình ảnh phân cảnh"}
                      </div>
                    )}

                    {generatingPanelId === panel.id && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          background: "rgba(0,0,0,0.65)",
                          display: "flex",
                          justifyContent: "center",
                          alignItems: "center",
                          color: "var(--accent)",
                          fontWeight: 700,
                          fontSize: 13
                        }}
                      >
                        🎨 AI đang vẽ...
                      </div>
                    )}
                  </div>
                  <div className="no-print" style={{ display: "flex", gap: 8 }}>
                    <button
                      type="button"
                      className="wf-btn wf-btn-primary"
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => void handleGenerateImage(panel)}
                      disabled={generatingPanelId !== null}
                    >
                      Sinh ảnh AI
                    </button>
                    <button
                      type="button"
                      className="wf-btn"
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => void openAssetPicker(panel.id)}
                      disabled={generatingPanelId !== null}
                    >
                      Chọn ảnh
                    </button>
                  </div>
                </div>

                {/* 3. Right Side: Settings & Text Editing */}
                <div style={{ flex: "2 2 340px", display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Shot metadata row */}
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span className="muted" style={{ fontSize: 10 }}>Góc máy (Shot Type)</span>
                      <select
                        value={panel.shotType}
                        onChange={(e) => updatePanel(panel.id, { shotType: e.target.value })}
                        className="wf-select"
                        style={{ width: "100%" }}
                      >
                        {SHOT_TYPES.map((st) => (
                          <option key={st.value} value={st.value}>
                            {st.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span className="muted" style={{ fontSize: 10 }}>Chuyển động camera</span>
                      <select
                        value={panel.cameraMovement}
                        onChange={(e) => updatePanel(panel.id, { cameraMovement: e.target.value })}
                        className="wf-select"
                        style={{ width: "100%" }}
                      >
                        {CAMERA_MOVEMENTS.map((cm) => (
                          <option key={cm.value} value={cm.value}>
                            {cm.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span className="muted" style={{ fontSize: 10 }}>Thời lượng (s)</span>
                      <input
                        type="number"
                        min={1}
                        max={30}
                        value={panel.duration}
                        onChange={(e) => updatePanel(panel.id, { duration: Number(e.target.value) })}
                        className="wf-input"
                        style={{ width: "100%" }}
                      />
                    </label>
                  </div>

                  {/* AI Prompt */}
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span className="muted" style={{ fontSize: 10 }}>Mô tả hình ảnh (AI Prompt)</span>
                    <textarea
                      rows={2}
                      value={panel.prompt}
                      onChange={(e) => updatePanel(panel.id, { prompt: e.target.value })}
                      placeholder="Mô tả chi tiết ảnh để AI vẽ..."
                      className="wf-textarea"
                      style={{ fontSize: 12 }}
                    />
                  </label>

                  {/* Action / Subtitle */}
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span className="muted" style={{ fontSize: 10 }}>Thoại / Hành động (Subtitle / Action)</span>
                    <textarea
                      rows={2}
                      value={panel.action}
                      onChange={(e) => updatePanel(panel.id, { action: e.target.value })}
                      placeholder="Mô tả hành động của nhân vật, âm thanh hoặc lời thoại chính của cảnh..."
                      className="wf-textarea"
                      style={{ fontSize: 12 }}
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>

          {/* Add bottom button (No Print) */}
          <div className="no-print" style={{ display: "flex", justifyContent: "center", marginTop: 12, marginBottom: 40 }}>
            <button
              type="button"
              className="wf-btn wf-btn-primary"
              style={{ width: 220, justifyContent: "center", padding: "10px 0" }}
              onClick={handleAddPanel}
            >
              + Thêm phân cảnh mới
            </button>
          </div>
        </div>
      ) : (
        <div style={{ padding: 40, textAlign: "center" }}>
          <p className="muted">Chưa có bảng phân cảnh nào. Hãy tạo một bảng mới để bắt đầu!</p>
        </div>
      )}

      {/* Unified Project Asset Picker Modal */}
      {showAssetPicker && (
        <div className="wf-modal-overlay" style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.65)",
          backdropFilter: "blur(4px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
        }}>
          <div className="wf-panel-card" style={{
            width: 720,
            maxHeight: "85vh",
            display: "flex",
            flexDirection: "column",
            padding: 24,
            background: "rgba(20,24,35,0.9)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            boxShadow: "0 20px 40px rgba(0,0,0,0.5)",
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text)" }}>Chọn ảnh đã tạo trong dự án</h3>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ padding: "4px 8px", fontSize: 13 }}
                onClick={() => {
                  setShowAssetPicker(false);
                  setPickerTargetId(null);
                }}
              >
                ✕ Đóng
              </button>
            </div>
            {loadingAppImages ? (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 260 }}>
                <span>Đang tải danh sách ảnh...</span>
              </div>
            ) : appImages.length === 0 ? (
              <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: 260, flexDirection: "column", gap: 10 }}>
                <span className="muted">Chưa có ảnh nào được tạo từ các dự án.</span>
                <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>Hãy chạy workflow tạo ảnh trước!</span>
              </div>
            ) : (
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
                gap: 12,
                overflowY: "auto",
                flex: 1,
                padding: 4,
                maxHeight: "55vh"
              }}>
                {appImages.map((img, idx) => (
                  <div
                    key={idx}
                    className="wf-image-grid-item"
                    style={{
                      position: "relative",
                      aspectRatio: "1/1",
                      borderRadius: 10,
                      overflow: "hidden",
                      border: "1px solid rgba(255,255,255,0.05)",
                      background: "#0d1017",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onClick={() => handleSelectAsset(img)}
                  >
                    <img
                      src={mediaUrl(img.url)}
                      alt={img.name}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <div style={{
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      right: 0,
                      background: "rgba(0,0,0,0.65)",
                      padding: "4px 8px",
                      fontSize: 10,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      textAlign: "center"
                    }}>
                      {img.name}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
