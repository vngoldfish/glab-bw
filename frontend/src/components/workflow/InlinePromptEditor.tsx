import type { CSSProperties } from "react";

const fieldStyle: CSSProperties = {
  width: "100%",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  color: "inherit",
  padding: 6,
  resize: "vertical",
  fontSize: 11,
};

interface InlinePromptEditorProps {
  /** "image" or "video" — used for placeholder text */
  kind: "image" | "video";
  /** Current prompt value */
  value: string;
  /** Is the AI currently rewriting? */
  aiBusy: boolean;
  /** Trigger AI rewrite */
  onAiRewrite: () => void;
  /** Update the prompt text */
  onChange: (text: string) => void;
  /** Context hint for the toolbar */
  ctxHint?: { up: number; down: number } | null;
}

/**
 * Shared inline prompt editor with AI rewrite button.
 * Eliminates 4× copy-paste across Generate/Video nodes.
 */
export default function InlinePromptEditor({
  kind,
  value,
  aiBusy,
  onAiRewrite,
  onChange,
  ctxHint,
}: InlinePromptEditorProps) {
  const kindLabel = kind === "video" ? "video" : "ảnh";

  return (
    <div className="nodrag" style={{ marginBottom: 8 }}>
      <div className="node-prompt-toolbar" style={{ marginBottom: 4 }}>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>Prompt {kindLabel}</span>
        <button
          type="button"
          className="node-ai-btn"
          disabled={aiBusy || !(value || "").trim()}
          onClick={() => void onAiRewrite()}
          title={`AI viết lại prompt ${kindLabel} cho tốt`}
        >
          {aiBusy ? "AI…" : "✦ AI"}
        </button>
      </div>
      <textarea
        className="nodrag nowheel"
        rows={3}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Nhập ý ngắn… AI sẽ viết thành prompt ${kindLabel} hoàn chỉnh`}
        style={fieldStyle}
        disabled={aiBusy}
      />
      {aiBusy && (
        <div className="node-ai-status">
          AI đang viết prompt {kindLabel}
          {ctxHint?.up ? ` + ${ctxHint.up} node trước` : ""}
          {" → phân tích pipeline và viết lại…"}
        </div>
      )}
    </div>
  );
}
