/**
 * MediaHistoryPanel — hiển thị ảnh/video đã tạo trước từ đĩa (không phụ thuộc localStorage)
 * Mặc định thu gọn, click nút mới mở ra — không che phần tạo ảnh/video.
 * Hỗ trợ phân trang để hiển thị mượt mà không bị tràn hay khuất phần dưới.
 * Hỗ trợ xóa vĩnh viễn file lỗi khỏi máy chủ bằng nút X màu đỏ ở góc phải trên.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { browseInsertMedia, deleteMediaFile } from "../api";
import type { ProjectAsset } from "../api";

interface Props {
  kind: "image" | "video";
  onSelect?: (asset: ProjectAsset) => void;
  selectLabel?: string;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(mtime: number) {
  const d = new Date(mtime * 1000);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "vừa xong";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} phút trước`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} giờ trước`;
  return d.toLocaleDateString("vi-VN");
}

export default function MediaHistoryPanel({ kind, onSelect, selectLabel }: Props) {
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(false);
  const actionLabel = selectLabel ?? (kind === "image" ? "Dùng ảnh này" : "Dùng video này");

  // Phân trang
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = kind === "image" ? 16 : 8;

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError("");
    try {
      const source = kind === "image" ? "flow_image" : "flow_video";
      const res = await browseInsertMedia({ source, kind });
      if (ctrl.signal.aborted) return;
      setAssets(res.assets ?? []);
      loadedRef.current = true;
    } catch (e) {
      if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [kind]);

  // Chỉ load khi user mở panel lần đầu
  useEffect(() => {
    if (open && !loadedRef.current) void load();
    return () => { if (!open) abortRef.current?.abort(); };
  }, [open, load]);

  // Cleanup khi unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  const filtered = assets.filter((a) =>
    search ? a.name.toLowerCase().includes(search.toLowerCase()) : true,
  );

  // Reset trang khi lọc hoặc load lại
  useEffect(() => {
    setCurrentPage(1);
  }, [search, assets]);

  // Xử lý xóa file khỏi máy chủ
  const handleDelete = async (e: React.MouseEvent, asset: ProjectAsset) => {
    e.stopPropagation();
    const ok = window.confirm(`Bạn có chắc chắn muốn xóa file "${asset.name}" khỏi máy chủ không? Hành động này sẽ xóa vĩnh viễn file trên đĩa cứng.`);
    if (!ok) return;

    try {
      await deleteMediaFile(asset.path);
      setAssets((prev) => prev.filter((a) => a.path !== asset.path));
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    }
  };

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginatedItems = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const label = kind === "image" ? "Ảnh đã tạo" : "Video đã tạo";
  const icon  = kind === "image" ? "🖼️" : "🎬";

  return (
    <div className="mhp-wrap">
      {/* ── Toggle bar ── */}
      <button
        className={`mhp-toggle${open ? " mhp-toggle--open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="mhp-toggle-left">
          <span className="mhp-icon">{icon}</span>
          <span className="mhp-label">{label}</span>
          {assets.length > 0 && (
            <span className="mhp-badge">{assets.length}</span>
          )}
          {loading && <span className="mhp-spinner" />}
        </span>
        <span className="mhp-chevron">{open ? "▲" : "▼"}</span>
      </button>

      {/* ── Nội dung thu gọn/mở ── */}
      {open && (
        <div className="mhp-body">
          {/* Toolbar */}
          <div className="mhp-toolbar">
            {assets.length > 6 && (
              <input
                type="search"
                className="mhp-search"
                placeholder="Tìm theo tên file..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
            <button
              className="mhp-refresh"
              onClick={load}
              disabled={loading}
              title="Tải lại danh sách"
            >
              {loading ? "⟳" : "↻ Làm mới"}
            </button>
          </div>

          {/* States */}
          {error && (
            <div className="mhp-error">
              ⚠️ {error}{" "}
              <button onClick={load} className="mhp-retry">Thử lại</button>
            </div>
          )}
          {loading && assets.length === 0 && (
            <div className="mhp-empty">Đang tải...</div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="mhp-empty">
              {assets.length === 0
                ? `Chưa có ${kind === "image" ? "ảnh" : "video"} nào. Tạo xong sẽ hiện ở đây.`
                : "Không tìm thấy kết quả."}
            </div>
          )}

          {/* Grid */}
          <div className={`mhp-grid${kind === "video" ? " mhp-grid--video" : ""}`}>
            {paginatedItems.map((asset) => (
              <div
                key={asset.url}
                className="mhp-item"
                onClick={() => setPreviewUrl(previewUrl === asset.url ? null : asset.url)}
              >
                {/* Nút X đỏ để xóa file */}
                <button
                  className="mhp-delete-btn"
                  onClick={(e) => handleDelete(e, asset)}
                  title="Xóa file khỏi máy chủ"
                  type="button"
                >
                  ✕
                </button>

                {kind === "image" ? (
                  <img
                    src={asset.url}
                    alt={asset.name}
                    className="mhp-thumb"
                    loading="lazy"
                  />
                ) : (
                  <div className="mhp-video-wrap">
                    {previewUrl === asset.url ? (
                      <video
                        src={asset.url}
                        controls
                        autoPlay
                        className="mhp-video-player"
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <>
                        <video
                          src={asset.url}
                          muted
                          preload="metadata"
                          className="mhp-thumb mhp-thumb--video"
                        />
                        <span className="mhp-play">▶</span>
                      </>
                    )}
                  </div>
                )}

                <div className="mhp-info">
                  <span className="mhp-name" title={asset.name}>{asset.name}</span>
                  <span className="mhp-meta">
                    {formatSize(asset.bytes ?? 0)} · {formatTime(asset.mtime ?? 0)}
                  </span>
                </div>

                {onSelect && (
                  <button
                    className="mhp-use-btn"
                    onClick={(e) => { e.stopPropagation(); onSelect(asset); }}
                  >
                    {actionLabel}
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="mhp-pagination">
              <button
                className="mhp-page-btn"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                type="button"
              >
                ◀ Trước
              </button>
              <span className="mhp-page-info">
                Trang <b>{currentPage}</b> / {totalPages}
              </span>
              <button
                className="mhp-page-btn"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                type="button"
              >
                Sau ▶
              </button>
            </div>
          )}
        </div>
      )}

      {/* Overlay preview cho ảnh */}
      {previewUrl && kind === "image" && (
        <div className="mhp-overlay" onClick={() => setPreviewUrl(null)}>
          <img src={previewUrl} alt="" className="mhp-overlay-img" />
          <button className="mhp-overlay-close" onClick={() => setPreviewUrl(null)}>✕</button>
        </div>
      )}
    </div>
  );
}
