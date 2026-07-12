interface RefNameInputProps {
  refName?: string;
  onChange: (name: string) => void;
}

/**
 * Shared @refName input block used in ReferenceNode and Generate nodes.
 * Eliminates 3× copy-paste (~90 lines) of identical name input UI.
 */
export default function RefNameInput({ refName, onChange }: RefNameInputProps) {
  return (
    <div
      style={{
        marginTop: 6,
        padding: "6px 8px",
        background: "rgba(255,255,255,0.03)",
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.05)",
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: "#94a3b8",
          marginBottom: 4,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>Tên gọi trong prompt:</span>
        {refName && (
          <strong style={{ color: "#14b8a6" }}>@{refName}</strong>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <span style={{ fontSize: 11, color: "#14b8a6", fontWeight: 700 }}>@</span>
        <input
          type="text"
          className="nodrag"
          value={refName || ""}
          onChange={(e) => {
            const clean = e.target.value.replace(/[^a-zA-Z0-9_]/g, "");
            onChange(clean);
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
            outline: "none",
          }}
        />
      </div>
    </div>
  );
}
