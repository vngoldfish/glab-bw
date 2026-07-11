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
import { Link, useSearchParams } from "react-router-dom";
import {
  browseInsertMedia,
  deleteProject,
  duplicateProject,
  fetchAllProjectAssets,
  fetchProject,
  fetchProjectAssets,
  fetchReferenceLibrary,
  fetchSampleMultiProductIsolate,
  fetchSampleProductIsolate,
  fetchSampleProductPlacement,
  fetchSampleVideoChain,
  fetchSampleWorkflow,
  fetchWorkflow,
  fetchWorkflowRun,
  listProjects,
  saveWorkflow,
  mapReferenceRecord,
  mediaUrl,
  normalizeFileUrl,
  openProjectFolder,
  rewritePromptAi,
  runWorkflowGraph,
  saveProject,
  type ProjectAsset,
  type ProjectMeta,
  type WorkflowAiNodeContext,
  type WorkflowRunResult,
} from "../api";
import { useUiDialog } from "../components/UiDialog";
import { NAV_ROUTES } from "../routes";
import type { NamedReference } from "../types";
import {
  IMAGE_MODELS,
  GROK_IMAGE_MODELS,
  META_IMAGE_MODELS,
  VIDEO_MODELS,
  GROK_VIDEO_MODELS,
  META_VIDEO_MODELS,
} from "../types";
import { findLibraryRef } from "../referenceUtils";

interface WorkflowPageProps {
  onError: (msg: string) => void;
}

type RunStatus = "idle" | "pending" | "running" | "completed" | "failed" | "skipped";

type ImageField = "image" | "start_image" | "end_image" | "video";

type WNodeData = {
  title: string;
  prompt?: string;
  engine?: string;
  model?: string;
  aspect_ratio?: string;
  mode?: string;
  image?: string;
  video?: string;
  /** Video start/end attached on node (no edge required) */
  start_image?: string;
  end_image?: string;

  positions?: string;
  /** Preview media after run (image/video URLs) */
  resultUrls?: string[];
  /** frame_extract meta for continue/reuse */
  frames?: Array<{ position: string; url: string; path?: string }>;
  folder?: string;
  refName?: string;
  runStatus?: RunStatus;
  runError?: string;
  reused?: boolean;
  onChange?: (id: string, patch: Partial<WNodeData>) => void;
  onPreview?: (url: string) => void;
  onRerun?: (id: string) => void;
  onPickImage?: (id: string, field: ImageField) => void;
  onError?: (msg: string) => void;
  /** Build graph context for AI (upstream + downstream nodes) */
  getWorkflowContext?: (nodeId: string) => WorkflowAiNodeContext[];
  /** true if an edge feeds start_image / image into this video node */
  hasStartImageInput?: boolean;
  /** true if end_image edge connected (e.g. from frame extract) */
  hasEndImageInput?: boolean;
  /** true if reference edge connected (for character reference) */
  hasReferenceInput?: boolean;
  /** true if a prompt node is connected via prompt edge */
  hasPromptInput?: boolean;
  /** AI rewrite style for this prompt node */
  promptKind?: "image" | "video";
  /** Inline prompt hint for VideoNode (when no PromptNode connected) */
  prompt_hint?: string;
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
  label,
}: {
  urls?: string[];
  onPreview?: (url: string) => void;
  max?: number;
  label?: string;
}) {
  if (!urls?.length) return null;
  // Dedupe identical URLs (frames often appear in both results + frames[])
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of urls) {
    const u = normalizeFileUrl(raw);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    list.push(u);
    if (list.length >= max) break;
  }
  if (!list.length) return null;
  const single = list.length === 1;
  const totalUnique = (() => {
    const s = new Set(urls.map((x) => normalizeFileUrl(x)).filter(Boolean));
    return s.size;
  })();
  return (
    <div className="nodrag nopan node-media-preview">
      {label ? <div className="node-media-label">{label}</div> : null}
      <div className={`node-media-grid${single ? " is-single" : ""}`}>
        {list.map((u, i) =>
          isVideoUrl(u) ? (
            <div key={`media-v-${i}`} className="node-media-item node-media-item--video">
              <video src={u} controls playsInline preload="metadata" />
              <span className="node-media-badge">VIDEO{list.length > 1 ? ` ${i + 1}` : ""}</span>
            </div>
          ) : (
            <button
              key={`media-i-${i}`}
              type="button"
              className="node-media-item node-media-item--image"
              onClick={() => onPreview?.(u)}
              title="Click phóng to"
            >
              <img src={u} alt="" loading="lazy" />
              <span className="node-media-shine" aria-hidden />
              <span className="node-media-badge">IMG{list.length > 1 ? ` ${i + 1}` : ""}</span>
            </button>
          ),
        )}
      </div>
      {totalUnique > max ? (
        <div className="node-media-more">+{totalUnique - max} media khác</div>
      ) : null}
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
      className={runStatus === "running" ? "node-running-glow" : ""}
      style={{
        minWidth: 260,
        maxWidth: 320,
        borderRadius: 14,
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
              {runStatus === "running" ? (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <span className="spin-icon" style={{ fontSize: 11, lineHeight: 1 }}>⟳</span>
                  chạy
                </span>
              ) : (
                st.label
              )}
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

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Không đọc được file"));
    reader.readAsDataURL(file);
  });
}

/** Attach existing image: upload / library / project */
function ImageAttachBar({
  nodeId,
  field,
  value,
  onChange,
  onPick,
  onPreview,
  label = "Ảnh có sẵn",
}: {
  nodeId: string;
  field: ImageField;
  value?: string;
  onChange?: (id: string, patch: Partial<WNodeData>) => void;
  onPick?: (id: string, field: ImageField) => void;
  onPreview?: (url: string) => void;
  label?: string;
}) {
  const has = Boolean(value);
  return (
    <div className="nodrag nopan node-attach-bar">
      <div className="node-attach-head">
        <span>{label}</span>
        {has ? (
          <button
            type="button"
            className="node-attach-clear"
            onClick={() =>
              onChange?.(nodeId, {
                [field]: undefined,
                ...(field === "image" ? { resultUrls: undefined } : {}),
              } as Partial<WNodeData>)
            }
          >
            Gỡ
          </button>
        ) : null}
      </div>
      {has ? (
        <button
          type="button"
          className="node-attach-thumb"
          onClick={() => value && onPreview?.(mediaUrl(value))}
          title="Xem ảnh"
        >
          <img src={mediaUrl(value!)} alt="" onError={e => { (e.target as HTMLImageElement).style.opacity = "0.3"; }} />
        </button>
      ) : (
        <div className="node-attach-actions">
          <label className="node-attach-btn">
            ⬆ Upload
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  const url = await readFileAsDataUrl(f);
                  onChange?.(nodeId, {
                    [field]: url,
                    ...(field === "image" ? { resultUrls: [url] } : {}),
                  } as Partial<WNodeData>);
                } catch {
                  /* ignore */
                }
              }}
            />
          </label>
          <button
            type="button"
            className="node-attach-btn"
            onClick={() => onPick?.(nodeId, field)}
          >
            📂 Chọn có sẵn
          </button>
        </div>
      )}
    </div>
  );
}
const handleLabelStyle = (side: "left" | "right", top: string | number): CSSProperties => ({
  position: "absolute",
  top,
  transform: "translateY(-50%)",
  [side === "left" ? "right" : "left"]: "100%",
  [side === "left" ? "marginRight" : "marginLeft"]: "8px",
  fontSize: "8px",
  fontWeight: "bold",
  color: "#f8fafc",
  pointerEvents: "none",
  whiteSpace: "nowrap",
  background: "rgba(15, 23, 42, 0.9)",
  padding: "2px 5px",
  borderRadius: "3px",
  border: "1px solid rgba(255,255,255,0.15)",
  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
});

function PromptNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  const [aiBusy, setAiBusy] = useState(false);
  // kind hint; server may override from pipeline (downstream image vs video)
  const kind = d.promptKind === "video" ? "video" : "image";

  async function handleAiRewrite() {
    const source = (d.prompt || "").trim();
    if (!source) {
      d.onError?.("Nhập ý/prompt trên node này trước khi dùng AI");
      return;
    }
    if (aiBusy) return;
    setAiBusy(true);
    try {
      // Always re-query graph so AI sees latest upstream/downstream nodes
      const workflow_context = d.getWorkflowContext?.(id) ?? [];
      const up = workflow_context.filter((c) => c.role === "upstream");
      const down = workflow_context.filter((c) => c.role === "downstream");
      // Prefer pipeline-inferred kind: if only video downstream → video, etc.
      let kindUse: "image" | "video" = kind;
      const hasVid = down.some((c) => c.type === "video_generate");
      const hasImg = down.some((c) => c.type === "generate");
      if (hasVid && !hasImg) kindUse = "video";
      else if (hasImg && !hasVid) kindUse = "image";

      const res = await rewritePromptAi({
        prompt: source,
        kind: kindUse,
        locale: "vi",
        current_node_id: id,
        workflow_context,
      });
      const next = (res.prompt || "").trim();
      if (!next) {
        d.onError?.("AI trả về prompt rỗng — kiểm tra API AI trong Cài đặt");
        return;
      }
      d.onChange?.(id, { prompt: next, promptKind: kindUse });
      if (next === source) {
        d.onError?.("AI gần như không đổi prompt — thử model/style khác trong Cài đặt");
      } else if (up.length > 0) {
        // soft status: context was used
        console.info(
          `[AI prompt] rewritten with ${up.length} upstream + ${down.length} downstream node(s)`,
        );
      }
    } catch (err) {
      d.onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  }

  // Live count for toolbar hint (graph may change while panel open)
  const ctxHint = (() => {
    try {
      const ctx = d.getWorkflowContext?.(id) ?? [];
      const up = ctx.filter((c) => c.role === "upstream").length;
      const down = ctx.filter((c) => c.role === "downstream").length;
      if (up === 0 && down === 0) return null;
      return { up, down };
    } catch {
      return null;
    }
  })();

  return (
    <Shell
      type="prompt"
      title={d.title || "Prompt"}
      selected={selected}
      runStatus={d.runStatus}
      runError={d.runError}
    >
      <Handle
        type="source"
        position={Position.Right}
        id="prompt"
        style={{ background: "#6366f1" }}
        title="Cổng xuất Prompt: Nối sang cổng Prompt của node Tạo ảnh hoặc Tạo video"
      />
      <div style={handleLabelStyle("right", "50%")}>Prompt →</div>
      <div className="nodrag node-prompt-toolbar">
        <label className="node-prompt-kind">
          Gợi ý AI
          <select
            value={kind}
            onChange={(e) =>
              d.onChange?.(id, { promptKind: e.target.value as "image" | "video" })
            }
            title="Gợi ý style AI; nếu đã nối sang Ảnh/Video, AI sẽ ưu tiên theo pipeline"
          >
            <option value="image">Viết kiểu ảnh</option>
            <option value="video">Viết kiểu video</option>
          </select>
        </label>
        <button
          type="button"
          className="node-ai-btn"
          disabled={aiBusy || !(d.prompt || "").trim()}
          onClick={() => void handleAiRewrite()}
          title={
            ctxHint
              ? `AI đọc prompt node này + ${ctxHint.up} node trước + ${ctxHint.down} node sau trên graph`
              : "AI đọc prompt node này; nối graph để phân tích node trước/sau"
          }
        >
          {aiBusy ? "AI…" : "✦ AI"}
        </button>
      </div>
      <textarea
        className="nodrag nowheel"
        rows={4}
        value={d.prompt || ""}
        onChange={(e) => d.onChange?.(id, { prompt: e.target.value })}
        placeholder="Nhập ý ngắn… AI đọc prompt này + node trước (ảnh/video/frame) rồi viết hợp lý"
        style={{ ...fieldStyle(), resize: "vertical" }}
        disabled={aiBusy}
      />
      {aiBusy ? (
        <div className="node-ai-status">
          AI đang đọc prompt hiện tại
          {ctxHint ? ` + ${ctxHint.up} node trước` : ""}
          {" → phân tích pipeline và viết lại…"}
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 10, marginTop: 6, lineHeight: 1.35 }}>
          {ctxHint ? (
            <>
              ✦ Sẽ phân tích: prompt node này
              {ctxHint.up > 0 ? ` · ${ctxHint.up} node trước` : ""}
              {ctxHint.down > 0 ? ` · ${ctxHint.down} node sau` : ""}
            </>
          ) : (
            <>✦ AI đọc prompt node này; nối sang Ảnh/Video (và node trước) để viết khớp pipeline</>
          )}
        </div>
      )}
    </Shell>
  );
}

function ReferenceNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  // MediaPreview: only use resultUrls (ImageAttachBar already shows thumb for d.image)
  const previewUrls = d.resultUrls?.length ? d.resultUrls : [];
  return (
    <Shell
      type="reference"
      title={d.title || "Ảnh có sẵn"}
      selected={selected}
      runStatus={d.runStatus}
      runError={d.runError}
    >
      <Handle
        type="source"
        position={Position.Right}
        id="image"
        style={{ background: "#14b8a6" }}
        title="Cổng xuất Ảnh: Nối sang cổng Ảnh ref của Tạo ảnh hoặc Nhân vật ref của Tạo video"
      />
      <div style={handleLabelStyle("right", "50%")}>Ảnh ref →</div>
      <ImageAttachBar
        nodeId={id}
        field="image"
        value={d.image}
        onChange={d.onChange}
        onPick={d.onPickImage}
        onPreview={d.onPreview}
        label="Gắn ảnh có sẵn"
      />
      <div style={{ marginTop: 8, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
          <span>Tên gọi trong prompt:</span>
          {d.refName && <strong style={{ color: "#14b8a6" }}>@{d.refName}</strong>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <span style={{ fontSize: 11, color: "#14b8a6", fontWeight: 700 }}>@</span>
          <input
            type="text"
            className="nodrag"
            value={d.refName || ""}
            onChange={(e) => {
              const clean = e.target.value.replace(/[^a-zA-Z0-9_]/g, "");
              d.onChange?.(id, { refName: clean, title: clean ? `@${clean}` : "Ảnh có sẵn" });
            }}
            placeholder="dat_ten_ref..."
            style={{
              flex: 1,
              background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 4,
              padding: "2px 6px",
              fontSize: 10,
              color: "#fff",
              outline: "none"
            }}
          />
        </div>
      </div>
      {previewUrls.length > 0 && !d.image && (
        <MediaPreview urls={previewUrls} onPreview={d.onPreview} max={1} label="Preview" />
      )}
      <input
        className="nodrag"
        value={
          d.image?.startsWith("data:") ? "(đã gắn file local)"
          : d.image ? (d.refName ? `@${d.refName}` : d.image)
          : ""
        }
        onChange={(e) => d.onChange?.(id, { image: e.target.value, resultUrls: e.target.value ? [e.target.value] : undefined })}
        placeholder="Hoặc dán URL /api/files/..."
        style={{ ...fieldStyle(), marginTop: 6, fontSize: 10 }}
      />
    </Shell>
  );
}

/** Attach existing video: upload / library / project */
function VideoAttachBar({
  nodeId,
  field,
  value,
  onChange,
  onPick,
  onPreview,
  label = "Video có sẵn",
}: {
  nodeId: string;
  field: "video";
  value?: string;
  onChange?: (id: string, patch: Partial<WNodeData>) => void;
  onPick?: (id: string, field: "video") => void;
  onPreview?: (url: string) => void;
  label?: string;
}) {
  const has = Boolean(value);
  return (
    <div className="nodrag nopan node-attach-bar">
      <div className="node-attach-head">
        <span>{label}</span>
        {has ? (
          <button
            type="button"
            className="node-attach-clear"
            onClick={() =>
              onChange?.(nodeId, {
                [field]: undefined,
                resultUrls: undefined,
              } as Partial<WNodeData>)
            }
          >
            Gỡ
          </button>
        ) : null}
      </div>
      {has ? (
        <button
          type="button"
          className="node-attach-thumb node-attach-thumb--video"
          onClick={() => value && onPreview?.(mediaUrl(value))}
          title="Xem video"
          style={{ position: "relative" }}
        >
          <video src={mediaUrl(value!)} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          <span style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "rgba(0,0,0,0.25)", color: "#fff", fontSize: 16 }}>▶</span>
        </button>
      ) : (
        <div className="node-attach-actions">
          <label className="node-attach-btn">
            ⬆ Upload
            <input
              type="file"
              accept="video/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try {
                  const url = await readFileAsDataUrl(f);
                  onChange?.(nodeId, {
                    [field]: url,
                    resultUrls: [url],
                  } as Partial<WNodeData>);
                } catch {
                  /* ignore */
                }
              }}
            />
          </label>
          <button
            type="button"
            className="node-attach-btn"
            onClick={() => onPick?.(nodeId, field)}
          >
            📂 Chọn có sẵn
          </button>
        </div>
      )}
    </div>
  );
}

function VideoReferenceNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  const previewUrls = d.resultUrls?.length ? d.resultUrls : [];
  return (
    <Shell
      type="video_reference"
      title={d.title || "Video có sẵn"}
      selected={selected}
      runStatus={d.runStatus}
      runError={d.runError}
    >
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        style={{ background: "#f59e0b" }}
        title="Cổng xuất Video: Nối sang cổng Video gốc của node Tách frame"
      />
      <div style={handleLabelStyle("right", "50%")}>Video ref →</div>
      <VideoAttachBar
        nodeId={id}
        field="video"
        value={d.video}
        onChange={d.onChange}
        onPick={d.onPickImage}
        onPreview={d.onPreview}
        label="Gắn video có sẵn"
      />
      {previewUrls.length > 0 && !d.video && (
        <MediaPreview urls={previewUrls} onPreview={d.onPreview} max={1} label="Preview" />
      )}
      <input
        className="nodrag"
        value={
          d.video?.startsWith("data:") ? "(đã gắn file local)"
          : d.video || ""
        }
        onChange={(e) => d.onChange?.(id, { video: e.target.value, resultUrls: e.target.value ? [e.target.value] : undefined })}
        placeholder="Hoặc dán URL /api/files/..."
        style={{ ...fieldStyle(), marginTop: 6, fontSize: 10 }}
      />
    </Shell>
  );
}

function GenerateNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  const [aiBusy, setAiBusy] = useState(false);
  const hasPromptEdge = Boolean(d.hasPromptInput);

  async function handleAiImagePrompt() {
    const source = (d.prompt || "").trim();
    if (!source) {
      d.onError?.("Nhập ý/prompt ảnh trên node này trước khi dùng AI");
      return;
    }
    if (aiBusy) return;
    setAiBusy(true);
    try {
      const workflow_context = d.getWorkflowContext?.(id) ?? [];
      const res = await rewritePromptAi({
        prompt: source,
        kind: "image",
        current_node_id: id,
        workflow_context,
      });
      const next = (res.prompt || "").trim();
      if (!next) {
        d.onError?.("AI trả về prompt rỗng — kiểm tra API AI trong Cài đặt");
        return;
      }
      d.onChange?.(id, { prompt: next });
    } catch (err) {
      d.onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  }

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
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        style={{ top: "22%", background: "#6366f1" }}
        title="Cổng nhận Prompt: Nối từ node Prompt"
      />
      <div style={handleLabelStyle("left", "22%")}>← Prompt</div>

      <Handle
        type="target"
        position={Position.Left}
        id="image"
        style={{ top: "42%", background: "#14b8a6" }}
        title="Cổng nhận Ảnh ref: Nối từ Ảnh có sẵn hoặc ảnh kết quả khác"
      />
      <div style={handleLabelStyle("left", "42%")}>← Ảnh ref</div>

      <Handle
        type="source"
        position={Position.Right}
        id="image"
        style={{ background: "#22c55e" }}
        title="Cổng xuất Ảnh kết quả: Nối sang cổng Ảnh đầu hoặc Khung cuối của Tạo video"
      />
      <div style={handleLabelStyle("right", "50%")}>Ảnh kết quả →</div>
      <label className="nodrag" style={{ display: "block", marginBottom: 6 }}>
        Công cụ
        <select
          value={d.engine || "flow"}
          onChange={(e) => {
            const nextEngine = e.target.value;
            const defaultModel =
              nextEngine === "grok" ? "grok-3"
              : nextEngine === "meta" ? "midjen-base"
              : "nano_banana_2_lite";
            d.onChange?.(id, { engine: nextEngine, model: defaultModel });
          }}
          style={{ ...fieldStyle(), marginTop: 2 }}
        >
          <option value="flow">Google Flow</option>
          <option value="grok">Grok Imagine</option>
          <option value="meta">Meta AI</option>
        </select>
      </label>
      <label className="nodrag" style={{ display: "block", marginBottom: 6 }}>
        Model
        <select
          value={d.model || (d.engine === "grok" ? "grok-3" : d.engine === "meta" ? "midjen-base" : "nano_banana_2_lite")}
          onChange={(e) => d.onChange?.(id, { model: e.target.value })}
          style={{ ...fieldStyle(), marginTop: 2 }}
        >
          {(!d.engine || d.engine === "flow") &&
            IMAGE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          {d.engine === "grok" &&
            GROK_IMAGE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          {d.engine === "meta" &&
            META_IMAGE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
        </select>
      </label>
      <label className="nodrag" style={{ display: "block", marginBottom: 6 }}>
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

      {/* Prompt hint + AI button — hiện khi không có PromptNode nối */}
      {!hasPromptEdge && (
        <div className="nodrag" style={{ marginBottom: 8 }}>
          <div className="node-prompt-toolbar" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>Prompt ảnh</span>
            <button
              type="button"
              className="node-ai-btn"
              disabled={aiBusy || !(d.prompt || "").trim()}
              onClick={() => void handleAiImagePrompt()}
              title="AI viết lại prompt ảnh cho tốt"
            >
              {aiBusy ? "AI…" : "✦ AI"}
            </button>
          </div>
          <textarea
            className="nodrag nowheel"
            rows={3}
            value={d.prompt || ""}
            onChange={(e) => d.onChange?.(id, { prompt: e.target.value })}
            placeholder="Nhập ý ngắn… AI sẽ viết thành prompt ảnh hoàn chỉnh"
            style={{ ...fieldStyle(), resize: "vertical", fontSize: 11 }}
            disabled={aiBusy}
          />
          {aiBusy && (
            <div className="node-ai-status">AI đang viết prompt ảnh…</div>
          )}
        </div>
      )}

      {hasPromptEdge && (
        <div className="node-edge-hint" style={{ marginBottom: 6, borderColor: "rgba(99,102,241,0.3)", color: "#818cf8" }}>
          ✓ Đã nối node Prompt
        </div>
      )}

      <ImageAttachBar
        nodeId={id}
        field="image"
        value={d.image}
        onChange={d.onChange}
        onPick={d.onPickImage}
        onPreview={d.onPreview}
        label="Ảnh ref (có sẵn)"
      />
      {d.image && (
        <div style={{ marginTop: 6, padding: "6px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 6, border: "1px solid rgba(255,255,255,0.05)" }}>
          <div style={{ fontSize: 9, color: "#94a3b8", marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
            <span>Tên gọi ảnh ref trong prompt:</span>
            {d.refName && <strong style={{ color: "#14b8a6" }}>@{d.refName}</strong>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 11, color: "#14b8a6", fontWeight: 700 }}>@</span>
            <input
              type="text"
              className="nodrag"
              value={d.refName || ""}
              onChange={(e) => {
                const clean = e.target.value.replace(/[^a-zA-Z0-9_]/g, "");
                d.onChange?.(id, { refName: clean });
              }}
              placeholder="ten_anh_ref..."
              style={{
                flex: 1,
                background: "rgba(0,0,0,0.25)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 4,
                padding: "2px 6px",
                fontSize: 10,
                color: "#fff",
                outline: "none"
              }}
            />
          </div>
        </div>
      )}
      {d.resultUrls?.length ? (
        <MediaPreview urls={d.resultUrls} onPreview={d.onPreview} label="Kết quả gen" />
      ) : (
        <div className="node-media-empty">
          {d.runStatus === "running" || d.runStatus === "pending"
            ? "Đang tạo ảnh…"
            : "Ảnh kết quả gen hiện ở đây"}
        </div>
      )}
    </Shell>
  );
}

function VideoNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  const [aiBusy, setAiBusy] = useState(false);
  // Ảnh đầu: từ edge (node ảnh) HOẶC upload khi không nối
  const fromEdge = Boolean(d.hasStartImageInput);
  const hasStart = fromEdge || Boolean(d.start_image);
  const hasEndEdge = Boolean(d.hasEndImageInput);
  const hasRefEdge = Boolean(d.hasReferenceInput);
  // Check xem có PromptNode nối vào không
  const hasPromptEdge = Boolean(d.hasPromptInput);

  // Mode tự suy: text | start | start+end | components (reference)
  const modeLabel = hasEndEdge
    ? "Ảnh đầu + khung cuối (từ node frame)"
    : hasStart
      ? "Từ ảnh → video"
      : hasRefEdge
        ? "Từ text → video (Tham chiếu nhân vật)"
        : "Từ text → video";

  async function handleAiVideoPrompt() {
    const source = (d.prompt_hint || "").trim();
    if (!source) {
      d.onError?.("Nhập ý/prompt video trên node này trước khi dùng AI");
      return;
    }
    if (aiBusy) return;
    setAiBusy(true);
    try {
      const workflow_context = d.getWorkflowContext?.(id) ?? [];
      const res = await rewritePromptAi({
        prompt: source,
        kind: "video",
        locale: "vi",
        current_node_id: id,
        workflow_context,
      });
      const next = (res.prompt || "").trim();
      if (!next) {
        d.onError?.("AI trả về prompt rỗng — kiểm tra API AI trong Cài đặt");
        return;
      }
      d.onChange?.(id, { prompt_hint: next });
    } catch (err) {
      d.onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setAiBusy(false);
    }
  }

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
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        style={{ top: "18%", background: "#6366f1" }}
        title="Cổng nhận Prompt: Nối từ node Prompt"
      />
      <div style={handleLabelStyle("left", "18%")}>← Prompt</div>

      <Handle
        type="target"
        position={Position.Left}
        id="start_image"
        style={{ top: "38%", background: "#22c55e" }}
        title="Cổng nhận Ảnh đầu: Nối từ node Tạo ảnh hoặc cổng end_image của Tách frame"
      />
      <div style={handleLabelStyle("left", "38%")}>← Ảnh đầu</div>

      <Handle
        type="target"
        position={Position.Left}
        id="reference"
        style={{ top: "58%", background: "#06b6d4" }}
        title="Cổng nhận Nhân vật ref: Nối từ node Ảnh có sẵn để giữ nhất quán nhân vật"
      />
      <div style={handleLabelStyle("left", "58%")}>← Nhân vật ref</div>

      <Handle
        type="target"
        position={Position.Left}
        id="end_image"
        style={{ top: "78%", background: "#14b8a6" }}
        title="Cổng nhận Khung cuối: Nối từ cổng end_image của node Tách frame (Video-to-Video)"
      />
      <div style={handleLabelStyle("left", "78%")}>← Khung cuối</div>

      <Handle
        type="source"
        position={Position.Right}
        id="video"
        style={{ background: "#f59e0b" }}
        title="Cổng xuất Video kết quả: Nối sang cổng Video của node Tách frame"
      />
      <div style={handleLabelStyle("right", "50%")}>Video kết quả →</div>
      <label className="nodrag" style={{ display: "block", marginBottom: 6 }}>
        Công cụ
        <select
          value={d.engine || "flow"}
          onChange={(e) => {
            const nextEngine = e.target.value;
            const defaultModel =
              nextEngine === "grok" ? "grok-3"
              : nextEngine === "meta" ? "meta-video"
              : "veo_31_fast";
            d.onChange?.(id, { engine: nextEngine, model: defaultModel });
          }}
          style={{ ...fieldStyle(), marginTop: 2 }}
        >
          <option value="flow">Google Flow</option>
          <option value="grok">Grok Imagine</option>
          <option value="meta">Meta AI</option>
        </select>
      </label>
      <label className="nodrag" style={{ display: "block", marginBottom: 6 }}>
        Model
        <select
          value={d.model || (d.engine === "grok" ? "grok-3" : d.engine === "meta" ? "meta-video" : "veo_31_fast")}
          onChange={(e) => d.onChange?.(id, { model: e.target.value })}
          style={{ ...fieldStyle(), marginTop: 2 }}
        >
          {(!d.engine || d.engine === "flow") &&
            VIDEO_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          {d.engine === "grok" &&
            GROK_VIDEO_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          {d.engine === "meta" &&
            META_VIDEO_MODELS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
        </select>
      </label>
      <div className="node-config-compact nodrag" style={{ marginBottom: 8 }}>
        <span>{modeLabel}</span>
      </div>

      {/* Prompt hint + AI button — hiện khi không có PromptNode nối */}
      {!hasPromptEdge && (
        <div className="nodrag" style={{ marginBottom: 8 }}>
          <div className="node-prompt-toolbar" style={{ marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: "#94a3b8" }}>Prompt video</span>
            <button
              type="button"
              className="node-ai-btn"
              disabled={aiBusy || !(d.prompt_hint || "").trim()}
              onClick={() => void handleAiVideoPrompt()}
              title="AI viết lại prompt video cho tốt"
            >
              {aiBusy ? "AI…" : "✦ AI"}
            </button>
          </div>
          <textarea
            className="nodrag nowheel"
            rows={3}
            value={d.prompt_hint || ""}
            onChange={(e) => d.onChange?.(id, { prompt_hint: e.target.value })}
            placeholder="Nhập ý ngắn… AI sẽ viết thành prompt video hoàn chỉnh"
            style={{ ...fieldStyle(), resize: "vertical", fontSize: 11 }}
            disabled={aiBusy}
          />
          {aiBusy && (
            <div className="node-ai-status">AI đang viết prompt video…</div>
          )}
        </div>
      )}

      {hasPromptEdge && (
        <div className="node-edge-hint" style={{ marginBottom: 6, borderColor: "rgba(99,102,241,0.3)", color: "#818cf8" }}>
          ✓ Đã nối node Prompt
        </div>
      )}

      {hasRefEdge && (
        <div className="node-edge-hint" style={{ marginBottom: 6, borderColor: "rgba(6,182,212,0.3)", color: "#06b6d4" }}>
          ✓ Đã nối nhân vật tham chiếu
        </div>
      )}

      {fromEdge ? (
        <div className="node-edge-hint">
          ✓ Ảnh đầu lấy từ node ảnh đã nối
        </div>
      ) : (
        <ImageAttachBar
          nodeId={id}
          field="start_image"
          value={d.start_image}
          onChange={(nid, patch) => {
            // auto mode when user attaches start image
            d.onChange?.(nid, {
              ...patch,
              mode: patch.start_image ? "start_image" : "text_to_video",
            });
          }}
          onPick={d.onPickImage}
          onPreview={d.onPreview}
          label="Ảnh đầu (khi không nối node ảnh)"
        />
      )}

      {hasEndEdge ? (
        <div className="node-edge-hint" style={{ marginTop: 6 }}>
          ✓ Khung cuối lấy từ node Tách frame
        </div>
      ) : (
        <div className="muted" style={{ fontSize: 10, marginTop: 6, lineHeight: 1.4 }}>
          Khung cuối: nối node <strong>Tách frame</strong> → chấm <code>end_image</code>
        </div>
      )}

      {d.resultUrls?.length ? (
        <MediaPreview urls={d.resultUrls} onPreview={d.onPreview} max={2} label="Kết quả video" />
      ) : (
        <div className="node-media-empty">
          {d.runStatus === "running" || d.runStatus === "pending"
            ? "Đang tạo video…"
            : "Video kết quả hiện ở đây"}
        </div>
      )}
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
      <Handle
        type="target"
        position={Position.Left}
        id="video"
        style={{ background: "#f59e0b" }}
        title="Cổng nhận Video gốc: Nối từ cổng Video của node Tạo video"
      />
      <div style={handleLabelStyle("left", "50%")}>← Video gốc</div>

      <Handle
        type="source"
        position={Position.Right}
        id="image"
        style={{ top: "40%", background: "#22c55e" }}
        title="Cổng xuất Mọi frame: Trích xuất tất cả các frame của video"
      />
      <div style={handleLabelStyle("right", "40%")}>Mọi frame →</div>

      <Handle
        type="source"
        position={Position.Right}
        id="start_image"
        style={{ top: "62%", background: "#14b8a6" }}
        title="Cổng xuất Khung đầu: Chỉ lấy frame đầu tiên của video"
      />
      <div style={handleLabelStyle("right", "62%")}>Khung đầu →</div>

      <Handle
        type="source"
        position={Position.Right}
        id="end_image"
        style={{ top: "82%", background: "#ec4899" }}
        title="Cổng xuất Khung cuối: Chỉ lấy frame cuối cùng để nối video tiếp theo"
      />
      <div style={handleLabelStyle("right", "82%")}>Khung cuối →</div>
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
      {d.resultUrls?.length ? (
        <MediaPreview urls={d.resultUrls} onPreview={d.onPreview} max={3} label="Frames" />
      ) : (
        <div className="node-media-empty">
          {d.runStatus === "running" || d.runStatus === "pending"
            ? "Đang tách frame…"
            : "Frame hiện ở đây sau khi chạy"}
        </div>
      )}
    </Shell>
  );
}

/** Stable module-level maps — never recreate inside the component (RF error #002). */
const WORKFLOW_NODE_TYPES: Record<string, typeof PromptNode> = {
  prompt: PromptNode,
  reference: ReferenceNode,
  video_reference: VideoReferenceNode,
  generate: GenerateNode,
  video_generate: VideoNode,
  frame_extract: FrameNode,
};

const WORKFLOW_DEFAULT_EDGE_OPTIONS = {
  animated: true,
  style: { stroke: "#64748b", strokeWidth: 2 },
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
  const seen = new Set<string>();
  const urls: string[] = [];
  const push = (u: string) => {
    const n = normalizeFileUrl(u);
    if (!n || seen.has(n)) return;
    seen.add(n);
    urls.push(n);
  };
  for (const u of r.results || []) {
    if (typeof u === "string" && u) push(u);
  }
  for (const f of r.frames || []) {
    if (f?.url) push(f.url);
  }
  if (r.image && typeof r.image === "string" && r.image !== "(image)") {
    push(r.image);
  }
  return urls;
}

type NodeRunRaw = {
  status?: string;
  error?: string;
  results?: string[];
  frames?: Array<{ position?: string; url: string; path?: string }>;
  reused?: boolean;
  folder?: string;
  prompt?: string;
  image?: string;
};

/** Merge workflow run snapshot into node list (pure — safe for save after run). */
function mergeRunResultIntoNodes(
  list: Node[],
  result: WorkflowRunResult,
  opts?: { keepMissing?: boolean },
): Node[] {
  const nr = result.node_results || {};
  return list.map((n) => {
    const raw = nr[n.id] as NodeRunRaw | undefined;
    if (!raw) {
      if (opts?.keepMissing) return n;
      return n;
    }
    const status = (raw.status || "idle") as RunStatus;
    const urls = extractUrlsFromNodeResult(raw);
    const frames = (raw.frames || []).map((f) => ({
      position: String(f.position || ""),
      url: normalizeFileUrl(f.url),
      path: f.path,
    }));
    const prev = n.data as WNodeData;
    return {
      ...n,
      data: {
        ...prev,
        runStatus: status,
        runError: raw.error || undefined,
        reused: Boolean(raw.reused),
        folder: raw.folder ?? prev.folder,
        resultUrls: urls.length
          ? urls
          : status === "running" || status === "pending" || status === "completed"
            ? prev.resultUrls
            : prev.resultUrls,
        ...(urls.length ? { resultUrls: urls } : {}),
        ...(frames.length ? { frames } : {}),
        ...(n.type === "reference" && urls[0] ? { image: urls[0] } : {}),
      },
    };
  });
}

/**
 * Restore previews/status from saved node.data and/or node_states
 * (older saves may only have node_states).
 */
function hydrateNodesFromProject(
  rawNodes: Node[],
  nodeStates?: Record<string, unknown> | null,
): Node[] {
  const states = nodeStates || {};
  return rawNodes.map((n) => {
    const d = { ...(n.data as WNodeData) };
    const st = states[n.id] as NodeRunRaw | undefined;

    // Prefer embedded data; fall back to node_states
    if ((!d.resultUrls || !d.resultUrls.length) && st) {
      const urls = extractUrlsFromNodeResult(st);
      if (urls.length) d.resultUrls = urls;
      if (st.frames?.length && !d.frames?.length) {
        d.frames = st.frames.map((f) => ({
          position: String(f.position || ""),
          url: normalizeFileUrl(f.url),
          path: f.path,
        }));
      }
      if (st.folder && !d.folder) d.folder = st.folder;
      if (n.type === "reference" && st.image && !d.image) d.image = st.image;
    }

    if (!d.runStatus || d.runStatus === "idle") {
      if (st?.status === "completed" || (d.resultUrls && d.resultUrls.length)) {
        d.runStatus = "completed";
      } else if (st?.status && st.status !== "idle") {
        d.runStatus = st.status as RunStatus;
      }
    }

    // Normalize URLs so /api/files/... still loads after restart
    if (d.resultUrls?.length) {
      d.resultUrls = d.resultUrls.map((u) => normalizeFileUrl(u));
    }
    if (d.frames?.length) {
      d.frames = d.frames.map((f) => ({ ...f, url: normalizeFileUrl(f.url) }));
    }
    if (d.image) d.image = normalizeFileUrl(d.image);
    if (d.start_image) d.start_image = normalizeFileUrl(d.start_image);
    if (d.end_image) d.end_image = normalizeFileUrl(d.end_image);

    return { ...n, data: d };
  });
}

/**
 * If project JSON lost previews but files still exist under Media project,
 * re-attach newest assets to nodes by type (left→right on canvas).
 */
function recoverPreviewsFromAssets(list: Node[], assets: ProjectAsset[]): Node[] {
  const hasAny = list.some((n) => {
    const d = n.data as WNodeData;
    return Boolean(d.resultUrls?.length || d.frames?.length);
  });
  if (hasAny || !assets.length) return list;

  const byMtimeAsc = (a: ProjectAsset, b: ProjectAsset) =>
    Number(a.mtime || 0) - Number(b.mtime || 0);
  const isFramePath = (a: ProjectAsset) =>
    /\/frames\//i.test(a.path || "") || /frames/i.test(a.folder || "");

  const images = assets
    .filter((a) => a.kind !== "video" && !isFramePath(a))
    .sort(byMtimeAsc);
  const frames = assets.filter((a) => a.kind !== "video" && isFramePath(a)).sort(byMtimeAsc);
  const videos = assets.filter((a) => a.kind === "video").sort(byMtimeAsc);

  const genNodes = list
    .filter((n) => n.type === "generate")
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const vidNodes = list
    .filter((n) => n.type === "video_generate")
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const frameNodes = list
    .filter((n) => n.type === "frame_extract")
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);
  const refNodes = list
    .filter((n) => n.type === "reference")
    .sort((a, b) => a.position.x - b.position.x || a.position.y - b.position.y);

  const assign = new Map<string, Partial<WNodeData>>();
  // Prefer the most recent N files for N nodes (re-runs leave older copies on disk)
  const pickLast = <T,>(arr: T[], n: number) => (n <= 0 ? [] : arr.slice(Math.max(0, arr.length - n)));

  const genImgs = pickLast(images, genNodes.length);
  genNodes.forEach((n, i) => {
    const a = genImgs[i];
    if (!a) return;
    const url = normalizeFileUrl(a.url);
    assign.set(n.id, { resultUrls: [url], runStatus: "completed", folder: a.folder });
  });
  const usedImg = new Set(genImgs.map((a) => a.path));
  const leftoverImgs = images.filter((a) => !usedImg.has(a.path));
  refNodes.forEach((n, i) => {
    const d = n.data as WNodeData;
    if (d.image || d.resultUrls?.length) return;
    const a = leftoverImgs[i];
    if (!a) return;
    const url = normalizeFileUrl(a.url);
    assign.set(n.id, { image: url, resultUrls: [url], runStatus: "completed" });
  });
  const pickVids = pickLast(videos, vidNodes.length);
  vidNodes.forEach((n, i) => {
    const a = pickVids[i];
    if (!a) return;
    const url = normalizeFileUrl(a.url);
    assign.set(n.id, { resultUrls: [url], runStatus: "completed", folder: a.folder });
  });
  const pickFrames = pickLast(frames, frameNodes.length);
  frameNodes.forEach((n, i) => {
    const a = pickFrames[i];
    if (!a) return;
    const url = normalizeFileUrl(a.url);
    assign.set(n.id, {
      resultUrls: [url],
      frames: [{ position: "end", url, path: a.path }],
      runStatus: "completed",
      folder: a.folder,
    });
  });

  if (!assign.size) return list;
  return list.map((n) => {
    const patch = assign.get(n.id);
    if (!patch) return n;
    return { ...n, data: { ...(n.data as WNodeData), ...patch } };
  });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Preferred vertical order of node types within the same column. */
const LAYOUT_TYPE_ORDER: Record<string, number> = {
  prompt: 0,
  reference: 1,
  generate: 2,
  video_generate: 3,
  frame_extract: 4,
};

export type WorkflowLayoutMode = "pipeline" | "grid";

/**
 * Auto-arrange nodes for readability.
 * - pipeline: left→right by graph depth (edges), top→bottom by parent barycenter
 * - grid: group by type in columns
 */
function layoutWorkflowNodes(
  nodes: Node[],
  edges: Edge[],
  mode: WorkflowLayoutMode = "pipeline",
): Node[] {
  if (nodes.length === 0) return nodes;

  const COL_W = 420;
  const ORIGIN_X = 48;
  const ORIGIN_Y = 40;

  // Helper to dynamically estimate a node's height based on whether it has output images/videos
  const getNodeHeight = (n: Node): number => {
    const d = n.data || {};
    const hasMedia = !!(d.resultUrls?.length || d.imageUrl || d.videoUrl || d.image || d.video);
    return hasMedia ? 480 : 180;
  };

  if (mode === "grid") {
    const groups = new Map<string, Node[]>();
    for (const n of nodes) {
      const t = String(n.type || "other");
      if (!groups.has(t)) groups.set(t, []);
      groups.get(t)!.push(n);
    }
    const typeCols = Object.keys(LAYOUT_TYPE_ORDER).concat(
      [...groups.keys()].filter((t) => !(t in LAYOUT_TYPE_ORDER)),
    );
    const pos = new Map<string, { x: number; y: number }>();
    let col = 0;
    for (const t of typeCols) {
      const list = groups.get(t);
      if (!list?.length) continue;
      
      let currentY = ORIGIN_Y;
      list
        .slice()
        .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
        .forEach((n) => {
          pos.set(n.id, { x: ORIGIN_X + col * COL_W, y: currentY });
          currentY += getNodeHeight(n) + 80; // dynamic height + 80px gap
        });
      col += 1;
    }
    return nodes.map((n) => ({
      ...n,
      position: pos.get(n.id) || n.position,
    }));
  }

  // —— pipeline (layered DAG left → right) ——
  const ids = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const id of ids) {
    incoming.set(id, []);
    outgoing.set(id, []);
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target) || e.source === e.target) continue;
    outgoing.get(e.source)!.push(e.target);
    incoming.get(e.target)!.push(e.source);
  }

  // Calculate primary connections to ignore secondary reference edges for row assignment
  const primaryOutgoing = new Map<string, string[]>();
  for (const id of ids) {
    primaryOutgoing.set(id, []);
  }
  for (const id of ids) {
    const allIncomingEdges = edges.filter(
      (e) => e.target === id && ids.has(e.source) && e.source !== id
    );
    if (allIncomingEdges.length <= 1) {
      for (const e of allIncomingEdges) {
        primaryOutgoing.get(e.source)!.push(id);
      }
    } else {
      const processorEdges = allIncomingEdges.filter((e) => {
        const srcNode = nodes.find((x) => x.id === e.source);
        const t = srcNode?.type || "";
        return t === "generate" || t === "video_generate" || t === "frame_extract";
      });
      if (processorEdges.length > 0) {
        for (const e of processorEdges) {
          primaryOutgoing.get(e.source)!.push(id);
        }
      } else {
        for (const e of allIncomingEdges) {
          primaryOutgoing.get(e.source)!.push(id);
        }
      }
    }
  }

  const roots = [...ids].filter((id) => (incoming.get(id) || []).length === 0);
  const seed = roots.length ? roots : [...ids];

  // Longest-path rank from roots (relative to 0)
  const rank = new Map<string, number>();
  for (const id of seed) rank.set(id, 0);
  const q = [...seed];
  const guard = new Set<string>();
  let iterations = 0;
  while (q.length && iterations < 10000) {
    iterations++;
    const u = q.shift()!;
    const key = `${u}:${rank.get(u)}`;
    if (guard.has(key)) continue;
    guard.add(key);
    const ru = rank.get(u) || 0;
    for (const v of outgoing.get(u) || []) {
      const next = ru + 1;
      if (!rank.has(v) || next > (rank.get(v) || 0)) {
        rank.set(v, next);
        q.push(v);
      }
    }
  }
  for (const id of ids) {
    if (!rank.has(id)) rank.set(id, 0);
  }

  // Adjust rank by offset of root node type to support type-based columns
  const typeRank = (nId: string) => {
    const node = nodes.find((x) => x.id === nId);
    const t = String(node?.type || "");
    if (t === "reference") return 0;
    if (t === "generate") return 1;
    if (t === "video_generate") return 2;
    if (t === "frame_extract") return 3;
    return 0;
  };

  const getSourceRoots = (nId: string): string[] => {
    const rts: string[] = [];
    const visited = new Set<string>();
    const dfs = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      const parents = incoming.get(id) || [];
      if (parents.length === 0) {
        rts.push(id);
      } else {
        for (const p of parents) {
          dfs(p);
        }
      }
    };
    dfs(nId);
    return rts;
  };

  const finalRank = new Map<string, number>();
  for (const id of ids) {
    const depth = rank.get(id) || 0;
    const rts = getSourceRoots(id);
    const offset = rts.length ? Math.max(...rts.map(typeRank)) : 0;
    finalRank.set(id, depth + offset);
  }

  const rowMap = new Map<string, number>();
  let nextRow = 0;

  const assignRow = (nodeId: string, row: number) => {
    if (rowMap.has(nodeId)) return;
    rowMap.set(nodeId, row);
    const neighbors = [...(primaryOutgoing.get(nodeId) || [])];
    neighbors.sort((a, b) => {
      const na = nodes.find((x) => x.id === a)!;
      const nb = nodes.find((x) => x.id === b)!;
      const nameA = String(na.data?.refName || na.data?.title || na.id);
      const nameB = String(nb.data?.refName || nb.data?.title || nb.id);
      return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
    });
    neighbors.forEach((neigh, idx) => {
      if (idx === 0) {
        assignRow(neigh, row);
      } else {
        nextRow += 1;
        assignRow(neigh, nextRow);
      }
    });
  };

  const rootIds = [...ids].filter((id) => (incoming.get(id) || []).length === 0);
  rootIds.sort((a, b) => {
    const na = nodes.find((x) => x.id === a)!;
    const nb = nodes.find((x) => x.id === b)!;
    const nameA = String(na.data?.refName || na.data?.title || na.id);
    const nameB = String(nb.data?.refName || nb.data?.title || nb.id);
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
  });

  for (const rId of rootIds) {
    assignRow(rId, nextRow);
    nextRow += 1;
  }

  for (const n of nodes) {
    if (!rowMap.has(n.id)) {
      rowMap.set(n.id, nextRow);
      nextRow += 1;
    }
  }

  // Calculate dynamic heights and cumulative Y offsets for each row
  const rowHeights = new Map<number, number>();
  for (const n of nodes) {
    const row = rowMap.get(n.id) ?? 0;
    const nodeHeight = getNodeHeight(n);
    const currentMax = rowHeights.get(row) || 0;
    if (nodeHeight > currentMax) {
      rowHeights.set(row, nodeHeight);
    }
  }

  const rowY = new Map<number, number>();
  let currentY = ORIGIN_Y;
  const sortedRows = Array.from(rowHeights.keys()).sort((a, b) => a - b);
  for (const row of sortedRows) {
    rowY.set(row, currentY);
    const height = rowHeights.get(row) || 180;
    currentY += height + 80; // dynamic height + 80px gap
  }

  const positioned = new Map<string, { x: number; y: number }>();
  const seenPositions = new Set<string>();

  for (const n of nodes) {
    const r = finalRank.get(n.id) || 0;
    const row = rowMap.get(n.id) ?? 0;
    
    let x = ORIGIN_X + r * COL_W;
    let y = rowY.get(row) ?? ORIGIN_Y;
    
    // Exact coordinate collision resolver (safety net to prevent any two nodes from overlapping)
    let posKey = `${x}:${y}`;
    let safety = 0;
    while (seenPositions.has(posKey) && safety < 100) {
      y += getNodeHeight(n) + 80; // shift down by node's height + gap
      posKey = `${x}:${y}`;
      safety++;
    }
    seenPositions.add(posKey);
    
    positioned.set(n.id, { x, y });
  }

  return nodes.map((n) => ({
    ...n,
    position: positioned.get(n.id) || n.position,
  }));
}

export default function WorkflowPage({ onError }: WorkflowPageProps) {
  const dialog = useUiDialog();
  const [searchParams, setSearchParams] = useSearchParams();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState("Project mới");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [running, setRunning] = useState(false);
  const [, setRunResult] = useState<WorkflowRunResult | null>(null);
  const [progressLabel, setProgressLabel] = useState("");
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState("");
  const [dirty, setDirty] = useState(false);
  const [projectAssets, setProjectAssets] = useState<ProjectAsset[]>([]);
  /** Sidebar media column: Image / Video tabs (newest first) */
  const [mediaTab, setMediaTab] = useState<"image" | "video">("image");
  const [picker, setPicker] = useState<{ nodeId: string; field: ImageField } | null>(null);
  const [pickerTab, setPickerTab] = useState<"project" | "library" | "all_projects" | "flow_image">("project");
  const [library, setLibrary] = useState<NamedReference[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [allProjectsAssets, setAllProjectsAssets] = useState<ProjectAsset[]>([]);
  const [flowAssets, setFlowAssets] = useState<ProjectAsset[]>([]);
  const [bulkBoxes, setBulkBoxes] = useState<Array<{ id: string; type: "generate" | "video_generate"; prompts: string }>>([]);
  const [showBulkPopup, setShowBulkPopup] = useState(false);
  /** Only mount ReactFlow when wrapper has real px size (avoids RF error #004). */
  const [canvasReady, setCanvasReady] = useState(false);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const rf = useRef<ReactFlowInstance | null>(null);
  // Freeze prop identity for the lifetime of this mount
  const nodeTypesRef = useRef(WORKFLOW_NODE_TYPES);
  const edgeOptsRef = useRef(WORKFLOW_DEFAULT_EDGE_OPTIONS);
  const nodesRef = useRef<Node[]>([]);
  const pollStop = useRef(false);
  const projectIdRef = useRef<string | null>(null);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    (window as any).workflowDirty = dirty;
    return () => {
      (window as any).workflowDirty = false;
    };
  }, [dirty]);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "Bạn có thay đổi chưa lưu. Bạn có chắc chắn muốn rời đi?";
        return e.returnValue;
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [dirty]);

  // Measure canvas wrapper — RF needs non-zero width/height before first paint
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      setCanvasReady(width > 8 && height > 8);
    };
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const refreshProjectAssets = useCallback(async (id: string | null) => {
    if (!id) {
      setProjectAssets([]);
      return;
    }
    try {
      const data = await fetchProjectAssets(id);
      // Backend already sorts mtime desc (mới → cũ); keep client sort as safety
      const sorted = [...data.assets].sort(
        (a, b) => Number(b.mtime || 0) - Number(a.mtime || 0),
      );
      setProjectAssets(sorted.slice(0, 120));
    } catch {
      /* ignore */
    }
  }, []);

  const mediaSidebarAssets = useMemo(() => {
    const filtered = projectAssets.filter((a) =>
      mediaTab === "video" ? a.kind === "video" : a.kind !== "video",
    );
    // Mới nhất trên · dedupe by path (same frame can appear twice)
    const seen = new Set<string>();
    const unique: ProjectAsset[] = [];
    for (const a of [...filtered].sort(
      (x, y) => Number(y.mtime || 0) - Number(x.mtime || 0),
    )) {
      const k = a.path || a.url || a.name;
      if (!k || seen.has(k)) continue;
      seen.add(k);
      unique.push(a);
    }
    return unique;
  }, [projectAssets, mediaTab]);

  const mediaCounts = useMemo(() => {
    let images = 0;
    let videos = 0;
    for (const a of projectAssets) {
      if (a.kind === "video") videos += 1;
      else images += 1;
    }
    return { images, videos };
  }, [projectAssets]);

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  const openPreview = useCallback((url: string) => {
    setLightbox(normalizeFileUrl(url));
  }, []);

  const rerunRef = useRef<(id: string) => void>(() => undefined);
  const pickImageRef = useRef<(id: string, field: ImageField) => void>(() => undefined);
  const edgesRef = useRef<Edge[]>([]);

  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  /**
   * Collect pipeline context for AI prompt rewrite:
   * - current prompt node (full text)
   * - upstream chain (BFS hop distance): siblings feeding same consumer + their ancestors
   * - downstream consumers (image/video/frame)
   */
  const getWorkflowContext = useCallback((nodeId: string): WorkflowAiNodeContext[] => {
    const nds = nodesRef.current;
    const eds = edgesRef.current;
    const byId = new Map(nds.map((n) => [n.id, n]));

    const upstreamHop = new Map<string, number>();
    const downstreamHop = new Map<string, number>();

    // Direct ancestors of this node (rare for prompt, useful if ever wired)
    const backQ: Array<{ id: string; hop: number }> = [{ id: nodeId, hop: 0 }];
    const backSeen = new Set<string>([nodeId]);
    while (backQ.length) {
      const { id: cur, hop } = backQ.shift()!;
      for (const e of eds) {
        if (e.target === cur && !backSeen.has(e.source)) {
          backSeen.add(e.source);
          const h = hop + 1;
          upstreamHop.set(e.source, Math.min(upstreamHop.get(e.source) ?? 99, h));
          backQ.push({ id: e.source, hop: h });
        }
      }
    }

    // Forward consumers
    const fwdQ: Array<{ id: string; hop: number }> = [{ id: nodeId, hop: 0 }];
    const fwdSeen = new Set<string>([nodeId]);
    while (fwdQ.length) {
      const { id: cur, hop } = fwdQ.shift()!;
      for (const e of eds) {
        if (e.source === cur && !fwdSeen.has(e.target)) {
          fwdSeen.add(e.target);
          const h = hop + 1;
          downstreamHop.set(e.target, Math.min(downstreamHop.get(e.target) ?? 99, h));
          fwdQ.push({ id: e.target, hop: h });
        }
      }
    }

    // Siblings: other inputs into the same generate/video/frame that this prompt feeds
    // + walk their full ancestor chain (e.g. PromptA→Ảnh→Video while this is PromptB→Video)
    for (const e of eds) {
      if (e.source !== nodeId) continue;
      for (const e2 of eds) {
        if (e2.target !== e.target || e2.source === nodeId) continue;
        if (!backSeen.has(e2.source)) {
          backSeen.add(e2.source);
          upstreamHop.set(e2.source, Math.min(upstreamHop.get(e2.source) ?? 99, 1));
          // BFS ancestors of sibling
          const sq: Array<{ id: string; hop: number }> = [{ id: e2.source, hop: 1 }];
          while (sq.length) {
            const { id: cur, hop } = sq.shift()!;
            for (const e3 of eds) {
              if (e3.target === cur && !backSeen.has(e3.source)) {
                backSeen.add(e3.source);
                const h = hop + 1;
                upstreamHop.set(e3.source, Math.min(upstreamHop.get(e3.source) ?? 99, h));
                sq.push({ id: e3.source, hop: h });
              }
            }
          }
        }
      }
    }

    const pack = (
      n: Node,
      role: WorkflowAiNodeContext["role"],
      hop = 0,
    ): WorkflowAiNodeContext => {
      const d = n.data as WNodeData;
      const hasMedia = Boolean(
        d.image ||
          d.start_image ||
          d.end_image ||
          (d.resultUrls && d.resultUrls.length) ||
          d.hasStartImageInput ||
          d.hasEndImageInput ||
          (d.frames && d.frames.length),
      );
      const notes: string[] = [];
      if (d.runStatus === "completed" && d.resultUrls?.length) {
        notes.push(`has_${d.resultUrls.length}_output(s)`);
      }
      if (d.frames?.length) {
        notes.push(`frames:${d.frames.map((f) => f.position).filter(Boolean).join(",") || d.frames.length}`);
      }
      if (d.mode) notes.push(`mode=${d.mode}`);
      if (d.hasStartImageInput) notes.push("receives_start_image_from_edge");
      if (d.hasEndImageInput) notes.push("receives_end_image_from_edge");
      // Prompt nodes: keep more text so AI can continue the story
      const promptLimit = n.type === "prompt" || role === "current" ? 1200 : 600;
      return {
        id: n.id,
        type: String(n.type || ""),
        title: d.title || "",
        prompt: (d.prompt || "").slice(0, promptLimit),
        model: d.model || "",
        mode: d.mode || "",
        has_image: hasMedia,
        hop,
        note: notes.join("; ") || undefined,
        role,
      };
    };

    const out: WorkflowAiNodeContext[] = [];
    const self = byId.get(nodeId);
    if (self) out.push(pack(self, "current", 0));

    // Closest upstream first (hop 1 = direct sibling into same consumer)
    const upSorted = [...upstreamHop.entries()].sort((a, b) => a[1] - b[1]);
    for (const [uid, hop] of upSorted) {
      const n = byId.get(uid);
      if (n) out.push(pack(n, "upstream", hop));
    }
    const downSorted = [...downstreamHop.entries()].sort((a, b) => a[1] - b[1]);
    for (const [did, hop] of downSorted) {
      const n = byId.get(did);
      if (n) out.push(pack(n, "downstream", hop));
    }
    return out;
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
                  onError,
                  getWorkflowContext,
                  onRerun: (nid: string) => rerunRef.current(nid),
                  onPickImage: (nid: string, field: ImageField) => pickImageRef.current(nid, field),
                },
              }
            : n,
        ),
      );
      setDirty(true);
    },
    [getWorkflowContext, onError, openPreview, setNodes],
  );

  const attachHandlers = useCallback(
    (list: Node[]) =>
      list.map((n) => ({
        ...n,
        data: {
          ...(n.data as object),
          onChange: patchNode,
          onPreview: openPreview,
          onError,
          getWorkflowContext,
          onRerun: (nid: string) => rerunRef.current(nid),
          onPickImage: (nid: string, field: ImageField) => pickImageRef.current(nid, field),
        },
      })),
    [getWorkflowContext, onError, openPreview, patchNode],
  );

  pickImageRef.current = (id: string, field: ImageField) => {
    setPicker({ nodeId: id, field });
    if (field === "video") {
      setPickerTab(projectIdRef.current ? "project" : "flow_image");
    } else {
      setPickerTab(projectIdRef.current ? "project" : "library");
    }
  };


  useEffect(() => {
    if (!picker) return;
    setPickerLoading(true);
    void (async () => {
      try {
        const isVideo = picker.field === "video";
        if (pickerTab === "library") {
          const data = await fetchReferenceLibrary();
          setLibrary(data.references.map(mapReferenceRecord));
        } else if (pickerTab === "all_projects") {
          const data = await fetchAllProjectAssets(isVideo ? "video" : "image", 300);
          setAllProjectsAssets(data.assets);
        } else if (pickerTab === "flow_image") {
          const data = await browseInsertMedia({
            source: isVideo ? "flow_video" : "flow_image",
            kind: isVideo ? "video" : "image",
          });
          setFlowAssets(data.assets || []);
        } else if (projectIdRef.current) {
          const data = await fetchProjectAssets(projectIdRef.current, isVideo ? "video" : "image");
          setProjectAssets(data.assets);
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      } finally {
        setPickerLoading(false);
      }
    })();
  }, [picker, pickerTab, onError]);


  // Fetch library whenever bulk popup opens (ensure @mention auto-link has fresh data)
  useEffect(() => {
    if (!showBulkPopup) return;
    void (async () => {
      try {
        const data = await fetchReferenceLibrary();
        setLibrary(data.references.map(mapReferenceRecord));
      } catch {
        // silent – library hint will just be empty
      }
    })();
  }, [showBulkPopup]);

  function applyPickedImage(url: string, refName?: string) {
    if (!picker) return;
    const { nodeId, field } = picker;
    const patch: Partial<WNodeData> = { [field]: url };
    if (field === "image") {
      patch.resultUrls = [url];
      if (refName) {
        patch.title = `@${refName}`;
        patch.refName = refName;
      }
    } else if (field === "video") {
      patch.resultUrls = [url];
    } else if (refName) {
      patch.refName = refName;
    }

    // video mode auto when attaching start
    if (field === "start_image" || field === "end_image") {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      if (node?.type === "video_generate") {
        const d = node.data as WNodeData;
        if (field === "end_image" || d.end_image) {
          patch.mode = "start_end_image";
        } else {
          patch.mode = "start_image";
        }
      }
    }
    patchNode(nodeId, patch);
    setPicker(null);
  }

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

        // Check for template parameters
        const tKey = searchParams.get("template");
        const ctId = searchParams.get("customTemplate");

        if (tKey) {
          let s = null;
          if (tKey === "default") s = await fetchSampleWorkflow();
          else if (tKey === "video-chain") s = await fetchSampleVideoChain();
          else if (tKey === "product-isolate") s = await fetchSampleProductIsolate();
          else if (tKey === "product-placement") s = await fetchSampleProductPlacement();
          else if (tKey === "multi-product-isolate") s = await fetchSampleMultiProductIsolate();

          if (s) {
            setProjectId(null);
            setName(s.name || "Mẫu");
            setDescription("");
            setNodes(attachHandlers((s.nodes as Node[]) || []));
            setEdges((s.edges as Edge[]) || []);
            setDirty(true);
            setProjectAssets([]);
            setSearchParams({});
            requestAnimationFrame(() => rf.current?.fitView({ padding: 0.2 }));
            return;
          }
        } else if (ctId) {
          const s = await fetchWorkflow(ctId);
          if (s) {
            setProjectId(null);
            setName(s.name || "Mẫu Custom");
            setDescription(s.description || "");
            setNodes(attachHandlers((s.nodes as Node[]) || []));
            setEdges((s.edges as Edge[]) || []);
            setDirty(true);
            setProjectAssets([]);
            setSearchParams({});
            requestAnimationFrame(() => rf.current?.fitView({ padding: 0.2 }));
            return;
          }
        }

        const qid = searchParams.get("project");
        const list = await listProjects();
        const openId = qid && list.find((p) => p.id === qid) ? qid : list[0]?.id;
        if (openId) {
          const doc = await fetchProject(openId);
          setProjectId(doc.id);
          setName(doc.name || "Project");
          setDescription(doc.description || "");
          let assets: ProjectAsset[] = [];
          try {
            const media = await fetchProjectAssets(openId);
            assets = media.assets || [];
            setProjectAssets(
              [...assets].sort((a, b) => Number(b.mtime || 0) - Number(a.mtime || 0)).slice(0, 120),
            );
          } catch {
            /* ignore */
          }
          const loaded = loadProjectNodes(doc, assets);
          nodesRef.current = loaded;
          setNodes(loaded);
          setEdges((doc.edges as Edge[]) || []);
          // Persist recovered previews so next reload keeps them
          const needsPersist = loaded.some((n) => {
            const d = n.data as WNodeData;
            return d.runStatus === "completed" && Boolean(d.resultUrls?.length);
          });
          const hadSaved = ((doc.nodes as Node[]) || []).some((n) => {
            const d = (n.data || {}) as WNodeData;
            return Boolean(d.resultUrls?.length);
          });
          if (needsPersist && !hadSaved) {
            try {
              await saveProject(
                projectPayload(loaded, (doc.edges as Edge[]) || [], {
                  name: doc.name || "Project",
                  description: doc.description || "",
                }),
                openId,
              );
              setDirty(false);
            } catch {
              setDirty(true);
            }
          } else {
            setDirty(false);
          }
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
  }, [attachHandlers, onError, refreshProjectAssets, refreshProjects, searchParams, setSearchParams, setEdges, setNodes]);

  // mark dirty when graph edits
  const onNodesChangeTracked: typeof onNodesChange = useCallback(
    (changes) => {
      onNodesChange(changes);
      const hasRealEdit = changes.some(
        (c) => c.type !== "select" && c.type !== "dimensions",
      );
      if (hasRealEdit) {
        setDirty(true);
      }
    },
    [onNodesChange],
  );
  const onEdgesChangeTracked: typeof onEdgesChange = useCallback(
    (changes) => {
      onEdgesChange(changes);
      const hasRealEdit = changes.some((c) => c.type !== "select");
      if (hasRealEdit) {
        setDirty(true);
      }
    },
    [onEdgesChange],
  );

  // Sync edge flags into video nodes: hide start-image upload when image node is connected
  useEffect(() => {
    setNodes((nds) => {
      let changed = false;
      const next = nds.map((n) => {
        if (n.type !== "video_generate" && n.type !== "generate") return n;

        if (n.type === "generate") {
          const hasPrompt = edges.some(
            (e) => e.target === n.id && e.targetHandle === "prompt",
          );
          const hasRef = edges.some(
            (e) => e.target === n.id && e.targetHandle === "image",
          );
          const d = n.data as WNodeData;
          if (d.hasPromptInput === hasPrompt && d.hasReferenceInput === hasRef) {
            return n;
          }
          changed = true;
          return {
            ...n,
            data: {
              ...d,
              hasPromptInput: hasPrompt,
              hasReferenceInput: hasRef,
              onChange: patchNode,
              onPreview: openPreview,
              onError,
              getWorkflowContext,
              onRerun: (nid: string) => rerunRef.current(nid),
              onPickImage: (nid: string, field: ImageField) => pickImageRef.current(nid, field),
            }
          };
        }

        const hasStart = edges.some(
          (e) =>
            e.target === n.id &&
            (e.targetHandle === "start_image" || e.targetHandle === "image" || !e.targetHandle),
        );
        // also count edges from image outputs that target start_image specifically
        const hasStartStrict = edges.some(
          (e) =>
            e.target === n.id &&
            (e.targetHandle === "start_image" || e.targetHandle === "image"),
        );
        const hasEnd = edges.some(
          (e) => e.target === n.id && e.targetHandle === "end_image",
        );
        const hasRef = edges.some(
          (e) => e.target === n.id && e.targetHandle === "reference",
        );
        const hasPrompt = edges.some(
          (e) => e.target === n.id && e.targetHandle === "prompt",
        );
        const startFlag = hasStartStrict || hasStart;
        const d = n.data as WNodeData;
        if (
          d.hasStartImageInput === startFlag &&
          d.hasEndImageInput === hasEnd &&
          d.hasReferenceInput === hasRef &&
          d.hasPromptInput === hasPrompt
        ) {
          return n;
        }
        changed = true;
        // auto mode from connections
        let mode = d.mode;
        if (hasEnd && startFlag) mode = "start_end_image";
        else if (startFlag || d.start_image) mode = "start_image";
        else if (hasRef) mode = "components";
        else if (!d.start_image) mode = "text_to_video";
        return {
          ...n,
          data: {
            ...d,
            hasStartImageInput: startFlag,
            hasEndImageInput: hasEnd,
            hasReferenceInput: hasRef,
            hasPromptInput: hasPrompt,
            mode,
            // clear local start upload when edge provides image
            ...(startFlag ? { start_image: undefined } : {}),
            onChange: patchNode,
            onPreview: openPreview,
            onError,
            getWorkflowContext,
            onRerun: (nid: string) => rerunRef.current(nid),
            onPickImage: (nid: string, field: ImageField) => pickImageRef.current(nid, field),
          },
        };
      });
      return changed ? next : nds;
    });
  }, [edges, getWorkflowContext, onError, openPreview, patchNode, setNodes]);


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
      reference: "Ảnh có sẵn",
      video_reference: "Video có sẵn",
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
      onError,
      getWorkflowContext,
      onRerun: (nid: string) => rerunRef.current(nid),
      onPickImage: (nid: string, field: ImageField) => pickImageRef.current(nid, field),
    };
    if (type === "prompt") {
      baseData.prompt = "";
      baseData.promptKind = "image";
    }
    if (type === "generate") {
      baseData.model = "nano_banana_2_lite";
      baseData.aspect_ratio = "16:9";
    }
    if (type === "video_generate") {
      baseData.model = "veo_31_fast";
      baseData.mode = "start_image";
      baseData.aspect_ratio = "16:9";
    }
    if (type === "frame_extract") baseData.positions = "end";
    if (type === "reference") baseData.image = "";
    if (type === "video_reference") baseData.video = "";


    let screenPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    if (canvasWrapRef.current) {
      const rect = canvasWrapRef.current.getBoundingClientRect();
      screenPos = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
    const pos = rf.current
      ? rf.current.screenToFlowPosition(screenPos)
      : { x: 140 + Math.random() * 60, y: 120 + Math.random() * 60 };

    setNodes((nds) => [
      ...nds,
      { id, type, position: pos, data: baseData },
    ]);
    setDirty(true);
  }

  function addBulkNodes() {
    if (bulkBoxes.length === 0) return;

    let screenPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    if (canvasWrapRef.current) {
      const rect = canvasWrapRef.current.getBoundingClientRect();
      screenPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    const origin = rf.current ? rf.current.screenToFlowPosition(screenPos) : { x: 140, y: 120 };

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Parse each box's prompt lines, extracting numeric prefix and text
    type ParsedPrompt = { prefix: string; text: string; boxIndex: number; lineIndex: number };
    const allPrompts: ParsedPrompt[] = [];

    bulkBoxes.forEach((box, boxIndex) => {
      const lines = box.prompts.split("\n").map(l => l.trim()).filter(Boolean);
      lines.forEach((line, lineIndex) => {
        const m = line.match(/^(\d+(?:\.\d+)?)\s*(.*)/);
        if (m) {
          allPrompts.push({ prefix: m[1], text: m[2].trim() || "No prompt", boxIndex, lineIndex });
        } else {
          // No prefix → treat as auto-numbered standalone
          allPrompts.push({ prefix: `__auto_${boxIndex}_${lineIndex}`, text: line, boxIndex, lineIndex });
        }
      });
    });

    // Group by prefix: prefix → ordered list of entries (preserves box order)
    const prefixGroups = new Map<string, ParsedPrompt[]>();
    allPrompts.forEach(p => {
      if (!prefixGroups.has(p.prefix)) prefixGroups.set(p.prefix, []);
      prefixGroups.get(p.prefix)!.push(p);
    });

    // Build a stable global row index per (boxIndex, lineIndex) for Y positioning
    // Each box stacks vertically; each row inside a box adds to y offset
    const BOX_GAP = 320;  // vertical gap between row groups
    const LANE_GAP = 520; // horizontal gap between boxes (columns)
    const PROMPT_OFFSET_X = -310;

    // nodeId map: key = `${boxIndex}_${lineIndex}` → generated node id
    const nodeIdMap = new Map<string, string>();

    // Track global row for each box's line
    const boxLineRowMap = new Map<string, number>(); // `${boxIndex}_${lineIndex}` → row
    let globalRow = 0;

    // Assign rows by walking all prompts in box order
    bulkBoxes.forEach((box, boxIndex) => {
      const lines = box.prompts.split("\n").map(l => l.trim()).filter(Boolean);
      lines.forEach((_, lineIndex) => {
        boxLineRowMap.set(`${boxIndex}_${lineIndex}`, globalRow);
        globalRow++;
      });
    });

    // Create all nodes first (prompt + generator per entry)
    allPrompts.forEach((entry) => {
      const { boxIndex, lineIndex, text, prefix } = entry;
      const box = bulkBoxes[boxIndex];
      const type = box.type;
      const key = `${boxIndex}_${lineIndex}`;
      const row = boxLineRowMap.get(key) ?? 0;

      const genId = nid(type);
      const pId = nid("prompt");
      nodeIdMap.set(key, genId);

      const x = origin.x + boxIndex * LANE_GAP;
      const y = origin.y + row * BOX_GAP;
      const promptX = x + PROMPT_OFFSET_X;
      const promptY = y - 40;

      const promptData: WNodeData = {
        title: prefix.startsWith("__auto") ? `Prompt ${lineIndex + 1}` : `Prompt ${prefix}`,
        prompt: text,
        promptKind: type === "video_generate" ? "video" : "image",
        runStatus: "idle",
        onChange: patchNode,
        onPreview: openPreview,
        onError,
        getWorkflowContext,
        onRerun: (nid: string) => rerunRef.current(nid),
        onPickImage: (nid: string, field: ImageField) => pickImageRef.current(nid, field),
      };

      newNodes.push({ id: pId, type: "prompt", position: { x: promptX, y: promptY }, data: promptData });

      const genData: WNodeData = {
        title: type === "video_generate" ? `Tạo video ${prefix}` : `Tạo ảnh ${prefix}`,
        runStatus: "idle",
        onChange: patchNode,
        onPreview: openPreview,
        onError,
        getWorkflowContext,
        onRerun: (nid: string) => rerunRef.current(nid),
        onPickImage: (nid: string, field: ImageField) => pickImageRef.current(nid, field),
      };

      if (type === "generate") {
        genData.model = "nano_banana_2_lite";
        genData.aspect_ratio = "16:9";
      } else {
        genData.model = "veo_31_fast";
        genData.mode = "text_to_video"; // default: no image edge yet
        genData.aspect_ratio = "16:9";
        // hasStartImageInput NOT set here — set below when cross-box edge is created
      }

      newNodes.push({ id: genId, type, position: { x, y }, data: genData });

      // Prompt → Generator edge
      newEdges.push({
        id: `edge_p_${pId}_${genId}`,
        source: pId, sourceHandle: "prompt",
        target: genId, targetHandle: "prompt",
        animated: true,
        style: { stroke: "#64748b", strokeWidth: 2 },
      });
    });

    // Cross-box connections: for each prefix group, connect consecutive entries
    prefixGroups.forEach((entries) => {
      if (entries.length < 2) return;
      // Sort by boxIndex to ensure left-to-right chain
      const sorted = [...entries].sort((a, b) => a.boxIndex - b.boxIndex);
      for (let i = 0; i < sorted.length - 1; i++) {
        const src = sorted[i];
        const dst = sorted[i + 1];
        const srcId = nodeIdMap.get(`${src.boxIndex}_${src.lineIndex}`);
        const dstId = nodeIdMap.get(`${dst.boxIndex}_${dst.lineIndex}`);
        if (!srcId || !dstId) continue;

        const srcType = bulkBoxes[src.boxIndex].type;
        const dstType = bulkBoxes[dst.boxIndex].type;

        if (srcType === "generate" && dstType === "video_generate") {
          newEdges.push({
            id: `edge_img_vid_${srcId}_${dstId}`,
            source: srcId, sourceHandle: "image",
            target: dstId, targetHandle: "start_image",
            animated: true,
            style: { stroke: "#22c55e", strokeWidth: 2 },
          });
          // Update dst node data so VideoNode shows "Ảnh đầu lấy từ node ảnh đã nối"
          const dstNode = newNodes.find(n => n.id === dstId);
          if (dstNode) {
            (dstNode.data as WNodeData).hasStartImageInput = true;
            (dstNode.data as WNodeData).mode = "start_image";
          }
        } else if (srcType === "video_generate" && dstType === "video_generate") {
          const feId = nid("frame_extract");
          const srcRow = boxLineRowMap.get(`${src.boxIndex}_${src.lineIndex}`) ?? 0;
          // Position frame node between src column and dst column
          const feX = origin.x + src.boxIndex * LANE_GAP + Math.floor(LANE_GAP / 2);
          const feY = origin.y + srcRow * BOX_GAP + 40;

          const feData: WNodeData = {
            title: `Tách frame ${src.prefix ?? ""}`,
            positions: "end",
            runStatus: "idle",
            onChange: patchNode,
            onPreview: openPreview,
            onError,
            getWorkflowContext,
            onRerun: (nid: string) => rerunRef.current(nid),
            onPickImage: (nid: string, field: ImageField) => pickImageRef.current(nid, field),
          };

          newNodes.push({ id: feId, type: "frame_extract", position: { x: feX, y: feY }, data: feData });

          newEdges.push({
            id: `edge_fe_in_${feId}`,
            source: srcId, sourceHandle: "video",
            target: feId, targetHandle: "video",
            animated: true,
            style: { stroke: "#f59e0b", strokeWidth: 2 },
          });
          newEdges.push({
            id: `edge_fe_out_${feId}`,
            source: feId, sourceHandle: "end_image",
            target: dstId, targetHandle: "start_image",
            animated: true,
            style: { stroke: "#ec4899", strokeWidth: 2 },
          });
          // Update dst node data
          const dstNode = newNodes.find(n => n.id === dstId);
          if (dstNode) {
            (dstNode.data as WNodeData).hasStartImageInput = true;
            (dstNode.data as WNodeData).hasEndImageInput = true;
            (dstNode.data as WNodeData).mode = "start_end_image";
          }
        }
        // Image → Image: no chain edge (each stands alone)
      }
    });

    // ──────────────────────────────────────────────────────────────────────────
    // AUTO-INJECT REFERENCE NODES: scan ALL @mentions in every prompt text.
    // If mention found in library  → Reference node gets the library image.
    // If mention NOT in library    → Reference node created empty (user fills in).
    // One Reference node per unique @mention name.
    // ──────────────────────────────────────────────────────────────────────────
    {
      const MENTION_RE = /@([a-zA-Z][a-zA-Z0-9_]*)/g;

      // Map mention (lowercase) → list of generator node IDs whose prompts reference it
      const mentionToGenIds = new Map<string, { genId: string; genType: string }[]>();

      newEdges.forEach(edge => {
        // Only prompt→generator edges
        if (edge.sourceHandle !== "prompt" || edge.targetHandle !== "prompt") return;
        const pNode = newNodes.find(n => n.id === edge.source);
        const gNode = newNodes.find(n => n.id === edge.target);
        if (!pNode || !gNode) return;
        const promptText = (pNode.data as WNodeData).prompt || "";

        // Collect all @mentions via raw regex (no library dependency)
        const seen = new Set<string>();
        for (const match of promptText.matchAll(MENTION_RE)) {
          const key = match[1].toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          if (!mentionToGenIds.has(key)) mentionToGenIds.set(key, []);
          mentionToGenIds.get(key)!.push({ genId: gNode.id, genType: gNode.type || "" });
        }
      });

      if (mentionToGenIds.size > 0) {
        let refNodeCounter = 0;

        mentionToGenIds.forEach((targets, mention) => {
          // Look up library for image data
          const libItem = findLibraryRef(library, mention);

          const refId = nid("reference");

          // Position: column far to the left, stacked vertically per mention
          const refX = origin.x + PROMPT_OFFSET_X - 340;
          const refY = origin.y + refNodeCounter * 240;
          refNodeCounter++;

          const imageUrl = libItem?.image || undefined;
          const refData: WNodeData = {
            title: libItem ? `@${libItem.name}` : `@${mention}`,
            image: imageUrl,
            resultUrls: imageUrl ? [imageUrl] : undefined,
            refName: libItem ? libItem.name : mention,
            runStatus: "idle",
            onChange: patchNode,
            onPreview: openPreview,
            onError,
            getWorkflowContext,
            onRerun: (nid: string) => rerunRef.current(nid),
            onPickImage: (nid: string, field: ImageField) => pickImageRef.current(nid, field),
          };

          newNodes.push({
            id: refId,
            type: "reference",
            position: { x: refX, y: refY },
            data: refData,
          });

          // Connect this Reference node → every generator that mentions it
          targets.forEach(({ genId, genType }) => {
            const targetHandle = genType === "video_generate" ? "reference" : "image";
            newEdges.push({
              id: `edge_ref_${refId}_${genId}`,
              source: refId,
              sourceHandle: "image",
              target: genId,
              targetHandle,
              animated: true,
              style: { stroke: "#14b8a6", strokeWidth: 2 },
            });
          });
        });
      }
    }
    // ──────────────────────────────────────────────────────────────────────────

    setNodes(nds => [...nds, ...newNodes]);
    if (newEdges.length > 0) setEdges(eds => [...eds, ...newEdges]);
    setDirty(true);
    setBulkBoxes([]);
    setShowBulkPopup(false);
  }

  const moveBulkBox = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= bulkBoxes.length) return;
    const next = [...bulkBoxes];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    setBulkBoxes(next);
  };

  // auto-save after successful run (debounced light)
  // (manual save still primary)

  function stripNodeData(data: WNodeData, { keepRuntime = true } = {}): Record<string, unknown> {
    const {
      onChange: _c,
      onPreview: _p,
      onRerun: _r,
      onError: _e,
      getWorkflowContext: _g,
      onPickImage: _pi,
      runError,
      runStatus,
      reused,
      ...rest
    } = data;
    if (!keepRuntime) {
      const { resultUrls: _u, frames: _f, folder: _fo, ...clean } = rest as WNodeData;
      return clean as Record<string, unknown>;
    }
    // Persist previews + status so project can resume work after reload
    return {
      ...rest,
      runStatus: runStatus || "idle",
      runError,
      reused,
    } as Record<string, unknown>;
  }

  /** Always prefer refs — React state can be stale right after setNodes / after await. */
  function graphPayload(list?: Node[], edgeList?: Edge[]) {
    const nds = list ?? nodesRef.current;
    const eds = edgeList ?? edgesRef.current;
    return {
      name,
      nodes: nds.map(({ id, type, position, data }) => ({
        id,
        type,
        position,
        data: stripNodeData(data as WNodeData),
      })),
      edges: eds.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle,
        targetHandle: e.targetHandle,
      })),
      viewport: rf.current?.getViewport(),
    };
  }

  function projectPayload(
    list?: Node[],
    edgeList?: Edge[],
    meta?: { name?: string; description?: string },
  ) {
    const nds = list ?? nodesRef.current;
    const g = graphPayload(nds, edgeList);
    return {
      name: (meta?.name ?? name).trim() || "Project mới",
      description: (meta?.description ?? description).trim(),
      nodes: g.nodes,
      edges: g.edges,
      viewport: g.viewport,
      node_states: buildPriorResults(nds),
    };
  }

  function loadProjectNodes(
    doc: {
      nodes?: unknown;
      node_states?: Record<string, unknown> | null;
    },
    assets?: ProjectAsset[],
  ): Node[] {
    const raw = ((doc.nodes as Node[]) || []).map((n) => ({
      ...n,
      data: { ...(n.data as object) },
    }));
    let hydrated = hydrateNodesFromProject(raw, doc.node_states);
    if (assets?.length) {
      hydrated = recoverPreviewsFromAssets(hydrated, assets);
    }
    return attachHandlers(hydrated);
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

  async function handleSaveAsTemplate() {
    const tName = prompt("Nhập tên cho Mẫu Workflow mới của bạn:", name);
    if (tName === null) return;
    const cleanName = tName.trim();
    if (!cleanName) {
      alert("Tên mẫu không được để trống!");
      return;
    }
    const tDesc = prompt("Nhập mô tả ngắn cho mẫu (không bắt buộc):", description) || "";
    try {
      const g = graphPayload();
      await saveWorkflow({
        name: cleanName,
        description: tDesc,
        nodes: g.nodes,
        edges: g.edges,
        viewport: g.viewport,
      });
      alert(`Đã lưu mẫu "${cleanName}" thành công! Bạn có thể xem trong trang Mẫu Workflow.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleNewProject() {
    if (dirty) {
      const ok = await dialog.confirm({
        title: "Tạo project trống?",
        message: "Project hiện tại chưa lưu. Thay đổi chưa lưu sẽ mất.",
        confirmLabel: "Tạo mới",
        cancelLabel: "Hủy",
        tone: "danger",
      });
      if (!ok) return;
    }
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
    if (dirty) {
      const ok = await dialog.confirm({
        title: "Mở project khác?",
        message: "Có thay đổi chưa lưu. Tiếp tục sẽ mất thay đổi hiện tại.",
        confirmLabel: "Mở project",
        cancelLabel: "Hủy",
        tone: "danger",
      });
      if (!ok) return;
    }
    try {
      const doc = await fetchProject(id);
      setProjectId(doc.id);
      setName(doc.name || "Project");
      setDescription(doc.description || "");
      let assets: ProjectAsset[] = [];
      try {
        const media = await fetchProjectAssets(id);
        assets = media.assets || [];
        setProjectAssets(
          [...assets].sort((a, b) => Number(b.mtime || 0) - Number(a.mtime || 0)).slice(0, 120),
        );
      } catch {
        /* ignore */
      }
      const loaded = loadProjectNodes(doc, assets);
      nodesRef.current = loaded;
      setNodes(loaded);
      setEdges((doc.edges as Edge[]) || []);
      setRunResult(null);
      setProgressLabel("");
      const needsPersist = loaded.some((n) => {
        const d = n.data as WNodeData;
        return d.runStatus === "completed" && Boolean(d.resultUrls?.length);
      });
      const hadSaved = ((doc.nodes as Node[]) || []).some((n) => {
        const d = (n.data || {}) as WNodeData;
        return Boolean(d.resultUrls?.length);
      });
      if (needsPersist && !hadSaved) {
        try {
          await saveProject(
            projectPayload(loaded, (doc.edges as Edge[]) || [], {
              name: doc.name || "Project",
              description: doc.description || "",
            }),
            id,
          );
          setDirty(false);
        } catch {
          setDirty(true);
        }
      } else {
        setDirty(false);
      }
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
      const loaded = loadProjectNodes(doc);
      nodesRef.current = loaded;
      setNodes(loaded);
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
    setNodes((nds) => {
      const merged = mergeRunResultIntoNodes(nds, result, opts);
      const withHandlers = attachHandlers(merged);
      nodesRef.current = withHandlers;
      return withHandlers;
    });
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

  async function pollUntilDone(runId: string, runPid: string | null): Promise<WorkflowRunResult> {
    pollStop.current = false;
    let last: WorkflowRunResult | null = null;
    for (let i = 0; i < 3600; i++) {
      if (pollStop.current) break;
      const snap = await fetchWorkflowRun(runId);
      last = snap;
      setRunResult(snap);
      if (projectIdRef.current === runPid) {
        applyRunToNodes(snap, { keepMissing: true });
        const done = snap.progress?.done ?? 0;
        const total = snap.progress?.total ?? 0;
        const cur = snap.progress?.current;
        setProgressLabel(
          total
            ? `${done}/${total}${cur ? ` · ${cur}` : ""}${snap.status === "running" ? " …" : ""}`
            : snap.status,
        );
      }
      if (snap.status === "completed" || snap.status === "failed") {
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
                onError,
                getWorkflowContext,
                onRerun: (nid: string) => rerunRef.current(nid),
                onPickImage: (nid: string, field: ImageField) => pickImageRef.current(nid, field),
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
                    onError,
                    getWorkflowContext,
                    onRerun: (nid: string) => rerunRef.current(nid),
                    onPickImage: (nid: string, field: ImageField) => pickImageRef.current(nid, field),
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
      const final = await pollUntilDone(started.run_id, pid);
      setRunResult(final);
      if (projectIdRef.current === pid) {
        // Sync ref immediately from final snapshot using the freshest state
        const currentNodes = nodesRef.current;
        const nodesWithResults = attachHandlers(
          mergeRunResultIntoNodes(currentNodes, final),
        );
        setNodes(nodesWithResults);
        nodesRef.current = nodesWithResults;

        // auto-save project graph + previews in the background so reload still shows results
        try {
          const saved = await saveProject(projectPayload(nodesWithResults), pid);
          if (projectIdRef.current === pid) {
            setProjectId(saved.id);
            setDirty(false);
            await refreshProjects();
            await refreshProjectAssets(saved.id);
          }
        } catch (e) {
          console.warn("autosave after run failed", e);
          onError(
            e instanceof Error
              ? `Chạy xong nhưng lưu project lỗi: ${e.message}`
              : "Chạy xong nhưng lưu project lỗi",
          );
        }
      } else {
        // Background path: user switched projects during run.
        // We should still save the completed results to the old project `pid` in the database,
        // so it has the results next time they open it.
        void (async () => {
          try {
            const doc = await fetchProject(pid!);
            const rawNodes = ((doc.nodes as Node[]) || []).map((n) => ({
              ...n,
              data: { ...(n.data as object) },
            }));
            const mergedNodes = mergeRunResultIntoNodes(rawNodes, final);
            const g = graphPayload(mergedNodes, (doc.edges as Edge[]) || []);
            const payload = {
              name: doc.name || "Project",
              description: doc.description || "",
              nodes: g.nodes,
              edges: g.edges,
              viewport: doc.viewport || g.viewport,
              node_states: buildPriorResults(mergedNodes),
            };
            await saveProject(payload, pid);
            await refreshProjects();
          } catch (e) {
            console.warn("background save of old project failed", e);
          }
        })();
      }
      if (projectIdRef.current === pid) {
        if (final.status !== "completed") {
          onError(final.error || "Workflow failed");
        }
        setProgressLabel(
          final.status === "completed"
            ? `Xong ${final.progress?.done ?? ""}/${final.progress?.total ?? ""}`
            : `Lỗi · ${final.error || final.status}`,
        );
      }
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
    setNodes((nds) => {
      const next = attachHandlers(
        nds.map((n) => ({
          ...n,
          data: {
            ...(n.data as WNodeData),
            resultUrls: undefined,
            frames: undefined,
            runStatus: "idle" as RunStatus,
            runError: undefined,
            reused: undefined,
          },
        })),
      );
      nodesRef.current = next;
      return next;
    });
    setRunResult(null);
    setDirty(true);
  }

  function handleLayout(mode: WorkflowLayoutMode = "pipeline") {
    const nds = nodesRef.current;
    const eds = edgesRef.current;
    if (!nds.length) return;
    const laid = attachHandlers(layoutWorkflowNodes(nds, eds, mode));
    nodesRef.current = laid;
    setNodes(laid);
    setDirty(true);
    requestAnimationFrame(() => {
      rf.current?.fitView({ padding: 0.18, duration: 280 });
    });
  }

  return (
    <div className="workflow-page">
      <header className="wf-header-bar">
        <div className="page-title-group" style={{ margin: 0 }}>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Workflow</h1>
          <span className="pill pill-purple" style={{ fontSize: 9 }}>PROJECT</span>
          <Link
            to={NAV_ROUTES.docs}
            className="wf-btn wf-btn-secondary"
            style={{ padding: "4px 8px" }}
            title="Hướng dẫn nối node, chạy pipeline"
            onClick={(e) => {
              if (!dirty) return;
              e.preventDefault();
              void (async () => {
                const ok = await dialog.confirm({
                  title: "Rời workflow?",
                  message: "Có thay đổi chưa lưu. Rời trang sẽ mất thay đổi nếu chưa lưu.",
                  confirmLabel: "Rời đi",
                  cancelLabel: "Ở lại",
                  tone: "danger",
                });
                if (ok) window.location.assign(NAV_ROUTES.docs);
              })();
            }}
          >
            Document
          </Link>
          {dirty && <span className="wf-status-badge dirty">chưa lưu</span>}
          {running && <span className="wf-status-badge running">Đang chạy…</span>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            className="wf-input"
            style={{ minWidth: 160 }}
            placeholder="Tên project"
          />
          <div className="wf-btn-group">
            <button
              type="button"
              className="wf-btn"
              onClick={() => void handleSaveProject(false)}
              title="Lưu project (nodes + preview + trạng thái)"
            >
              💾 Lưu{saveHint ? ` · ${saveHint}` : ""}
            </button>
            <button
              type="button"
              className="wf-btn"
              onClick={() => void handleSaveProject(true)}
              title="Lưu thành project mới"
            >
              Lưu như…
            </button>
            <button
              type="button"
              className="wf-btn"
              onClick={() => void handleSaveAsTemplate()}
              title="Lưu cấu trúc node hiện tại thành mẫu để dùng lại"
            >
              Lưu thành mẫu
            </button>
            <button type="button" className="wf-btn" onClick={() => void handleNewProject()}>
              + Project
            </button>
          </div>

          <div className="wf-btn-group">
            <button
              type="button"
              className="wf-btn"
              onClick={clearPreviews}
              disabled={running}
              title="Xóa preview trên node (không xóa file đã gen)"
            >
              Xóa preview
            </button>
            <button
              type="button"
              className="wf-btn"
              onClick={() => rf.current?.fitView({ padding: 0.2 })}
            >
              Fit view
            </button>
            <button
              type="button"
              className="wf-btn"
              disabled={nodes.length === 0}
              title="Sắp xếp node trái → phải theo luồng nối (pipeline)"
              onClick={() => handleLayout("pipeline")}
            >
              ⊡ Sắp xếp
            </button>
            <button
              type="button"
              className="wf-btn"
              disabled={nodes.length === 0}
              title="Gom node theo loại (Prompt / Ảnh / Video…) thành cột"
              onClick={() => handleLayout("grid")}
            >
              ▦ Theo loại
            </button>
          </div>
          {progressLabel ? (
            <span className="muted" style={{ fontSize: 11, maxWidth: 200, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {progressLabel}
            </span>
          ) : null}
          <div className="wf-btn-group" style={{ background: "transparent", border: "none", padding: 0 }}>
            <button
              type="button"
              className="wf-btn wf-btn-primary"
              disabled={running || nodes.length === 0}
              onClick={() => void handleRun()}
            >
              {running ? "Đang chạy…" : "▶ Chạy hết"}
            </button>
            <button
              type="button"
              className="wf-btn wf-btn-secondary"
              disabled={running || nodes.length === 0}
              onClick={() => void handleContinue()}
              title="Giữ node đã OK — chỉ chạy node mới / chưa xong / lỗi"
            >
              ⏭ Tiếp tục
            </button>
          </div>
        </div>
      </header>

      <div className="workflow-body">
        <aside className="wf-sidebar-panel" style={{ height: "100%" }}>
          <div className="wf-panel-card">
            <h3>Thêm node</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {(
                [
                  ["prompt", "Prompt", "+"],
                  ["reference", "Ảnh có sẵn", "🖼"],
                  ["video_reference", "Video có sẵn", "📹"],
                  ["generate", "Tạo ảnh", "🎨"],
                  ["video_generate", "Tạo video", "🎬"],
                  ["frame_extract", "Tách frame", "🎞"],
                ] as const

              ).map(([t, label, icon]) => (
                <button key={t} type="button" className="wf-node-add-btn" onClick={() => addNode(t)}>
                  <span style={{ fontSize: 12, width: 16, display: "inline-block", textAlign: "center" }}>{icon}</span> {label}
                </button>
              ))}
              <button
                type="button"
                className="wf-node-add-btn"
                onClick={() => {
                  setBulkBoxes([]);
                  setShowBulkPopup(true);
                }}
                style={{
                  marginTop: 6,
                  borderStyle: "dashed",
                  borderColor: "rgba(129, 140, 248, 0.4)",
                  color: "#a5b4fc",
                  background: "rgba(129, 140, 248, 0.05)",
                }}
              >
                ⚡ Thêm hàng loạt
              </button>
            </div>
          </div>

          <div className="wf-panel-card" style={{ flex: 1, minHeight: 0 }}>
            <h3>Projects</h3>
            <input
              placeholder="Tìm project…"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="wf-input"
              style={{ width: "100%", marginBottom: 8 }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, overflowY: "auto", paddingRight: 4 }}>
              {projects.filter((p) =>
                !projectFilter.trim()
                  ? true
                  : p.name.toLowerCase().includes(projectFilter.trim().toLowerCase()),
              ).length === 0 && (
                <span className="muted" style={{ fontSize: 11, textAlign: "center", display: "block", padding: 12 }}>
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
                  <div key={p.id} className={`wf-project-item ${projectId === p.id ? "active" : ""}`}>
                    <button
                      type="button"
                      className="wf-project-info-btn"
                      onClick={() => void handleOpenProject(p.id)}
                      title={p.description || p.name}
                    >
                      <span className="wf-project-title">{p.name}</span>
                      <span className="wf-project-meta">
                        {p.node_count ?? 0} node
                        {p.updated_at
                          ? ` · ${new Date(p.updated_at * 1000).toLocaleDateString()}`
                          : ""}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="wf-project-del-btn"
                      onClick={async () => {
                        const ok = await dialog.confirm({
                          title: "Xóa project?",
                          message: `“${p.name}” sẽ bị xóa khỏi danh sách workflow.`,
                          confirmLabel: "Xóa",
                          cancelLabel: "Hủy",
                          tone: "danger",
                        });
                        if (!ok) return;
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
              className="wf-btn wf-btn-secondary"
              style={{ marginTop: 10, width: "100%", justifyContent: "center" }}
              disabled={!projectId}
              onClick={() => void handleDuplicateProject()}
            >
              Nhân bản project
            </button>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 10, fontSize: 11, fontWeight: 700, color: "var(--text-secondary)" }}>
              Mô tả
              <textarea
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDirty(true);
                }}
                rows={2}
                placeholder="Ghi chú mô tả project…"
                className="wf-textarea"
              />
            </label>
            <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: "#a78bfa", textTransform: "uppercase", letterSpacing: "0.05em" }}>Mẫu graph</span>
              <Link
                to={NAV_ROUTES["workflow-templates"]}
                className="wf-btn wf-btn-secondary"
                style={{ width: "100%", justifyContent: "center", gap: 6, fontSize: 11 }}
              >
                🗃️ Quản lý mẫu graph
              </Link>
            </div>
          </div>
        </aside>

        <div className="workflow-canvas-wrap" ref={canvasWrapRef}>
          {canvasReady ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChangeTracked}
              onEdgesChange={onEdgesChangeTracked}
              onConnect={onConnect}
              nodeTypes={nodeTypesRef.current}
              onInit={(instance) => {
                rf.current = instance;
              }}
              fitView
              minZoom={0.05}
              maxZoom={4}
              colorMode="dark"
              deleteKeyCode={["Backspace", "Delete"]}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={edgeOptsRef.current}
              style={{ width: "100%", height: "100%" }}
            >
              <Background gap={18} size={1} />
              <MiniMap
                style={{ background: "#151820" }}
                nodeColor={(n) => NODE_COLORS[n.type || ""] || "#555"}
                pannable
                zoomable
              />
              <Controls />
            </ReactFlow>
          ) : (
            <div className="workflow-canvas-placeholder muted">Đang chuẩn bị canvas…</div>
          )}
        </div>

        <aside className="workflow-media-aside">
          <div className="panel-card workflow-media-panel">
            <div className="workflow-media-head">
              <strong style={{ fontSize: 13 }}>Media project</strong>
              {projectId && (
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 10, padding: "2px 8px" }}
                    onClick={() => void openProjectFolder(projectId).catch((e) => onError(String(e)))}
                  >
                    Folder
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 10, padding: "2px 8px" }}
                    onClick={() => void refreshProjectAssets(projectId)}
                  >
                    Refresh
                  </button>
                </div>
              )}
            </div>
            {!projectId ? (
              <p className="muted" style={{ fontSize: 11, margin: "8px 0 0" }}>
                Lưu project hoặc chạy workflow — output hiện tại đây (tab Ảnh / Video).
              </p>
            ) : (
              <>
                <p className="muted" style={{ fontSize: 10, margin: "6px 0 8px" }}>
                  <code>projects/{projectId.slice(0, 8)}…</code>
                  {mediaSidebarAssets.length > 0
                    ? ` · ${mediaSidebarAssets.length} file · mới trên`
                    : ""}
                </p>
                <div className="projects-tabs workflow-media-tabs" style={{ marginBottom: 8 }}>
                  <button
                    type="button"
                    className={`projects-tab${mediaTab === "image" ? " active" : ""}`}
                    onClick={() => setMediaTab("image")}
                  >
                    Ảnh{mediaCounts.images ? ` (${mediaCounts.images})` : ""}
                  </button>
                  <button
                    type="button"
                    className={`projects-tab${mediaTab === "video" ? " active" : ""}`}
                    onClick={() => setMediaTab("video")}
                  >
                    Video{mediaCounts.videos ? ` (${mediaCounts.videos})` : ""}
                  </button>
                </div>
                <div className="workflow-media-grid workflow-media-grid--fill">
                  {mediaSidebarAssets.length === 0 && (
                    <span className="muted" style={{ fontSize: 11, gridColumn: "1/-1" }}>
                      {projectAssets.length === 0
                        ? "Chưa có file — chạy workflow"
                        : mediaTab === "video"
                          ? "Chưa có video trong project"
                          : "Chưa có ảnh trong project"}
                    </span>
                  )}
                  {mediaSidebarAssets.map((a, i) => (
                    <button
                      key={`${a.path || a.url || a.name}-${i}`}
                      type="button"
                      className="workflow-media-thumb"
                      onClick={() => setLightbox(normalizeFileUrl(a.url))}
                      title={`${a.name}${a.mtime ? ` · ${new Date(a.mtime * 1000).toLocaleString()}` : ""}`}
                    >
                      {a.kind === "video" ? (
                        <video
                          src={normalizeFileUrl(a.url)}
                          muted
                          preload="metadata"
                          className="workflow-media-thumb-media"
                        />
                      ) : (
                        <img
                          src={normalizeFileUrl(a.url)}
                          alt=""
                          loading="lazy"
                          className="workflow-media-thumb-media"
                        />
                      )}
                      {a.kind === "video" && <span className="workflow-media-badge">VIDEO</span>}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>

      {picker && (
        <div className="ui-lightbox node-picker-overlay" onClick={() => setPicker(null)}>
          <div className="node-picker-modal" onClick={(e) => e.stopPropagation()}>
            <div className="node-picker-head">
              <strong>{picker.field === "video" ? "Chọn video có sẵn" : "Chọn ảnh có sẵn"}</strong>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicker(null)}>
                Đóng
              </button>
            </div>
            <div className="projects-tabs" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={`projects-tab${pickerTab === "project" ? " active" : ""}`}
                onClick={() => setPickerTab("project")}
                disabled={!projectIdRef.current}
              >
                Project này
              </button>
              <button
                type="button"
                className={`projects-tab${pickerTab === "flow_image" ? " active" : ""}`}
                onClick={() => setPickerTab("flow_image")}
              >
                {picker.field === "video" ? "🎬 Video Flow lẻ" : "🖼️ Ảnh Flow lẻ"}
              </button>

              <button
                type="button"
                className={`projects-tab${pickerTab === "all_projects" ? " active" : ""}`}
                onClick={() => setPickerTab("all_projects")}
              >
                🗂 Tất cả Projects
              </button>
              {picker.field !== "video" && (
                <button
                  type="button"
                  className={`projects-tab${pickerTab === "library" ? " active" : ""}`}
                  onClick={() => setPickerTab("library")}
                >
                  Thư viện @ref
                </button>
              )}
            </div>

            {pickerLoading ? (
              <p className="muted">Đang tải…</p>
            ) : pickerTab === "library" ? (
              <div className="node-picker-grid">
                {library.length === 0 && (
                  <p className="muted">Thư viện trống — thêm ảnh ở trang Ảnh tham chiếu.</p>
                )}
                {library.map((ref) => (
                  <button
                    key={ref.id}
                    type="button"
                    className="node-picker-item"
                    onClick={() => applyPickedImage(ref.image, ref.name)}
                    title={ref.name}
                  >
                    <img src={ref.image} alt={ref.name} />
                    <span>{ref.name}</span>
                  </button>
                ))}
              </div>
            ) : pickerTab === "flow_image" ? (
              <div className="node-picker-grid">
                {flowAssets.length === 0 && (
                  <p className="muted">
                    {picker.field === "video"
                      ? "Chưa có video trong thư mục Flow lẻ (video_output)."
                      : "Chưa có ảnh trong thư mục Flow lẻ (image_output / grok_output)."}
                  </p>
                )}
                {flowAssets.map((a, i) => (
                  <button
                    key={`flow-${a.path || a.url}-${i}`}
                    type="button"
                    className="node-picker-item"
                    onClick={() => applyPickedImage(normalizeFileUrl(a.url))}
                    title={a.name}
                  >
                    {picker.field === "video" ? (
                      <video src={normalizeFileUrl(a.url)} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <img src={normalizeFileUrl(a.url)} alt={a.name} />
                    )}
                    <span style={{ fontSize: 9 }}>
                      <span style={{ color: "#10b981", display: "block" }}>
                        {String(a.folder || "").includes("grok") ? "Grok" : "Flow"}
                      </span>
                      {a.name}
                    </span>
                  </button>
                ))}
              </div>
            ) : pickerTab === "all_projects" ? (
              <div className="node-picker-grid">
                {allProjectsAssets.length === 0 && (
                  <p className="muted">
                    {picker.field === "video" ? "Chưa có video trong bất kỳ project nào." : "Chưa có ảnh trong bất kỳ project nào."}
                  </p>
                )}
                {allProjectsAssets
                  .filter((a) => picker.field === "video" ? (a.kind === "video" || /\.mp4/i.test(a.name)) : (a.kind === "image" || !/\.mp4/i.test(a.name)))
                  .map((a, i) => (
                    <button
                      key={`all-${a.path || a.url}-${i}`}
                      type="button"
                      className="node-picker-item"
                      onClick={() => applyPickedImage(normalizeFileUrl(a.url))}
                      title={`${(a as ProjectAsset & { project_name?: string }).project_name || ""} · ${a.name}`}
                    >
                      {picker.field === "video" ? (
                        <video src={normalizeFileUrl(a.url)} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <img src={normalizeFileUrl(a.url)} alt={a.name} />
                      )}
                      <span style={{ fontSize: 9 }}>
                        <span style={{ color: "#94a3b8", display: "block" }}>
                          {(a as ProjectAsset & { project_name?: string }).project_name || ""}
                        </span>
                        {a.name}
                      </span>
                    </button>
                  ))}
              </div>
            ) : (
              <div className="node-picker-grid">
                {!projectIdRef.current && (
                  <p className="muted">Lưu project trước để chọn media project.</p>
                )}
                {projectIdRef.current &&
                  projectAssets.filter((a) => picker.field === "video" ? (a.kind === "video" || /\.mp4/i.test(a.name)) : (a.kind === "image" || !/\.mp4/i.test(a.name))).length ===
                    0 && <p className="muted">{picker.field === "video" ? "Chưa có video trong project." : "Chưa có ảnh trong project."}</p>}
                {projectAssets
                  .filter((a) => picker.field === "video" ? (a.kind === "video" || /\.mp4/i.test(a.name)) : (a.kind === "image" || !/\.mp4/i.test(a.name)))
                  .map((a, i) => (
                    <button
                      key={`${a.path || a.url}-${i}`}
                      type="button"
                      className="node-picker-item"
                      onClick={() => applyPickedImage(normalizeFileUrl(a.url))}
                      title={a.name}
                    >
                      {picker.field === "video" ? (
                        <video src={normalizeFileUrl(a.url)} muted preload="metadata" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      ) : (
                        <img src={normalizeFileUrl(a.url)} alt={a.name} />
                      )}
                      <span>{a.name}</span>
                    </button>
                  ))}
              </div>
            )}
            <div style={{ marginTop: 12 }}>
              <label className="btn btn-primary btn-sm" style={{ cursor: "pointer" }}>
                {picker.field === "video" ? "⬆ Upload video từ máy" : "⬆ Upload ảnh từ máy"}
                <input
                  type="file"
                  accept={picker.field === "video" ? "video/*" : "image/*"}
                  hidden

                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (!f) return;
                    try {
                      applyPickedImage(await readFileAsDataUrl(f));
                    } catch (err) {
                      onError(err instanceof Error ? err.message : String(err));
                    }
                  }}
                />
              </label>
            </div>
          </div>
        </div>
      )}


      {lightbox && (
        <div role="dialog" className="ui-lightbox" onClick={() => setLightbox(null)}>
          {isVideoUrl(lightbox) ? (
            <video
              src={mediaUrl(lightbox)}
              controls
              autoPlay
              playsInline
              style={{ maxWidth: "92vw", maxHeight: "90vh", borderRadius: 12, background: "#000" }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              src={mediaUrl(lightbox)}
              alt=""
              style={{ maxWidth: "92vw", maxHeight: "90vh", borderRadius: 12, objectFit: "contain" }}
              onClick={(e) => e.stopPropagation()}
            />
          )}
        </div>
      )}

      {showBulkPopup && (
        <div className="ui-lightbox node-picker-overlay" onClick={() => setShowBulkPopup(false)}>
          <div
            className="wf-panel-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "660px",
              maxWidth: "96vw",
              maxHeight: "90vh",
              background: "#13151e",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 16,
              padding: 0,
              boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {/* ── HEADER ─────────────────────────────────────────────── */}
            <div style={{
              padding: "14px 18px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.07)",
              display: "flex",
              alignItems: "center",
              gap: 10,
              flexShrink: 0,
              background: "rgba(255,255,255,0.02)",
            }}>
              <span style={{ fontSize: 18 }}>⚡</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>Tạo Node Hàng Loạt</div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 1 }}>
                  Mỗi Box = 1 nhóm node · Cùng số đầu dòng → tự kết nối
                </div>
              </div>
              {/* Quick-add buttons */}
              <button type="button"
                onClick={() => setBulkBoxes([...bulkBoxes, { id: `box_${Date.now()}`, type: "generate", prompts: "" }])}
                style={{ background: "rgba(99,179,237,0.12)", border: "1px solid rgba(99,179,237,0.3)", borderRadius: 7, color: "#63b3ed", padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}
              >+ 🎨 Ảnh</button>
              <button type="button"
                onClick={() => setBulkBoxes([...bulkBoxes, { id: `box_${Date.now()}`, type: "video_generate", prompts: "" }])}
                style={{ background: "rgba(167,139,250,0.12)", border: "1px solid rgba(167,139,250,0.3)", borderRadius: 7, color: "#a78bfa", padding: "4px 10px", fontSize: 12, cursor: "pointer", fontWeight: 600 }}
              >+ 🎬 Video</button>
              <button type="button" onClick={() => setShowBulkPopup(false)}
                style={{ background: "none", border: "none", color: "#475569", fontSize: 20, cursor: "pointer", lineHeight: 1, padding: "0 2px" }}>×</button>
            </div>

            {/* ── LIBRARY CHARACTER HINT ─────────────────────────────── */}
            {library.filter(r => r.category === "character").length > 0 && (
              <div style={{
                padding: "8px 18px",
                background: "rgba(20,184,166,0.05)",
                borderBottom: "1px solid rgba(20,184,166,0.12)",
                fontSize: 11,
                color: "#94a3b8",
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexShrink: 0,
                flexWrap: "wrap",
              }}>
                <span style={{ color: "#14b8a6", fontWeight: 700 }}>🧑 Nhân vật thư viện:</span>
                {library.filter(r => r.category === "character").map(ref => (
                  <span key={ref.id} style={{
                    background: "rgba(20,184,166,0.1)",
                    border: "1px solid rgba(20,184,166,0.2)",
                    borderRadius: 4,
                    padding: "1px 6px",
                    color: "#2dd4bf",
                    fontFamily: "monospace",
                    cursor: "pointer",
                  }}
                    title={`Nhấn để chèn @${ref.name} vào prompt`}
                    onClick={() => {
                      // Copy @name to clipboard for easy pasting
                      navigator.clipboard?.writeText(`@${ref.name}`).catch(() => {});
                    }}
                  >@{ref.name}</span>
                ))}
                <span style={{ color: "#475569", fontSize: 10 }}>← Nhấn để copy · Dán vào prompt → tự tạo node tham chiếu</span>
              </div>
            )}

            {/* ── BOX LIST ────────────────────────────────────────────── */}
            <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10 }}>
              {bulkBoxes.length === 0 && (
                <div style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  color: "#334155",
                  fontSize: 13,
                  border: "2px dashed rgba(255,255,255,0.05)",
                  borderRadius: 12,
                }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>📦</div>
                  Chưa có Box nào.<br />
                  <span style={{ color: "#64748b" }}>Nhấn <strong style={{ color: "#63b3ed" }}>+ 🎨 Ảnh</strong> hoặc <strong style={{ color: "#a78bfa" }}>+ 🎬 Video</strong> để bắt đầu.</span>
                </div>
              )}

              {bulkBoxes.map((box, index) => {
                const lineCount = box.prompts.split("\n").filter(l => l.trim()).length;
                const mentions = Array.from(new Set(
                  box.prompts.split("\n")
                    .flatMap(line => [...line.matchAll(/@([a-zA-Z][a-zA-Z0-9_]*)/g)].map(m => m[1]))
                ));
                const isImg = box.type === "generate";
                const accentColor = isImg ? "#63b3ed" : "#a78bfa";
                const prevBox = bulkBoxes[index - 1];
                const nextBox = bulkBoxes[index + 1];

                return (
                  <div key={box.id} style={{
                    background: "#1a1d2b",
                    border: `1px solid ${isImg ? "rgba(99,179,237,0.2)" : "rgba(167,139,250,0.2)"}`,
                    borderRadius: 12,
                    overflow: "hidden",
                    transition: "box-shadow 0.15s",
                  }}>
                    {/* Box header */}
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "8px 12px",
                      background: isImg ? "rgba(99,179,237,0.06)" : "rgba(167,139,250,0.06)",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                    }}>
                      {/* Box label */}
                      <div style={{
                        fontSize: 11,
                        fontWeight: 800,
                        color: accentColor,
                        background: `${accentColor}18`,
                        border: `1px solid ${accentColor}30`,
                        borderRadius: 5,
                        padding: "2px 7px",
                        letterSpacing: "0.02em",
                      }}>
                        {isImg ? "🎨" : "🎬"} Box {index + 1}
                      </div>

                      {/* Type selector */}
                      <select
                        value={box.type}
                        onChange={(e) => {
                          const next = [...bulkBoxes];
                          next[index] = { ...next[index], type: e.target.value as "generate" | "video_generate" };
                          setBulkBoxes(next);
                        }}
                        style={{
                          background: "#252836",
                          border: "1px solid rgba(255,255,255,0.1)",
                          borderRadius: 5,
                          color: accentColor,
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "3px 6px",
                          outline: "none",
                          cursor: "pointer",
                        }}
                      >
                        <option value="generate">🎨 Ảnh</option>
                        <option value="video_generate">🎬 Video</option>
                      </select>

                      {/* Line count */}
                      {lineCount > 0 && (
                        <span style={{ fontSize: 10, color: "#475569", background: "rgba(255,255,255,0.04)", borderRadius: 4, padding: "1px 6px" }}>
                          {lineCount} dòng
                        </span>
                      )}

                      {/* @mention badges */}
                      {mentions.map(m => {
                        const found = findLibraryRef(library, m);
                        return (
                          <span key={m} style={{
                            fontSize: 10,
                            background: found ? "rgba(20,184,166,0.12)" : "rgba(255,255,255,0.05)",
                            border: found ? "1px solid rgba(20,184,166,0.25)" : "1px solid rgba(255,255,255,0.08)",
                            borderRadius: 4,
                            padding: "1px 5px",
                            color: found ? "#2dd4bf" : "#64748b",
                          }}>
                            @{m}{found ? " ✓" : " ?"}
                          </span>
                        );
                      })}

                      <span style={{ flex: 1 }} />

                      {/* Connection badges */}
                      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        {prevBox && prevBox.type === "generate" && box.type === "video_generate" && (
                          <span style={{ fontSize: 10, background: "rgba(34,197,94,0.1)", color: "#22c55e", borderRadius: 3, padding: "1px 5px", border: "1px solid rgba(34,197,94,0.2)" }}>← Ảnh→Vid</span>
                        )}
                        {prevBox && prevBox.type === "video_generate" && box.type === "video_generate" && (
                          <span style={{ fontSize: 10, background: "rgba(245,158,11,0.1)", color: "#f59e0b", borderRadius: 3, padding: "1px 5px", border: "1px solid rgba(245,158,11,0.2)" }}>← Frame</span>
                        )}
                        {nextBox && box.type === "generate" && nextBox.type === "video_generate" && (
                          <span style={{ fontSize: 10, background: "rgba(34,197,94,0.1)", color: "#22c55e", borderRadius: 3, padding: "1px 5px", border: "1px solid rgba(34,197,94,0.2)" }}>→ Video</span>
                        )}
                        {nextBox && box.type === "video_generate" && nextBox.type === "video_generate" && (
                          <span style={{ fontSize: 10, background: "rgba(245,158,11,0.1)", color: "#f59e0b", borderRadius: 3, padding: "1px 5px", border: "1px solid rgba(245,158,11,0.2)" }}>→ Frame</span>
                        )}
                      </div>

                      {/* Controls */}
                      <div style={{ display: "flex", gap: 3 }}>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={index === 0}
                          onClick={() => moveBulkBox(index, "up")}
                          style={{ padding: "2px 6px", height: "auto", fontSize: 11 }} title="Di chuyển lên">▲</button>
                        <button type="button" className="btn btn-ghost btn-sm" disabled={index === bulkBoxes.length - 1}
                          onClick={() => moveBulkBox(index, "down")}
                          style={{ padding: "2px 6px", height: "auto", fontSize: 11 }} title="Di chuyển xuống">▼</button>
                        <button type="button" className="btn btn-ghost btn-sm danger"
                          onClick={() => setBulkBoxes(bulkBoxes.filter(b => b.id !== box.id))}
                          style={{ padding: "2px 7px", height: "auto", fontSize: 13 }} title="Xóa Box">×</button>
                      </div>
                    </div>

                    {/* Prompt textarea */}
                    <div style={{ padding: "10px 12px" }}>
                      <div style={{ fontSize: 10, color: "#475569", marginBottom: 5, display: "flex", justifyContent: "space-between" }}>
                        <span>Prompt · mỗi dòng bắt đầu bằng số · dùng <code style={{ color: "#14b8a6" }}>@nhân_vật</code> để auto-link</span>
                      </div>
                      <textarea
                        rows={5}
                        value={box.prompts}
                        onChange={(e) => {
                          const next = [...bulkBoxes];
                          next[index] = { ...next[index], prompts: e.target.value };
                          setBulkBoxes(next);
                        }}
                        placeholder={
                          isImg
                            ? "001 Cảnh bình minh trên bãi biển, @nhanvat_1 đứng nhìn ra biển\n002 Cảnh hoàng hôn rực rỡ, ánh vàng chiếu sáng\n003 Cảnh đêm tối với ánh sao lấp lánh"
                            : "001 Sóng biển vỗ nhẹ vào bờ cát trắng\n002 Mặt trời lặn xuống đường chân trời\n003 Ánh trăng chiếu bạc mặt nước yên bình"
                        }
                        style={{
                          width: "100%",
                          background: "rgba(0,0,0,0.25)",
                          border: `1px solid ${accentColor}20`,
                          borderRadius: 8,
                          color: "inherit",
                          padding: "8px 10px",
                          fontSize: 12,
                          fontFamily: "monospace",
                          lineHeight: 1.65,
                          resize: "vertical",
                          outline: "none",
                          boxSizing: "border-box",
                          transition: "border-color 0.15s",
                        }}
                        onFocus={e => { e.target.style.borderColor = accentColor + "50"; }}
                        onBlur={e => { e.target.style.borderColor = accentColor + "20"; }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── FOOTER ──────────────────────────────────────────────── */}
            <div style={{
              padding: "12px 18px",
              borderTop: "1px solid rgba(255,255,255,0.07)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexShrink: 0,
              background: "rgba(255,255,255,0.015)",
              gap: 10,
            }}>
              {/* Total summary */}
              <div style={{ fontSize: 11, color: "#475569" }}>
                {bulkBoxes.length > 0 && (() => {
                  const totalLines = bulkBoxes.reduce((s, b) => s + b.prompts.split("\n").filter(l => l.trim()).length, 0);
                  const totalMentions = new Set(
                    bulkBoxes.flatMap(b =>
                      b.prompts.split("\n").flatMap(line =>
                        [...line.matchAll(/@([a-zA-Z][a-zA-Z0-9_]*)/g)].map(m => m[1])
                      )
                    )
                  ).size;
                  return (
                    <span>
                      {bulkBoxes.length} Box · {totalLines} node
                      {totalMentions > 0 && <span style={{ color: "#14b8a6" }}> · {totalMentions} @nhân vật</span>}
                    </span>
                  );
                })()}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setShowBulkPopup(false)}>
                  Hủy
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={bulkBoxes.length === 0 || !bulkBoxes.some(b => b.prompts.trim())}
                  onClick={addBulkNodes}
                  style={{ minWidth: 140 }}
                >
                  ✓ Tạo &amp; Kết Nối
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    
    </div>
  );
}
