import { Handle, Position, type NodeProps } from "@xyflow/react";
import { WNodeData, Shell, handleLabelStyle, ImageAttachBar, MediaPreview, fieldStyle } from "./shared";
import RefNameInput from "../RefNameInput";

export default function ReferenceNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
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
      <RefNameInput
        refName={d.refName}
        onChange={(name: string) => {
          d.onChange?.(id, { refName: name, title: name ? `@${name}` : "Ảnh có sẵn" });
        }}
      />
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
