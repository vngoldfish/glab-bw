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
  type ProjectAsset,
  type ProjectMeta,
} from "../api";
import { NAV_ROUTES } from "../routes";

interface ProjectsPageProps {
  onError: (msg: string) => void;
}

export default function ProjectsPage({ onError }: ProjectsPageProps) {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [assetKind, setAssetKind] = useState<"all" | "image" | "video">("all");
  const [stats, setStats] = useState<{ images: number; videos: number; total: number; total_mb: number } | null>(
    null,
  );
  const [lightbox, setLightbox] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const list = await listProjects();
      setProjects(list);
      if (selectedId && !list.find((p) => p.id === selectedId)) {
        setSelectedId(list[0]?.id ?? null);
      } else if (!selectedId && list[0]) {
        setSelectedId(list[0].id);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [onError, selectedId]);

  const loadAssets = useCallback(async (id: string, kind: "all" | "image" | "video") => {
    try {
      const data = await fetchProjectAssets(id, kind === "all" ? undefined : kind);
      setAssets(data.assets);
      setStats(data.stats);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }, [onError]);

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

  return (
    <div className="projects-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Projects</h1>
          <span className="pill pill-purple">QUẢN LÝ</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()} disabled={loading}>
            Làm mới
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => navigate(NAV_ROUTES.workflow)}
          >
            Mở Workflow
          </button>
        </div>
      </header>

      <div className="projects-layout">
        <section className="panel-card" style={{ margin: 0, padding: 16 }}>
          <input
            placeholder="Tìm project…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: "100%", marginBottom: 12 }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: "70vh", overflow: "auto" }}>
            {filtered.length === 0 && <p className="muted">Chưa có project — tạo trong Workflow → 💾 Lưu</p>}
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
                  <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                    <div className="project-thumb">
                      {p.thumbnail ? (
                        <img src={normalizeFileUrl(String(p.thumbnail))} alt="" />
                      ) : (
                        <div className="muted" style={{ fontSize: 10, padding: 10, textAlign: "center" }}>
                          empty
                        </div>
                      )}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <strong style={{ fontSize: 13.5, letterSpacing: "-0.02em" }}>{p.name}</strong>
                      <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>
                        {p.node_count ?? 0} node · 🖼 {st?.images ?? 0} · ▶ {st?.videos ?? 0}
                        {st?.total_mb != null ? ` · ${st.total_mb} MB` : ""}
                      </div>
                      {p.updated_at ? (
                        <div className="muted" style={{ fontSize: 10, marginTop: 2 }}>
                          {new Date(p.updated_at * 1000).toLocaleString()}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="panel-card" style={{ margin: 0, padding: 14, minHeight: 400 }}>
          {!selected ? (
            <p className="muted">Chọn project bên trái</p>
          ) : (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ margin: 0 }}>{selected.name}</h2>
                  <p className="muted" style={{ margin: "6px 0 0", fontSize: 13 }}>
                    {selected.description || "—"} · folder{" "}
                    <code>G-Labs BW/projects/{selected.id}</code>
                  </p>
                  {stats && (
                    <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>
                      Media: {stats.images} ảnh · {stats.videos} video · {stats.total_mb} MB
                    </p>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => navigate(`${NAV_ROUTES.workflow}?project=${selected.id}`)}
                  >
                    Mở trong Workflow
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
                        await duplicateProject(selected.id);
                        await load();
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
                      const also = confirm(
                        "Xóa project?\nOK = xóa luôn file ảnh/video trong folder project\nCancel = hủy",
                      );
                      // confirm returns true/false - we need two-step
                      if (!also) return;
                      const delFiles = confirm("Xóa cả media trong folder project?");
                      try {
                        await deleteProjectFull(selected.id, delFiles);
                        setSelectedId(null);
                        await load();
                      } catch (e) {
                        onError(e instanceof Error ? e.message : String(e));
                      }
                    }}
                  >
                    Xóa project
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap", alignItems: "center" }}>
                <select value={assetKind} onChange={(e) => setAssetKind(e.target.value as "all" | "image" | "video")}>
                  <option value="all">Tất cả media</option>
                  <option value="image">Chỉ ảnh</option>
                  <option value="video">Chỉ video</option>
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => selectedId && void loadAssets(selectedId, assetKind)}
                >
                  Refresh media
                </button>
                <button
                  type="button"
                  className="btn btn-ghost danger btn-sm"
                  onClick={async () => {
                    if (!confirm("Xóa toàn bộ media trong project?")) return;
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

              <div className="media-grid">
                {assets.length === 0 && <p className="muted">Chưa có ảnh/video — chạy workflow với project này.</p>}
                {assets.map((a) => (
                  <div key={a.path} className="media-tile">
                    <button
                      type="button"
                      onClick={() => setLightbox(normalizeFileUrl(a.url))}
                      style={{
                        display: "block",
                        width: "100%",
                        padding: 0,
                        border: "none",
                        background: "#000",
                        cursor: "zoom-in",
                      }}
                    >
                      {a.kind === "video" ? (
                        <video src={normalizeFileUrl(a.url)} className="media-tile-media" muted />
                      ) : (
                        <img src={normalizeFileUrl(a.url)} alt={a.name} className="media-tile-media" />
                      )}
                    </button>
                    <div className="media-tile-body">
                      <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.name}>
                        {a.kind === "video" ? "▶ " : "🖼 "}
                        {a.name}
                      </div>
                      <div className="muted">{a.mb} MB</div>
                      <button
                        type="button"
                        className="btn btn-ghost danger btn-sm"
                        style={{ marginTop: 4, fontSize: 10, padding: "2px 6px" }}
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
                ))}
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
              style={{ maxWidth: "92vw", maxHeight: "90vh", borderRadius: 12 }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={lightbox}
              alt=""
              style={{ maxWidth: "92vw", maxHeight: "90vh", borderRadius: 12, objectFit: "contain" }}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}
