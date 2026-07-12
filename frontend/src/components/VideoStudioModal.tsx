import { useState, useMemo } from "react";
import { createPortal } from "react-dom";

/* ───── DATA: Camera Movements ───── */
const CAMERA_MOVEMENTS = [
  { id: "static", label: "Tĩnh (Static)", en: "Static camera, no movement, locked tripod shot", icon: "📌", desc: "Camera cố định, không di chuyển", path: "static" },
  { id: "dolly_in", label: "Dolly In", en: "Smooth slow dolly zoom pushing in towards the subject", icon: "➡️", desc: "Tiến gần vào chủ thể", path: "dolly_in" },
  { id: "dolly_out", label: "Dolly Out", en: "Smooth slow dolly pulling back away from the subject, revealing environment", icon: "⬅️", desc: "Lùi xa khỏi chủ thể", path: "dolly_out" },
  { id: "pan_left", label: "Pan Trái", en: "Smooth horizontal pan from right to left, following action", icon: "◀️", desc: "Quay ngang từ phải sang trái", path: "pan_l" },
  { id: "pan_right", label: "Pan Phải", en: "Smooth horizontal pan from left to right, following action", icon: "▶️", desc: "Quay ngang từ trái sang phải", path: "pan_r" },
  { id: "tilt_up", label: "Tilt Lên", en: "Vertical tilt movement from ground level looking upward to reveal height", icon: "🔼", desc: "Nghiêng camera từ dưới lên trên", path: "tilt_up" },
  { id: "tilt_down", label: "Tilt Xuống", en: "Vertical tilt movement from top looking downward", icon: "🔽", desc: "Nghiêng camera từ trên xuống dưới", path: "tilt_down" },
  { id: "orbit_cw", label: "Xoay 360° →", en: "Orbiting camera rotating clockwise around the subject, 360 degree view", icon: "🔄", desc: "Xoay quanh chủ thể theo chiều kim đồng hồ", path: "orbit_cw" },
  { id: "orbit_ccw", label: "Xoay 360° ←", en: "Orbiting camera rotating counter-clockwise around the subject", icon: "🔃", desc: "Xoay quanh chủ thể ngược chiều kim đồng hồ", path: "orbit_ccw" },
  { id: "crane_up", label: "Crane Lên", en: "Crane shot rising up vertically, revealing vast landscape from above", icon: "⤴️", desc: "Camera nâng lên cao dần (cẩu)", path: "crane_up" },
  { id: "crane_down", label: "Crane Xuống", en: "Crane shot descending down from aerial view to ground level", icon: "⤵️", desc: "Camera hạ xuống từ trên cao", path: "crane_down" },
  { id: "tracking", label: "Tracking", en: "Tracking shot following subject movement, keeping subject in frame", icon: "🏃", desc: "Theo dõi di chuyển của chủ thể", path: "tracking" },
  { id: "zoom_in", label: "Zoom In", en: "Gradual optical zoom in towards subject, increasing focal length", icon: "🔎", desc: "Zoom ống kính vào gần chủ thể", path: "zoom_in" },
  { id: "zoom_out", label: "Zoom Out", en: "Gradual optical zoom out from subject, widening field of view", icon: "🔍", desc: "Zoom ống kính ra xa", path: "zoom_out" },
  { id: "handheld", label: "Cầm tay", en: "Handheld camera with natural organic shake, documentary style, intimate feel", icon: "✋", desc: "Camera cầm tay, rung nhẹ tự nhiên", path: "handheld" },
  { id: "steadicam", label: "Steadicam", en: "Smooth steadicam gliding movement, floating camera, cinematic flow", icon: "🎥", desc: "Di chuyển mượt mà (steadicam/gimbal)", path: "steadicam" },
];

/* ───── DATA: Speed / Tempo ───── */
const SPEED_PRESETS = [
  { id: "slowmo", label: "Slow Motion", en: "Extreme slow motion, 0.25x speed, dramatic time dilation", icon: "🐌", accent: "#3b82f6" },
  { id: "slow", label: "Chậm", en: "Slow deliberate pace, 0.5x speed, contemplative mood", icon: "🐢", accent: "#06b6d4" },
  { id: "normal", label: "Bình thường", en: "Normal real-time speed, 1x natural pace", icon: "🚶", accent: "#22c55e" },
  { id: "fast", label: "Nhanh", en: "Fast energetic pace, 2x speed, dynamic movement", icon: "🏃", accent: "#f59e0b" },
  { id: "timelapse", label: "Time-lapse", en: "Time-lapse accelerated speed, compressing hours into seconds, clouds racing", icon: "⏩", accent: "#ef4444" },
  { id: "hyperlapse", label: "Hyperlapse", en: "Hyperlapse with forward movement and time acceleration, city flowing", icon: "🚀", accent: "#a855f7" },
];

/* ───── DATA: Video Styles ───── */
const VIDEO_STYLES = [
  { id: "cinematic", label: "Điện ảnh", en: "Cinematic film look, 24fps, anamorphic lens, professional color grading, shallow depth of field", accent: "#f59e0b", icon: "🎬" },
  { id: "documentary", label: "Phim tài liệu", en: "Documentary style, natural lighting, authentic feeling, observational camera", accent: "#22c55e", icon: "📹" },
  { id: "anime", label: "Anime", en: "Anime animation style, cel shading, dynamic camera movements, vibrant colors", accent: "#ec4899", icon: "🌸" },
  { id: "music_video", label: "MV / Music Video", en: "Music video style, stylized lighting, dramatic angles, fast cuts, creative transitions", accent: "#8b5cf6", icon: "🎵" },
  { id: "commercial", label: "Quảng cáo", en: "High-end commercial style, clean polished look, product showcase, studio lighting", accent: "#e2e8f0", icon: "💎" },
  { id: "vlog", label: "Vlog", en: "Casual vlog style, POV camera, natural authentic look, warm personality", accent: "#fb923c", icon: "📱" },
  { id: "noir", label: "Film Noir", en: "Dark film noir style, black and white, high contrast, dramatic shadows, mysterious", accent: "#64748b", icon: "🕵️" },
  { id: "scifi", label: "Sci-Fi", en: "Science fiction style, futuristic VFX, holographic UI, cybernetic environments, neon glow", accent: "#06b6d4", icon: "🚀" },
  { id: "vintage", label: "Vintage", en: "Vintage 8mm film look, heavy grain, light leaks, warm faded colors, nostalgic", accent: "#d97706", icon: "📼" },
  { id: "action", label: "Hành động", en: "Action movie style, dynamic fast camera, impact shots, dramatic slow motion moments", accent: "#ef4444", icon: "💥" },
  { id: "horror", label: "Kinh dị", en: "Horror atmosphere, dark desaturated, Dutch angles, unsettling tension, flickering lights", accent: "#991b1b", icon: "👻" },
  { id: "fantasy", label: "Fantasy", en: "Fantasy epic style, magical particle effects, enchanted glowing atmosphere, ethereal", accent: "#818cf8", icon: "⚔️" },
];

/* ───── DATA: Camera Angles (reused for video) ───── */
const VIDEO_ANGLES = [
  { id: "closeup", label: "Cận cảnh", en: "Close-up shot, subject filling frame", icon: "🔍", accent: "#22c55e" },
  { id: "medium", label: "Trung cảnh", en: "Medium shot, waist up, balanced", icon: "👤", accent: "#14b8a6" },
  { id: "wide", label: "Toàn cảnh", en: "Wide establishing shot, full environment", icon: "🏔", accent: "#6366f1" },
  { id: "high", label: "Trên cao", en: "High angle looking down on subject", icon: "🦅", accent: "#f59e0b" },
  { id: "low", label: "Dưới lên", en: "Low angle looking up, dramatic", icon: "⬆️", accent: "#ef4444" },
  { id: "eye", label: "Ngang mắt", en: "Eye-level natural perspective", icon: "👁", accent: "#8b5cf6" },
  { id: "drone", label: "Drone", en: "Aerial drone bird's eye top-down", icon: "🚁", accent: "#06b6d4" },
  { id: "pov", label: "POV", en: "First person POV through character eyes", icon: "🎮", accent: "#ec4899" },
];

/* ───── SVG VIEWPORT ───── */
function VideoViewport({ movement, angle }: { movement: typeof CAMERA_MOVEMENTS[0] | null; angle: typeof VIDEO_ANGLES[0] | null }) {
  const mid = movement?.id || "";
  const pathColor = "#22c55e";

  // Define camera path based on movement type
  function renderPath() {
    switch (mid) {
      case "dolly_in":
        return (<><line x1="200" y1="360" x2="200" y2="200" stroke={pathColor} strokeWidth="2" strokeDasharray="6 3" opacity="0.6"><animate attributeName="stroke-dashoffset" from="40" to="0" dur="2s" repeatCount="indefinite" /></line><polygon points="195,210 205,210 200,195" fill={pathColor} opacity="0.7"><animate attributeName="opacity" values="0.4;1;0.4" dur="1.5s" repeatCount="indefinite" /></polygon></>);
      case "dolly_out":
        return (<><line x1="200" y1="200" x2="200" y2="360" stroke={pathColor} strokeWidth="2" strokeDasharray="6 3" opacity="0.6"><animate attributeName="stroke-dashoffset" from="0" to="40" dur="2s" repeatCount="indefinite" /></line><polygon points="195,350 205,350 200,365" fill={pathColor} opacity="0.7"><animate attributeName="opacity" values="0.4;1;0.4" dur="1.5s" repeatCount="indefinite" /></polygon></>);
      case "pan_l":
        return (<><line x1="340" y1="300" x2="60" y2="300" stroke={pathColor} strokeWidth="2" strokeDasharray="6 3" opacity="0.6"><animate attributeName="stroke-dashoffset" from="40" to="0" dur="2s" repeatCount="indefinite" /></line><polygon points="70,295 70,305 55,300" fill={pathColor} opacity="0.7" /></>);
      case "pan_r":
        return (<><line x1="60" y1="300" x2="340" y2="300" stroke={pathColor} strokeWidth="2" strokeDasharray="6 3" opacity="0.6"><animate attributeName="stroke-dashoffset" from="40" to="0" dur="2s" repeatCount="indefinite" /></line><polygon points="330,295 330,305 345,300" fill={pathColor} opacity="0.7" /></>);
      case "tilt_up":
        return (<><line x1="200" y1="350" x2="200" y2="100" stroke={pathColor} strokeWidth="2" strokeDasharray="6 3" opacity="0.6"><animate attributeName="stroke-dashoffset" from="40" to="0" dur="2s" repeatCount="indefinite" /></line><polygon points="195,110 205,110 200,95" fill={pathColor} opacity="0.7" /><text x="200" y="85" textAnchor="middle" fill={pathColor} fontSize="8">↑ Tilt Up</text></>);
      case "tilt_down":
        return (<><line x1="200" y1="100" x2="200" y2="350" stroke={pathColor} strokeWidth="2" strokeDasharray="6 3" opacity="0.6"><animate attributeName="stroke-dashoffset" from="40" to="0" dur="2s" repeatCount="indefinite" /></line><polygon points="195,340 205,340 200,355" fill={pathColor} opacity="0.7" /></>);
      case "orbit_cw":
      case "orbit_ccw":
        return (<><circle cx="200" cy="200" r="120" fill="none" stroke={pathColor} strokeWidth="2" strokeDasharray="8 4" opacity="0.4"><animate attributeName="stroke-dashoffset" from={mid === "orbit_cw" ? "0" : "48"} to={mid === "orbit_cw" ? "48" : "0"} dur="3s" repeatCount="indefinite" /></circle><circle cx="200" cy="80" r="5" fill={pathColor}><animateMotion dur="3s" repeatCount="indefinite" path={`M0,0 a120,120 0 1,${mid === "orbit_cw" ? "1" : "0"} 0.001,0`}><set attributeName="fill" to={pathColor} /></animateMotion></circle></>);
      case "crane_up":
        return (<><line x1="200" y1="360" x2="200" y2="80" stroke={pathColor} strokeWidth="2" strokeDasharray="6 3" opacity="0.6"><animate attributeName="stroke-dashoffset" from="40" to="0" dur="2s" repeatCount="indefinite" /></line><polygon points="195,90 205,90 200,75" fill={pathColor} opacity="0.7" /><text x="230" y="85" fill="rgba(255,255,255,0.3)" fontSize="8">🏗 Cẩu nâng</text></>);
      case "crane_down":
        return (<><line x1="200" y1="80" x2="200" y2="360" stroke={pathColor} strokeWidth="2" strokeDasharray="6 3" opacity="0.6"><animate attributeName="stroke-dashoffset" from="40" to="0" dur="2s" repeatCount="indefinite" /></line><polygon points="195,350 205,350 200,365" fill={pathColor} opacity="0.7" /></>);
      case "tracking":
        return (<><path d="M 60,300 Q 130,250 200,280 T 340,260" fill="none" stroke={pathColor} strokeWidth="2" strokeDasharray="6 3" opacity="0.6"><animate attributeName="stroke-dashoffset" from="40" to="0" dur="2s" repeatCount="indefinite" /></path><circle cx="60" cy="300" r="4" fill={pathColor} opacity="0.5" /><polygon points="335,255 335,265 348,260" fill={pathColor} opacity="0.7" /></>);
      case "zoom_in":
        return (<><circle cx="200" cy="200" r="140" fill="none" stroke={pathColor} strokeWidth="1" strokeDasharray="4 4" opacity="0.2" /><circle cx="200" cy="200" r="80" fill="none" stroke={pathColor} strokeWidth="1.5" strokeDasharray="4 4" opacity="0.4"><animate attributeName="r" values="130;50;130" dur="3s" repeatCount="indefinite" /></circle><text x="200" y="370" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8">🔎 Zoom In</text></>);
      case "zoom_out":
        return (<><circle cx="200" cy="200" r="60" fill="none" stroke={pathColor} strokeWidth="1" strokeDasharray="4 4" opacity="0.2" /><circle cx="200" cy="200" r="80" fill="none" stroke={pathColor} strokeWidth="1.5" strokeDasharray="4 4" opacity="0.4"><animate attributeName="r" values="50;140;50" dur="3s" repeatCount="indefinite" /></circle><text x="200" y="370" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8">🔍 Zoom Out</text></>);
      case "handheld":
        return (<><path d="M 190,310 Q 195,305 200,312 T 210,308 T 198,315 T 205,310" fill="none" stroke={pathColor} strokeWidth="2" opacity="0.5"><animate attributeName="d" values="M 190,310 Q 195,305 200,312 T 210,308 T 198,315 T 205,310;M 192,308 Q 197,312 202,306 T 208,312 T 200,308 T 207,314;M 190,310 Q 195,305 200,312 T 210,308 T 198,315 T 205,310" dur="1s" repeatCount="indefinite" /></path><text x="200" y="340" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8">✋ Rung tay</text></>);
      case "steadicam":
        return (<><path d="M 80,320 C 120,200 280,200 320,320" fill="none" stroke={pathColor} strokeWidth="2" strokeDasharray="6 3" opacity="0.5"><animate attributeName="stroke-dashoffset" from="40" to="0" dur="2s" repeatCount="indefinite" /></path><circle cx="80" cy="320" r="4" fill={pathColor} opacity="0.5" /><polygon points="315,315 315,325 328,320" fill={pathColor} opacity="0.7" /><text x="200" y="185" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8">🎥 Glide mượt</text></>);
      default:
        return (<><text x="200" y="320" textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9">Chọn chuyển động camera →</text></>);
    }
  }

  return (
    <svg viewBox="0 0 400 400" style={{ width: "100%", height: "100%", maxHeight: "100%" }}>
      <defs>
        <pattern id="vidGrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
        </pattern>
        <radialGradient id="vidGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(99,102,241,0.06)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
      </defs>
      <rect width="400" height="400" fill="#080d18" />
      <rect width="400" height="400" fill="url(#vidGrid)" />
      <circle cx="200" cy="200" r="160" fill="url(#vidGlow)" />
      <circle cx="200" cy="200" r="160" fill="none" stroke="rgba(255,255,255,0.04)" strokeDasharray="6 4" />

      {/* Cross */}
      <line x1="200" y1="40" x2="200" y2="360" stroke="rgba(255,255,255,0.03)" />
      <line x1="40" y1="200" x2="360" y2="200" stroke="rgba(255,255,255,0.03)" />

      {/* Subject */}
      <circle cx="200" cy="200" r="22" fill="rgba(99,102,241,0.1)" stroke="rgba(99,102,241,0.3)" strokeWidth="1.5" />
      <circle cx="200" cy="191" r="6" fill="rgba(129,140,248,0.5)" />
      <ellipse cx="200" cy="207" rx="9" ry="10" fill="rgba(129,140,248,0.35)" />
      <text x="200" y="234" textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="7" fontFamily="monospace">CHỦ THỂ</text>

      {/* Movement path visualization */}
      {renderPath()}

      {/* Angle indicator */}
      {angle && (
        <text x="200" y="390" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="8">
          {angle.icon} {angle.label}
        </text>
      )}

      <text x="200" y="15" textAnchor="middle" fill="rgba(255,255,255,0.08)" fontSize="7" fontFamily="monospace">
        VIDEO VIEWPORT — CAMERA MOVEMENT
      </text>
    </svg>
  );
}

/* ───── TIMELINE ───── */
function Timeline({ duration }: { duration: number }) {
  const seconds = Array.from({ length: Math.ceil(duration) + 1 }, (_, i) => i);
  return (
    <div style={{ padding: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 0 }}>
        {seconds.map(s => (
          <div key={s} style={{ flex: 1, textAlign: "center", position: "relative" }}>
            <div style={{ height: s % 5 === 0 ? 14 : 8, width: 1, background: s % 5 === 0 ? "rgba(34,197,94,0.5)" : "rgba(255,255,255,0.1)", margin: "0 auto 2px" }} />
            {s % (duration > 10 ? 2 : 1) === 0 && (
              <span style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>{s}s</span>
            )}
          </div>
        ))}
      </div>
      {/* Progress bar */}
      <div style={{ height: 4, background: "rgba(255,255,255,0.05)", borderRadius: 2, marginTop: 4, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: "100%", borderRadius: 2,
          background: "linear-gradient(90deg, #22c55e, #14b8a6, #06b6d4)",
          animation: "timelineProgress 3s linear infinite",
        }} />
      </div>
      <style>{`
        @keyframes timelineProgress { 0% { transform: translateX(-100%); } 100% { transform: translateX(100%); } }
      `}</style>
    </div>
  );
}

/* ───── CARD GRID ───── */
function CardGrid({ items, selected, onSelect, cols = 4 }: {
  items: { id: string; label: string; icon: string; accent?: string; desc?: string }[];
  selected: string;
  onSelect: (id: string) => void;
  cols?: number;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 5 }}>
      {items.map(it => {
        const active = it.id === selected;
        const c = it.accent || "#22c55e";
        return (
          <button key={it.id} type="button" onClick={() => onSelect(it.id === selected ? "" : it.id)} title={it.desc || it.label}
            style={{
              background: active ? `${c}18` : "rgba(255,255,255,0.02)",
              border: `1px solid ${active ? `${c}60` : "rgba(255,255,255,0.06)"}`,
              borderRadius: 8, padding: "9px 4px 7px", cursor: "pointer", textAlign: "center",
              transition: "all 0.2s", color: active ? c : "rgba(255,255,255,0.7)", outline: "none", position: "relative",
            }}
          >
            {active && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: c }} />}
            <div style={{ fontSize: 18, lineHeight: 1 }}>{it.icon}</div>
            <div style={{ fontSize: 8, marginTop: 4, fontWeight: active ? 700 : 400, lineHeight: 1.2 }}>{it.label}</div>
          </button>
        );
      })}
    </div>
  );
}

/* ───── SECTION ───── */
function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 11, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
        <span style={{ fontSize: 13 }}>{icon}</span> {title}
      </h3>
      {children}
    </div>
  );
}

/* ───── MAIN MODAL ───── */
export interface VideoStudioSettings {
  cameraAngle: string;
  style: string;
  cameraMovement: string;
  movementSpeed: string;
  duration: number;
}

interface Props {
  initial: VideoStudioSettings;
  onConfirm: (s: VideoStudioSettings) => void;
  onClose: () => void;
}

function findId(items: { id: string; en: string }[], prompt: string): string {
  if (!prompt) return "";
  return items.find(i => i.en === prompt)?.id || "";
}

export default function VideoStudioModal({ initial, onConfirm, onClose }: Props) {
  const [moveId, setMoveId] = useState(() => findId(CAMERA_MOVEMENTS, initial.cameraMovement));
  const [speedId, setSpeedId] = useState(() => findId(SPEED_PRESETS, initial.movementSpeed));
  const [styleId, setStyleId] = useState(() => findId(VIDEO_STYLES, initial.style));
  const [angleId, setAngleId] = useState(() => findId(VIDEO_ANGLES, initial.cameraAngle));
  const [duration, setDuration] = useState(initial.duration || 5);

  const selMove = CAMERA_MOVEMENTS.find(m => m.id === moveId) || null;
  const selSpeed = SPEED_PRESETS.find(s => s.id === speedId) || null;
  const selStyle = VIDEO_STYLES.find(s => s.id === styleId) || null;
  const selAngle = VIDEO_ANGLES.find(a => a.id === angleId) || null;

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (selMove) parts.push(selMove.en);
    if (selAngle) parts.push(selAngle.en);
    if (selSpeed) parts.push(selSpeed.en);
    if (selStyle) parts.push(selStyle.en);
    parts.push(`${duration} seconds duration`);
    return parts.join(", ");
  }, [selMove, selAngle, selSpeed, selStyle, duration]);

  const count = [selMove, selAngle, selSpeed, selStyle].filter(Boolean).length;

  function handleConfirm() {
    onConfirm({
      cameraAngle: selAngle?.en || "",
      style: selStyle?.en || "",
      cameraMovement: selMove?.en || "",
      movementSpeed: selSpeed?.en || "",
      duration,
    });
  }

  return createPortal(
    <div onClick={onClose} className="nodrag nowheel"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.88)", display: "flex", padding: 16, zIndex: 99999, backdropFilter: "blur(10px)", animation: "fadeIn 0.25s ease" }}
    >
      <div onClick={e => e.stopPropagation()}
        style={{
          flex: 1, display: "flex", flexDirection: "column",
          background: "linear-gradient(145deg, #0a0f1e 0%, #141e30 50%, #0c1222 100%)",
          borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden",
          boxShadow: "0 0 80px rgba(34,197,94,0.06), 0 25px 50px rgba(0,0,0,0.5)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #f59e0b, #ef4444)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🎬</div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "#fff", fontWeight: 800, letterSpacing: 1 }}>STUDIO VIDEO NÂNG CAO</h2>
              <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: 0.5 }}>Giả lập studio — Chuyển động camera • Tốc độ • Phong cách • Timeline</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {count > 0 && (
              <span style={{ fontSize: 10, background: "rgba(245,158,11,0.15)", color: "#f59e0b", padding: "4px 10px", borderRadius: 20, border: "1px solid rgba(245,158,11,0.2)", fontWeight: 700 }}>
                {count} cấu hình
              </span>
            )}
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#94a3b8", padding: "8px 14px", cursor: "pointer", fontSize: 16 }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Left: Viewport + Timeline */}
          <div style={{ width: "40%", minWidth: 300, padding: 16, display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ flex: 1, background: "rgba(0,0,0,0.4)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.04)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <VideoViewport movement={selMove} angle={selAngle} />
            </div>
            {/* Movement description */}
            {selMove && (
              <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(34,197,94,0.06)", borderRadius: 8, border: "1px solid rgba(34,197,94,0.12)" }}>
                <div style={{ fontSize: 11, color: "#22c55e", fontWeight: 700 }}>{selMove.icon} {selMove.label}</div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{selMove.desc}</div>
              </div>
            )}
            {/* Timeline */}
            <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(0,0,0,0.2)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: "#94a3b8", fontFamily: "monospace", textTransform: "uppercase" }}>⏱ Timeline ({duration}s)</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button onClick={() => setDuration(Math.max(1, duration - 1))} style={{ width: 22, height: 22, borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                  <span style={{ fontSize: 12, color: "#22c55e", fontWeight: 700, minWidth: 24, textAlign: "center" }}>{duration}s</span>
                  <button onClick={() => setDuration(Math.min(30, duration + 1))} style={{ width: 22, height: 22, borderRadius: 4, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
                </div>
              </div>
              <Timeline duration={duration} />
            </div>
            {/* Badges */}
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {selSpeed && <span style={{ fontSize: 8, padding: "2px 8px", borderRadius: 20, background: `${selSpeed.accent}15`, color: selSpeed.accent, border: `1px solid ${selSpeed.accent}30` }}>{selSpeed.icon} {selSpeed.label}</span>}
              {selStyle && <span style={{ fontSize: 8, padding: "2px 8px", borderRadius: 20, background: `${selStyle.accent}15`, color: selStyle.accent, border: `1px solid ${selStyle.accent}30` }}>{selStyle.icon} {selStyle.label}</span>}
            </div>
          </div>

          {/* Right: Controls */}
          <div style={{ flex: 1, padding: "16px 20px", overflowY: "auto" }}>
            <Section icon="🎥" title="Chuyển Động Camera / Camera Movement">
              <CardGrid items={CAMERA_MOVEMENTS} selected={moveId} onSelect={setMoveId} cols={4} />
            </Section>
            <Section icon="📷" title="Góc Quay / Camera Angle">
              <CardGrid items={VIDEO_ANGLES} selected={angleId} onSelect={setAngleId} cols={4} />
            </Section>
            <Section icon="⚡" title="Tốc Độ / Speed">
              <CardGrid items={SPEED_PRESETS} selected={speedId} onSelect={setSpeedId} cols={3} />
            </Section>
            <Section icon="🎨" title="Phong Cách Video / Video Style">
              <CardGrid items={VIDEO_STYLES} selected={styleId} onSelect={setStyleId} cols={4} />
            </Section>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 24px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginBottom: 3, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: 1 }}>📝 Prompt bổ sung cho AI:</div>
            <div style={{ fontSize: 10, color: summary ? "#f59e0b" : "rgba(255,255,255,0.15)", fontFamily: "monospace", lineHeight: 1.5, maxHeight: 40, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {summary || "Chưa chọn cấu hình nào..."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={onClose} style={{ padding: "10px 20px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#94a3b8", cursor: "pointer", fontSize: 12 }}>Hủy</button>
            <button onClick={handleConfirm}
              style={{ padding: "10px 28px", background: "linear-gradient(135deg, #f59e0b, #ea580c)", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, letterSpacing: 0.5, boxShadow: "0 4px 14px rgba(245,158,11,0.3)" }}
            >
              ✓ Xác Nhận
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
