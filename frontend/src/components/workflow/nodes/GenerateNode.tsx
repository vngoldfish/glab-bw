import { useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import {
  WNodeData,
  Shell,
  handleLabelStyle,
  ImageAttachBar,
  MediaPreview
} from "./shared";
import { useAiRewrite } from "../../../hooks/useAiRewrite";
import ImageStudioModal, { type ImageStudioSettings } from "../../ImageStudioModal";
import EngineModelSelector from "../EngineModelSelector";
import InlinePromptEditor from "../InlinePromptEditor";
import RefNameInput from "../RefNameInput";
import ConfigBadges from "../ConfigBadges";

export default function GenerateNode({ id, data, selected, plus = false }: NodeProps & { plus?: boolean }) {
  const d = data as WNodeData;
  const [showModal, setShowModal] = useState(false);
  const hasPromptEdge = Boolean(d.hasPromptInput);

  const { aiBusy, handleAiRewrite, ctxHint } = useAiRewrite({
    nodeId: id,
    kind: "image",
    prompt: d.prompt || "",
    getWorkflowContext: d.getWorkflowContext,
    onChange: d.onChange,
    targetField: "prompt",
    onError: d.onError,
  });

  return (
    <Shell
      type="generate"
      title={d.title || (plus ? "Tạo ảnh +" : "Tạo ảnh")}
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

      {plus && (
        <div style={{ marginBottom: 8, display: "flex", gap: 6 }}>
          <button
            type="button"
            className="wf-btn wf-btn-secondary nodrag"
            style={{ width: "100%", padding: "6px 8px", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: "rgba(34, 197, 94, 0.1)", border: "1px solid rgba(34, 197, 94, 0.2)" }}
            onClick={() => setShowModal(true)}
          >
            ⚙️ Cấu hình chụp & style +
          </button>
        </div>
      )}

      {plus && <ConfigBadges cameraAngle={d.cameraAngle} style={d.style} lighting={d.lighting} composition={d.composition} />}

      <EngineModelSelector
        type="image"
        engine={d.engine}
        model={d.model}
        aspect_ratio={d.aspect_ratio}
        onChange={(patch: Partial<WNodeData>) => d.onChange?.(id, patch)}
      />

      {!hasPromptEdge && (
        <InlinePromptEditor
          kind="image"
          value={d.prompt || ""}
          aiBusy={aiBusy}
          onAiRewrite={handleAiRewrite}
          onChange={(text: string) => d.onChange?.(id, { prompt: text })}
          ctxHint={ctxHint}
        />
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
        <RefNameInput
          refName={d.refName}
          onChange={(name: string) => d.onChange?.(id, { refName: name })}
        />
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

      {plus && showModal && (
        <ImageStudioModal
          initial={{
            cameraAngle: d.cameraAngle || "",
            style: d.style || "",
            lighting: d.lighting || "",
            composition: d.composition || "",
          }}
          onConfirm={(s: ImageStudioSettings) => {
            d.onChange?.(id, {
              cameraAngle: s.cameraAngle,
              style: s.style,
              lighting: s.lighting,
              composition: s.composition,
            });
            setShowModal(false);
          }}
          onClose={() => setShowModal(false)}
        />
      )}
    </Shell>
  );
}
