import { useMemo, useRef, useState } from "react";
import { openOutputFolder, fetchAllProjectAssets, mediaUrl, type ProjectAsset } from "../api";
import { useReferenceLibrary } from "../referenceLibraryContext";
import {
  ensureUniqueRefName,
  isValidRefName,
  slugifyRefName,
} from "../referenceUtils";
import {
  REFERENCE_CATEGORIES,
  type NamedReference,
  type ReferenceCategory,
} from "../types";
import { useUiDialog } from "../components/UiDialog";

interface ReferenceLibraryPageProps {
  onError: (msg: string) => void;
}

const CATEGORY_COLORS: Record<ReferenceCategory, string> = {
  character: "ref-cat-character",
  scene: "ref-cat-scene",
  prop: "ref-cat-prop",
  other: "ref-cat-other",
};

function categoryLabel(value: ReferenceCategory): string {
  return REFERENCE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}

export default function ReferenceLibraryPage({ onError }: ReferenceLibraryPageProps) {
  const dialog = useUiDialog();
  const {
    library,
    folder,
    maxItems,
    loading,
    addReferences,
    addReferenceFromAppPath,
    updateReference,
    replaceImage,
    removeReference,
  } = useReferenceLibrary();
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ReferenceCategory | "all">("all");
  const [uploading, setUploading] = useState(false);
  const [showAppImagesModal, setShowAppImagesModal] = useState(false);
  const [appImages, setAppImages] = useState<ProjectAsset[]>([]);
  const [loadingAppImages, setLoadingAppImages] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const [replaceTargetId, setReplaceTargetId] = useState<string | null>(null);

  const categoryCounts = useMemo(() => {
    const counts: Record<ReferenceCategory, number> = {
      character: 0,
      scene: 0,
      prop: 0,
      other: 0,
    };
    library.forEach((item) => {
      counts[item.category] += 1;
    });
    return counts;
  }, [library]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return library.filter((item) => {
      if (categoryFilter !== "all" && item.category !== categoryFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.filePath.toLowerCase().includes(q)
      );
    });
  }, [library, search, categoryFilter]);

  async function handleUpload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    onError("");
    try {
      await addReferences(list);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
      setDragOver(false);
    }
  }

  async function handleSelectFromApp() {
    setShowAppImagesModal(true);
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

  async function handleImportAppImage(img: ProjectAsset) {
    setShowAppImagesModal(false);
    setUploading(true);
    try {
      const baseName = img.name.replace(/\.[^/.]+$/, "");
      await addReferenceFromAppPath(img.path, baseName, "other");
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function saveName(item: NamedReference, raw: string) {
    const next = slugifyRefName(raw);
    if (!isValidRefName(next)) {
      onError("Tên chỉ gồm chữ, số và _ — bắt đầu bằng chữ cái");
      return;
    }
    const unique = ensureUniqueRefName(next, library, item.id);
    if (unique === item.name) return;
    try {
      await updateReference(item.id, { name: unique });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  function onDropFiles(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (uploading || library.length >= maxItems) return;
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith("image/"));
    if (files.length > 0) void handleUpload(files);
  }

  return (
    <div className="flow-page ref-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Ảnh tham chiếu</h1>
          <span className="pill pill-purple">Dùng chung</span>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => openOutputFolder(folder).catch((err) => onError(String(err)))}
          >
            Mở thư mục
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || library.length >= maxItems}
          >
            {uploading ? "Đang tải..." : "+ Thêm ảnh máy tính"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSelectFromApp()}
            disabled={uploading || library.length >= maxItems}
          >
            + Chọn từ ảnh đã tạo
          </button>
        </div>
      </header>

      <div className="flow-stats">
        <div className="stat-chip accent">
          <span className="stat-value">{library.length}</span>
          <span className="stat-label">Tổng ảnh</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value">{maxItems - library.length}</span>
          <span className="stat-label">Còn trống</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value">{categoryCounts.character}</span>
          <span className="stat-label">Nhân vật</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value">{categoryCounts.scene}</span>
          <span className="stat-label">Cảnh</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value">{categoryCounts.prop}</span>
          <span className="stat-label">Đồ vật</span>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={async (e) => {
          const files = e.target.files;
          if (files) await handleUpload(files);
          e.target.value = "";
        }}
      />
      <input
        ref={replaceInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (file && replaceTargetId) {
            try {
              await replaceImage(replaceTargetId, file);
            } catch (err) {
              onError(err instanceof Error ? err.message : String(err));
            }
          }
          e.target.value = "";
          setReplaceTargetId(null);
        }}
      />

      <div className="ref-page-body">
        <aside className="ref-page-aside">
          <section className="ref-page-guide">
            <h3>Cách dùng</h3>
            <p>
              Đặt tên từng ảnh, gọi trong prompt bằng <code>@ten_anh</code>.
            </p>
            <div className="ref-page-example">
              <span className="ref-page-example-label">Ví dụ</span>
              <code>@nhan_vat_a đứng trong @canh_bien lúc hoàng hôn</code>
            </div>
            <ul className="ref-page-guide-list">
              <li>Dùng chung cho Flow Ảnh, Flow Video và model khác</li>
              <li>Tối đa 10 ảnh / prompt</li>
              <li>Lưu tại <code>data/{folder}</code></li>
            </ul>
          </section>

          <section
            className={[
              "ref-page-dropzone",
              dragOver ? "ref-page-dropzone--active" : "",
              uploading ? "ref-page-dropzone--busy" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploading && library.length < maxItems) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDropFiles}
            onClick={() => !uploading && library.length < maxItems && fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            role="button"
            tabIndex={0}
          >
            <div className="ref-page-dropzone-icon">↑</div>
            <strong>{uploading ? "Đang tải lên..." : "Kéo thả ảnh vào đây"}</strong>
            <span>hoặc bấm để chọn nhiều file</span>
            <small>PNG · JPG · WebP · tối đa 10MB/ảnh</small>
          </section>
        </aside>

        <main className="ref-page-main">
          <div className="ref-page-toolbar">
            <div className="ref-page-search">
              <span className="ref-page-search-icon" aria-hidden>⌕</span>
              <input
                type="search"
                placeholder="Tìm theo tên, nhãn..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="ref-page-filters">
              <button
                type="button"
                className={`ref-filter-chip${categoryFilter === "all" ? " active" : ""}`}
                onClick={() => setCategoryFilter("all")}
              >
                Tất cả
              </button>
              {REFERENCE_CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  className={`ref-filter-chip ${CATEGORY_COLORS[cat.value]}${categoryFilter === cat.value ? " active" : ""}`}
                  onClick={() => setCategoryFilter(cat.value)}
                >
                  {cat.label}
                  <span className="ref-filter-count">{categoryCounts[cat.value]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="ref-page-scroll">
            {loading ? (
              <div className="ref-page-state">
                <div className="ref-page-spinner" />
                <p>Đang tải thư viện...</p>
              </div>
            ) : library.length === 0 ? (
              <div className="ref-page-state ref-page-state--empty">
                <div className="ref-page-state-icon">▣</div>
                <h3>Chưa có ảnh tham chiếu</h3>
                <p>Thêm ảnh nhân vật, cảnh hoặc đồ vật để dùng lại trong mọi prompt.</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  + Thêm ảnh đầu tiên
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="ref-page-state">
                <p>Không tìm thấy ảnh phù hợp.</p>
                <button type="button" className="btn btn-ghost" onClick={() => setSearch("")}>
                  Xóa bộ lọc
                </button>
              </div>
            ) : (
              <div className="ref-page-grid">
                {filtered.map((item) => (
                  <article key={item.id} className="ref-gallery-card">
                    <div className="ref-gallery-media">
                      <img src={item.image} alt={item.label} loading="lazy" />
                      <span className={`ref-gallery-cat ${CATEGORY_COLORS[item.category]}`}>
                        {categoryLabel(item.category)}
                      </span>
                      <button
                        type="button"
                        className="ref-gallery-replace"
                        onClick={() => {
                          setReplaceTargetId(item.id);
                          replaceInputRef.current?.click();
                        }}
                      >
                        Đổi ảnh
                      </button>
                    </div>

                    <div className="ref-gallery-body">
                      <div className="ref-gallery-token">@{item.name}</div>
                      <label className="ref-gallery-field">
                        <span>Tên gọi</span>
                        <input
                          defaultValue={item.name}
                          key={`${item.id}-${item.name}`}
                          onBlur={(e) => saveName(item, e.target.value)}
                        />
                      </label>
                      <label className="ref-gallery-field">
                        <span>Nhãn</span>
                        <input
                          defaultValue={item.label}
                          key={`${item.id}-${item.label}`}
                          onBlur={(e) => {
                            const label = e.target.value.trim() || item.name;
                            if (label !== item.label) {
                              updateReference(item.id, { label }).catch((err) =>
                                onError(String(err)),
                              );
                            }
                          }}
                        />
                      </label>
                      <label className="ref-gallery-field">
                        <span>Loại</span>
                        <select
                          value={item.category}
                          onChange={(e) =>
                            updateReference(item.id, {
                              category: e.target.value as NamedReference["category"],
                            }).catch((err) => onError(String(err)))
                          }
                        >
                          {REFERENCE_CATEGORIES.map((cat) => (
                            <option key={cat.value} value={cat.value}>
                              {cat.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="ref-gallery-footer">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs ref-gallery-copy"
                        onClick={() => {
                          void navigator.clipboard.writeText(`@${item.name}`);
                        }}
                      >
                        Sao chép @{item.name}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs danger"
                        onClick={() => {
                          void (async () => {
                            const ok = await dialog.confirm({
                              title: "Xóa ảnh tham chiếu?",
                              message: `Ảnh @${item.name} sẽ bị xóa khỏi thư viện.`,
                              confirmLabel: "Xóa",
                              cancelLabel: "Hủy",
                              tone: "danger",
                            });
                            if (!ok) return;
                            removeReference(item.id).catch((err) => onError(String(err)));
                          })();
                        }}
                      >
                        Xóa
                      </button>
                    </div>
                  </article>
                ))}

                {library.length < maxItems && (
                  <button
                    type="button"
                    className="ref-gallery-add"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span className="ref-gallery-add-icon">+</span>
                    <span>Thêm ảnh</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </main>
      </div>

      {showAppImagesModal && (
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
                onClick={() => setShowAppImagesModal(false)}
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
                    onClick={() => void handleImportAppImage(img)}
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