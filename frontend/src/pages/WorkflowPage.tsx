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
  deleteWorkflow,
  fetchSampleVideoChain,
  fetchSampleWorkflow,
  fetchWorkflow,
  listWorkflows,
  normalizeFileUrl,
  runWorkflowGraph,
  saveWorkflow,
  type WorkflowMeta,
  type WorkflowRunResult,
} from "../api";

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
  runStatus?: RunStatus;
  runError?: string;
  onChange?: (id: string, patch: Partial<WNodeData>) => void;
  onPreview?: (url: string) => void;
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
}: {
  type: string;
  title: string;
  children: ReactNode;
  selected?: boolean;
  runStatus?: RunStatus;
  runError?: string;
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
    >
      <Handle type="target" position={Position.Left} id="video" style={{ background: "#f59e0b" }} />
      <Handle type="source" position={Position.Right} id="image" style={{ top: "40%", background: "#22c55e" }} />
      <Handle type="source" position={Position.Right} id="start_image" style={{ top: "62%", background: "#14b8a6" }} />
      <Handle type="source" position={Position.Right} id="end_image" style={{ top: "82%", background: "#ec4899" }} />
      <label className="nodrag">
        Positions
        <input
          value={d.positions || "start,middle,end"}
          onChange={(e) => d.onChange?.(id, { positions: e.target.value })}
          style={{ ...fieldStyle(), marginTop: 2 }}
        />
      </label>
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

export default function WorkflowPage({ onError }: WorkflowPageProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("Untitled workflow");
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [savedList, setSavedList] = useState<WorkflowMeta[]>([]);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState("");
  const rf = useRef<ReactFlowInstance | null>(null);

  const openPreview = useCallback((url: string) => {
    setLightbox(normalizeFileUrl(url));
  }, []);

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
        },
      })),
    [openPreview, patchNode],
  );

  const refreshList = useCallback(async () => {
    try {
      setSavedList(await listWorkflows());
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const sample = await fetchSampleWorkflow();
        setName(sample.name || "Sample");
        setNodes(attachHandlers((sample.nodes as Node[]) || []));
        setEdges((sample.edges as Edge[]) || []);
        await refreshList();
        requestAnimationFrame(() => rf.current?.fitView({ padding: 0.2 }));
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [attachHandlers, onError, refreshList, setEdges, setNodes]);

  const onConnect: OnConnect = useCallback(
    (params: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            animated: true,
            style: { stroke: "#64748b", strokeWidth: 2 },
          },
          eds,
        ),
      ),
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
  }

  function stripNodeData(data: WNodeData): Record<string, unknown> {
    const {
      onChange: _c,
      onPreview: _p,
      runStatus: _s,
      runError: _e,
      // keep resultUrls so reopen still shows previews if user saved after run
      ...rest
    } = data;
    return rest as Record<string, unknown>;
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

  async function handleSave() {
    try {
      const doc = await saveWorkflow(graphPayload(), workflowId);
      setWorkflowId(doc.id || null);
      setName(doc.name);
      await refreshList();
      setSaveHint("Đã lưu");
      setTimeout(() => setSaveHint(""), 2000);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleLoad(id: string) {
    try {
      const doc = await fetchWorkflow(id);
      setWorkflowId(doc.id || id);
      setName(doc.name);
      setNodes(attachHandlers((doc.nodes as Node[]) || []));
      setEdges((doc.edges as Edge[]) || []);
      setRunResult(null);
      requestAnimationFrame(() => rf.current?.fitView({ padding: 0.2 }));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  function applyRunToNodes(result: WorkflowRunResult) {
    const nr = result.node_results || {};
    setNodes((nds) =>
      nds.map((n) => {
        const raw = nr[n.id] as
          | { status?: string; error?: string; results?: string[]; frames?: Array<{ url: string }> }
          | undefined;
        if (!raw) {
          return {
            ...n,
            data: {
              ...n.data,
              runStatus: "idle" as RunStatus,
              onChange: patchNode,
              onPreview: openPreview,
            },
          };
        }
        const status = (raw.status || "idle") as RunStatus;
        const urls = extractUrlsFromNodeResult(raw);
        return {
          ...n,
          data: {
            ...n.data,
            runStatus: status,
            runError: raw.error || undefined,
            resultUrls: urls.length ? urls : (n.data as WNodeData).resultUrls,
            // reference: sync image field if we got output
            ...(n.type === "reference" && urls[0] ? { image: urls[0] } : {}),
            onChange: patchNode,
            onPreview: openPreview,
          },
        };
      }),
    );
  }

  async function handleRun() {
    try {
      setRunning(true);
      setRunResult(null);
      // mark all media nodes pending for feedback
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: {
            ...n.data,
            runStatus: "pending" as RunStatus,
            runError: undefined,
            onChange: patchNode,
            onPreview: openPreview,
          },
        })),
      );

      const result = await runWorkflowGraph(graphPayload());
      setRunResult(result);
      applyRunToNodes(result);
      if (result.status !== "completed") {
        onError(result.error || "Workflow failed");
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
      setNodes((nds) =>
        nds.map((n) => ({
          ...n,
          data: {
            ...n.data,
            runStatus: "failed" as RunStatus,
            runError: e instanceof Error ? e.message : String(e),
            onChange: patchNode,
            onPreview: openPreview,
          },
        })),
      );
    } finally {
      setRunning(false);
    }
  }

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
          <span className="pill pill-purple">NODE EDITOR</span>
          {running && <span className="pill pill-green">Đang chạy…</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ minWidth: 160 }}
            placeholder="Tên workflow"
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleSave()}>
            Lưu{saveHint ? ` · ${saveHint}` : ""}
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
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={running || nodes.length === 0}
            onClick={() => void handleRun()}
          >
            {running ? "Đang chạy…" : "▶ Chạy workflow"}
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
            <strong style={{ fontSize: 13 }}>Đã lưu</strong>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {savedList.length === 0 && (
                <span className="muted" style={{ fontSize: 12 }}>
                  Chưa có
                </span>
              )}
              {savedList.map((w) => (
                <div key={w.id} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ flex: 1, textAlign: "left", fontSize: 11 }}
                    onClick={() => void handleLoad(w.id)}
                  >
                    {w.name}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost danger btn-sm"
                    style={{ fontSize: 11, padding: "2px 6px" }}
                    onClick={async () => {
                      if (!confirm("Xóa workflow?")) return;
                      await deleteWorkflow(w.id);
                      if (workflowId === w.id) setWorkflowId(null);
                      await refreshList();
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
              onClick={async () => {
                const s = await fetchSampleWorkflow();
                setWorkflowId(null);
                setName(s.name);
                setNodes(attachHandlers((s.nodes as Node[]) || []));
                setEdges((s.edges as Edge[]) || []);
                setRunResult(null);
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
                  const s = await fetchSampleVideoChain();
                  setWorkflowId(null);
                  setName(s.name);
                  setNodes(attachHandlers((s.nodes as Node[]) || []));
                  setEdges((s.edges as Edge[]) || []);
                  setRunResult(null);
                  requestAnimationFrame(() => rf.current?.fitView({ padding: 0.15 }));
                } catch (e) {
                  onError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Mẫu: Nối video (frame cuối)
            </button>
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
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
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
          <div className="panel-card" style={{ padding: 12, margin: 0 }}>
            <strong style={{ fontSize: 13 }}>Kết quả / log</strong>
            {!runResult && (
              <p className="muted" style={{ fontSize: 12 }}>
                Ảnh/video hiện <strong>trên từng node</strong> sau khi chạy. Click ảnh để phóng to.
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
