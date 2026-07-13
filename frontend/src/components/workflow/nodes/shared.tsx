import { ReactNode, CSSProperties } from "react";
import { normalizeFileUrl, mediaUrl, WorkflowAiNodeContext } from "../../../api";
export { mediaUrl };

export type RunStatus = "idle" | "pending" | "running" | "completed" | "failed" | "skipped";
export type ImageField = "image" | "start_image" | "end_image" | "video";

export type WNodeData = {
  title: string;
  prompt?: string;
  engine?: string;
  model?: string;
  aspect_ratio?: string;
  mode?: string;
  image?: string;
  video?: string;
  start_image?: string;
  end_image?: string;
  cameraAngle?: string;
  style?: string;
  lighting?: string;
  composition?: string;
  cameraMovement?: string;
  movementSpeed?: string;
  studioDuration?: number;
  timelineSegments?: any[];
  characterAssets?: any[];
  positions?: string;
  resultUrls?: string[];
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
  getWorkflowContext?: (nodeId: string) => WorkflowAiNodeContext[];
  hasStartImageInput?: boolean;
  hasEndImageInput?: boolean;
  hasReferenceInput?: boolean;
  hasPromptInput?: boolean;
  promptKind?: "image" | "video";
  prompt_hint?: string;
};

export const NODE_COLORS: Record<string, string> = {
  prompt: "#6366f1",
  reference: "#14b8a6",
  generate: "#22c55e",
  video_generate: "#f59e0b",
  frame_extract: "#ec4899",
  video_reference: "#e879f9",
};

export const STATUS_META: Record<RunStatus, { label: string; color: string; bg: string }> = {
  idle: { label: "", color: "transparent", bg: "transparent" },
  pending: { label: "chờ", color: "#94a3b8", bg: "rgba(148,163,184,0.15)" },
  running: { label: "…", color: "#38bdf8", bg: "rgba(56,189,248,0.18)" },
  completed: { label: "OK", color: "#4ade80", bg: "rgba(74,222,128,0.15)" },
  failed: { label: "Lỗi", color: "#f87171", bg: "rgba(248,113,113,0.18)" },
  skipped: { label: "skip", color: "#a3a3a3", bg: "rgba(163,163,163,0.12)" },
};

export function isVideoUrl(u: string): boolean {
  return /\.mp4($|\?)/i.test(u) || u.includes("/video");
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Không đọc được file"));
    reader.readAsDataURL(file);
  });
}

export const handleLabelStyle = (side: "left" | "right", top: string | number): CSSProperties => ({
  position: "absolute",
  top,
  transform: "translateY(-50%)",
  [side === "left" ? "right" : "left"]: "100%",
  [side === "left" ? "marginRight" : "marginLeft"]: "8px",
  fontSize: 8,
  fontWeight: "bold",
  color: "#f8fafc",
  pointerEvents: "none",
  whiteSpace: "nowrap",
  background: "rgba(15, 23, 42, 0.9)",
  padding: "2px 5px",
  borderRadius: 3,
  border: "1px solid rgba(255,255,255,0.15)",
  boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
});

export function fieldStyle(): CSSProperties {
  return {
    width: "100%",
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 6,
    color: "inherit",
    padding: 6,
  };
}

export function Shell({
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
        background: "rgba(10, 13, 26, 0.82)",
        backdropFilter: "blur(20px)",
        boxShadow: selected
          ? `0 0 16px ${color}22`
          : "0 10px 30px rgba(0,0,0,0.5)",
        transition: "border-color 0.25s, box-shadow 0.25s",
        position: "relative",
        boxSizing: "border-box",
        padding: "16px 16px 14px 16px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "-0.01em", color: "#fff" }}>
            {title}
          </span>
          {reused && (
            <span
              style={{
                fontSize: 8,
                background: "rgba(34,197,94,0.12)",
                color: "#4ade80",
                padding: "1px 4px",
                borderRadius: 4,
                fontWeight: 700,
                border: "1px solid rgba(74,222,128,0.2)",
              }}
              title="Sử dụng lại kết quả cũ (Không thay đổi prompt)"
            >
              Reused
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {st.label && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: st.color,
                background: st.bg,
                padding: "2px 6px",
                borderRadius: 6,
                letterSpacing: "0.02em",
                textTransform: "uppercase",
              }}
            >
              {st.label}
            </span>
          )}
          {showRerun && onRerun && (
            <button
              type="button"
              className="node-rerun-btn nodrag"
              onClick={onRerun}
              title="Chạy lại riêng node này"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "rgba(255,255,255,0.7)",
                borderRadius: 6,
                padding: "3px 6px",
                fontSize: 10,
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.08)";
                e.currentTarget.style.color = "#fff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255,255,255,0.04)";
                e.currentTarget.style.color = "rgba(255,255,255,0.7)";
              }}
            >
              ⟳
            </button>
          )}
        </div>
      </div>

      {runError && (
        <div
          style={{
            fontSize: 10,
            color: "#f87171",
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.15)",
            padding: "8px 10px",
            borderRadius: 8,
            marginBottom: 10,
            wordBreak: "break-all",
            lineHeight: 1.4,
          }}
        >
          {runError}
        </div>
      )}

      {children}
    </div>
  );
}

export function MediaPreview({
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
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of urls) {
    const u = normalizeFileUrl(raw);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    list.push(u);
  }
  if (!list.length) return null;

  const display = list.slice(0, max);
  const totalUnique = list.length;

  return (
    <div className="node-media-preview-container nodrag">
      {label && <div className="node-media-label">{label}</div>}
      <div className="node-media-grid">
        {display.map((url) =>
          isVideoUrl(url) ? (
            <div
              key={url}
              className="node-media-item video"
              onClick={() => onPreview?.(url)}
              title="Xem video"
            >
              <video src={url} muted preload="metadata" />
              <div className="video-play-indicator">▶</div>
            </div>
          ) : (
            <div
              key={url}
              className="node-media-item"
              onClick={() => onPreview?.(url)}
              title="Xem ảnh"
            >
              <img src={url} alt="" />
            </div>
          )
        )}
      </div>
      {totalUnique > max ? (
        <div className="node-media-more">+{totalUnique - max} media khác</div>
      ) : null}
    </div>
  );
}

export function ImageAttachBar({
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
                const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
                if (f.size > MAX_IMAGE_SIZE) {
                  alert("File quá lớn (tối đa 10MB cho ảnh)");
                  return;
                }
                try {
                  const url = await readFileAsDataUrl(f);
                  onChange?.(nodeId, {
                    [field]: url,
                    ...(field === "image" ? { resultUrls: [url] } : {}),
                  } as Partial<WNodeData>);
                } catch (err) {
                  console.warn('Upload failed:', err);
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

export function VideoAttachBar({
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
                const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
                if (f.size > MAX_VIDEO_SIZE) {
                  alert("File quá lớn (tối đa 50MB cho video)");
                  return;
                }
                try {
                  const url = await readFileAsDataUrl(f);
                  onChange?.(nodeId, {
                    [field]: url,
                    resultUrls: [url],
                  } as Partial<WNodeData>);
                } catch (err) {
                  console.warn('Upload failed:', err);
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
