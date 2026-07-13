import type { CSSProperties } from "react";

interface BadgeConfig {
  key: string;
  icon: string;
  value?: string;
  color: string;
}

const badgeBase: CSSProperties = {
  fontSize: 8,
  padding: "2px 6px",
  borderRadius: 4,
  maxWidth: 140,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

function makeBadgeStyle(color: string): CSSProperties {
  return {
    ...badgeBase,
    background: `${color}26`, // ~15% opacity
    color,
    border: `1px solid ${color}33`, // ~20% opacity
  };
}

interface ConfigBadgesProps {
  cameraAngle?: string;
  style?: string;
  lighting?: string;
  composition?: string;
  cameraMovement?: string;
  movementSpeed?: string;
  studioDuration?: number;
}

/**
 * Shared configuration badges display for image/video nodes.
 * Eliminates ~60 lines of repeated inline style badge JSX.
 */
export default function ConfigBadges(props: ConfigBadgesProps) {
  const badges: BadgeConfig[] = [
    { key: "cameraMovement", icon: "🎥", value: props.cameraMovement, color: "#22c55e" },
    { key: "cameraAngle", icon: "📷", value: props.cameraAngle, color: props.cameraMovement ? "#f59e0b" : "#22c55e" },
    { key: "movementSpeed", icon: "⚡", value: props.movementSpeed, color: "#06b6d4" },
    { key: "style", icon: "🎨", value: props.style, color: "#818cf8" },
    { key: "lighting", icon: "💡", value: props.lighting, color: "#fbbf24" },
    { key: "composition", icon: "▦", value: props.composition, color: "#6366f1" },
  ];

  const activeBadges = badges.filter((b) => b.value);
  if (activeBadges.length === 0 && !props.studioDuration) return null;

  return (
    <div style={{ marginBottom: 8, display: "flex", flexWrap: "wrap", gap: 3 }}>
      {activeBadges.map((b) => (
        <span key={b.key} style={makeBadgeStyle(b.color)}>
          {b.icon} {b.value!.split(",")[0]}
        </span>
      ))}
      {props.studioDuration != null && props.studioDuration > 0 && (
        <span
          style={{
            ...badgeBase,
            background: "rgba(255,255,255,0.05)",
            color: "#94a3b8",
            border: "1px solid rgba(255,255,255,0.08)",
          }}
        >
          ⏱ {props.studioDuration}s
        </span>
      )}
    </div>
  );
}
