import { Handle, Position, type NodeProps } from "@xyflow/react";
import { WNodeData, Shell, handleLabelStyle, MediaPreview, fieldStyle } from "./shared";

export default function FrameNode({ id, data, selected }: NodeProps) {
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
