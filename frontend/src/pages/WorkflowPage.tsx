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
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  deleteWorkflow,
  fetchSampleWorkflow,
  fetchWorkflow,
  listWorkflows,
  runWorkflowGraph,
  saveWorkflow,
  type WorkflowMeta,
  type WorkflowRunResult,
} from "../api";

interface WorkflowPageProps {
  onError: (msg: string) => void;
}

type WNodeData = {
  title: string;
  prompt?: string;
  model?: string;
  aspect_ratio?: string;
  mode?: string;
  image?: string;
  positions?: string;
  onChange?: (id: string, patch: Partial<WNodeData>) => void;
};

const NODE_COLORS: Record<string, string> = {
  prompt: "#6366f1",
  reference: "#14b8a6",
  generate: "#22c55e",
  video_generate: "#f59e0b",
  frame_extract: "#ec4899",
};

function Shell({
  type,
  title,
  children,
  selected,
}: {
  type: string;
  title: string;
  children: ReactNode;
  selected?: boolean;
}) {
  const color = NODE_COLORS[type] || "#888";
  return (
    <div
      style={{
        minWidth: 220,
        maxWidth: 280,
        borderRadius: 10,
        border: `1px solid ${selected ? color : "rgba(255,255,255,0.12)"}`,
        background: "rgba(20,22,28,0.95)",
        boxShadow: selected ? `0 0 0 1px ${color}` : "0 4px 16px rgba(0,0,0,0.35)",
        fontSize: 12,
        color: "#e5e7eb",
      }}
    >
      <div
        style={{
          padding: "8px 10px",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          background: `${color}22`,
          borderRadius: "10px 10px 0 0",
          fontWeight: 600,
          display: "flex",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span>{title}</span>
        <span style={{ opacity: 0.6, fontWeight: 400 }}>{type}</span>
      </div>
      <div style={{ padding: 10 }}>{children}</div>
    </div>
  );
}

function PromptNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  return (
    <Shell type="prompt" title={d.title || "Prompt"} selected={selected}>
      <Handle type="source" position={Position.Right} id="prompt" style={{ background: "#6366f1" }} />
      <textarea
        className="nodrag"
        rows={4}
        value={d.prompt || ""}
        onChange={(e) => d.onChange?.(id, { prompt: e.target.value })}
        placeholder="Nhập prompt…"
        style={{
          width: "100%",
          resize: "vertical",
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          color: "inherit",
          padding: 6,
        }}
      />
    </Shell>
  );
}

function ReferenceNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  return (
    <Shell type="reference" title={d.title || "Ảnh tham chiếu"} selected={selected}>
      <Handle type="source" position={Position.Right} id="image" style={{ background: "#14b8a6" }} />
      <input
        className="nodrag"
        value={d.image || ""}
        onChange={(e) => d.onChange?.(id, { image: e.target.value })}
        placeholder="data URL /api/files/... hoặc path"
        style={{
          width: "100%",
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 6,
          color: "inherit",
          padding: 6,
        }}
      />
      <small className="muted">Hoặc dán URL ảnh kết quả từ queue</small>
    </Shell>
  );
}

function GenerateNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  return (
    <Shell type="generate" title={d.title || "Tạo ảnh"} selected={selected}>
      <Handle type="target" position={Position.Left} id="prompt" style={{ top: "30%", background: "#6366f1" }} />
      <Handle type="target" position={Position.Left} id="image" style={{ top: "70%", background: "#14b8a6" }} />
      <Handle type="source" position={Position.Right} id="image" style={{ background: "#22c55e" }} />
      <label className="nodrag" style={{ display: "block", marginBottom: 6 }}>
        Model
        <select
          value={d.model || "nano_banana_2_lite"}
          onChange={(e) => d.onChange?.(id, { model: e.target.value })}
          style={{ width: "100%", marginTop: 2 }}
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
          style={{ width: "100%", marginTop: 2 }}
        >
          <option value="1:1">1:1</option>
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
        </select>
      </label>
    </Shell>
  );
}

function VideoNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  return (
    <Shell type="video_generate" title={d.title || "Tạo video"} selected={selected}>
      <Handle type="target" position={Position.Left} id="prompt" style={{ top: "25%", background: "#6366f1" }} />
      <Handle
        type="target"
        position={Position.Left}
        id="start_image"
        style={{ top: "55%", background: "#22c55e" }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="end_image"
        style={{ top: "80%", background: "#14b8a6" }}
      />
      <Handle type="source" position={Position.Right} id="video" style={{ background: "#f59e0b" }} />
      <label className="nodrag" style={{ display: "block", marginBottom: 6 }}>
        Model
        <select
          value={d.model || "veo_31_fast"}
          onChange={(e) => d.onChange?.(id, { model: e.target.value })}
          style={{ width: "100%", marginTop: 2 }}
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
          style={{ width: "100%", marginTop: 2 }}
        >
          <option value="text_to_video">Text→Video</option>
          <option value="start_image">Start image</option>
          <option value="start_end_image">Start+End</option>
        </select>
      </label>
    </Shell>
  );
}

function FrameNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  return (
    <Shell type="frame_extract" title={d.title || "Tách frame"} selected={selected}>
      <Handle type="target" position={Position.Left} id="video" style={{ background: "#f59e0b" }} />
      <Handle type="source" position={Position.Right} id="image" style={{ top: "40%", background: "#22c55e" }} />
      <Handle
        type="source"
        position={Position.Right}
        id="start_image"
        style={{ top: "65%", background: "#14b8a6" }}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="end_image"
        style={{ top: "85%", background: "#ec4899" }}
      />
      <label className="nodrag">
        Positions
        <input
          value={d.positions || "start,middle,end"}
          onChange={(e) => d.onChange?.(id, { positions: e.target.value })}
          style={{ width: "100%", marginTop: 2 }}
        />
      </label>
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

export default function WorkflowPage({ onError }: WorkflowPageProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("Untitled workflow");
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [savedList, setSavedList] = useState<WorkflowMeta[]>([]);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<WorkflowRunResult | null>(null);
  const rf = useRef<ReactFlowInstance | null>(null);

  const patchNode = useCallback(
    (id: string, patch: Partial<WNodeData>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id
            ? {
                ...n,
                data: { ...n.data, ...patch, onChange: patchNode },
              }
            : n,
        ),
      );
    },
    [setNodes],
  );

  const attachHandlers = useCallback(
    (list: Node[]) =>
      list.map((n) => ({
        ...n,
        data: { ...(n.data as object), onChange: patchNode },
      })),
    [patchNode],
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
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [attachHandlers, onError, refreshList, setEdges, setNodes]);

  const onConnect: OnConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge({ ...params, animated: true }, eds)),
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
      onChange: patchNode,
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
      ? rf.current.screenToFlowPosition({ x: 280, y: 180 })
      : { x: 120 + Math.random() * 80, y: 100 + Math.random() * 80 };

    setNodes((nds) => [
      ...nds,
      {
        id,
        type,
        position: pos,
        data: baseData,
      },
    ]);
  }

  async function handleSave() {
    try {
      const doc = await saveWorkflow(
        {
          name,
          nodes: nodes.map(({ id, type, position, data }) => {
            const { onChange: _o, ...rest } = data as WNodeData;
            return { id, type, position, data: rest };
          }),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
          })),
          viewport: rf.current?.getViewport(),
        },
        workflowId,
      );
      setWorkflowId(doc.id || null);
      setName(doc.name);
      await refreshList();
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
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRun() {
    try {
      setRunning(true);
      setRunResult(null);
      const result = await runWorkflowGraph({
        name,
        nodes: nodes.map(({ id, type, position, data }) => {
          const { onChange: _o, ...rest } = data as WNodeData;
          return { id, type, position, data: rest };
        }),
        edges: edges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
          targetHandle: e.targetHandle,
        })),
      });
      setRunResult(result);
      if (result.status !== "completed") {
        onError(result.error || "Workflow failed");
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const resultPreview = useMemo(() => {
    if (!runResult?.node_results) return [];
    const items: { node: string; urls: string[] }[] = [];
    for (const [nidKey, raw] of Object.entries(runResult.node_results)) {
      const r = raw as { results?: string[]; frames?: Array<{ url: string }> };
      const urls = [
        ...(r.results || []),
        ...((r.frames || []).map((f) => f.url) || []),
      ].filter(Boolean);
      if (urls.length) items.push({ node: nidKey, urls });
    }
    return items;
  }, [runResult]);

  return (
    <div className="workflow-page" style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 100px)", minHeight: 520 }}>
      <header className="page-header" style={{ flexShrink: 0 }}>
        <div className="page-title-group">
          <h1>Workflow</h1>
          <span className="pill pill-purple">NODE EDITOR</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ minWidth: 180 }}
            placeholder="Tên workflow"
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void handleSave()}>
            Lưu
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
              {savedList.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Chưa có</span>}
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
              }}
            >
              Load mẫu
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
          >
            <Background gap={18} size={1} />
            <MiniMap
              style={{ background: "#151820" }}
              nodeColor={(n) => NODE_COLORS[n.type || ""] || "#555"}
            />
            <Controls />
          </ReactFlow>
        </div>

        <aside
          style={{
            width: 260,
            flexShrink: 0,
            overflow: "auto",
          }}
        >
          <div className="panel-card" style={{ padding: 12, margin: 0 }}>
            <strong style={{ fontSize: 13 }}>Kết quả chạy</strong>
            {!runResult && <p className="muted" style={{ fontSize: 12 }}>Chưa chạy</p>}
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
                <div style={{ maxHeight: 160, overflow: "auto", fontSize: 11 }} className="muted">
                  {(runResult.logs || []).slice(-12).map((l, i) => (
                    <div key={i}>{l.msg}</div>
                  ))}
                </div>
                {resultPreview.map((block) => (
                  <div key={block.node} style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 11, opacity: 0.7 }}>{block.node}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                      {block.urls.map((u) =>
                        /\.mp4($|\?)/i.test(u) ? (
                          <video
                            key={u}
                            src={u.startsWith("http") ? u : u}
                            controls
                            style={{ width: "100%", maxHeight: 120, borderRadius: 6 }}
                          />
                        ) : (
                          <img
                            key={u}
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
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
          <p className="muted" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.45 }}>
            Kéo từ chấm bên phải node → chấm trái node khác. Backspace xóa node/edge đã chọn.
            Pipeline mẫu: Prompt → Tạo ảnh → Tạo video (nối image → start_image).
          </p>
        </aside>
      </div>
    </div>
  );
}
