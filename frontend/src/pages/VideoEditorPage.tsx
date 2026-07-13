/**
 * Dựng phim:
 * 1) Mặc định = danh sách quản lý project dựng
 * 2) Vào project → ghép video (pick → order → preview → export)
 *
 * Edit project riêng; insert từ Workflow | Flow Video | Flow Ảnh
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from "react";
import { Link } from "react-router-dom";
import {
  assembleVideoClips,
  browseInsertMedia,
  deleteEditProject,
  fetchEditProject,
  fetchMediaSources,
  fetchVideoEditorStatus,
  listEditProjects,
  mediaUrl,
  openOutputFolder,
  saveEditProject,
  type EditProjectMeta,
  type MediaInsertSource,
  type ProjectAsset,
  type VideoAssembleResult,
} from "../api";
import { Folder } from "lucide-react";
import { useUiDialog } from "../components/UiDialog";
import { NAV_ROUTES } from "../routes";

interface Clip {
  id: string;
  path: string;
  url: string;
  name: string;
  duration: number | null;
}

interface VideoEditorPageProps {
  onError: (msg: string) => void;
}

function fmt(sec?: number | null) {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
}

let _n = 1;
const nid = () => `c_${Date.now().toString(36)}_${_n++}`;
const LS_EDIT = "glab-bw-edit-project";
const LS_SRC = "glab-bw-insert-source";
const LS_WF = "glab-bw-insert-workflow";

const SOURCE_TABS: Array<{ id: MediaInsertSource; label: string; hint: string }> = [
  { id: "all", label: "Xem tất cả", hint: "Tất cả ảnh & video từ mọi nguồn" },
  { id: "workflow", label: "Project Workflow", hint: "Video gen trong workflow" },
  { id: "flow_video", label: "Flow Video", hint: "video_output" },
  { id: "flow_image", label: "Flow Ảnh", hint: "image_output (xem; ghép cần video)" },
];

function fmtDate(ts?: number) {
  if (!ts || !Number.isFinite(ts)) return "—";
  try {
    return new Date(ts * (ts < 1e12 ? 1000 : 1)).toLocaleString("vi-VN", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

export default function VideoEditorPage({ onError }: VideoEditorPageProps) {
  const dialog = useUiDialog();
  const [ready, setReady] = useState<boolean | null>(null);
  /** list = quản lý project (mặc định); editor = ghép video trong 1 project */
  const [view, setView] = useState<"list" | "editor">("list");
  const [listLoading, setListLoading] = useState(true);
  const [listQ, setListQ] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  // Edit project (dựng video) — riêng
  const [editProjects, setEditProjects] = useState<EditProjectMeta[]>([]);
  const [editId, setEditId] = useState("");
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);

  // Insert picker sources
  const [pickerOpen, setPickerOpen] = useState(false);
  const [insertSource, setInsertSource] = useState<MediaInsertSource>("all");
  const [wfProjects, setWfProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [wfProjectId, setWfProjectId] = useState("");
  const [bin, setBin] = useState<ProjectAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");

  const [clips, setClips] = useState<Clip[]>([]);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<VideoAssembleResult | null>(null);
  const [filename, setFilename] = useState("");

  // preview
  const [playing, setPlaying] = useState(false);
  const [clipIdx, setClipIdx] = useState(0);
  const [masterTime, setMasterTime] = useState(0);
  const [status, setStatus] = useState("Tạo / chọn project dựng · thêm video");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playingRef = useRef(false);
  const idxRef = useRef(0);
  const seekingRef = useRef(false);
  const clipsRef = useRef(clips);
  clipsRef.current = clips;
  const skipSaveRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const layout = useMemo(() => {
    let t = 0;
    return clips.map((c) => {
      const dur = c.duration && c.duration > 0 ? c.duration : 3;
      const start = t;
      t += dur;
      return { id: c.id, start, duration: dur, end: t };
    });
  }, [clips]);

  const totalEst = useMemo(
    () => (layout.length ? layout[layout.length - 1].end : 0),
    [layout],
  );
  const totalSafe = Math.max(totalEst, 0.1);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = bin;
    // Stitcher only adds videos — hide images in list unless flow_image or all (show all for browse)
    if (insertSource !== "flow_image" && insertSource !== "all") {
      list = list.filter((a) => a.kind === "video" || /\.(mp4|webm|mov|mkv)$/i.test(a.name || ""));
    }
    if (!needle) return list;
    return list.filter((a) => (a.name || "").toLowerCase().includes(needle));
  }, [bin, q, insertSource]);

  const videoPickable = useMemo(
    () =>
      filtered.filter(
        (a) => a.kind === "video" || /\.(mp4|webm|mov|mkv)$/i.test(a.name || ""),
      ),
    [filtered],
  );

  const refreshEditList = useCallback(async () => {
    const list = await listEditProjects();
    setEditProjects(list);
    return list;
  }, []);

  const listFiltered = useMemo(() => {
    const needle = listQ.trim().toLowerCase();
    if (!needle) return editProjects;
    return editProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(needle) ||
        (p.description || "").toLowerCase().includes(needle) ||
        (p.last_export_name || "").toLowerCase().includes(needle),
    );
  }, [editProjects, listQ]);

  // Boot — chỉ load danh sách, không tự vào editor
  useEffect(() => {
    void (async () => {
      try {
        const st = await fetchVideoEditorStatus();
        setReady(st.ready);
      } catch {
        setReady(false);
      }

      try {
        const sources = await fetchMediaSources();
        setWfProjects(sources.workflow_projects || []);
        const lastWf = localStorage.getItem(LS_WF) || "";
        const wfIds = (sources.workflow_projects || []).map((p) => p.id);
        setWfProjectId(
          (lastWf && wfIds.includes(lastWf) ? lastWf : wfIds[0]) || "",
        );
        const lastSrc = localStorage.getItem(LS_SRC) as MediaInsertSource | null;
        if (lastSrc && ["workflow", "flow_video", "flow_image"].includes(lastSrc)) {
          setInsertSource(lastSrc);
        }
      } catch {
        /* */
      }

      try {
        setListLoading(true);
        await refreshEditList();
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setListLoading(false);
      }
    })();
  }, [onError, refreshEditList]);

  useEffect(() => {
    if (editId && view === "editor") localStorage.setItem(LS_EDIT, editId);
  }, [editId, view]);

  useEffect(() => {
    localStorage.setItem(LS_SRC, insertSource);
  }, [insertSource]);

  useEffect(() => {
    if (wfProjectId) localStorage.setItem(LS_WF, wfProjectId);
  }, [wfProjectId]);

  async function loadEdit(
    id: string,
    opts?: { skipList?: boolean; list?: EditProjectMeta[] },
  ) {
    skipSaveRef.current = true;
    try {
      const doc = await fetchEditProject(id);
      setEditId(doc.id);
      setEditName(doc.name || "");
      setFilename(doc.filename || "");
      const loaded: Clip[] = (doc.clips || []).map((c) => ({
        id: c.id || nid(),
        path: c.path || "",
        url: mediaUrl(c.url || c.path || ""),
        name: c.name || "clip",
        duration: c.duration ?? null,
      }));
      setClips(loaded);
      setResult(
        doc.last_export && typeof doc.last_export === "object" && "url" in doc.last_export
          ? (doc.last_export as VideoAssembleResult)
          : null,
      );
      stopPreview();
      setMasterTime(0);
      setClipIdx(0);
      idxRef.current = 0;
      setStatus(
        loaded.length
          ? `${loaded.length} clip · bấm ▶ Xem thử`
          : "Thêm video từ Workflow / Flow Video",
      );
      if (!opts?.skipList) await refreshEditList();
      else if (opts.list) setEditProjects(opts.list);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      // allow saves after paint
      setTimeout(() => {
        skipSaveRef.current = false;
      }, 80);
    }
  }

  // Autosave clips/name into edit project (chỉ khi đang trong editor)
  useEffect(() => {
    if (view !== "editor" || !editId || skipSaveRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void (async () => {
        try {
          setSaving(true);
          await saveEditProject(
            {
              name: editName || "Dựng video",
              clips: clips.map((c) => ({
                id: c.id,
                path: c.path,
                url: c.url,
                name: c.name,
                duration: c.duration,
              })),
              filename,
            },
            editId,
          );
          setEditProjects((prev) =>
            prev.map((p) =>
              p.id === editId
                ? { ...p, name: editName || p.name, clip_count: clips.length }
                : p,
            ),
          );
        } catch {
          /* silent autosave */
        } finally {
          setSaving(false);
        }
      })();
    }, 600);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [view, editId, editName, clips, filename]);

  const loadBin = useCallback(async () => {
    setLoading(true);
    try {
      if (insertSource === "workflow") {
        if (!wfProjectId) {
          setBin([]);
          return;
        }
        const data = await browseInsertMedia({
          source: "workflow",
          workflow_project_id: wfProjectId,
          kind: "video",
        });
        setBin(data.assets || []);
      } else if (insertSource === "flow_video") {
        const data = await browseInsertMedia({ source: "flow_video", kind: "video" });
        setBin(data.assets || []);
      } else if (insertSource === "flow_image") {
        const data = await browseInsertMedia({ source: "flow_image", kind: "image" });
        setBin(data.assets || []);
      } else if (insertSource === "all") {
        const data = await browseInsertMedia({ source: "all", kind: "all" });
        setBin(data.assets || []);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setBin([]);
    } finally {
      setLoading(false);
    }
  }, [insertSource, wfProjectId, onError]);

  useEffect(() => {
    if (pickerOpen) void loadBin();
  }, [pickerOpen, loadBin]);

  function openPicker() {
    if (!editId) {
      onError("Tạo project dựng video trước");
      return;
    }
    setPickerOpen(true);
    setPicked(new Set());
    setQ("");
  }

  function toggle(key: string) {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  }

  function toClip(a: ProjectAsset): Clip {
    return {
      id: nid(),
      path: a.path || "",
      url: mediaUrl(a.url),
      name: a.name || "clip",
      duration: null,
    };
  }

  function isVideoAsset(a: ProjectAsset) {
    return a.kind === "video" || /\.(mp4|webm|mov|mkv)$/i.test(a.name || "");
  }

  function addList(list: ProjectAsset[]) {
    const videos = list.filter(isVideoAsset);
    if (!videos.length) {
      onError("Chỉ ghép được file video (mp4/webm/mov). Ảnh chỉ xem trong Flow Ảnh.");
      return;
    }
    const ordered = videos.slice().reverse();
    setClips((c) => [...c, ...ordered.map(toClip)]);
    setResult(null);
    setStatus(`Đã thêm ${videos.length} clip · bấm ▶ Xem thử`);
  }

  function insertPicked() {
    const list = filtered.filter((a) => picked.has(a.path || a.url));
    if (!list.length) {
      onError("Tick chọn video rồi bấm Thêm vào danh sách");
      return;
    }
    addList(list);
    setPickerOpen(false);
    setPicked(new Set());
  }

  function insertAllVideos() {
    if (!videoPickable.length) {
      onError(
        insertSource === "flow_image"
          ? "Flow Ảnh không có video — chuyển tab Flow Video hoặc Project Workflow"
          : "Không có video trong nguồn này",
      );
      return;
    }
    addList(videoPickable);
    setPickerOpen(false);
  }

  function move(id: string, dir: -1 | 1) {
    setClips((list) => {
      const i = list.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= list.length) return list;
      const n = list.slice();
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
    setResult(null);
    stopPreview();
  }

  function remove(id: string) {
    setClips((c) => c.filter((x) => x.id !== id));
    setResult(null);
    stopPreview();
  }

  async function clearList() {
    if (!clips.length) return;
    const ok = await dialog.confirm({
      title: "Xóa hết danh sách?",
      message: "Toàn bộ clip trong project dựng sẽ bị gỡ khỏi danh sách ghép (file gốc vẫn giữ).",
      confirmLabel: "Xóa hết",
      cancelLabel: "Giữ lại",
      tone: "danger",
    });
    if (!ok) return;
    setClips([]);
    setResult(null);
    stopPreview();
    setStatus("Thêm video từ Workflow / Flow Video");
  }

  function stopPreview() {
    playingRef.current = false;
    setPlaying(false);
    const v = videoRef.current;
    if (v) v.pause();
  }

  async function loadIndex(i: number, autoplay: boolean, localTime = 0) {
    const list = clipsRef.current;
    const v = videoRef.current;
    if (!v || !list[i]) return;
    const c = list[i];
    idxRef.current = i;
    setClipIdx(i);
    setStatus(`${i + 1}/${list.length} · ${c.name}`);
    const src = mediaUrl(c.url);
    if (v.getAttribute("data-id") !== c.id) {
      v.setAttribute("data-id", c.id);
      v.src = src;
      v.load();
      await new Promise<void>((resolve) => {
        const done = () => {
          v.removeEventListener("loadeddata", done);
          v.removeEventListener("error", done);
          resolve();
        };
        v.addEventListener("loadeddata", done);
        v.addEventListener("error", done);
        setTimeout(done, 4000);
      });
    }
    try {
      const target = Math.max(0, localTime);
      if (Math.abs(v.currentTime - target) > 0.12) {
        v.currentTime = target;
      }
    } catch {
      /* */
    }
    const start = layout[i]?.start ?? 0;
    setMasterTime(start + Math.max(0, localTime));

    if (autoplay && playingRef.current) {
      await v.play().catch(() => undefined);
    }
  }

  function seekMaster(t: number) {
    const list = clipsRef.current;
    if (!list.length) return;
    const total = totalSafeRef.current;
    const nt = Math.max(0, Math.min(total - 0.05, t));
    setMasterTime(nt);

    let acc = 0;
    let idx = 0;
    let local = 0;
    for (let i = 0; i < list.length; i++) {
      const dur = list[i].duration && list[i].duration! > 0 ? list[i].duration! : 3;
      if (nt < acc + dur || i === list.length - 1) {
        idx = i;
        local = Math.max(0, nt - acc);
        local = Math.min(local, Math.max(0, dur - 0.05));
        break;
      }
      acc += dur;
    }
    void loadIndex(idx, playingRef.current, local);
  }

  const masterTimeRef = useRef(0);
  masterTimeRef.current = masterTime;
  const totalSafeRef = useRef(totalSafe);
  totalSafeRef.current = totalSafe;

  function togglePlay() {
    if (!clipsRef.current.length) {
      onError("Chưa có video trong danh sách");
      return;
    }
    if (playingRef.current) {
      stopPreview();
      return;
    }
    if (masterTimeRef.current >= totalSafeRef.current - 0.15) {
      setMasterTime(0);
      idxRef.current = 0;
    }
    playingRef.current = true;
    setPlaying(true);
    const len = clipsRef.current.length;
    void loadIndex(idxRef.current < len ? idxRef.current : 0, true);
  }

  const togglePlayRef = useRef(togglePlay);
  togglePlayRef.current = togglePlay;

  function onTimeUpdate() {
    if (seekingRef.current) return;
    const v = videoRef.current;
    const list = clipsRef.current;
    if (!v || !list.length) return;
    const i = idxRef.current;
    const start = layout[i]?.start ?? 0;
    setMasterTime(start + (v.currentTime || 0));
  }

  function onEnded() {
    if (!playingRef.current) return;
    const next = idxRef.current + 1;
    if (next >= clipsRef.current.length) {
      stopPreview();
      setMasterTime(totalSafeRef.current);
      setStatus("Hết danh sách · ổn thì bấm Xuất");
      return;
    }
    void loadIndex(next, true, 0);
  }

  function onMeta(e: SyntheticEvent<HTMLVideoElement>, id: string) {
    const d = e.currentTarget.duration;
    if (d && Number.isFinite(d)) {
      setClips((list) =>
        list.map((c) => (c.id === id && !c.duration ? { ...c, duration: d } : c)),
      );
    }
  }

  async function handleExport() {
    if (!clips.length) {
      onError("Thêm video trước khi xuất");
      return;
    }
    if (!editId) {
      onError("Chọn project dựng video");
      return;
    }
    if (ready === false) {
      onError("Cần ffmpeg để xuất (brew install ffmpeg)");
      return;
    }
    stopPreview();
    setExporting(true);
    setResult(null);
    try {
      const res = await assembleVideoClips({
        clips: clips.map((c) => ({
          path: c.path || undefined,
          url: c.url,
          title: c.name,
        })),
        edit_project_id: editId,
        filename: filename.trim() || null,
      });
      setResult(res);
      setStatus(`Đã xuất: ${res.name}`);
      await refreshEditList();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  async function openProject(id: string) {
    await loadEdit(id);
    setView("editor");
  }

  function backToList() {
    stopPreview();
    setPickerOpen(false);
    setView("list");
    setEditId("");
    setEditName("");
    setClips([]);
    setResult(null);
    setFilename("");
    setStatus("Chọn project để dựng");
    void refreshEditList();
  }

  async function handleCreateFromList(openAfter = true) {
    const name =
      newName.trim() ||
      `Dựng ${editProjects.length + 1} · ${new Date().toLocaleDateString("vi-VN")}`;
    try {
      setCreating(true);
      const doc = await saveEditProject({ name, clips: [] });
      setNewName("");
      await refreshEditList();
      if (openAfter) await openProject(doc.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleRenameProject(id: string, current: string) {
    const name = await dialog.prompt({
      title: "Đổi tên project",
      message: "Tên hiển thị trong danh sách dựng phim",
      defaultValue: current,
      placeholder: "Tên project…",
      confirmLabel: "Lưu tên",
      cancelLabel: "Hủy",
    });
    if (name == null || !name.trim()) return;
    try {
      // Chỉ đổi tên — không gửi clips để backend giữ nguyên danh sách
      await saveEditProject({ name: name.trim() }, id);
      if (id === editId) setEditName(name.trim());
      await refreshEditList();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDeleteFromList(id: string, name: string) {
    const ok = await dialog.confirm({
      title: "Xóa project dựng?",
      message: `“${name}” sẽ bị xóa khỏi danh sách.\nFile export trong video_edits vẫn được giữ trên đĩa.`,
      confirmLabel: "Xóa project",
      cancelLabel: "Hủy",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await deleteEditProject(id, false);
      if (editId === id) {
        stopPreview();
        setView("list");
        setEditId("");
        setClips([]);
        setResult(null);
      }
      await refreshEditList();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (!pickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  useEffect(() => {
    if (view !== "editor") return;
    const onKey = (e: KeyboardEvent) => {
      if (pickerOpen || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      ) {
        return;
      }
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault();
        togglePlayRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen, view]);

  useEffect(() => {
    if (idxRef.current >= clips.length) {
      idxRef.current = 0;
      setClipIdx(0);
    }
  }, [clips.length]);

  const progressPct = clips.length
    ? Math.min(100, Math.max(0, (masterTime / totalSafe) * 100))
    : 0;

  const hasPreviewed = masterTime > 0.2 || playing || Boolean(result);
  const activeStep = !clips.length
    ? 1
    : clips.length < 2
      ? 2
      : !hasPreviewed
        ? 3
        : 4;

  const steps = [
    { n: 1, label: "Thêm", done: clips.length > 0 },
    { n: 2, label: "Sắp xếp", done: clips.length > 1 },
    { n: 3, label: "Xem thử", done: hasPreviewed },
    { n: 4, label: "Xuất", done: Boolean(result) },
  ];

  const sourceHint =
    insertSource === "all"
      ? "Tất cả ảnh & video từ mọi nguồn (Workflow, Video, Ảnh)"
      : insertSource === "workflow"
        ? "Chọn project Workflow bên dưới → tick video gen sẵn"
        : insertSource === "flow_video"
          ? "Video trong G-Labs BW/video_output (+ grok)"
          : "Ảnh Flow — chỉ xem; ghép cần video";

  /* ── Màn danh sách quản lý project (mặc định) ── */
  if (view === "list") {
    return (
      <div className="st-root st-hub">
        <header className="st-header">
          <div className="st-brand">
            <div className="st-logo">▶</div>
            <div>
              <h1>Dựng phim</h1>
              <p className="st-sub">
                Quản lý project dựng · vào project mới ghép video
              </p>
            </div>
          </div>
          <div className="st-header-right">
            <Link to={NAV_ROUTES.workflow} className="st-link">
              Workflow
            </Link>
            <span className={`st-badge${ready ? " ok" : ready === false ? " bad" : ""}`}>
              {ready === null ? "…" : ready ? "● ffmpeg OK" : "○ Cần ffmpeg"}
            </span>
          </div>
        </header>

        <section className="st-hub-create">
          <div className="st-hub-create-inner">
            <input
              className="st-filename st-hub-name-input"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Tên project dựng mới…"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateFromList(true);
              }}
            />
            <button
              type="button"
              className="st-btn-primary"
              disabled={creating}
              onClick={() => void handleCreateFromList(true)}
            >
              {creating ? "Đang tạo…" : "+ Tạo & mở"}
            </button>
            <button
              type="button"
              className="st-btn-ghost"
              disabled={creating}
              onClick={() => void handleCreateFromList(false)}
            >
              Chỉ tạo
            </button>
          </div>
          <p className="st-hub-hint">
            Project dựng <strong>riêng</strong> với Workflow. Insert clip từ Workflow / Flow Video
            khi đã vào project.
          </p>
        </section>

        <div className="st-hub-toolbar">
          <strong>
            {listFiltered.length} project
            {listQ ? ` · lọc “${listQ}”` : ""}
          </strong>
          <input
            className="st-hub-search"
            value={listQ}
            onChange={(e) => setListQ(e.target.value)}
            placeholder="Tìm project…"
          />
          <button
            type="button"
            className="st-btn-ghost st-btn-sm"
            onClick={() => {
              setListLoading(true);
              void refreshEditList().finally(() => setListLoading(false));
            }}
          >
            Làm mới
          </button>
        </div>

        {listLoading ? (
          <p className="st-list-empty">Đang tải danh sách…</p>
        ) : !listFiltered.length ? (
          <div className="st-list-empty st-hub-empty">
            <div className="st-empty-icon">🎬</div>
            <p>
              {editProjects.length
                ? "Không khớp tìm kiếm"
                : "Chưa có project dựng nào"}
            </p>
            <p className="muted">Tạo project phía trên để bắt đầu ghép video</p>
          </div>
        ) : (
          <div className="st-hub-grid">
            {listFiltered.map((p) => (
              <article key={p.id} className="st-hub-card">
                <button
                  type="button"
                  className="st-hub-card-main"
                  onClick={() => void openProject(p.id)}
                >
                  <div className="st-hub-card-icon">▶</div>
                  <div className="st-hub-card-body">
                    <strong title={p.name}>{p.name}</strong>
                    <span className="st-hub-meta">
                      {p.clip_count ?? 0} clip
                      {p.last_export_name ? ` · xuất: ${p.last_export_name}` : ""}
                    </span>
                    <span className="st-hub-date">
                      Cập nhật {fmtDate(p.updated_at)}
                    </span>
                  </div>
                </button>
                <div className="st-hub-card-actions">
                  <button
                    type="button"
                    className="st-btn-primary st-btn-sm"
                    onClick={() => void openProject(p.id)}
                  >
                    Mở
                  </button>
                  <button
                    type="button"
                    className="st-btn-ghost st-btn-sm"
                    onClick={() => void handleRenameProject(p.id, p.name)}
                    title="Đổi tên"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="st-btn-ghost st-btn-sm st-hub-danger"
                    onClick={() => void handleDeleteFromList(p.id, p.name)}
                    title="Xóa"
                  >
                    ×
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ── Màn ghép video trong 1 project ── */
  return (
    <div className="st-root">
      <header className="st-header">
        <div className="st-brand">
          <button
            type="button"
            className="st-back-btn"
            onClick={backToList}
            title="Về danh sách project"
          >
            ←
          </button>
          <div className="st-logo">▶</div>
          <div>
            <h1>{editName || "Ghép video"}</h1>
            <p className="st-sub">
              Project dựng · insert Workflow / Flow Video · Flow Ảnh
            </p>
          </div>
        </div>
        <div className="st-header-right">
          <button type="button" className="st-btn-ghost st-btn-sm" onClick={backToList}>
            ← Danh sách
          </button>
          <button
            type="button"
            className="st-btn-ghost st-btn-sm"
            disabled={!editId}
            onClick={() => void handleRenameProject(editId, editName)}
            title="Đổi tên"
          >
            ✎ Đổi tên
          </button>
          {editId && (
            <button
              type="button"
              className="st-btn-ghost st-btn-sm"
              onClick={() => {
                const folder = "G-Labs BW/video_edits/" + editId;
                console.log("VideoEditorPage - Mở thư mục lưu:", folder);
                void openOutputFolder(folder).catch((e) => onError(String(e)));
              }}
              title="Mở thư mục dự án dựng video trên máy tính"
              style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}
            >
              <Folder size={12} />
              Thư mục lưu
            </button>
          )}
          <span className="st-save-hint">{saving ? "Đang lưu…" : "Đã đồng bộ"}</span>
          <Link to={NAV_ROUTES.workflow} className="st-link">
            Workflow
          </Link>
          <span className={`st-badge${ready ? " ok" : ready === false ? " bad" : ""}`}>
            {ready === null ? "…" : ready ? "● Sẵn sàng" : "○ Cần ffmpeg"}
          </span>
        </div>
      </header>

      <nav className="st-steps" aria-label="Các bước">
        {steps.map((s, i) => (
          <div
            key={s.n}
            className={`st-step${s.done ? " done" : ""}${activeStep === s.n && !s.done ? " current" : ""}`}
          >
            <span className="st-step-dot">{s.done ? "✓" : s.n}</span>
            <span className="st-step-lab">{s.label}</span>
            {i < steps.length - 1 && <span className="st-step-line" aria-hidden />}
          </div>
        ))}
      </nav>

      <div className="st-body">
        <section className="st-preview-card">
          <div className="st-card-label">Xem thử</div>
          <div className={`st-stage${playing ? " is-playing" : ""}`}>
            {!clips.length ? (
              <div className="st-stage-empty">
                <div className="st-empty-icon">🎬</div>
                <p>Chưa có clip trong project dựng</p>
                <button type="button" className="st-btn-primary" onClick={openPicker}>
                  + Thêm từ Workflow / Flow
                </button>
              </div>
            ) : (
              <video
                ref={videoRef}
                className="st-video"
                playsInline
                preload="auto"
                onEnded={onEnded}
                onTimeUpdate={onTimeUpdate}
                onClick={togglePlay}
                onLoadedMetadata={(e) => {
                  const id = clips[idxRef.current]?.id;
                  if (id) onMeta(e, id);
                }}
              />
            )}
            {clips.length > 0 && !playing && (
              <button type="button" className="st-play-fab" onClick={togglePlay} aria-label="Phát">
                ▶
              </button>
            )}
            {clips.length > 0 && (
              <div className="st-stage-badge">
                {clipIdx + 1}/{clips.length}
              </div>
            )}
          </div>

          <div className="st-seek-block">
            <div className="st-seek-wrap">
              <span className="st-seek-time">{fmt(masterTime)}</span>
              <div className="st-seek-track">
                <div className="st-seek-fill" style={{ width: `${progressPct}%` }} />
                <input
                  type="range"
                  className="st-seek"
                  min={0}
                  max={totalSafe}
                  step={0.05}
                  value={Math.min(masterTime, totalSafe)}
                  disabled={!clips.length}
                  onPointerDown={() => {
                    seekingRef.current = true;
                  }}
                  onPointerUp={(e) => {
                    seekingRef.current = false;
                    seekMaster(Number((e.target as HTMLInputElement).value));
                  }}
                  onChange={(e) => {
                    const t = Number(e.target.value);
                    setMasterTime(t);
                    if (!seekingRef.current) seekMaster(t);
                  }}
                  title="Kéo để tua"
                  aria-label="Thanh tua thời gian"
                />
              </div>
              <span className="st-seek-time st-seek-time--end">{fmt(totalEst)}</span>
            </div>
            {clips.length > 1 && totalEst > 0 && (
              <div className="st-seg-bar" aria-hidden>
                {layout.map((seg, i) => (
                  <button
                    key={seg.id}
                    type="button"
                    className={`st-seg${i === clipIdx ? " on" : ""}`}
                    style={{ flex: Math.max(0.15, seg.duration) }}
                    title={`${i + 1}. ${clips[i]?.name}`}
                    onClick={() => {
                      setMasterTime(seg.start);
                      idxRef.current = i;
                      setClipIdx(i);
                      void loadIndex(i, playingRef.current, 0);
                    }}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="st-preview-bar">
            <button
              type="button"
              className="st-btn-primary"
              disabled={!clips.length}
              onClick={togglePlay}
            >
              {playing ? "⏸ Tạm dừng" : "▶ Xem thử"}
            </button>
            <button
              type="button"
              className="st-btn-ghost"
              disabled={!clips.length}
              onClick={() => {
                stopPreview();
                idxRef.current = 0;
                setClipIdx(0);
                setMasterTime(0);
                void loadIndex(0, false, 0);
              }}
            >
              ⏮ Đầu
            </button>
            <div className="st-status-wrap">
              <span className="st-status">{status}</span>
              <span className="st-meta">
                {clips.length} clip
                {totalEst > 0 ? ` · ${fmt(totalEst)}` : ""}
                {clips.length > 0 ? " · Space = phát/dừng" : ""}
              </span>
            </div>
          </div>

          {result && (
            <div className="st-result">
              <div className="st-result-head">
                <strong>✓ Đã xuất thành công</strong>
                <span className="st-result-name">{result.name}</span>
              </div>
              <video src={mediaUrl(result.url)} controls playsInline className="st-result-video" />
              <div className="st-result-actions">
                <a
                  href={mediaUrl(result.url)}
                  target="_blank"
                  rel="noreferrer"
                  className="st-btn-primary st-btn-sm"
                >
                  Mở / tải file
                </a>
                {result.folder && <span className="st-meta">data/{result.folder}</span>}
              </div>
            </div>
          )}
        </section>

        <section className="st-list-card">
          <div className="st-list-head">
            <div>
              <strong>Danh sách ghép</strong>
              {clips.length > 0 && <span className="st-list-count">{clips.length} video</span>}
            </div>
            <div className="st-list-actions">
              <button type="button" className="st-btn-primary st-btn-sm" onClick={openPicker}>
                + Thêm
              </button>
              <button
                type="button"
                className="st-btn-ghost st-btn-sm"
                disabled={!clips.length}
                onClick={() => void clearList()}
              >
                Xóa hết
              </button>
            </div>
          </div>

          {!clips.length ? (
            <div className="st-list-empty">
              <div className="st-empty-icon">📋</div>
              <p>
                Bấm <strong>+ Thêm</strong>
              </p>
              <p className="muted">
                Chọn nguồn: <strong>Workflow</strong> · <strong>Flow Video</strong> · Flow Ảnh
              </p>
              <button type="button" className="st-btn-primary st-btn-sm" onClick={openPicker}>
                Chọn video
              </button>
            </div>
          ) : (
            <ol className="st-list">
              {clips.map((c, i) => (
                <li
                  key={c.id}
                  className={`st-item${i === clipIdx ? " active" : ""}${i === clipIdx && playing ? " playing" : ""}`}
                >
                  <span className="st-num">{i + 1}</span>
                  <video
                    src={c.url}
                    muted
                    playsInline
                    preload="metadata"
                    className="st-thumb"
                    onLoadedMetadata={(e) => onMeta(e, c.id)}
                  />
                  <div className="st-item-info">
                    <strong title={c.name}>{c.name}</strong>
                    <small>{fmt(c.duration)}</small>
                  </div>
                  <div className="st-item-ops">
                    <button type="button" disabled={i === 0} onClick={() => move(c.id, -1)} title="Lên">
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={i === clips.length - 1}
                      onClick={() => move(c.id, 1)}
                      title="Xuống"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="play"
                      onClick={() => {
                        const start = layout[i]?.start ?? 0;
                        setMasterTime(start);
                        idxRef.current = i;
                        setClipIdx(i);
                        playingRef.current = true;
                        setPlaying(true);
                        void loadIndex(i, true, 0);
                      }}
                      title="Xem từ đây"
                    >
                      ▶
                    </button>
                    <button type="button" className="danger" onClick={() => remove(c.id)} title="Xóa">
                      ×
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <div className="st-export-row">
            <input
              className="st-filename"
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="Tên file xuất (tuỳ chọn)"
            />
            <button
              type="button"
              className="st-btn-export"
              disabled={exporting || !clips.length || ready === false || !editId}
              onClick={() => void handleExport()}
            >
              {exporting ? (
                <span className="st-exporting">
                  <span className="st-spin" /> Đang ghép…
                </span>
              ) : (
                "⬇ Xuất MP4"
              )}
            </button>
          </div>
        </section>
      </div>

      {/* Insert picker — sources: workflow | flow_video | flow_image */}
      {pickerOpen && (
        <div
          className="st-picker"
          role="dialog"
          aria-modal
          aria-label="Chọn media"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false);
          }}
        >
          <div className="st-picker-panel">
            <header className="st-picker-head">
              <div>
                <strong>Thêm media vào project dựng</strong>
                <p className="st-picker-sub">
                  Nguồn insert ≠ project dựng. Export lưu vào video_edits/{editId || "…"}
                </p>
              </div>
              <button type="button" className="st-btn-ghost" onClick={() => setPickerOpen(false)}>
                ✕ Đóng
              </button>
            </header>

            <div className="st-source-tabs" role="tablist">
              {SOURCE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={insertSource === tab.id}
                  className={`st-source-tab${insertSource === tab.id ? " on" : ""}`}
                  onClick={() => {
                    setInsertSource(tab.id);
                    setPicked(new Set());
                    setQ("");
                  }}
                >
                  <span>{tab.label}</span>
                  <small>{tab.hint}</small>
                </button>
              ))}
            </div>

            <div className="st-picker-toolbar">
              {insertSource === "workflow" && (
                <label className="st-wf-pick">
                  Project Workflow
                  <select
                    className="st-select"
                    value={wfProjectId}
                    onChange={(e) => {
                      setWfProjectId(e.target.value);
                      setPicked(new Set());
                    }}
                  >
                    {!wfProjects.length && <option value="">Chưa có project workflow</option>}
                    {wfProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <input
                placeholder="Tìm tên file…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="st-btn-ghost st-btn-sm"
                onClick={() =>
                  setPicked(new Set(videoPickable.map((a) => a.path || a.url)))
                }
                disabled={!videoPickable.length}
              >
                Chọn hết video
              </button>
              <button type="button" className="st-btn-ghost st-btn-sm" onClick={() => setPicked(new Set())}>
                Bỏ chọn
              </button>
              <span className="st-picker-count">
                <b>{picked.size}</b> đã chọn · {filtered.length} hiện · {sourceHint}
              </span>
            </div>

            <div className="st-picker-body">
              {loading && <p className="st-list-empty">Đang tải…</p>}
              {!loading && insertSource === "workflow" && !wfProjectId && (
                <p className="st-list-empty">
                  Chưa có project Workflow. <Link to={NAV_ROUTES.workflow}>Mở Workflow</Link> tạo
                  trước.
                </p>
              )}
              {!loading && insertSource === "flow_image" && (
                <p className="st-picker-banner">
                  Tab Flow Ảnh chỉ để xem / tham chiếu. Để ghép video hãy dùng{" "}
                  <button type="button" className="st-inline-link" onClick={() => setInsertSource("flow_video")}>
                    Flow Video
                  </button>{" "}
                  hoặc Project Workflow.
                </p>
              )}
              {!loading && !filtered.length && (insertSource !== "workflow" || wfProjectId) && (
                <p className="st-list-empty">
                  {insertSource === "workflow" && (
                    <>
                      Project này chưa có video.{" "}
                      <Link to={NAV_ROUTES.workflow}>Chạy Workflow</Link> gen video trước.
                    </>
                  )}
                  {insertSource === "flow_video" && (
                    <>
                      Chưa có file trong video_output.{" "}
                      <Link to={NAV_ROUTES["flow-video"]}>Mở Flow Video</Link>.
                    </>
                  )}
                  {insertSource === "flow_image" && (
                    <>
                      Chưa có ảnh. <Link to={NAV_ROUTES["flow-image"]}>Mở Flow Ảnh</Link>.
                    </>
                  )}
                  {insertSource === "all" && (
                    <>
                      Chưa có video hay ảnh nào được tạo.
                    </>
                  )}
                </p>
              )}
              <div className="st-picker-grid">
                {filtered.map((a, i) => {
                  const key = a.path || a.url;
                  const on = picked.has(key);
                  const isVid = isVideoAsset(a);
                  return (
                    <button
                      key={`${key}-${i}`}
                      type="button"
                      className={`st-pick-card${on ? " on" : ""}${!isVid ? " is-image" : ""}`}
                      onClick={() => {
                        if (!isVid) {
                          onError("Ảnh không ghép được — chỉ chọn video");
                          return;
                        }
                        toggle(key);
                      }}
                      onDoubleClick={() => {
                        if (!isVid) return;
                        addList([a]);
                        setPickerOpen(false);
                      }}
                      title={isVid ? a.name : `${a.name} (ảnh — không ghép)`}
                    >
                      <div className="st-pick-thumb">
                        {isVid ? (
                          <video src={mediaUrl(a.url)} muted playsInline preload="metadata" />
                        ) : (
                          <img src={mediaUrl(a.url)} alt="" loading="lazy" />
                        )}
                        <span className={`st-kind-tag${isVid ? " vid" : " img"}`}>
                          {isVid ? "VIDEO" : "ẢNH"}
                        </span>
                        {isVid && (
                          <span className={`st-check${on ? " on" : ""}`}>{on ? "✓" : ""}</span>
                        )}
                      </div>
                      <span>{a.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <footer className="st-picker-foot">
              <button type="button" className="st-btn-ghost" onClick={() => setPickerOpen(false)}>
                Hủy
              </button>
              <button
                type="button"
                className="st-btn-ghost"
                disabled={!videoPickable.length}
                onClick={insertAllVideos}
              >
                Thêm tất cả video{videoPickable.length ? ` (${videoPickable.length})` : ""}
              </button>
              <button
                type="button"
                className="st-btn-primary"
                disabled={!picked.size}
                onClick={insertPicked}
              >
                {picked.size ? `Thêm ${picked.size} vào danh sách` : "Chọn video rồi thêm"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
