import { useState, useCallback, useMemo, useRef } from "react";
import { rewritePromptAi, type WorkflowAiNodeContext } from "../api";

interface UseAiRewriteOptions {
  nodeId: string;
  kind: "image" | "video";
  /** The current prompt text */
  prompt: string;
  /** Callback to get workflow context graph */
  getWorkflowContext?: (nodeId: string) => WorkflowAiNodeContext[];
  /** Callback to update the node data */
  onChange?: (id: string, patch: Record<string, any>) => void;
  /** Field name to write the rewritten prompt to (default: "prompt") */
  targetField?: string;
  /** Error callback */
  onError?: (msg: string) => void;
}

interface UseAiRewriteResult {
  aiBusy: boolean;
  handleAiRewrite: () => Promise<void>;
  /** Context hint for toolbar display */
  ctxHint: { up: number; down: number } | null;
}

/**
 * Shared hook for AI prompt rewriting across all node types.
 * Eliminates 5× copy-paste of nearly identical rewrite logic.
 */
export function useAiRewrite({
  nodeId,
  kind,
  prompt,
  getWorkflowContext,
  onChange,
  targetField = "prompt",
  onError,
}: UseAiRewriteOptions): UseAiRewriteResult {
  const [aiBusy, setAiBusy] = useState(false);
  const busyRef = useRef(false);

  const handleAiRewrite = useCallback(async () => {
    const source = (prompt || "").trim();
    if (!source) {
      onError?.("Nhập ý/prompt trên node này trước khi dùng AI");
      return;
    }
    if (busyRef.current) return;
    busyRef.current = true;
    setAiBusy(true);
    try {
      const workflow_context = getWorkflowContext?.(nodeId) ?? [];

      // Auto-detect kind from pipeline if on PromptNode
      let kindUse = kind;
      if (kind === "image") {
        const down = workflow_context.filter((c) => c.role === "downstream");
        const hasVid = down.some((c) => c.type === "video_generate");
        const hasImg = down.some((c) => c.type === "generate");
        if (hasVid && !hasImg) kindUse = "video";
      }

      const res = await rewritePromptAi({
        prompt: source,
        kind: kindUse,
        locale: "vi",
        current_node_id: nodeId,
        workflow_context,
      });
      const next = (res.prompt || "").trim();
      if (!next) {
        onError?.("AI trả về prompt rỗng — kiểm tra API AI trong Cài đặt");
        return;
      }
      onChange?.(nodeId, { [targetField]: next });
      if (next === source) {
        onError?.("AI gần như không đổi prompt — thử model/style khác trong Cài đặt");
      }
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      busyRef.current = false;
      setAiBusy(false);
    }
  }, [prompt, nodeId, kind, getWorkflowContext, onChange, targetField, onError]);

  // Live context hint for toolbar
  const ctxHint = useMemo(() => {
    try {
      const ctx = getWorkflowContext?.(nodeId) ?? [];
      const up = ctx.filter((c) => c.role === "upstream").length;
      const down = ctx.filter((c) => c.role === "downstream").length;
      if (up === 0 && down === 0) return null;
      return { up, down };
    } catch {
      return null;
    }
  }, [getWorkflowContext, nodeId]);

  return { aiBusy, handleAiRewrite, ctxHint };
}
