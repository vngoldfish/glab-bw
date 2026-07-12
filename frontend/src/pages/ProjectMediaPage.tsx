import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchAllProjectAssets,
  deleteProjectAsset,
  normalizeFileUrl,
  type ProjectAsset,
} from "../api";
import { useUiDialog } from "../components/UiDialog";
import { NAV_ROUTES } from "../routes";
import { Trash2, Download, ExternalLink } from "lucide-react";

export default function ProjectMediaPage({ onError }: { onError: (msg: string) => void }) {
  const dialog = useUiDialog();
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [filterKind, setFilterKind] = useState<"all" | "image" | "video">("all");
  const [filterProject, setFilterProject] = useState<string>("all");
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetchAllProjectAssets("all", 500);
      setAssets(res.assets || []);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Extract unique projects from assets list for filtering
  const projectList = useMemo(() => {
    const map = new Map<string, string>();
    assets.forEach((a) => {
      const pid = (a as any).project_id;
      const pname = (a as any).project_name;
      if (pid && pname) {
        map.set(pid, pname);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [assets]);

  // Filter assets based on search query, kind, and project
  const filteredAssets = useMemo(() => {
    return assets.filter((a) => {
      // 1. Search Query
      const nameMatch = a.name.toLowerCase().includes(q.trim().toLowerCase());
      
      // 2. Kind
      const isVid = a.kind === "video" || /\.mp4($|\?)/i.test(a.url || a.name);
      const kindMatch =
        filterKind === "all" ||
        (filterKind === "video" && isVid) ||
        (filterKind === "image" && !isVid);

      // 3. Project ID
      const pid = (a as any).project_id;
      const projectMatch = filterProject === "all" || pid === filterProject;

      return nameMatch && kindMatch && projectMatch;
    });
  }, [assets, q, filterKind, filterProject]);

  const stats = useMemo(() => {
    const images = filteredAssets.filter((a) => a.kind === "image").length;
    const videos = filteredAssets.filter((a) => a.kind === "video").length;
    const total_bytes = filteredAssets.reduce((acc, curr) => acc + (curr.bytes || 0), 0);
    return {
      images,
      videos,
      total: filteredAssets.length,
      total_mb: roundToTwo(total_bytes / (1024 * 1024)),
    };
  }, [filteredAssets]);

  function roundToTwo(num: number) {
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  async function handleDelete(asset: ProjectAsset) {
    const pid = (asset as any).project_id;
    if (!pid || pid === "global") {
      void dialog.alert({
        title: "Không thể xóa",
        message: "Không thể xóa trực tiếp file hệ thống/thư viện chung qua giao diện này.",
      });
      return;
    }

    const ok = await dialog.confirm({
      title: "Xóa file?",
      message: `File "${asset.name}" thuộc dự án "${(asset as any).project_name}" sẽ bị xóa vĩnh viễn khỏi đĩa cứng.`,
      confirmLabel: "Xóa file",
      cancelLabel: "Hủy",
      tone: "danger",
    });

    if (!ok) return;

    try {
      await deleteProjectAsset(pid, asset.path);
      setAssets((prev) => prev.filter((a) => a.path !== asset.path));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="projects-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Media Tổng Hợp</h1>
          <span className="pill pill-purple">THƯ VIỆN</span>
          <span className="pill pill-green">{assets.length} file</span>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={loading}>
            {loading ? "…" : "Làm mới"}
          </button>
        </div>
      </header>

      <div className="projects-toolbar" style={{ margin: "0 0 16px 0", gap: 12 }}>
        <div className="search-box" style={{ flex: 1, minWidth: 200 }}>
          <input
            type="text"
            className="input"
            style={{ width: "100%" }}
            placeholder="Tìm kiếm theo tên file..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {/* Project Filter */}
          <select
            className="input select-project-filter"
            style={{ minWidth: 160, height: 34, padding: "0 8px", borderRadius: 8, background: "var(--bg-card)", border: "1px solid var(--border)" }}
            value={filterProject}
            onChange={(e) => setFilterProject(e.target.value)}
          >
            <option value="all">Tất cả dự án</option>
            {projectList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          {/* Kind Filter Tabs */}
          <div className="projects-tabs">
            {(
              [
                ["all", `Tất cả (${stats.total})`],
                ["image", `Ảnh (${stats.images})`],
                ["video", `Video (${stats.videos})`],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`projects-tab${filterKind === k ? " active" : ""}`}
                onClick={() => setFilterKind(k)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="projects-stats-row" style={{ display: "flex", gap: 24, marginBottom: 20, background: "var(--bg-card)", padding: 12, borderRadius: 12, border: "1px solid var(--border)" }}>
        <div className="projects-stat">
          <strong>{stats.total}</strong>
          <span>Tổng số file</span>
        </div>
        <div className="projects-stat">
          <strong>{stats.images}</strong>
          <span>Ảnh</span>
        </div>
        <div className="projects-stat">
          <strong>{stats.videos}</strong>
          <span>Video</span>
        </div>
        <div className="projects-stat">
          <strong>{stats.total_mb}</strong>
          <span>Dung lượng (MB)</span>
        </div>
      </div>

      {loading && assets.length === 0 ? (
        <div style={{ textAlign: "center", padding: "64px 0", color: "var(--muted)" }}>Đang tải thư viện media...</div>
      ) : (
        <div className="media-grid projects-media-grid">
          {filteredAssets.length === 0 && (
            <div className="projects-empty-media" style={{ gridColumn: "1 / -1", height: 200 }}>
              <p className="muted">Không tìm thấy file nào khớp với bộ lọc.</p>
            </div>
          )}
          {filteredAssets.map((a, ai) => {
            const isVid = a.kind === "video" || /\.mp4($|\?)/i.test(a.url || a.name);
            const url = normalizeFileUrl(a.url);
            const pid = (a as any).project_id;
            const pname = (a as any).project_name;
            return (
              <article key={`${a.path || a.url || a.name}-${ai}`} className="media-tile">
                <button
                  type="button"
                  className="media-tile-hit"
                  onClick={() => setLightbox(url)}
                  title="Phóng to"
                >
                  {isVid ? (
                    <video src={url} className="media-tile-media" muted preload="metadata" />
                  ) : (
                    <img src={url} alt={a.name} className="media-tile-media" loading="lazy" />
                  )}
                  <span className={`media-kind-badge${isVid ? " is-video" : ""}`}>
                    {isVid ? "VIDEO" : "IMAGE"}
                  </span>
                  
                  {pname && (
                    <span 
                      className="project-origin-badge" 
                      style={{
                        position: "absolute",
                        top: 8,
                        left: 8,
                        background: "rgba(0, 0, 0, 0.7)",
                        color: "#fff",
                        padding: "2px 6px",
                        borderRadius: 4,
                        fontSize: 9,
                        backdropFilter: "blur(4px)",
                        border: "1px solid rgba(255, 255, 255, 0.1)"
                      }}
                    >
                      📁 {pname}
                    </span>
                  )}
                </button>
                <div className="media-tile-body">
                  <div className="media-tile-name" title={a.name}>
                    {a.name}
                  </div>
                  <div className="muted media-tile-meta" style={{ display: "flex", justifyContent: "space-between" }}>
                    <span>{a.mb ?? 0} MB</span>
                    <span>
                      {a.mtime
                        ? new Date(a.mtime * 1000).toLocaleDateString("vi-VN")
                        : ""}
                    </span>
                  </div>
                  <div className="media-tile-actions" style={{ marginTop: 8 }}>
                    <a className="btn btn-ghost btn-sm" href={url} download target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <Download size={10} /> Tải
                    </a>
                    
                    {pid && pid !== "global" && (
                      <Link 
                        to={`${NAV_ROUTES.workflow}?project=${pid}`}
                        className="btn btn-ghost btn-sm"
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <ExternalLink size={10} /> Mở dự án
                      </Link>
                    )}

                    {pid && pid !== "global" && (
                      <button
                        type="button"
                        className="btn btn-ghost danger btn-sm"
                        onClick={() => handleDelete(a)}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: "auto" }}
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Lightbox Preview Modal */}
      {lightbox && (
        <div
          className="lightbox-overlay"
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.85)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ position: "relative", maxWidth: "90%", maxHeight: "90%" }} onClick={(e) => e.stopPropagation()}>
            {/\.mp4($|\?)/i.test(lightbox) ? (
              <video src={lightbox} controls autoPlay style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: 8 }} />
            ) : (
              <img src={lightbox} alt="" style={{ maxWidth: "100%", maxHeight: "80vh", borderRadius: 8, objectFit: "contain" }} />
            )}
            <button
              type="button"
              onClick={() => setLightbox(null)}
              style={{
                position: "absolute",
                top: -40,
                right: 0,
                background: "transparent",
                border: "none",
                color: "#fff",
                fontSize: 24,
                cursor: "pointer",
              }}
            >
              ✕ Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
