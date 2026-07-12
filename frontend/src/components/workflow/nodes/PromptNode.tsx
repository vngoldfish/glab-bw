import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { WNodeData, Shell, handleLabelStyle, fieldStyle } from "./shared";
import { rewritePromptAi } from "../../../api";

export default function PromptNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  const [aiBusy, setAiBusy] = useState(false);
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
      const workflow_context = d.getWorkflowContext?.(id) ?? [];
      const up = workflow_context.filter((c) => c.role === "upstream");
      const down = workflow_context.filter((c) => c.role === "downstream");
      
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
