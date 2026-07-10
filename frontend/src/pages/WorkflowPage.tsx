import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnConnect,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  deleteProject,
  duplicateProject,
  fetchProject,
  fetchProjectAssets,
  fetchSampleVideoChain,
  fetchSampleWorkflow,
  fetchWorkflowRun,
  listProjects,
  normalizeFileUrl,
  openProjectFolder,
  runWorkflowGraph,
  saveProject,
  type ProjectAsset,
  type ProjectMeta,
  type WorkflowRunResult,
} from "../api";
import { useSearchParams } from "react-router-dom";

interface WorkflowPageProps {
  onError: (msg: string) => void;
}

type RunStatus = "idle" | "pending" | "running" | "completed" | "failed" | "skipped";

type WNodeData = {
  title: string;
  prompt?: string;
  model?: string;
  aspect_ratio?: string;
  mode?: string;
  image?: string;
  positions?: string;
  /** Preview media after run (image/video URLs) */
  resultUrls?: string[];
  /** frame_extract meta for continue/reuse */
  frames?: Array<{ position: string; url: string; path?: string }>;
  folder?: string;
  runStatus?: RunStatus;
  runError?: string;
  reused?: boolean;
  onChange?: (id: string, patch: Partial<WNodeData>) => void;
  onPreview?: (url: string) => void;
  onRerun?: (id: string) => void;
};

const NODE_COLORS: Record<string, string> = {
  prompt: "#6366f1",
  reference: "#14b8a6",
  generate: "#22c55e",
  video_generate: "#f59e0b",
  frame_extract: "#ec4899",
};

const STATUS_META: Record<
  RunStatus,
  { label: string; color: string; bg: string }
> = {
  idle: { label: "", color: "transparent", bg: "transparent" },
  pending: { label: "chờ", color: "#94a3b8", bg: "rgba(148,163,184,0.15)" },
  running: { label: "…", color: "#38bdf8", bg: "rgba(56,189,248,0.18)" },
  completed: { label: "OK", color: "#4ade80", bg: "rgba(74,222,128,0.15)" },
  failed: { label: "Lỗi", color: "#f87171", bg: "rgba(248,113,113,0.18)" },
  skipped: { label: "skip", color: "#a3a3a3", bg: "rgba(163,163,163,0.12)" },
};

function isVideoUrl(u: string): boolean {
  return /\.mp4($|\?)/i.test(u) || u.includes("/video");
}

function MediaPreview({
  urls,
  onPreview,
  max = 4,
}: {
  urls?: string[];
  onPreview?: (url: string) => void;
  max?: number;
}) {
  if (!urls?.length) return null;
  const list = urls.slice(0, max).map(normalizeFileUrl);
  return (
    <div
      className="nodrag nopan"
      style={{
        display: "grid",
        gridTemplateColumns: list.length === 1 ? "1fr" : "1fr 1fr",
        gap: 6,
        marginTop: 8,
      }}
    >
      {list.map((u) =>
        isVideoUrl(u) ? (
          <video
            key={u}
            src={u}
            controls
            playsInline
            style={{
              width: "100%",
              maxHeight: 140,
              borderRadius: 8,
              background: "#000",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          />
        ) : (
          <button
            key={u}
            type="button"
            className="nodrag"
            onClick={() => onPreview?.(u)}
            title="Click phóng to"
            style={{
              padding: 0,
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 8,
              overflow: "hidden",
              cursor: "zoom-in",
              background: "#0a0a0c",
              lineHeight: 0,
            }}
          >
            <img
              src={u}
              alt=""
              style={{
                width: "100%",
                height: list.length === 1 ? 150 : 88,
                objectFit: "cover",
                display: "block",
              }}
            />
          </button>
        ),
      )}
      {urls.length > max && (
        <span className="muted" style={{ fontSize: 10, gridColumn: "1 / -1" }}>
          +{urls.length - max} media
        </span>
      )}
    </div>
  );
}

function Shell({
  type,
  title,
  children,
  selected,
  runStatus = "idle",
  runError,
  showRerun,
  onRerun,
  reused,
}: {
  type: string;
  title: string;
  children: ReactNode;
  selected?: boolean;
  runStatus?: RunStatus;
  runError?: string;
  showRerun?: boolean;
  onRerun?: () => void;
  reused?: boolean;
}) {
  const color = NODE_COLORS[type] || "#888";
  const st = STATUS_META[runStatus] || STATUS_META.idle;
  const borderColor =
    runStatus === "failed"
      ? "#f87171"
      : runStatus === "completed"
        ? color
        : runStatus === "running"
          ? "#38bdf8"
          : selected
            ? color
            : "rgba(255,255,255,0.12)";

  return (
    <div
      style={{
        minWidth: 240,
        maxWidth: 300,
        borderRadius: 12,
        border: `1.5px solid ${borderColor}`,
        background: "rgba(18,20,26,0.97)",
        boxShadow:
          runStatus === "running"
            ? "0 0 0 1px rgba(56,189,248,0.35), 0 8px 24px rgba(0,0,0,0.4)"
            : selected
              ? `0 0 0 1px ${color}55, 0 8px 24px rgba(0,0,0,0.4)`
              : "0 4px 16px rgba(0,0,0,0.35)",
        fontSize: 12,
        color: "#e5e7eb",
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: `${color}22`,
          borderRadius: "12px 12px 0 0",
          fontWeight: 600,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {reused && runStatus === "completed" ? (
            <span style={{ fontSize: 9, color: "#94a3b8", opacity: 0.9 }}>giữ</span>
          ) : null}
          {st.label ? (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: st.color,
                background: st.bg,
                padding: "2px 6px",
                borderRadius: 999,
                letterSpacing: 0.2,
              }}
            >
              {runStatus === "running" ? "⟳ chạy" : st.label}
            </span>
          ) : null}
          <span style={{ opacity: 0.45, fontWeight: 400, fontSize: 10 }}>{type}</span>
        </span>
      </div>
      <div style={{ padding: 10 }}>
        {children}
        {runError ? (
          <div
            style={{
              marginTop: 8,
              fontSize: 10,
              color: "#fca5a5",
              lineHeight: 1.35,
              maxHeight: 48,
              overflow: "auto",
            }}
          >
            {runError}
          </div>
        ) : null}
        {showRerun && (runStatus === "completed" || runStatus === "failed") ? (
          <button
            type="button"
            className="nodrag nopan"
            onClick={(e) => {
              e.stopPropagation();
              onRerun?.();
            }}
            style={{
              marginTop: 8,
              width: "100%",
              padding: "6px 8px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(255,255,255,0.06)",
              color: "#e2e8f0",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {runStatus === "failed" ? "↻ Thử lại" : "↻ Tạo lại"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function fieldStyle(): CSSProperties {
  return {
    width: "100%",
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    color: "inherit",
    padding: 6,
  };
}

function PromptNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  return (
    <Shell
      type="prompt"
      title={d.title || "Prompt"}
      selected={selected}
      runStatus={d.runStatus}
      runError={d.runError}
    >
      <Handle type="source" position={Position.Right} id="prompt" style={{ background: "#6366f1" }} />
      <textarea
        className="nodrag nowheel"
        rows={4}
        value={d.prompt || ""}
        onChange={(e) => d.onChange?.(id, { prompt: e.target.value })}
        placeholder="Nhập prompt…"
        style={{ ...fieldStyle(), resize: "vertical" }}
      />
    </Shell>
  );
}

function ReferenceNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  const preview = d.resultUrls?.length
    ? d.resultUrls
    : d.image && (d.image.startsWith("data:") || d.image.includes("/api/files/") || d.image.startsWith("http"))
      ? [d.image]
      : [];
  return (
    <Shell
      type="reference"
      title={d.title || "Ảnh tham chiếu"}
      selected={selected}
      runStatus={d.runStatus}
      runError={d.runError}
    >
      <Handle type="source" position={Position.Right} id="image" style={{ background: "#14b8a6" }} />
      <input
        className="nodrag"
        value={d.image || ""}
        onChange={(e) => d.onChange?.(id, { image: e.target.value, resultUrls: undefined })}
        placeholder="URL /api/files/... hoặc data:"
        style={fieldStyle()}
      />
      <label
        className="nodrag"
        style={{
          display: "inline-block",
          marginTop: 6,
          fontSize: 11,
          cursor: "pointer",
          color: "#5eead4",
        }}
      >
        ⬆ Upload ảnh
        <input
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => {
              const url = String(reader.result || "");
              d.onChange?.(id, { image: url, resultUrls: [url] });
            };
            reader.readAsDataURL(f);
          }}
        />
      </label>
      <MediaPreview urls={preview} onPreview={d.onPreview} max={1} />
    </Shell>
  );
}

function GenerateNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  return (
    <Shell
      type="generate"
      title={d.title || "Tạo ảnh"}
      selected={selected}
      runStatus={d.runStatus}
      runError={d.runError}
      showRerun
      reused={d.reused}
      onRerun={() => d.onRerun?.(id)}
    >
      <Handle type="target" position={Position.Left} id="prompt" style={{ top: "28%", background: "#6366f1" }} />
      <Handle type="target" position={Position.Left} id="image" style={{ top: "55%", background: "#14b8a6" }} />
      <Handle type="source" position={Position.Right} id="image" style={{ background: "#22c55e" }} />
      <label className="nodrag" style={{ display: "block", marginBottom: 6 }}>
        Model
        <select
          value={d.model || "nano_banana_2_lite"}
          onChange={(e) => d.onChange?.(id, { model: e.target.value })}
          style={{ ...fieldStyle(), marginTop: 2 }}
        >
          <option value="nano_banana_2_lite">Nano Banana 2 Lite</option>
          <option value="nano_banana_2">Nano Banana 2</option>
          <option value="nano_banana_pro">Nano Banana Pro</option>
        </select>
      </label>
      <label className="nodrag" style={{ display: "block" }}>
        Tỷ lệ
        <select
          value={d.aspect_ratio || "16:9"}
          onChange={(e) => d.onChange?.(id, { aspect_ratio: e.target.value })}
          style={{ ...fieldStyle(), marginTop: 2 }}
        >
          <option value="1:1">1:1</option>
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
        </select>
      </label>
      <MediaPreview urls={d.resultUrls} onPreview={d.onPreview} />
      {!d.resultUrls?.length && d.runStatus === "idle" && (
        <div className="muted" style={{ fontSize: 10, marginTop: 8, opacity: 0.7 }}>
          Ảnh kết quả hiện tại đây sau khi chạy
        </div>
      )}
    </Shell>
  );
}

function VideoNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  return (
    <Shell
      type="video_generate"
      title={d.title || "Tạo video"}
      selected={selected}
      runStatus={d.runStatus}
      runError={d.runError}
      showRerun
      reused={d.reused}
      onRerun={() => d.onRerun?.(id)}
    >
      <Handle type="target" position={Position.Left} id="prompt" style={{ top: "22%", background: "#6366f1" }} />
      <Handle type="target" position={Position.Left} id="start_image" style={{ top: "48%", background: "#22c55e" }} />
      <Handle type="target" position={Position.Left} id="end_image" style={{ top: "72%", background: "#14b8a6" }} />
      <Handle type="source" position={Position.Right} id="video" style={{ background: "#f59e0b" }} />
      <label className="nodrag" style={{ display: "block", marginBottom: 6 }}>
        Model
        <select
          value={d.model || "veo_31_fast"}
          onChange={(e) => d.onChange?.(id, { model: e.target.value })}
          style={{ ...fieldStyle(), marginTop: 2 }}
        >
          <option value="veo_31_fast">Veo 3.1 Fast</option>
          <option value="veo_31_quality">Veo 3.1 Quality</option>
          <option value="omni_flash">Omni Flash</option>
        </select>
      </label>
      <label className="nodrag" style={{ display: "block" }}>
        Mode
        <select
          value={d.mode || "start_image"}
          onChange={(e) => d.onChange?.(id, { mode: e.target.value })}
          style={{ ...fieldStyle(), marginTop: 2 }}
        >
          <option value="text_to_video">Text→Video</option>
          <option value="start_image">Start image</option>
          <option value="start_end_image">Start+End</option>
        </select>
      </label>
      <MediaPreview urls={d.resultUrls} onPreview={d.onPreview} max={2} />
    </Shell>
  );
}

function FrameNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  return (
    <Shell
      type="frame_extract"
      title={d.title || "Tách frame"}
      selected={selected}
      runStatus={d.runStatus}
      runError={d.runError}
      showRerun
      reused={d.reused}
      onRerun={() => d.onRerun?.(id)}
    >
      <Handle type="target" position={Position.Left} id="video" style={{ background: "#f59e0b" }} />
      <Handle type="source" position={Position.Right} id="image" style={{ top: "40%", background: "#22c55e" }} />
      <Handle type="source" position={Position.Right} id="start_image" style={{ top: "62%", background: "#14b8a6" }} />
      <Handle type="source" position={Position.Right} id="end_image" style={{ top: "82%", background: "#ec4899" }} />
      <label className="nodrag">
        Lấy frame
        <select
          value={d.positions || "end"}
          onChange={(e) => d.onChange?.(id, { positions: e.target.value })}
          style={{ ...fieldStyle(), marginTop: 2 }}
        >
          <option value="end">Chỉ khung cuối (nối video tiếp)</option>
          <option value="start">Chỉ khung đầu</option>
          <option value="start,end">Đầu + cuối</option>
          <option value="start,middle,end">Đầu + giữa + cuối</option>
        </select>
      </label>
      <small className="muted" style={{ display: "block", marginTop: 4, fontSize: 10 }}>
        Nối <strong>end_image</strong> (chấm phải dưới) → Video kế <strong>start_image</strong>
      </small>
      <MediaPreview urls={d.resultUrls} onPreview={d.onPreview} max={3} />
    </Shell>
  );
}

const nodeTypes = {
  prompt: PromptNode,
  reference: ReferenceNode,
  generate: GenerateNode,
  video_generate: VideoNode,
  frame_extract: FrameNode,
};

let _seq = 1;
function nid(prefix: string) {
  return `${prefix}_${Date.now().toString(36)}_${_seq++}`;
}

function extractUrlsFromNodeResult(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const r = raw as {
    results?: string[];
    frames?: Array<{ url: string }>;
    image?: string;
    prompt?: string;
  };
  const urls: string[] = [];
  for (const u of r.results || []) {
    if (typeof u === "string" && u) urls.push(normalizeFileUrl(u));
  }
  for (const f of r.frames || []) {
    if (f?.url) urls.push(normalizeFileUrl(f.url));
  }
  if (r.image && typeof r.image === "string" && r.image !== "(image)") {
    urls.push(normalizeFileUrl(r.image));
  }
  return urls;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export default function WorkflowPage({ onError }: WorkflowPageProps) {
  const [searchParams] = useSearchParams();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("Project mới");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null);
  const [progressLabel, setProgressLabel] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState("");
  const [dirty, setDirty] = useState(false);
  const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>([]);
  const rf = useRef<ReactFlowInstance | null>(null);
  const nodesRef = useRef<Node[]>([]);
  const pollStop = useRef(false);
  const projectIdRef = useRef<string | null>(null);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  const refreshProjectAssets = useCallback(async (id: string | null) => {
    if (!id) {
      setProjectAssets([]);
      return;
    }
    try {
      const data = await fetchProjectAssets(id);
      setProjectAssets(data.assets.slice(0, 24));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const openPreview = useCallback((url: string) => {
    setLightbox(normalizeFileUrl(url));
  }, []);

  const rerunRef = useRef<(id: string) => void>(() => undefined);

  const patchNode = useCallback(
    (id: string, patch: Partial<WNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? {
                ...n,
                data: {
                  ...n.data,
                  ...patch,
                  onChange: patchNode,
                  onPreview: openPreview,
                  onRerun: (nid: string) => rerunRef.current(nid),
                },
              }
            : n,
        ),
      );
    },
    [openPreview, setNodes],
  );

  const attachHandlers = useCallback(
    (list: Node[]) =>
      list.map((n) => ({
        ...n,
        data: {
          ...(n.data as object),
          onChange: patchNode,
          onPreview: openPreview,
          onRerun: (nid: string) => rerunRef.current(nid),
        },
      })),
    [openPreview, patchNode],
  );

  const refreshProjects = useCallback(async () => {
    try {
      setProjects(await listProjects());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await refreshProjects();
        const qid = searchParams.get("project");
        const list = await listProjects();
        const openId = qid && list.find((p) => p.id === qid) ? qid : list[0]?.id;
        if (openId) {
          const doc = await fetchProject(openId);
          setProjectId(doc.id);
          setName(doc.name || "Project");
          setDescription(doc.description || "");
          setNodes(attachHandlers((doc.nodes as Node[]) || []));
          setEdges((doc.edges as Edge[]) || []);
          setDirty(false);
          await refreshProjectAssets(doc.id);
        } else {
          const sample = await fetchSampleWorkflow();
          setProjectId(null);
          setName(sample.name || "Project mới");
          setDescription("");
          setNodes(attachHandlers((sample.nodes as Node[]) || []));
          setEdges((sample.edges as Edge[]) || []);
          setDirty(true);
          setProjectAssets([]);
        }
        requestAnimationFrame(() => rf.current?.fitView({ padding: 0.2 }));
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [attachHandlers, onError, refreshProjectAssets, refreshProjects, searchParams, setEdges, setNodes]);

  // mark dirty when graph edits
  const onNodesChangeTracked: typeof onNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      setDirty(true);
    },
    [onNodesChange],
  );
  const onEdgesChangeTracked: typeof onEdgesChange = useCallback(
    (changes) => {
      onEdgesChange(changes);
      setDirty(true);
    },
    [onEdgesChange],
  );

  const onConnect: OnConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            style: { stroke: "#64748b", strokeWidth: 2 },
          },
          eds,
        ),
      );
      setDirty(true);
    },
    [setEdges],
  );

  function addNode(type: string) {
    const titles: Record<string, string> = {
      prompt: "Prompt",
      reference: "Ảnh tham chiếu",
      generate: "Tạo ảnh",
      video_generate: "Tạo video",
      frame_extract: "Tách frame",
    };
    const id = nid(type);
    const baseData: WNodeData = {
      title: titles[type] || type,
      runStatus: "idle",
      onChange: patchNode,
      onPreview: openPreview,
    };
    if (type === "prompt") baseData.prompt = "";
    if (type === "generate") {
      baseData.model = "nano_banana_2_lite";
      baseData.aspect_ratio = "16:9";
    }
    if (type === "video_generate") {
      baseData.model = "veo_31_fast";
      baseData.mode = "start_image";
      baseData.aspect_ratio = "16:9";
    }
    if (type === "frame_extract") baseData.positions = "start,middle,end";
    if (type === "reference") baseData.image = "";

    const pos = rf.current
      ? rf.current.screenToFlowPosition({ x: 320, y: 200 })
      : { x: 140 + Math.random() * 60, y: 120 + Math.random() * 60 };

    setNodes((nds) => [
      ...nds,
      { id, type, position: pos, data: baseData },
    ]);
    setDirty(true);
  }

  // auto-save after successful run (debounced light)
  // (manual save still primary)

  function stripNodeData(data: WNodeData, { keepRuntime = true } = {}): Record<string, unknown> {
    const {
      onChange: _c,
      onPreview: _p,
      onRerun: _r,
      runError,
      runStatus,
      reused,
      ...rest
    } = data;
    if (!keepRuntime) {
      const { resultUrls: _u, frames: _f, folder: _fo, ...clean } = rest as WNodeData;
      return clean as Record<string, unknown>;
    }
    // Persist previews + status so project can resume work
    return {
      ...rest,
      runStatus,
      runError,
      reused,
    } as Record<string, unknown>;
  }

  function graphPayload() {
    return {
      name,
      nodes: nodes.map(({ id, type, position, data }) => ({
        id,
        type,
        position,
        data: stripNodeData(data as WNodeData),
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
      viewport: rf.current?.getViewport(),
    };
  }

  function projectPayload() {
    const g = graphPayload();
    return {
      name: name.trim() || "Project mới",
      description: description.trim(),
      nodes: g.nodes,
      edges: g.edges,
      viewport: g.viewport,
      node_states: buildPriorResults(nodes),
    };
  }

  async function handleSaveProject(asNew = false) {
    try {
      const doc = await saveProject(projectPayload(), asNew ? null : projectId);
      setProjectId(doc.id);
      setName(doc.name);
      setDescription(doc.description || "");
      setDirty(false);
      await refreshProjects();
      setSaveHint(asNew ? "Đã tạo project" : "Đã lưu project");
      setTimeout(() => setSaveHint(""), 2200);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleNewProject() {
    if (dirty && !confirm("Project hiện tại chưa lưu. Tạo project trống?")) return;
    setProjectId(null);
    setName("Project mới");
    setDescription("");
    setNodes([]);
    setEdges([]);
    setRunResult(null);
    setProgressLabel("");
    setDirty(true);
  }

  async function handleOpenProject(id: string) {
    if (dirty && !confirm("Có thay đổi chưa lưu. Mở project khác?")) return;
    try {
      const doc = await fetchProject(id);
      setProjectId(doc.id);
      setName(doc.name || "Project");
      setDescription(doc.description || "");
      setNodes(attachHandlers((doc.nodes as Node[]) || []));
      setEdges((doc.edges as Edge[]) || []);
      setRunResult(null);
      setProgressLabel("");
      setDirty(false);
      await refreshProjectAssets(doc.id);
      requestAnimationFrame(() => rf.current?.fitView({ padding: 0.2 }));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleDuplicateProject() {
    if (!projectId) {
      onError("Lưu project trước khi nhân bản");
      return;
    }
    try {
      await handleSaveProject(false);
      const doc = await duplicateProject(projectId);
      setProjectId(doc.id);
      setName(doc.name);
      setDescription(doc.description || "");
      setNodes(attachHandlers((doc.nodes as Node[]) || []));
      setEdges((doc.edges as Edge[]) || []);
      setDirty(false);
      await refreshProjects();
      setSaveHint("Đã nhân bản");
      setTimeout(() => setSaveHint(""), 2000);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  function applyRunToNodes(result: WorkflowRunResult, opts?: { keepMissing?: boolean }) {
    const nr = result.node_results || {};
    setNodes((nds) =>
      nds.map((n) => {
        const raw = nr[n.id] as
          | {
              status?: string;
              error?: string;
              results?: string[];
              frames?: Array<{ position?: string; url: string; path?: string }>;
              reused?: boolean;
              folder?: string;
              prompt?: string;
            }
          | undefined;
        if (!raw) {
          if (opts?.keepMissing) return n;
          return {
            ...n,
            data: {
              ...n.data,
              onChange: patchNode,
              onPreview: openPreview,
              onRerun: (nid: string) => rerunRef.current(nid),
            },
          };
        }
        const status = (raw.status || "idle") as RunStatus;
        const urls = extractUrlsFromNodeResult(raw);
        const frames = (raw.frames || []).map((f) => ({
          position: String(f.position || ""),
          url: normalizeFileUrl(f.url),
          path: f.path,
        }));
        return {
          ...n,
          data: {
            ...n.data,
            runStatus: status,
            runError: raw.error || undefined,
            reused: Boolean(raw.reused),
            folder: raw.folder,
            resultUrls: urls.length
              ? urls
              : status === "running" || status === "pending"
                ? (n.data as WNodeData).resultUrls
                : status === "completed"
                  ? (n.data as WNodeData).resultUrls
                  : (n.data as WNodeData).resultUrls,
            ...(urls.length ? { resultUrls: urls } : {}),
            ...(frames.length ? { frames } : {}),
            ...(n.type === "reference" && urls[0] ? { image: urls[0] } : {}),
            onChange: patchNode,
            onPreview: openPreview,
            onRerun: (nid: string) => rerunRef.current(nid),
          },
        };
      }),
    );
  }

  function buildPriorResults(list: Node[]): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const n of list) {
      const d = n.data as WNodeData;
      if (d.runStatus !== "completed") continue;
      const entry: Record<string, unknown> = {
        status: "completed",
        type: n.type,
      };
      if (d.resultUrls?.length) entry.results = d.resultUrls;
      if (d.frames?.length) entry.frames = d.frames;
      if (d.folder) entry.folder = d.folder;
      if (n.type === "prompt" && d.prompt) entry.prompt = d.prompt;
      if (n.type === "reference" && d.image) entry.image = d.image;
      out[n.id] = entry;
    }
    return out;
  }

  async function pollUntilDone(runId: string): Promise<WorkflowRunResult> {
    pollStop.current = false;
    let last: WorkflowRunResult | null = null;
    for (let i = 0; i < 3600; i++) {
      if (pollStop.current) break;
      const snap = await fetchWorkflowRun(runId);
      last = snap;
      setRunResult(snap);
      applyRunToNodes(snap, { keepMissing: true });
      const done = snap.progress?.done ?? 0;
      const total = snap.progress?.total ?? 0;
      const cur = snap.progress?.current;
      setProgressLabel(
        total
          ? `${done}/${total}${cur ? ` · ${cur}` : ""}${snap.status === "running" ? " …" : ""}`
          : snap.status,
      );
      if (snap.status === "completed" || snap.status === "failed") {
        applyRunToNodes(snap);
        return snap;
      }
      await sleep(900);
    }
    return last || { run_id: runId, status: "failed", error: "Timeout poll" };
  }

  async function startRun(opts: {
    skipCompleted?: boolean;
    onlyNodeIds?: string[];
    markPendingAll?: boolean;
  }) {
    try {
      setRunning(true);
      setProgressLabel("Đang xếp hàng…");
      if (opts.markPendingAll !== false && !opts.onlyNodeIds?.length) {
        setNodes((nds) =>
          nds.map((n) => {
            const d = n.data as WNodeData;
            const keep =
              opts.skipCompleted && d.runStatus === "completed"
                ? {
                    runStatus: "completed" as RunStatus,
                    resultUrls: d.resultUrls,
                    frames: d.frames,
                    reused: true,
                  }
                : {
                    runStatus: "pending" as RunStatus,
                    runError: undefined,
                    reused: false,
                  };
            return {
              ...n,
              data: {
                ...n.data,
                ...keep,
                onChange: patchNode,
                onPreview: openPreview,
                onRerun: (nid: string) => rerunRef.current(nid),
              },
            };
          }),
        );
      }
      if (opts.onlyNodeIds?.length) {
        const setIds = new Set(opts.onlyNodeIds);
        setNodes((nds) =>
          nds.map((n) =>
            setIds.has(n.id)
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    runStatus: "pending" as RunStatus,
                    runError: undefined,
                    reused: false,
                    onChange: patchNode,
                    onPreview: openPreview,
                    onRerun: (nid: string) => rerunRef.current(nid),
                  },
                }
              : n,
          ),
        );
      }

      // Ensure project exists so outputs go into project folder
      let pid = projectIdRef.current;
      if (!pid) {
        const created = await saveProject(projectPayload(), null);
        pid = created.id;
        setProjectId(created.id);
        projectIdRef.current = created.id;
        await refreshProjects();
      }

      const prior = buildPriorResults(nodesRef.current);
      const started = await runWorkflowGraph(graphPayload(), {
        async_mode: true,
        skip_completed: Boolean(opts.skipCompleted),
        only_node_ids: opts.onlyNodeIds,
        prior_results: Object.keys(prior).length ? prior : undefined,
        project_id: pid,
      });
      setRunResult(started);
      applyRunToNodes(started, { keepMissing: true });
      const final = await pollUntilDone(started.run_id);
      setRunResult(final);
      // auto-save project graph + previews after run
      try {
        const saved = await saveProject(projectPayload(), pid);
        setProjectId(saved.id);
        setDirty(false);
        await refreshProjects();
        await refreshProjectAssets(saved.id);
      } catch {
        /* ignore autosave errors */
      }
      if (final.status !== "completed") {
        onError(final.error || "Workflow failed");
      }
      setProgressLabel(
        final.status === "completed"
          ? `Xong ${final.progress?.done ?? ""}/${final.progress?.total ?? ""}`
          : `Lỗi · ${final.error || final.status}`,
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setProgressLabel("Lỗi");
    } finally {
      setRunning(false);
    }
  }

  async function handleRun() {
    await startRun({ skipCompleted: false, markPendingAll: true });
  }

  async function handleContinue() {
    const incomplete = nodesRef.current.filter((n) => {
      const s = (n.data as WNodeData).runStatus;
      return s !== "completed";
    });
    if (incomplete.length === 0) {
      onError("Tất cả node đã xong — thêm node mới hoặc bấm Tạo lại trên node");
      return;
    }
    await startRun({ skipCompleted: true, markPendingAll: true });
  }

  async function handleRerunNode(nodeId: string) {
    await startRun({
      skipCompleted: true,
      onlyNodeIds: [nodeId],
      markPendingAll: false,
    });
  }

  rerunRef.current = (id: string) => {
    if (running) return;
    void handleRerunNode(id);
  };

  function clearPreviews() {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          resultUrls: undefined,
          runStatus: "idle" as RunStatus,
          runError: undefined,
          onChange: patchNode,
          onPreview: openPreview,
        },
      })),
    );
    setRunResult(null);
  }

  const resultPreview = useMemo(() => {
    if (!runResult?.node_results) return [];
    const items: { node: string; urls: string[]; status: string }[] = [];
    for (const [nidKey, raw] of Object.entries(runResult.node_results)) {
      const r = raw as { status?: string; results?: string[]; frames?: Array<{ url: string }> };
      const urls = extractUrlsFromNodeResult(r);
      if (urls.length) items.push({ node: nidKey, urls, status: r.status || "" });
    }
    return items;
  }, [runResult]);

  return (
    <div
      className="workflow-page"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "calc(100vh - 100px)",
        minHeight: 520,
      }}
    >
      <header className="page-header" style={{ flexShrink: 0 }}>
        <div className="page-title-group">
          <h1>Workflow</h1>
          <span className="pill pill-purple">PROJECT</span>
          {dirty && <span className="pill" style={{ opacity: 0.85 }}>chưa lưu</span>}
          {running && <span className="pill pill-green">Đang chạy…</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            style={{ minWidth: 160 }}
            placeholder="Tên project"
          />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void handleSaveProject(false)}
            title="Lưu project (nodes + preview + trạng thái)"
          >
            💾 Lưu{saveHint ? ` · ${saveHint}` : ""}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void handleSaveProject(true)}
            title="Lưu thành project mới"
          >
            Lưu như…
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleNewProject()}>
            + Project
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={clearPreviews}
            disabled={running}
            title="Xóa preview trên node (không xóa file đã gen)"
          >
            Xóa preview
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => rf.current?.fitView({ padding: 0.2 })}
          >
            Fit view
          </button>
          {progressLabel ? (
            <span className="muted" style={{ fontSize: 12, maxWidth: 200 }}>
              {progressLabel}
            </span>
          ) : null}
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={running || nodes.length === 0}
            onClick={() => void handleRun()}
            title="Chạy lại toàn bộ từ đầu"
          >
            {running ? "Đang chạy…" : "▶ Chạy hết"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={running || nodes.length === 0}
            onClick={() => void handleContinue()}
            title="Giữ node đã OK — chỉ chạy node mới / chưa xong / lỗi"
          >
            ⏭ Tiếp tục
          </button>
        </div>
      </header>

      <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>
        <aside
          style={{
            width: 200,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            overflow: "auto",
          }}
        >
          <div className="panel-card" style={{ padding: 12, margin: 0 }}>
            <strong style={{ fontSize: 13 }}>Thêm node</strong>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {(
                [
                  ["prompt", "Prompt"],
                  ["reference", "Ảnh tham chiếu"],
                  ["generate", "Tạo ảnh"],
                  ["video_generate", "Tạo video"],
                  ["frame_extract", "Tách frame"],
                ] as const
              ).map(([t, label]) => (
                <button key={t} type="button" className="btn btn-ghost btn-sm" onClick={() => addNode(t)}>
                  + {label}
                </button>
              ))}
            </div>
          </div>
          <div className="panel-card" style={{ padding: 12, margin: 0, flex: 1 }}>
            <strong style={{ fontSize: 13 }}>Projects</strong>
            <input
              placeholder="Tìm project…"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              style={{ width: "100%", marginTop: 8, marginBottom: 6, fontSize: 11 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 220, overflow: "auto" }}>
              {projects.filter((p) =>
                !projectFilter.trim()
                  ? true
                  : p.name.toLowerCase().includes(projectFilter.trim().toLowerCase()),
              ).length === 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  Chưa có project — bấm 💾 Lưu
                </span>
              )}
              {projects
                .filter((p) =>
                  !projectFilter.trim()
                    ? true
                    : p.name.toLowerCase().includes(projectFilter.trim().toLowerCase()),
                )
                .map((p) => (
                  <div key={p.id} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{
                        flex: 1,
                        textAlign: "left",
                        fontSize: 11,
                        borderColor: projectId === p.id ? "rgba(99,102,241,0.5)" : undefined,
                      }}
                      onClick={() => void handleOpenProject(p.id)}
                      title={p.description || p.name}
                    >
                      {p.name}
                      <span className="muted" style={{ display: "block", fontSize: 10 }}>
                        {p.node_count ?? 0} node
                        {p.updated_at
                          ? ` · ${new Date(p.updated_at * 1000).toLocaleDateString()}`
                          : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost danger btn-sm"
                      style={{ fontSize: 11, padding: "2px 6px" }}
                      onClick={async () => {
                        if (!confirm(`Xóa project “${p.name}”?`)) return;
                        await deleteProject(p.id);
                        if (projectId === p.id) {
                          setProjectId(null);
                          setName("Project mới");
                          setNodes([]);
                          setEdges([]);
                          setDirty(true);
                        }
                        await refreshProjects();
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 8, width: "100%" }}
              disabled={!projectId}
              onClick={() => void handleDuplicateProject()}
            >
              Nhân bản project
            </button>
            <label className="muted" style={{ display: "block", marginTop: 10, fontSize: 11 }}>
              Mô tả
              <textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDirty(true);
                }}
                rows={2}
                placeholder="Ghi chú project…"
                style={{ width: "100%", marginTop: 4, fontSize: 11 }}
              />
            </label>
            <div style={{ marginTop: 10, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8 }}>
              <span className="muted" style={{ fontSize: 11 }}>Mẫu graph</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 6, width: "100%" }}
                onClick={async () => {
                  if (dirty && !confirm("Thay graph hiện tại bằng mẫu?")) return;
                  const s = await fetchSampleWorkflow();
                  setName(s.name || "Mẫu Ảnh→Video");
                  setNodes(attachHandlers((s.nodes as Node[]) || []));
                  setEdges((s.edges as Edge[]) || []);
                  setRunResult(null);
                  setDirty(true);
                  requestAnimationFrame(() => rf.current?.fitView({ padding: 0.2 }));
                }}
              >
                Mẫu: Ảnh→Video
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 6, width: "100%" }}
                title="Ảnh → Video1 → lấy frame cuối → Video2 tiếp"
                onClick={async () => {
                  try {
                    if (dirty && !confirm("Thay graph hiện tại bằng mẫu?")) return;
                    const s = await fetchSampleVideoChain();
                    setName(s.name || "Mẫu nối video");
                    setNodes(attachHandlers((s.nodes as Node[]) || []));
                    setEdges((s.edges as Edge[]) || []);
                    setRunResult(null);
                    setDirty(true);
                    requestAnimationFrame(() => rf.current?.fitView({ padding: 0.15 }));
                  } catch (e) {
                    onError(e instanceof Error ? e.message : String(e));
                  }
                }}
              >
                Mẫu: Nối video (frame cuối)
              </button>
            </div>
          </div>
        </aside>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            borderRadius: 12,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.08)",
            background: "#0c0e12",
          }}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChangeTracked}
            onEdgesChange={onEdgesChangeTracked}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onInit={(instance) => {
              rf.current = instance;
            }}
            fitView
            colorMode="dark"
            deleteKeyCode={["Backspace", "Delete"]}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              animated: true,
              style: { stroke: "#64748b", strokeWidth: 2 },
            }}
          >
            <Background gap={18} size={1} />
            <MiniMap
              style={{ background: "#151820" }}
              nodeColor={(n) => NODE_COLORS[n.type || ""] || "#555"}
            />
            <Controls />
          </ReactFlow>
        </div>

        <aside style={{ width: 260, flexShrink: 0, overflow: "auto" }}>
          <div className="panel-card" style={{ padding: 12, margin: 0, marginBottom: 10 }}>
            <strong style={{ fontSize: 13 }}>Media project</strong>
            {!projectId ? (
              <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
                Lưu project hoặc chạy workflow — output vào folder project.
              </p>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 10, margin: "6px 0" }}>
                  <code>projects/{projectId.slice(0, 8)}…</code>
                </p>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 10 }}
                    onClick={() => void openProjectFolder(projectId).catch((e) => onError(String(e)))}
                  >
                    Mở folder
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 10 }}
                    onClick={() => void refreshProjectAssets(projectId)}
                  >
                    Refresh
                  </button>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 6,
                    maxHeight: 200,
                    overflow: "auto",
                  }}
                >
                  {projectAssets.length === 0 && (
                    <span className="muted" style={{ fontSize: 11, gridColumn: "1/-1" }}>
                      Chưa có file — chạy workflow
                    </span>
                  )}
                  {projectAssets.slice(0, 12).map((a) => (
                    <button
                      key={a.path}
                      type="button"
                      onClick={() => setLightbox(normalizeFileUrl(a.url))}
                      style={{
                        padding: 0,
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 6,
                        overflow: "hidden",
                        background: "#000",
                        cursor: "zoom-in",
                      }}
                      title={a.name}
                    >
                      {a.kind === "video" ? (
                        <video
                          src={normalizeFileUrl(a.url)}
                          muted
                          style={{ width: "100%", height: 64, objectFit: "cover", display: "block" }}
                        />
                      ) : (
                        <img
                          src={normalizeFileUrl(a.url)}
                          alt=""
                          style={{ width: "100%", height: 64, objectFit: "cover", display: "block" }}
                        />
                      )}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="panel-card" style={{ padding: 12, margin: 0 }}>
            <strong style={{ fontSize: 13 }}>Kết quả / log</strong>
            {!runResult && (
              <p className="muted" style={{ fontSize: 12 }}>
                Mỗi node xong sẽ <strong>hiện ảnh ngay</strong> (poll tiến độ). Node OK có nút{" "}
                <strong>Tạo lại</strong>. Thêm node mới → <strong>Tiếp tục</strong>.
              </p>
            )}
            {runResult && (
              <>
                <p style={{ fontSize: 12, margin: "8px 0" }}>
                  <span
                    style={{
                      color: runResult.status === "completed" ? "#4ade80" : "#f87171",
                      fontWeight: 600,
                    }}
                  >
                    {runResult.status}
                  </span>{" "}
                  · {runResult.run_id}
                </p>
                {runResult.error && (
                  <p className="account-error" style={{ fontSize: 11 }}>
                    {runResult.error}
                  </p>
                )}
                <div style={{ maxHeight: 140, overflow: "auto", fontSize: 11 }} className="muted">
                  {(runResult.logs || []).slice(-15).map((l, i) => (
                    <div key={i}>{l.msg}</div>
                  ))}
                </div>
                {resultPreview.map((block) => (
                  <div key={block.node} style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, opacity: 0.7 }}>
                      {block.node} · {block.status}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                      {block.urls.slice(0, 4).map((u) =>
                        isVideoUrl(u) ? (
                          <video
                            key={u}
                            src={u}
                            controls
                            style={{ width: "100%", maxHeight: 100, borderRadius: 6 }}
                          />
                        ) : (
                          <button
                            key={u}
                            type="button"
                            onClick={() => openPreview(u)}
                            style={{ padding: 0, border: "none", background: "none", cursor: "zoom-in" }}
                          >
                            <img
                              src={u}
                              alt=""
                              style={{
                                width: 72,
                                height: 72,
                                objectFit: "cover",
                                borderRadius: 6,
                                border: "1px solid rgba(255,255,255,0.1)",
                              }}
                            />
                          </button>
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
            <strong>Nối video tiếp (frame cuối)</strong>
            <br />
            Ảnh → Video1 → <em>Tách frame</em> → chấm <code>end_image</code>
            <br />
            → Video2 chấm <code>start_image</code>
            <br />
            + Prompt2 → Video2. Dùng nút <em>Mẫu: Nối video</em>.
            <br />
            <br />
            1) Prompt → Tạo ảnh → Video (start_image)
            <br />
            2) Chạy → preview trên node · Backspace xóa node
          </p>
        </aside>
      </div>

      {lightbox && (
        <div
          role="dialog"
          onClick={() => setLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,0.82)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            cursor: "zoom-out",
          }}
        >
          {isVideoUrl(lightbox) ? (
            <video
              src={lightbox}
              controls
              autoPlay
              style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 12 }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={lightbox}
              alt=""
              style={{ maxWidth: "90vw", maxHeight: "90vh", borderRadius: 12, objectFit: "contain" }}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}
    </div>
  );
}
