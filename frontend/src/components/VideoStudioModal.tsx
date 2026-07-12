import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { fetchAllProjectAssets, mediaUrl, normalizeFileUrl, type ProjectAsset } from "../api";

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
];

/* ───── DATA: Video Styles ───── */
const VIDEO_STYLES = [
  { id: "cinematic", label: "Điện ảnh", en: "Cinematic film look, 24fps, anamorphic lens, professional color grading, shallow depth of field", accent: "#f59e0b", icon: "🎬" },
  { id: "documentary", label: "Phim tài liệu", en: "Documentary style, natural lighting, authentic feeling, observational camera", accent: "#22c55e", icon: "📹" },
  { id: "anime", label: "Anime", en: "Anime animation style, cel shading, dynamic camera movements, vibrant colors", accent: "#ec4899", icon: "🌸" },
  { id: "music_video", label: "MV / Music Video", en: "Music video style, stylized lighting, dramatic angles, fast cuts, creative transitions", accent: "#8b5cf6", icon: "🎵" },
  { id: "commercial", label: "Quảng cáo", en: "High-end commercial style, clean polished look, product showcase, studio lighting", accent: "#e2e8f0", icon: "💎" },
  { id: "vlog", label: "Vlog", en: "Casual vlog style, POV camera, natural authentic look, warm personality", accent: "#fb923c", icon: "📱" },
  { id: "scifi", label: "Sci-Fi", en: "Science fiction style, futuristic VFX, holographic UI, cybernetic environments, neon glow", accent: "#06b6d4", icon: "🚀" },
  { id: "vintage", label: "Vintage", en: "Vintage 8mm film look, heavy grain, light leaks, warm faded colors, nostalgic", accent: "#d97706", icon: "📼" },
];

/* ───── DATA: Camera Angles ───── */
const VIDEO_ANGLES = [
  { id: "closeup", label: "Cận cảnh", en: "Close-up shot, subject filling frame", icon: "🔍", accent: "#22c55e" },
  { id: "medium", label: "Trung cảnh", en: "Medium shot, waist up, balanced", icon: "👤", accent: "#14b8a6" },
  { id: "wide", label: "Toàn cảnh", en: "Wide establishing shot, full environment", icon: "🏔", accent: "#6366f1" },
  { id: "high", label: "Trên cao", en: "High angle looking down on subject", icon: "🦅", accent: "#f59e0b" },
  { id: "low", label: "Dưới lên", en: "Low angle looking up, dramatic", icon: "⬆️", accent: "#ef4444" },
  { id: "eye", label: "Ngang mắt", en: "Eye-level natural perspective", icon: "👁", accent: "#8b5cf6" },
  { id: "pov", label: "POV", en: "First person POV through character eyes", icon: "🎮", accent: "#ec4899" },
];

/* Helper to convert file to base64 Data URL */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ───── LOCAL ASSETS PICKER MODAL OVERLAY ───── */
function LocalAssetPicker({ onClose, onSelect }: { onClose: () => void; onSelect: (url: string) => void }) {
  const [assets, setAssets] = useState<ProjectAsset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAllProjectAssets("image")
      .then(res => {
        setAssets(res.assets || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999999, padding: 24, backdropFilter: "blur(6px)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#0f172a", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 12, width: "90%", maxWidth: 640, height: "80vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <div style={{ padding: 16, borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: 13, color: "#fff", fontWeight: 700 }}>📂 CHỌN ẢNH TỪ THƯ VIỆN DỰ ÁN</h3>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#94a3b8", fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>
        <div style={{ flex: 1, padding: 16, overflowY: "auto" }}>
          {loading ? (
            <div style={{ color: "rgba(255,255,255,0.4)", textAlign: "center", marginTop: 40, fontSize: 11 }}>Đang tải thư viện ảnh...</div>
          ) : assets.length === 0 ? (
            <div style={{ color: "rgba(255,255,255,0.4)", textAlign: "center", marginTop: 40, fontSize: 11 }}>Chưa có ảnh nào được sinh ra hoặc upload trong các project.</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 10 }}>
              {assets.map((a, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => { onSelect(a.url); onClose(); }}
                  style={{
                    background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, overflow: "hidden",
                    cursor: "pointer", display: "flex", flexDirection: "column", padding: 0, width: "100%", transition: "border 0.2s"
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = "#f59e0b"}
                  onMouseLeave={e => e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"}
                >
                  <img src={mediaUrl(normalizeFileUrl(a.url))} alt="" style={{ width: "100%", height: 75, objectFit: "cover" }} />
                  <div style={{ fontSize: 8, color: "rgba(255,255,255,0.6)", padding: "4px 6px", width: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left" }}>
                    {a.name}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───── SVG VIEWPORT ───── */
function VideoViewport({ movement, angle }: { movement: string; angle: string }) {
  const moveItem = CAMERA_MOVEMENTS.find(m => m.en === movement) || null;
  const angleItem = VIDEO_ANGLES.find(a => a.en === angle) || null;
  const mid = moveItem?.id || "";
  const pathColor = "#22c55e";

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
        return (<><text x="200" y="320" textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="9">Camera tĩnh</text></>);
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
      {angleItem && (
        <text x="200" y="390" textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="8">
          {angleItem.icon} {angleItem.label}
        </text>
      )}

      <text x="200" y="15" textAnchor="middle" fill="rgba(255,255,255,0.08)" fontSize="7" fontFamily="monospace">
        VIDEO VIEWPORT — CAMERA MOVEMENT
      </text>
    </svg>
  );
}

/* ───── CARD GRID ───── */
function CardGrid({ items, selected, onSelect, cols = 4 }: {
  items: { id: string; label: string; icon: string; accent?: string; desc?: string; en?: string }[];
  selected: string;
  onSelect: (en: string) => void;
  cols?: number;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4 }}>
      {items.map(it => {
        const val = it.en || "";
        const active = val === selected;
        const c = it.accent || "#22c55e";
        return (
          <button key={it.id} type="button" onClick={() => onSelect(active ? "" : val)} title={it.desc || it.label}
            style={{
              background: active ? `${c}12` : "rgba(255,255,255,0.02)",
              border: `1px solid ${active ? `${c}50` : "rgba(255,255,255,0.05)"}`,
              borderRadius: 6, padding: "6px 2px", cursor: "pointer", textAlign: "center",
              transition: "all 0.15s", color: active ? c : "rgba(255,255,255,0.6)", outline: "none", position: "relative",
            }}
          >
            {active && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1.5, background: c }} />}
            <div style={{ fontSize: 13, lineHeight: 1 }}>{it.icon}</div>
            <div style={{ fontSize: 7, marginTop: 2, fontWeight: active ? 700 : 400, lineHeight: 1.2 }}>{it.label}</div>
          </button>
        );
      })}
    </div>
  );
}

/* ───── SECTION ───── */
function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <h3 style={{ margin: "0 0 4px", fontSize: 9, color: "#94a3b8", display: "flex", alignItems: "center", gap: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
        <span style={{ fontSize: 10 }}>{icon}</span> {title}
      </h3>
      {children}
    </div>
  );
}

/* ───── TYPES & INTERFACES ───── */
export interface VideoSegment {
  id: string;
  start: number;
  end: number;
  movement: string;
  angle: string;
  action: string;
  audio: string;
}

export interface CharacterAsset {
  id: string;
  name: string;
  url: string;
}

export interface VideoStudioSettings {
  cameraAngle: string;
  style: string;
  cameraMovement: string;
  movementSpeed: string;
  duration: number;
  timelineSegments?: VideoSegment[];
  mode?: string;          // "text_to_video" | "start_image" | "start_end_image"
  start_image?: string;
  end_image?: string;
  characterAssets?: CharacterAsset[];
  // Edge checks & canvas presets
  hasStartImageEdge?: boolean;
  hasEndImageEdge?: boolean;
  workflowCharacters?: Array<{ name: string; url: string }>;
  connectedCharacters?: Array<{ name: string; url: string }>;
  runStatus?: string;
}

interface Props {
  initial: VideoStudioSettings;
  onConfirm: (s: VideoStudioSettings, triggerRun?: boolean) => void;
  onClose: () => void;
}

export default function VideoStudioModal({ initial, onConfirm, onClose }: Props) {
  const [duration, setDuration] = useState(initial.duration || 8);
  const [styleId, setStyleId] = useState(() => initial.style || "");
  const [speedId, setSpeedId] = useState(() => initial.movementSpeed || "");
  const [mode, setMode] = useState(() => initial.mode || "text_to_video");

  // Mode Images references
  const [startImg, setStartImg] = useState(() => initial.start_image || "");
  const [endImg, setEndImg] = useState(() => initial.end_image || "");

  // Auto-switch mode based on presence of start and end images
  useEffect(() => {
    const hasStart = initial.hasStartImageEdge || Boolean(startImg);
    const hasEnd = initial.hasEndImageEdge || Boolean(endImg);
    if (hasStart && hasEnd) {
      setMode("start_end_image");
    } else if (hasStart) {
      setMode("start_image");
    } else {
      setMode("text_to_video");
    }
  }, [startImg, endImg, initial.hasStartImageEdge, initial.hasEndImageEdge]);

  // Character library assets
  const [charAssets, setCharAssets] = useState<CharacterAsset[]>(() => initial.characterAssets || []);
  const [newCharName, setNewCharName] = useState("");

  // Asset picker target
  const [pickerTarget, setPickerTarget] = useState<"start" | "end" | "character" | null>(null);

  // References tab: "media" (ảnh đầu/cuối) vs "chars" (nhân vật/đồ vật)
  const [leftTab, setLeftTab] = useState<"media" | "chars">("media");

  // Input ref to insert tags in prompt
  const segmentPromptRef = useRef<HTMLTextAreaElement>(null);

  // Initialize segments
  const [segments, setSegments] = useState<VideoSegment[]>(() => {
    if (initial.timelineSegments && initial.timelineSegments.length > 0) {
      return initial.timelineSegments;
    }
    return [
      {
        id: "seg_1",
        start: 0,
        end: initial.duration || 8,
        movement: initial.cameraMovement || CAMERA_MOVEMENTS[0].en,
        angle: initial.cameraAngle || VIDEO_ANGLES[1].en,
        action: "",
        audio: "",
      }
    ];
  });

  const [selectedSegId, setSelectedSegId] = useState<string | null>(segments[0]?.id || null);

  // Clean segments when duration changes
  const activeSegments = useMemo(() => {
    return segments.map(seg => {
      let nextStart = seg.start;
      let nextEnd = seg.end;
      if (nextStart >= duration) {
        nextStart = Math.max(0, duration - 2);
      }
      if (nextEnd > duration || nextEnd <= nextStart) {
        nextEnd = duration;
      }
      return { ...seg, start: nextStart, end: nextEnd };
    }).sort((a, b) => a.start - b.start);
  }, [segments, duration]);

  const selectedSeg = activeSegments.find(s => s.id === selectedSegId) || null;

  // Add new segment
  function handleAddSegment() {
    const sorted = [...activeSegments].sort((a, b) => a.start - b.start);
    let gapStart = 0;
    let gapEnd = duration;
    let foundGap = false;

    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i].start > gapStart + 0.5) {
        gapEnd = sorted[i].start;
        foundGap = true;
        break;
      }
      gapStart = sorted[i].end;
    }

    if (!foundGap && gapStart < duration - 0.5) {
      gapEnd = duration;
      foundGap = true;
    }

    if (!foundGap) {
      alert("Timeline đã kín! Vui lòng tăng tổng thời lượng hoặc thu nhỏ các phân cảnh khác để thêm phân cảnh mới.");
      return;
    }

    const newSeg: VideoSegment = {
      id: `seg_${Date.now()}`,
      start: gapStart,
      end: gapEnd,
      movement: CAMERA_MOVEMENTS[0].en,
      angle: VIDEO_ANGLES[1].en,
      action: "",
      audio: "",
    };

    setSegments([...activeSegments, newSeg]);
    setSelectedSegId(newSeg.id);
  }

  // Delete segment
  function handleDeleteSegment(id: string) {
    if (activeSegments.length <= 1) {
      alert("Video cần ít nhất một phân cảnh!");
      return;
    }
    const next = activeSegments.filter(s => s.id !== id);
    setSegments(next);
    setSelectedSegId(next[0]?.id || null);
  }

  // Update selected segment fields
  function updateSelected(patch: Partial<Omit<VideoSegment, "id">>) {
    if (!selectedSegId) return;
    setSegments(prev => prev.map(s => s.id === selectedSegId ? { ...s, ...patch } : s));
  }

  // Insert character tag into segment prompt textarea
  function insertCharacterTag(tagName: string) {
    const tag = tagName.startsWith("@") ? tagName : `@${tagName}`;
    const textarea = segmentPromptRef.current;
    if (!textarea || !selectedSeg) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = selectedSeg.action || "";
    const before = text.substring(0, start);
    const after = text.substring(end, text.length);
    const newVal = `${before ? before + " " : ""}${tag}${after ? " " + after : ""}`;
    
    updateSelected({ action: newVal });

    setTimeout(() => {
      textarea.focus();
      textarea.selectionStart = textarea.selectionEnd = start + tag.length + (before ? 1 : 0);
    }, 0);
  }

  // Add a canvas reference preset to studio characterAssets list
  function addCanvasPreset(c: { name: string; url: string }) {
    const cleanName = c.name.startsWith("@") ? c.name : `@${c.name}`;
    if (charAssets.some(x => x.name.toLowerCase() === cleanName.toLowerCase())) {
      alert(`Nhân vật ${cleanName} đã tồn tại trong danh sách Studio!`);
      return;
    }
    setCharAssets([...charAssets, {
      id: `char_preset_${Date.now()}`,
      name: cleanName,
      url: c.url
    }]);
  }

  // Compute bounding constraints for selected segment to prevent overlaps
  const limits = useMemo(() => {
    if (!selectedSeg) return { minStart: 0, maxEnd: duration };
    const sorted = [...activeSegments].filter(s => s.id !== selectedSeg.id).sort((a, b) => a.start - b.start);
    let minStart = 0;
    let maxEnd = duration;

    for (const s of sorted) {
      if (s.end <= selectedSeg.start) {
        minStart = Math.max(minStart, s.end);
      }
      if (s.start >= selectedSeg.end) {
        maxEnd = Math.min(maxEnd, s.start);
      }
    }
    return { minStart, maxEnd };
  }, [activeSegments, selectedSeg, duration]);

  // Compile final structured timeline description for the AI prompt
  const compiledPrompt = useMemo(() => {
    const sorted = [...activeSegments].sort((a, b) => a.start - b.start);
    const parts = sorted.map((seg) => {
      const moveLabel = CAMERA_MOVEMENTS.find(m => m.en === seg.movement)?.label || "Tĩnh";
      const angleLabel = VIDEO_ANGLES.find(a => a.en === seg.angle)?.label || "Trung cảnh";
      const segParts = [
        `camera ${moveLabel.toLowerCase()}`,
        `perspective ${angleLabel.toLowerCase()}`
      ];
      if (seg.action.trim()) segParts.push(seg.action.trim());
      if (seg.audio.trim()) segParts.push(`with sound of ${seg.audio.trim()}`);
      return `[${seg.start}s-${seg.end}s]: ${segParts.join(", ")}`;
    });
    return parts.join(". ");
  }, [activeSegments]);

  function handleSave(triggerRun = false) {
    const sorted = [...activeSegments].sort((a, b) => a.start - b.start);
    if (sorted.length > 0) {
      if (sorted[0].start > 0) sorted[0].start = 0;
      if (sorted[sorted.length - 1].end < duration) sorted[sorted.length - 1].end = duration;
    }

    onConfirm({
      cameraAngle: sorted[0]?.angle || "",
      style: styleId,
      cameraMovement: compiledPrompt, // timeline prompt string
      movementSpeed: speedId,
      duration: duration,
      timelineSegments: sorted,
      mode: mode,
      start_image: mode !== "text_to_video" ? startImg : "",
      end_image: mode === "start_end_image" ? endImg : "",
      characterAssets: charAssets,
    }, triggerRun);
  }

  // Draw visual timeline blocks
  const timelineBlocks = useMemo(() => {
    const sorted = [...activeSegments].sort((a, b) => a.start - b.start);
    const result: Array<{ type: "segment" | "gap"; start: number; end: number; segment?: VideoSegment }> = [];
    let cur = 0;
    sorted.forEach(seg => {
      if (seg.start > cur + 0.1) {
        result.push({ type: "gap", start: cur, end: seg.start });
      }
      result.push({ type: "segment", start: seg.start, end: seg.end, segment: seg });
      cur = seg.end;
    });
    if (cur < duration - 0.1) {
      result.push({ type: "gap", start: cur, end: duration });
    }
    return result;
  }, [activeSegments, duration]);

  // Handle local reference image upload
  async function handleCharUpload(file: File) {
    if (!file) return;
    try {
      const url = await readFileAsDataUrl(file);
      const name = newCharName.trim() || `nv_${charAssets.length + 1}`;
      const newAsset: CharacterAsset = {
        id: `char_${Date.now()}`,
        name: name.startsWith("@") ? name : `@${name}`,
        url: url
      };
      setCharAssets([...charAssets, newAsset]);
      setNewCharName("");
    } catch {
      alert("Không đọc được file ảnh!");
    }
  }

  // Convert initial.connectedCharacters to local format with isConnected flag
  const connectedRefs = useMemo(() => {
    return (initial.connectedCharacters || []).map((c, i) => ({
      id: `connected_char_${i}`,
      name: c.name.startsWith("@") ? c.name : `@${c.name}`,
      url: c.url,
      isConnected: true,
    }));
  }, [initial.connectedCharacters]);

  // Merge local charAssets and connected characters
  const allActiveChars = useMemo(() => {
    const list = [...connectedRefs];
    charAssets.forEach(c => {
      const cleanName = c.name.toLowerCase();
      if (!list.some(x => x.name.toLowerCase() === cleanName)) {
        list.push({ ...c, isConnected: false });
      }
    });
    return list;
  }, [connectedRefs, charAssets]);

  // Format canvas reference nodes list
  const canvasPresets = initial.workflowCharacters || [];

  // Filter presets that are not already active
  const remainingPresets = useMemo(() => {
    return canvasPresets.filter(preset => {
      const cleanPresetName = preset.name.startsWith("@") ? preset.name : `@${preset.name}`;
      return !allActiveChars.some(x => x.name.toLowerCase() === cleanPresetName.toLowerCase());
    });
  }, [canvasPresets, allActiveChars]);

  return createPortal(
    <div onClick={onClose} className="nodrag nowheel"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.85)", display: "flex", padding: "12px 16px", zIndex: 99999, backdropFilter: "blur(8px)", animation: "fadeIn 0.2s ease" }}
    >
      <div onClick={e => e.stopPropagation()}
        style={{
          flex: 1, display: "flex", flexDirection: "column",
          background: "linear-gradient(150deg, #070913 0%, #0d1222 60%, #080a14 100%)",
          borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", overflow: "hidden",
          boxShadow: "0 0 65px rgba(245,158,11,0.05), 0 15px 45px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "10px 20px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg, #f59e0b, #ef4444)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🎬</div>
            <div>
              <h2 style={{ margin: 0, fontSize: 13, color: "#fff", fontWeight: 800, letterSpacing: 0.5 }}>STUDIO CHUYÊN NGHIỆP VIDEO +</h2>
              <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.4)" }}>Thiết kế video đa phân cảnh, kiểm soát góc quay, hành động và nhân vật nhất quán</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 8, background: "rgba(245,158,11,0.1)", color: "#f59e0b", padding: "3px 8px", borderRadius: 12, border: "1px solid rgba(245,158,11,0.15)", fontWeight: 700 }}>
              {activeSegments.length} phân cảnh · {duration}s
            </span>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#94a3b8", padding: "6px 12px", cursor: "pointer", fontSize: 12 }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          
          {/* Left Panel: Preview + Reference Assets Library */}
          <div style={{ width: "40%", minWidth: 320, padding: 12, display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.12)" }}>
            
            {/* Viewport */}
            <div style={{ flex: 1, background: "rgba(0,0,0,0.3)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.03)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <VideoViewport 
                movement={selectedSeg?.movement || ""} 
                angle={selectedSeg?.angle || ""} 
              />
            </div>

            {/* Reference Assets Library Section */}
            <div style={{ height: 180, flex: "none", display: "flex", flexDirection: "column", marginTop: 12, overflow: "hidden" }}>
              
              {/* Tabs */}
              <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.05)", marginBottom: 8 }}>
                <button
                  type="button"
                  onClick={() => setLeftTab("media")}
                  style={{
                    flex: 1, padding: "6px 0", background: "transparent", border: "none",
                    borderBottom: `2px solid ${leftTab === "media" ? "#f59e0b" : "transparent"}`,
                    color: leftTab === "media" ? "#f59e0b" : "rgba(255,255,255,0.4)",
                    fontSize: 9, fontWeight: 700, cursor: "pointer", outline: "none"
                  }}
                >
                  🖼 ẢNH ĐẦU / CUỐI
                </button>
                <button
                  type="button"
                  onClick={() => setLeftTab("chars")}
                  style={{
                    flex: 1, padding: "6px 0", background: "transparent", border: "none",
                    borderBottom: `2px solid ${leftTab === "chars" ? "#f59e0b" : "transparent"}`,
                    color: leftTab === "chars" ? "#f59e0b" : "rgba(255,255,255,0.4)",
                    fontSize: 9, fontWeight: 700, cursor: "pointer", outline: "none"
                  }}
                >
                  👤 NHÂN VẬT / ĐỒ VẬT
                </button>
              </div>

              {/* Tab Contents */}
              <div style={{ flex: 1, overflowY: "auto" }}>
                {leftTab === "media" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <label style={{ display: "block", fontSize: 8, color: "rgba(255,255,255,0.4)", marginBottom: 4, textTransform: "uppercase" }}>Chế độ Video</label>
                      <select
                        value={mode}
                        onChange={e => setMode(e.target.value)}
                        style={{ width: "100%", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#fff", padding: "4px 8px", fontSize: 10 }}
                      >
                        <option value="text_to_video">📝 Chỉ chạy từ prompt (Text to Video)</option>
                        <option value="start_image">🖼 Chạy từ ảnh đầu (Image to Video)</option>
                        <option value="start_end_image">🔄 Điểm đầu tới điểm cuối (Start & End Frame)</option>
                      </select>
                    </div>

                    {mode !== "text_to_video" && (
                      <div style={{ display: "flex", gap: 8, width: "100%", marginBottom: 6 }}>
                        
                        {/* Start image slot */}
                        <div style={{ flex: 1, minWidth: 0, background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 6, padding: "4px 6px" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                            <span style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", fontWeight: 700 }}>🖼 KHUNG HÌNH ĐẦU (START IMAGE)</span>
                            {initial.hasStartImageEdge ? (
                              <span style={{ fontSize: 8, color: "#22c55e", fontWeight: 600 }}>✓ Đang nối ngoài</span>
                            ) : startImg ? (
                              <button onClick={() => setStartImg("")} style={{ background: "transparent", border: "none", color: "#ef4444", fontSize: 8, cursor: "pointer" }}>Gỡ</button>
                            ) : null}
                          </div>
                          
                          {initial.hasStartImageEdge ? (
                            <div style={{ textAlign: "center", padding: "4px", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 4, height: 75, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <div style={{ fontSize: 8, color: "#22c55e", fontWeight: 700 }}>🔗 Khung đầu được liên kết ngoài</div>
                            </div>
                          ) : startImg ? (
                            <img src={mediaUrl(normalizeFileUrl(startImg))} alt="" style={{ width: "100%", height: 75, objectFit: "cover", borderRadius: 4 }} />
                          ) : (
                            <div style={{ display: "flex", gap: 4, height: 75, flexDirection: "column", justifyContent: "center" }}>
                              <label style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 9, color: "rgba(255,255,255,0.6)" }}>
                                ⬆ Tải ảnh
                                <input type="file" accept="image/*" hidden onChange={async e => {
                                  const f = e.target.files?.[0];
                                  if (f) setStartImg(await readFileAsDataUrl(f));
                                }} />
                              </label>
                              <button onClick={() => setPickerTarget("start")} style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 6, cursor: "pointer", fontSize: 9, color: "rgba(255,255,255,0.6)", padding: "4px 0" }}>📂 Chọn thư viện</button>
                            </div>
                          )}
                        </div>

                        {/* End image slot */}
                        {mode === "start_end_image" && (
                          <div style={{ flex: 1, minWidth: 0, background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 6, padding: "4px 6px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                              <span style={{ fontSize: 8, color: "rgba(255,255,255,0.5)", fontWeight: 700 }}>🖼 KHUNG HÌNH CUỐI (END IMAGE)</span>
                              {initial.hasEndImageEdge ? (
                                <span style={{ fontSize: 8, color: "#22c55e", fontWeight: 600 }}>✓ Đang nối ngoài</span>
                              ) : endImg ? (
                                <button onClick={() => setEndImg("")} style={{ background: "transparent", border: "none", color: "#ef4444", fontSize: 8, cursor: "pointer" }}>Gỡ</button>
                              ) : null}
                            </div>

                            {initial.hasEndImageEdge ? (
                              <div style={{ textAlign: "center", padding: "4px", background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.15)", borderRadius: 4, height: 75, display: "flex", alignItems: "center", justifyContent: "center" }}>
                                <div style={{ fontSize: 8, color: "#22c55e", fontWeight: 700 }}>🔗 Khung cuối được liên kết ngoài</div>
                              </div>
                            ) : endImg ? (
                              <img src={mediaUrl(normalizeFileUrl(endImg))} alt="" style={{ width: "100%", height: 75, objectFit: "cover", borderRadius: 4 }} />
                            ) : (
                              <div style={{ display: "flex", gap: 4, height: 75, flexDirection: "column", justifyContent: "center" }}>
                                <label style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", fontSize: 9, color: "rgba(255,255,255,0.6)" }}>
                                  ⬆ Tải ảnh
                                  <input type="file" accept="image/*" hidden onChange={async e => {
                                    const f = e.target.files?.[0];
                                    if (f) setEndImg(await readFileAsDataUrl(f));
                                  }} />
                                </label>
                                <button onClick={() => setPickerTarget("end")} style={{ flex: 1, background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 6, cursor: "pointer", fontSize: 9, color: "rgba(255,255,255,0.6)", padding: "4px 0" }}>📂 Chọn thư viện</button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {/* Add Character Input */}
                    <div style={{ display: "flex", gap: 6, background: "rgba(255,255,255,0.02)", padding: 6, borderRadius: 6, border: "1px solid rgba(255,255,255,0.04)" }}>
                      <input
                        type="text"
                        placeholder="Tên tag (ví dụ: john, car)..."
                        value={newCharName}
                        onChange={e => setNewCharName(e.target.value)}
                        style={{ flex: 1, background: "#080a14", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, color: "#fff", padding: "4px 8px", fontSize: 9 }}
                      />
                      <label style={{ background: "#f59e0b", color: "#000", padding: "4px 8px", borderRadius: 4, cursor: "pointer", fontSize: 9, fontWeight: 700 }}>
                        + Thêm
                        <input type="file" accept="image/*" hidden onChange={async e => {
                          const f = e.target.files?.[0];
                          if (f) {
                            await handleCharUpload(f);
                          }
                        }} />
                      </label>
                      <button onClick={() => setPickerTarget("character")} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", padding: "4px 6px", borderRadius: 4, cursor: "pointer", fontSize: 9 }}>📂</button>
                    </div>

                    {/* Canvas Presets (Nhân vật trên Canvas) */}
                    {remainingPresets.length > 0 && (
                      <div style={{ background: "rgba(245,158,11,0.03)", border: "1px dashed rgba(245,158,11,0.2)", borderRadius: 6, padding: 6, marginTop: 4 }}>
                        <div style={{ fontSize: 8, color: "#f59e0b", fontWeight: 700, marginBottom: 4 }}>👤 NHÂN VẬT TRÊN CANVAS (DÙNG LẠI)</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 90, overflowY: "auto" }}>
                          {remainingPresets.map((p, idx) => (
                            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(0,0,0,0.2)", padding: 4, borderRadius: 4 }}>
                              <img src={mediaUrl(normalizeFileUrl(p.url))} alt="" style={{ width: 20, height: 20, borderRadius: 2, objectFit: "cover" }} />
                              <span style={{ fontSize: 8, color: "#fff", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                              <button
                                type="button"
                                onClick={() => addCanvasPreset(p)}
                                style={{ background: "#f59e0b", border: "none", borderRadius: 3, color: "#000", fontSize: 7, padding: "2px 5px", fontWeight: 700, cursor: "pointer" }}
                              >
                                + Dùng
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                     {/* Studio Active Characters List */}
                     <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 150, overflowY: "auto", marginTop: 4 }}>
                       <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", fontWeight: 700 }}>LIST NHÂN VẬT TRONG PHÂN CẢNH STUDIO:</div>
                       {allActiveChars.length === 0 ? (
                         <div style={{ fontSize: 8, color: "rgba(255,255,255,0.3)", padding: 8, textAlign: "center" }}>Chưa có nhân vật nào được gắn</div>
                       ) : (
                         allActiveChars.map(c => {
                           const isWired = (c as any).isConnected;
                           return (
                             <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", padding: 3, borderRadius: 5 }}>
                               <img src={mediaUrl(normalizeFileUrl(c.url))} alt="" style={{ width: 22, height: 22, borderRadius: 3, objectFit: "cover" }} />
                               <div style={{ flex: 1, minWidth: 0 }}>
                                 <div style={{ fontSize: 9, color: "#f59e0b", fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 4 }}>
                                   {c.name}
                                   {isWired && (
                                     <span style={{ fontSize: 6, color: "#22c55e", background: "rgba(34,197,94,0.1)", padding: "1px 3px", borderRadius: 3, fontWeight: 700 }}>Dây nối</span>
                                   )}
                                 </div>
                               </div>
                               <button
                                 type="button"
                                 onClick={() => insertCharacterTag(c.name)}
                                 style={{ background: "rgba(245,158,11,0.12)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: 3, color: "#f59e0b", fontSize: 7, padding: "2px 4px", cursor: "pointer" }}
                               >
                                 Chèn
                               </button>
                               {isWired ? (
                                 <span style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", padding: "0 4px", cursor: "help" }} title="Nhân vật được nối dây ngoài canvas, hãy gỡ dây nối ngoài canvas nếu muốn xóa">🔒</span>
                               ) : (
                                 <button
                                   type="button"
                                   onClick={() => setCharAssets(prev => prev.filter(x => x.id !== c.id))}
                                   style={{ background: "transparent", border: "none", color: "#ef4444", fontSize: 9, cursor: "pointer", padding: "0 4px" }}
                                 >
                                   ✕
                                 </button>
                               )}
                             </div>
                           );
                         })
                       )}
                     </div>
                  </div>
                )}
              </div>

            </div>

          </div>

          {/* Right Panel: Segment Controls & Prompt Pacing */}
          <div style={{ flex: 1, padding: "10px 16px", overflowY: "auto", display: "flex", flexDirection: "column" }}>
            
            {/* Visual Timeline Bar */}
            <div style={{ marginBottom: 12, padding: 8, background: "rgba(0,0,0,0.15)", borderRadius: 8, border: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                <span style={{ fontSize: 8, color: "#a855f7", fontWeight: 700, textTransform: "uppercase" }}>⏱ HÀNG PHÂN CẢNH TIMELINE</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>Tổng thời lượng:</span>
                  <input
                    type="range"
                    min={4}
                    max={30}
                    value={duration}
                    onChange={e => setDuration(parseInt(e.target.value))}
                    style={{ width: 80, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2, cursor: "ew-resize" }}
                  />
                  <span style={{ fontSize: 10, color: "#a855f7", fontWeight: 700 }}>{duration}s</span>
                </div>
              </div>

              {/* Tracks Container */}
              <div style={{ position: "relative", height: 40, background: "rgba(255,255,255,0.02)", borderRadius: 6, display: "flex", overflow: "hidden", border: "1px solid rgba(255,255,255,0.05)" }}>
                {timelineBlocks.map((blk, idx) => {
                  const pct = ((blk.end - blk.start) / duration) * 100;
                  if (blk.type === "gap") {
                    return (
                      <button
                        key={`gap-${idx}`}
                        type="button"
                        onClick={handleAddSegment}
                        title="Click để thêm phân cảnh"
                        style={{
                          width: `${pct}%`, height: "100%", background: "repeating-linear-gradient(45deg, rgba(255,255,255,0.01), rgba(255,255,255,0.01) 4px, rgba(255,255,255,0.03) 4px, rgba(255,255,255,0.03) 8px)",
                          border: "1px dashed rgba(255,255,255,0.12)", cursor: "pointer", color: "rgba(255,255,255,0.3)", fontSize: 8, fontWeight: 700,
                          display: "flex", alignItems: "center", justifyContent: "center"
                        }}
                      >
                        + THÊM
                      </button>
                    );
                  }
                  
                  const seg = blk.segment!;
                  const isSel = seg.id === selectedSegId;
                  const moveLabel = CAMERA_MOVEMENTS.find(m => m.en === seg.movement)?.label.split(" ")[0] || "Tĩnh";
                  
                  return (
                    <button
                      key={seg.id}
                      type="button"
                      onClick={() => setSelectedSegId(seg.id)}
                      style={{
                        width: `${pct}%`, height: "100%",
                        background: isSel ? "linear-gradient(to bottom, #d97706, #b45309)" : "linear-gradient(to bottom, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                        border: isSel ? "1.5px solid #fbbf24" : "1px solid rgba(255,255,255,0.08)",
                        cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "center",
                        padding: "0 4px", textAlign: "left", transition: "all 0.1s"
                      }}
                    >
                      <div style={{ fontSize: 8, color: isSel ? "#fff" : "#f59e0b", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        #{idx + 1}: {moveLabel}
                      </div>
                      <div style={{ fontSize: 6, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
                        {seg.start}s - {seg.end}s
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedSeg ? (
              <>
                {/* Segment Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: 11, color: "#fff", fontWeight: 700 }}>
                      CẤU HÌNH PHÂN CẢNH ({selectedSeg.start}s - {selectedSeg.end}s)
                    </h4>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={handleAddSegment} style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 4, color: "#22c55e", padding: "2px 6px", fontSize: 8, cursor: "pointer" }}>
                      + Thêm phân cảnh
                    </button>
                    <button type="button" onClick={() => handleDeleteSegment(selectedSeg.id)} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 4, color: "#ef4444", padding: "2px 6px", fontSize: 8, cursor: "pointer" }}>
                      Xóa
                    </button>
                  </div>
                </div>

                {/* Timing Slider */}
                <div style={{ display: "flex", gap: 12, background: "rgba(255,255,255,0.01)", padding: "6px 10px", borderRadius: 6, marginBottom: 8, border: "1px solid rgba(255,255,255,0.03)" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 8, color: "rgba(255,255,255,0.4)", marginBottom: 2 }}>BẮT ĐẦU: {selectedSeg.start}s</label>
                    <input
                      type="range"
                      min={limits.minStart}
                      max={Math.max(limits.minStart, selectedSeg.end - 0.5)}
                      step={0.5}
                      value={selectedSeg.start}
                      onChange={e => updateSelected({ start: parseFloat(e.target.value) })}
                      style={{ width: "100%", cursor: "ew-resize", height: 4 }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 8, color: "rgba(255,255,255,0.4)", marginBottom: 2 }}>KẾT THÚC: {selectedSeg.end}s</label>
                    <input
                      type="range"
                      min={Math.max(selectedSeg.start + 0.5, limits.minStart)}
                      max={limits.maxEnd}
                      step={0.5}
                      value={selectedSeg.end}
                      onChange={e => updateSelected({ end: parseFloat(e.target.value) })}
                      style={{ width: "100%", cursor: "ew-resize", height: 4 }}
                    />
                  </div>
                </div>

                {/* Prompts for this segment */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 8, color: "rgba(255,255,255,0.4)", marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>🎬 PROMPT / HOẠT CẢNH PHÂN CẢNH</label>
                    <textarea
                      ref={segmentPromptRef}
                      rows={2}
                      value={selectedSeg.action}
                      onChange={e => updateSelected({ action: e.target.value })}
                      placeholder="Mô tả hành động... Sử dụng @name để gắn nhân vật (ví dụ: @john chạy nhanh qua đường)"
                      style={{ width: "100%", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#fff", padding: 6, fontSize: 9, resize: "none" }}
                    />
                    
                    {/* Character tag chips shortcut */}
                    {allActiveChars.length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                        <span style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", alignSelf: "center" }}>Gắn nhanh:</span>
                        {allActiveChars.map(c => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => insertCharacterTag(c.name)}
                            style={{
                              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4,
                              color: "#f59e0b", fontSize: 7, padding: "2px 4px", cursor: "pointer"
                            }}
                          >
                            {c.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 8, color: "rgba(255,255,255,0.4)", marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>🎵 ÂM THANH / SOUND FX</label>
                    <textarea
                      rows={2}
                      value={selectedSeg.audio}
                      onChange={e => updateSelected({ audio: e.target.value })}
                      placeholder="Mô tả tiếng động... (ví dụ: tiếng sấm chớp đùng đoàng, nhạc kịch tính)"
                      style={{ width: "100%", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#fff", padding: 6, fontSize: 9, resize: "none" }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <Section icon="🎥" title="Hướng Di Chuyển Camera">
                    <CardGrid items={CAMERA_MOVEMENTS} selected={selectedSeg.movement} onSelect={m => updateSelected({ movement: m })} cols={4} />
                  </Section>

                  <Section icon="📷" title="Góc Quay Camera">
                    <CardGrid items={VIDEO_ANGLES} selected={selectedSeg.angle} onSelect={a => updateSelected({ angle: a })} cols={4} />
                  </Section>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.2)", fontSize: 10 }}>
                Click chọn một phân cảnh trên timeline để cấu hình...
              </div>
            )}

            {/* Global pacing & styles */}
            <div style={{ marginTop: "auto", paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 8, color: "rgba(255,255,255,0.4)", marginBottom: 2 }}>TỐC ĐỘ TOÀN VIDEO</label>
                  <select
                    value={speedId}
                    onChange={e => setSpeedId(e.target.value)}
                    style={{ width: "100%", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#fff", padding: "3px 6px", fontSize: 9 }}
                  >
                    <option value="">-- Mặc định --</option>
                    {SPEED_PRESETS.map(s => <option key={s.id} value={s.en}>{s.icon} {s.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 8, color: "rgba(255,255,255,0.4)", marginBottom: 2 }}>PHONG CÁCH TOÀN VIDEO</label>
                  <select
                    value={styleId}
                    onChange={e => setStyleId(e.target.value)}
                    style={{ width: "100%", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#fff", padding: "3px 6px", fontSize: 9 }}
                  >
                    <option value="">-- Mặc định --</option>
                    {VIDEO_STYLES.map(s => <option key={s.id} value={s.en}>{s.icon} {s.label}</option>)}
                  </select>
                </div>
              </div>
            </div>

          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: "8px 20px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 7, color: "rgba(255,255,255,0.3)", marginBottom: 2, fontFamily: "monospace", textTransform: "uppercase" }}>📝 Prompt mốc thời gian AI:</div>
            <div style={{ fontSize: 8, color: "#f59e0b", fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={compiledPrompt}>
              {compiledPrompt}
            </div>
          </div>
          
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={onClose} style={{ padding: "8px 16px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#94a3b8", cursor: "pointer", fontSize: 10 }}>Hủy</button>
            
            {/* Run / Rerun Trigger inside Modal */}
            {initial.runStatus === "running" || initial.runStatus === "pending" ? (
              <button disabled
                style={{ padding: "8px 16px", background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "rgba(255,255,255,0.4)", fontSize: 11, cursor: "not-allowed", fontWeight: 700 }}
              >
                ⏳ Đang tạo...
              </button>
            ) : initial.runStatus === "completed" || initial.runStatus === "failed" ? (
              <button onClick={() => handleSave(true)}
                style={{ padding: "8px 16px", background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 6, color: "#22c55e", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
              >
                ↻ Chạy lại ngay
              </button>
            ) : (
              <button onClick={() => handleSave(true)}
                style={{ padding: "8px 16px", background: "rgba(34,197,94,0.2)", border: "1px solid #22c55e", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700 }}
              >
                ▶ Chạy ngay
              </button>
            )}

            <button onClick={() => handleSave(false)}
              style={{ padding: "8px 20px", background: "linear-gradient(135deg, #f59e0b, #ea580c)", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 11, fontWeight: 700, boxShadow: "0 2px 10px rgba(245,158,11,0.2)" }}
            >
              ✓ Áp Dụng Studio
            </button>
          </div>
        </div>
      </div>

      {/* Asset Picker Overlay */}
      {pickerTarget && (
        <LocalAssetPicker
          onClose={() => setPickerTarget(null)}
          onSelect={(url) => {
            if (pickerTarget === "start") setStartImg(url);
            else if (pickerTarget === "end") setEndImg(url);
            else if (pickerTarget === "character") {
              const name = newCharName.trim() || `nv_${charAssets.length + 1}`;
              setCharAssets([...charAssets, {
                id: `char_${Date.now()}`,
                name: name.startsWith("@") ? name : `@${name}`,
                url: url
              }]);
              setNewCharName("");
            }
          }}
        />
      )}
    </div>,
    document.body
  );
}
