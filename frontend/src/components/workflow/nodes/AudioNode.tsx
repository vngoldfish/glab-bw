import { Handle, Position, type NodeProps } from "@xyflow/react";
import { WNodeData, Shell, handleLabelStyle, fieldStyle, readFileAsDataUrl } from "./shared";

export default function AudioNode({ id, data, selected }: NodeProps) {
  const d = data as WNodeData;
  return (
    <Shell
      type="audio_source"
      title={d.title || "🎵 Nhạc nền"}
      selected={selected}
      runStatus={d.runStatus}
      runError={d.runError}
    >
      <Handle
        type="source"
        position={Position.Right}
        id="audio"
        style={{ background: "#ec4899" }}
        title="Cổng xuất Nhạc"
      />
      <div style={handleLabelStyle("right", "50%")}>Nhạc →</div>
      
      <div className="nodrag nopan node-attach-bar">
        <div className="node-attach-head">
          <span>Gắn nhạc có sẵn</span>
          {d.audio ? (
            <button
              type="button"
              className="node-attach-clear"
              onClick={() => d.onChange?.(id, { audio: undefined, refName: undefined })}
            >
              Gỡ
            </button>
          ) : null}
        </div>
        {d.audio ? (
          <div style={{ marginTop: 8 }}>
            {d.refName && (
              <div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.refName}
              </div>
            )}
            <audio src={d.audio} controls style={{ width: '100%', height: 32 }} />
          </div>
        ) : (
          <div className="node-attach-actions">
            <label className="node-attach-btn">
              ⬆ Upload
              <input
                type="file"
                accept="audio/*"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (f.size > 50 * 1024 * 1024) {
                    alert("File quá lớn (tối đa 50MB)");
                    return;
                  }
                  try {
                    const url = await readFileAsDataUrl(f);
                    d.onChange?.(id, { audio: url, refName: f.name });
                  } catch (err) {
                    console.warn('Upload failed:', err);
                  }
                }}
              />
            </label>
          </div>
        )}
      </div>

      <input
        className="nodrag"
        value={
          d.audio?.startsWith("data:") ? (d.refName ? `✅ ${d.refName}` : "✅ Đã gắn file local")
          : d.audio || ""
        }
        readOnly={!!d.audio?.startsWith("data:")}
        onChange={(e) => d.onChange?.(id, { audio: e.target.value, refName: undefined })}
        placeholder="Hoặc dán URL audio..."
        style={{ ...fieldStyle(), marginTop: 6, fontSize: 10, opacity: d.audio?.startsWith("data:") ? 0.5 : 1 }}
      />
    </Shell>
  );
}
