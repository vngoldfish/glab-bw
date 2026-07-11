/**
 * MediaHistoryPanel — hiển thị ảnh/video đã tạo trước từ đĩa (không phụ thuộc localStorage)
 * Dùng API /api/video-editor/media-browse để quét file thực tế trên server.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { browseInsertMedia } from "../api";
import type { ProjectAsset } from "../api";

interface Props {
  kind: "image" | "video";
  /** Gọi khi user click chọn 1 media */
  onSelect?: (asset: ProjectAsset) => void;
  /** Nút action label, mặc định "Dùng ảnh này" / "Dùng video này" */
  selectLabel?: string;
  /** Compact mode — hiển thị grid nhỏ, không có header lớn */
  compact?: boolean;
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(mtime: number) {
  const d = new Date(mtime * 1000);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return "vừa xong";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} phút trước`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} giờ trước`;
  return d.toLocaleDateString("vi-VN");
}

export default function MediaHistoryPanel({
  kind,
  onSelect,
  selectLabel,
  compact = false,
}: Props) {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const actionLabel = selectLabel ?? (kind === "image" ? "Dùng ảnh này" : "Dùng video này");

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
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const filtered = assets.filter((a) =>
    search ? a.name.toLowerCase().includes(search.toLowerCase()) : true,
  );

  return (
    <div className={`media-history-panel${compact ? " media-history-panel--compact" : ""}`}>
      {!compact && (
        <div className="media-history-header">
          <span className="media-history-title">
            {kind === "image" ? "🖼️ Ảnh đã tạo" : "🎬 Video đã tạo"}
            <span className="media-history-count">{assets.length}</span>
          </span>
          <button
            className="btn-icon-sm"
            onClick={load}
            title="Làm mới"
            disabled={loading}
          >
            {loading ? "⟳" : "↻"}
          </button>
        </div>
      )}

      {compact && (
        <div className="media-history-toolbar">
          <span className="media-history-count-compact">
            {kind === "image" ? "Ảnh" : "Video"} đã tạo ({assets.length})
          </span>
          <button className="btn-icon-sm" onClick={load} title="Làm mới" disabled={loading}>
            {loading ? "⟳" : "↻"}
          </button>
        </div>
      )}

      {assets.length > 6 && (
        <div className="media-history-search">
          <input
            type="search"
            placeholder="Tìm theo tên file..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      {error && (
        <div className="media-history-error">
          ⚠️ {error}{" "}
          <button onClick={load} style={{ textDecoration: "underline", background: "none", border: "none", cursor: "pointer", color: "inherit" }}>
            Thử lại
          </button>
        </div>
      )}

      {loading && assets.length === 0 && (
        <div className="media-history-loading">Đang tải...</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="media-history-empty">
          {assets.length === 0
            ? `Chưa có ${kind === "image" ? "ảnh" : "video"} nào được tạo.`
            : "Không tìm thấy kết quả."}
        </div>
      )}

      <div className={`media-history-grid${kind === "video" ? " media-history-grid--video" : ""}`}>
        {filtered.map((asset) => (
          <div
            key={asset.url}
            className="media-history-item"
            onClick={() => setPreviewUrl(previewUrl === asset.url ? null : asset.url)}
          >
            {kind === "image" ? (
              <img
                src={asset.url}
                alt={asset.name}
                className="media-history-thumb"
                loading="lazy"
              />
            ) : (
              <div className="media-history-video-thumb">
                {previewUrl === asset.url ? (
                  <video
                    src={asset.url}
                    controls
                    autoPlay
                    className="media-history-video-player"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <video
                    src={asset.url}
                    muted
                    preload="metadata"
                    className="media-history-thumb media-history-thumb--video"
                  />
                )}
                <span className="media-history-play-icon">▶</span>
              </div>
            )}

            <div className="media-history-item-info">
              <span className="media-history-item-name" title={asset.name}>
                {asset.name}
              </span>
              <span className="media-history-item-meta">
                {formatSize(asset.bytes ?? 0)} · {formatTime(asset.mtime ?? 0)}
              </span>
            </div>

            {onSelect && (
              <button
                className="media-history-item-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(asset);
                }}
                title={actionLabel}
              >
                {actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Full-screen preview overlay */}
      {previewUrl && kind === "image" && (
        <div
          className="media-history-overlay"
          onClick={() => setPreviewUrl(null)}
        >
          <img src={previewUrl} alt="" className="media-history-overlay-img" />
          <button className="media-history-overlay-close" onClick={() => setPreviewUrl(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
