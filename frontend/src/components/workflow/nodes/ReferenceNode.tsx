import { Handle, Position, type NodeProps } from "@xyflow/react";
import { WNodeData, Shell, handleLabelStyle, ImageAttachBar, MediaPreview, fieldStyle } from "./shared";

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
