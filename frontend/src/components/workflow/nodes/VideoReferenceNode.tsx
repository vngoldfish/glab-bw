import { Handle, Position, type NodeProps } from "@xyflow/react";
import { WNodeData, Shell, handleLabelStyle, VideoAttachBar, MediaPreview, fieldStyle } from "./shared";
import RefNameInput from "../RefNameInput";

export default function VideoReferenceNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  const previewUrls = d.resultUrls?.length ? d.resultUrls : [];
  return (
    <Shell
      type="video_reference"
      title={d.refName ? `📹 @${d.refName}` : (d.title || "Video có sẵn")}
      selected={selected}
      runStatus={d.runStatus}
      runError={d.runError}
    >
      <Handle
        type="source"
        position={Position.Right}
        id="video"
        style={{ background: "#f59e0b" }}
        title="Cổng xuất Video: Nối sang cổng Video mẫu của node Tạo video, hoặc cổng Video gốc của node Tách frame"
      />
      <div style={handleLabelStyle("right", "50%")}>Video ref →</div>
      <RefNameInput
        refName={d.refName}
        onChange={(name: string) => {
          d.onChange?.(id, { refName: name, title: name ? `📹 @${name}` : "Video có sẵn" });
        }}
      />
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
