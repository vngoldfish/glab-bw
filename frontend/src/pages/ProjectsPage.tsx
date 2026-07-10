import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  clearProjectAssets,
  deleteProjectAsset,
  deleteProjectFull,
  duplicateProject,
  fetchProjectAssets,
  listProjects,
  normalizeFileUrl,
  openProjectFolder,
  saveProject,
  type ProjectAsset,
  type ProjectMeta,
} from "../api";
import { NAV_ROUTES } from "../routes";

interface ProjectsPageProps {
  onError: (msg: string) => void;
}

function isVideo(a: ProjectAsset) {
  return a.kind === "video" || /\.mp4($|\?)/i.test(a.url || a.name);
}

export default function ProjectsPage({ onError }: ProjectsPageProps) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [assetKind, setAssetKind] = useState<"image" | "video">("image");
  const [stats, setStats] = useState<{
    images: number;
    videos: number;
    total: number;
    total_mb: number;
  } | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const list = await listProjects();
      setProjects(list);
      setSelectedId((prev) => {
        if (prev && list.find((p) => p.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const loadAssets = useCallback(
    async (id: string, kind: "image" | "video") => {
      try {
        const data = await fetchProjectAssets(id, kind);
        // Mới nhất trên, cũ dưới
        const sorted = [...data.assets].sort(
          (a, b) => Number(b.mtime || 0) - Number(a.mtime || 0),
        );
        setAssets(sorted);
        setStats(data.stats);
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    },
    [onError],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedId) void loadAssets(selectedId, assetKind);
    else {
      setAssets([]);
      setStats(null);
    }
  }, [selectedId, assetKind, loadAssets]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.description || "").toLowerCase().includes(needle),
    );
  }, [projects, q]);

  const selected = projects.find((p) => p.id === selectedId) || null;

  const imageCount = assets.filter((a) => !isVideo(a)).length;
  const videoCount = assets.filter((a) => isVideo(a)).length;

  async function handleCreate() {
    const name = newName.trim() || `Project ${new Date().toLocaleDateString("vi-VN")}`;
    try {
      setCreating(true);
      const doc = await saveProject({
        name,
        description: "",
        nodes: [],
        edges: [],
      });
      setNewName("");
      await load();
      setSelectedId(doc.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="projects-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Quản lý Project</h1>
          <span className="pill pill-purple">MEDIA</span>
          <span className="pill pill-green">{projects.length} project</span>
        </div>
        <div className="page-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={loading}>
            {loading ? "…" : "Làm mới"}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate(NAV_ROUTES.workflow)}>
            Mở Workflow
          </button>
        </div>
      </header>

      <div className="projects-layout">
        {/* LEFT: project list */}
        <section className="panel-card projects-sidebar" style={{ margin: 0, padding: 16 }}>
          <div className="projects-create-row">
            <input
              placeholder="Tên project mới…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
              }}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={creating}
              onClick={() => void handleCreate()}
            >
              + Tạo
            </button>
          </div>
          <input
            className="projects-search"
            placeholder="Tìm project…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="projects-list-scroll">
            {filtered.length === 0 && (
              <p className="muted" style={{ fontSize: 13 }}>
                Chưa có project. Tạo mới hoặc lưu từ Workflow.
              </p>
            )}
            {filtered.map((p) => {
              const st = p.asset_stats;
              const active = p.id === selectedId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`project-list-item${active ? " active" : ""}`}
                >
                  <div className="project-list-row">
                    <div className="project-thumb">
                      {p.thumbnail ? (
                        <img src={normalizeFileUrl(String(p.thumbnail))} alt="" />
                      ) : (
                        <div className="project-thumb-empty">📁</div>
                      )}
                    </div>
                    <div className="project-list-meta">
                      <strong>{p.name}</strong>
                      <span className="muted">
                        {p.node_count ?? 0} node · 🖼 {st?.images ?? 0} · ▶ {st?.videos ?? 0}
                        {st?.total_mb != null ? ` · ${st.total_mb} MB` : ""}
                      </span>
                      {p.updated_at ? (
                        <span className="muted project-list-date">
                          {new Date(p.updated_at * 1000).toLocaleString("vi-VN")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* RIGHT: detail + gallery */}
        <section className="panel-card projects-detail" style={{ margin: 0, padding: 18 }}>
          {!selected ? (
            <div className="projects-empty-state">
              <div className="projects-empty-icon">▤</div>
              <h2>Chọn project</h2>
              <p className="muted">Xem và quản lý ảnh / video đầu ra của từng project.</p>
            </div>
          ) : (
            <>
              <div className="projects-detail-head">
                <div>
                  <h2>{selected.name}</h2>
                  <p className="muted projects-detail-sub">
                    {selected.description || "Không có mô tả"}
                    <br />
                    <code>G-Labs BW/projects/{selected.id}</code>
                  </p>
                </div>
                <div className="projects-detail-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => navigate(`${NAV_ROUTES.workflow}?project=${selected.id}`)}
                  >
                    Mở Workflow
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void openProjectFolder(selected.id).catch((e) => onError(String(e)))}
                  >
                    Mở folder
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      try {
                        const doc = await duplicateProject(selected.id);
                        await load();
                        setSelectedId(doc.id);
                      } catch (e) {
                        onError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Nhân bản
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost danger btn-sm"
                    onClick={async () => {
                      if (!confirm(`Xóa project “${selected.name}”?`)) return;
                      const delFiles = confirm("Xóa luôn ảnh/video trong folder project?");
                      try {
                        await deleteProjectFull(selected.id, delFiles);
                        setSelectedId(null);
                        await load();
                      } catch (e) {
                        onError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Xóa
                  </button>
                </div>
              </div>

              <div className="projects-stat-row">
                <div className="projects-stat">
                  <strong>{stats?.images ?? imageCount}</strong>
                  <span>Ảnh</span>
                </div>
                <div className="projects-stat">
                  <strong>{stats?.videos ?? videoCount}</strong>
                  <span>Video</span>
                </div>
                <div className="projects-stat">
                  <strong>{stats?.total_mb ?? 0}</strong>
                  <span>MB</span>
                </div>
                <div className="projects-stat">
                  <strong>{selected.node_count ?? 0}</strong>
                  <span>Node</span>
                </div>
              </div>

              <div className="projects-toolbar">
                <div className="projects-tabs">
                  {(
                    [
                      ["image", `Ảnh${stats?.images != null ? ` (${stats.images})` : ""}`],
                      ["video", `Video${stats?.videos != null ? ` (${stats.videos})` : ""}`],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className={`projects-tab${assetKind === k ? " active" : ""}`}
                      onClick={() => setAssetKind(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => selectedId && void loadAssets(selectedId, assetKind)}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost danger btn-sm"
                    onClick={async () => {
                      if (!confirm("Xóa toàn bộ media trong project này?")) return;
                      try {
                        await clearProjectAssets(selected.id, "all");
                        await loadAssets(selected.id, assetKind);
                        await load();
                      } catch (e) {
                        onError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Dọn media
                  </button>
                </div>
              </div>

              <div className="media-grid projects-media-grid">
                {assets.length === 0 && (
                  <div className="projects-empty-media">
                    <p className="muted">
                      {assetKind === "video" ? "Chưa có video." : "Chưa có ảnh."}
                      <br />
                      Mở Workflow → chạy gen → file sẽ hiện tại đây (mới trên · cũ dưới).
                    </p>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => navigate(`${NAV_ROUTES.workflow}?project=${selected.id}`)}
                    >
                      Chạy workflow
                    </button>
                  </div>
                )}
                {assets.map((a, ai) => {
                  const video = isVideo(a);
                  const url = normalizeFileUrl(a.url);
                  return (
                    <article key={`${a.path || a.url || a.name}-${ai}`} className="media-tile">
                      <button
                        type="button"
                        className="media-tile-hit"
                        onClick={() => setLightbox(url)}
                        title="Phóng to"
                      >
                        {video ? (
                          <video src={url} className="media-tile-media" muted preload="metadata" />
                        ) : (
                          <img src={url} alt={a.name} className="media-tile-media" loading="lazy" />
                        )}
                        <span className={`media-kind-badge${video ? " is-video" : ""}`}>
                          {video ? "VIDEO" : "IMAGE"}
                        </span>
                      </button>
                      <div className="media-tile-body">
                        <div className="media-tile-name" title={a.name}>
                          {a.name}
                        </div>
                        <div className="muted media-tile-meta">
                          {a.mb ?? 0} MB
                          {a.mtime
                            ? ` · ${new Date(a.mtime * 1000).toLocaleDateString("vi-VN")}`
                            : ""}
                        </div>
                        <div className="media-tile-actions">
                          <a className="btn btn-ghost btn-sm" href={url} download target="_blank" rel="noreferrer">
                            Tải
                          </a>
                          <button
                            type="button"
                            className="btn btn-ghost danger btn-sm"
                            onClick={async () => {
                              if (!confirm("Xóa file này?")) return;
                              try {
                                await deleteProjectAsset(selected.id, a.path);
                                await loadAssets(selected.id, assetKind);
                                await load();
                              } catch (e) {
                                onError(e instanceof Error ? e.message : String(e));
                              }
                            }}
                          >
                            Xóa
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>

      {lightbox && (
        <div role="dialog" className="ui-lightbox" onClick={() => setLightbox(null)}>
          {/\.mp4($|\?)/i.test(lightbox) ? (
            <video
              src={lightbox}
              controls
              autoPlay
              style={{ maxWidth: "92vw", maxHeight: "90vh", borderRadius: 14 }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={lightbox}
              alt=""
              style={{
                maxWidth: "92vw",
                maxHeight: "90vh",
                borderRadius: 14,
                objectFit: "contain",
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              }}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}
