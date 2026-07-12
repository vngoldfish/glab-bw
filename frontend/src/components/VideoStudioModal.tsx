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

/* ───── DATA: Camera Angles ───── */
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
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 5 }}>
      {items.map(it => {
        const val = it.en || "";
        const active = val === selected;
        const c = it.accent || "#22c55e";
        return (
          <button key={it.id} type="button" onClick={() => onSelect(active ? "" : val)} title={it.desc || it.label}
            style={{
              background: active ? `${c}18` : "rgba(255,255,255,0.02)",
              border: `1px solid ${active ? `${c}60` : "rgba(255,255,255,0.06)"}`,
              borderRadius: 8, padding: "8px 4px 6px", cursor: "pointer", textAlign: "center",
              transition: "all 0.2s", color: active ? c : "rgba(255,255,255,0.7)", outline: "none", position: "relative",
            }}
          >
            {active && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: c }} />}
            <div style={{ fontSize: 16, lineHeight: 1 }}>{it.icon}</div>
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
    <div style={{ marginBottom: 16 }}>
      <h3 style={{ margin: "0 0 6px", fontSize: 10, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
        <span style={{ fontSize: 12 }}>{icon}</span> {title}
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

export interface VideoStudioSettings {
  cameraAngle: string;
  style: string;
  cameraMovement: string;
  movementSpeed: string;
  duration: number;
  timelineSegments?: VideoSegment[];
}

interface Props {
  initial: VideoStudioSettings;
  onConfirm: (s: VideoStudioSettings) => void;
  onClose: () => void;
}

export default function VideoStudioModal({ initial, onConfirm, onClose }: Props) {
  const [duration, setDuration] = useState(initial.duration || 10);
  const [styleId, setStyleId] = useState(() => initial.style || "");
  const [speedId, setSpeedId] = useState(() => initial.movementSpeed || "");

  // Initialize segments
  const [segments, setSegments] = useState<VideoSegment[]>(() => {
    if (initial.timelineSegments && initial.timelineSegments.length > 0) {
      return initial.timelineSegments;
    }
    return [
      {
        id: "seg_1",
        start: 0,
        end: initial.duration || 10,
        movement: initial.cameraMovement || CAMERA_MOVEMENTS[0].en,
        angle: initial.cameraAngle || VIDEO_ANGLES[1].en,
        action: "",
        audio: "",
      }
    ];
  });

  const [selectedSegId, setSelectedSegId] = useState<string | null>(segments[0]?.id || null);

  // Auto clean up and constrain segments when duration changes
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
    // Find gaps
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
      // Extend duration or create a small 1-second segment at the end
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

  // Compile prompt representation
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

  function handleConfirm() {
    // Check if there is a gap at the beginning or end, and stretch to cover if needed
    const sorted = [...activeSegments].sort((a, b) => a.start - b.start);
    if (sorted.length > 0) {
      if (sorted[0].start > 0) sorted[0].start = 0;
      if (sorted[sorted.length - 1].end < duration) sorted[sorted.length - 1].end = duration;
    }
    
    onConfirm({
      cameraAngle: sorted[0]?.angle || "",
      style: styleId,
      cameraMovement: compiledPrompt, // We store the fully compiled timeline prompt inside cameraMovement so it feeds into workflow runner
      movementSpeed: speedId,
      duration: duration,
      timelineSegments: sorted,
    });
  }

  // Draw visual timeline track
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

  return createPortal(
    <div onClick={onClose} className="nodrag nowheel"
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.9)", display: "flex", padding: 16, zIndex: 99999, backdropFilter: "blur(12px)", animation: "fadeIn 0.2s ease" }}
    >
      <div onClick={e => e.stopPropagation()}
        style={{
          flex: 1, display: "flex", flexDirection: "column",
          background: "linear-gradient(150deg, #070913 0%, #0d1222 60%, #080a14 100%)",
          borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden",
          boxShadow: "0 0 85px rgba(34,197,94,0.06), 0 25px 60px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{ padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #f59e0b, #ef4444)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🎬</div>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, color: "#fff", fontWeight: 800, letterSpacing: 1 }}>STUDIO CHUYÊN NGHIỆP VIDEO +</h2>
              <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.4)", letterSpacing: 0.5 }}>Thiết kế video đa phân cảnh — Thiết lập vị trí camera, hoạt cảnh và âm thanh từng giây một</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 10, background: "rgba(245,158,11,0.12)", color: "#f59e0b", padding: "4px 10px", borderRadius: 20, border: "1px solid rgba(245,158,11,0.2)", fontWeight: 700 }}>
              {activeSegments.length} phân cảnh · {duration} giây
            </span>
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#94a3b8", padding: "8px 14px", cursor: "pointer", fontSize: 14 }}>✕</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          
          {/* Left Panel: Preview + Visual Timeline */}
          <div style={{ width: "35%", minWidth: 320, padding: 16, display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.15)" }}>
            
            {/* Viewport */}
            <div style={{ flex: 1, background: "rgba(0,0,0,0.3)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.04)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <VideoViewport 
                movement={selectedSeg?.movement || ""} 
                angle={selectedSeg?.angle || ""} 
              />
            </div>

            {/* Visual Timeline Bar */}
            <div style={{ marginTop: 12, padding: 12, background: "rgba(0,0,0,0.25)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.05)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                <span style={{ fontSize: 9, color: "#a855f7", fontWeight: 700, textTransform: "uppercase" }}>⏱ HÀNG PHÂN CẢNH TIMELINE</span>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 8, color: "rgba(255,255,255,0.3)" }}>Tổng thời lượng:</span>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    value={duration}
                    onChange={e => setDuration(parseInt(e.target.value))}
                    style={{ width: 80, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 2, cursor: "ew-resize" }}
                  />
                  <span style={{ fontSize: 11, color: "#a855f7", fontWeight: 700 }}>{duration}s</span>
                </div>
              </div>

              {/* Tracks Container */}
              <div style={{ position: "relative", height: 50, background: "rgba(255,255,255,0.03)", borderRadius: 6, display: "flex", overflow: "hidden", border: "1px solid rgba(255,255,255,0.06)" }}>
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
                          border: "1px dashed rgba(255,255,255,0.15)", cursor: "pointer", color: "rgba(255,255,255,0.3)", fontSize: 8, fontWeight: 700,
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
                        background: isSel ? "linear-gradient(to bottom, #d97706, #b45309)" : "linear-gradient(to bottom, rgba(255,255,255,0.08), rgba(255,255,255,0.04))",
                        border: isSel ? "1.5px solid #fbbf24" : "1px solid rgba(255,255,255,0.1)",
                        cursor: "pointer", display: "flex", flexDirection: "column", justifyContent: "center",
                        padding: "0 4px", textAlign: "left", transition: "all 0.15s"
                      }}
                    >
                      <div style={{ fontSize: 9, color: isSel ? "#fff" : "#f59e0b", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        #{idx + 1}: {moveLabel}
                      </div>
                      <div style={{ fontSize: 7, color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>
                        {seg.start}s - {seg.end}s
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Timeline labels */}
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, padding: "0 2px" }}>
                <span style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>0s</span>
                <span style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{Math.round(duration / 2)}s</span>
                <span style={{ fontSize: 7, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>{duration}s</span>
              </div>
            </div>

            {/* global settings */}
            <div style={{ marginTop: 12, padding: 12, background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid rgba(255,255,255,0.04)" }}>
              <div style={{ display: "flex", gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>TỐC ĐỘ TOÀN VIDEO</label>
                  <select
                    value={speedId}
                    onChange={e => setSpeedId(e.target.value)}
                    style={{ width: "100%", background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#fff", padding: "4px 6px", fontSize: 10 }}
                  >
                    <option value="">-- Mặc định --</option>
                    {SPEED_PRESETS.map(s => <option key={s.id} value={s.en}>{s.icon} {s.label}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: "block", fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>PHONG CÁCH TOÀN VIDEO</label>
                  <select
                    value={styleId}
                    onChange={e => setStyleId(e.target.value)}
                    style={{ width: "100%", background: "#0d1117", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#fff", padding: "4px 6px", fontSize: 10 }}
                  >
                    <option value="">-- Mặc định --</option>
                    {VIDEO_STYLES.map(s => <option key={s.id} value={s.en}>{s.icon} {s.label}</option>)}
                  </select>
                </div>
              </div>
            </div>

          </div>

          {/* Right Panel: Segment Controls */}
          <div style={{ flex: 1, padding: "16px 20px", overflowY: "auto", display: "flex", flexDirection: "column" }}>
            {selectedSeg ? (
              <>
                {/* Segment Heading */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: 13, color: "#fff", fontWeight: 700 }}>
                      CẤU HÌNH PHÂN CẢNH ({selectedSeg.start}s - {selectedSeg.end}s)
                    </h4>
                    <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,0.3)" }}>Chỉnh sửa hoạt động của camera và mô tả hành cảnh trong khung giờ này</p>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button type="button" onClick={handleAddSegment} style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 6, color: "#22c55e", padding: "4px 10px", fontSize: 9, cursor: "pointer" }}>
                      + Thêm phân cảnh
                    </button>
                    <button type="button" onClick={() => handleDeleteSegment(selectedSeg.id)} style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: 6, color: "#ef4444", padding: "4px 10px", fontSize: 9, cursor: "pointer" }}>
                      Xóa phân cảnh
                    </button>
                  </div>
                </div>

                {/* Timing Slider */}
                <div style={{ display: "flex", gap: 16, background: "rgba(255,255,255,0.02)", padding: 10, borderRadius: 8, marginBottom: 14, border: "1px solid rgba(255,255,255,0.04)" }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>BẮT ĐẦU: {selectedSeg.start}s</label>
                    <input
                      type="range"
                      min={limits.minStart}
                      max={Math.max(limits.minStart, selectedSeg.end - 0.5)}
                      step={0.5}
                      value={selectedSeg.start}
                      onChange={e => updateSelected({ start: parseFloat(e.target.value) })}
                      style={{ width: "100%", cursor: "ew-resize" }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: "block", fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 4 }}>KẾT THÚC: {selectedSeg.end}s</label>
                    <input
                      type="range"
                      min={Math.max(selectedSeg.start + 0.5, limits.minStart)}
                      max={limits.maxEnd}
                      step={0.5}
                      value={selectedSeg.end}
                      onChange={e => updateSelected({ end: parseFloat(e.target.value) })}
                      style={{ width: "100%", cursor: "ew-resize" }}
                    />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 12 }}>
                  <Section icon="🎥" title="Hướng Di Chuyển Camera">
                    <CardGrid items={CAMERA_MOVEMENTS} selected={selectedSeg.movement} onSelect={m => updateSelected({ movement: m })} cols={3} />
                  </Section>

                  <Section icon="📷" title="Góc Quay Camera">
                    <CardGrid items={VIDEO_ANGLES} selected={selectedSeg.angle} onSelect={a => updateSelected({ angle: a })} cols={3} />
                  </Section>
                </div>

                {/* Prompts detail for this segment */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
                  <div>
                    <label style={{ display: "block", fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontWeight: 700, letterSpacing: 0.5 }}>🎬 HOẠT CẢNH / HÀNH ĐỘNG PHÂN CẢNH</label>
                    <textarea
                      rows={2}
                      value={selectedSeg.action}
                      onChange={e => updateSelected({ action: e.target.value })}
                      placeholder="Mô tả những gì diễn ra trong giây này... (ví dụ: Chú chim vỗ cánh bay đi khỏi cành cây)"
                      style={{ width: "100%", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#fff", padding: 8, fontSize: 10, resize: "none" }}
                    />
                  </div>
                  <div>
                    <label style={{ display: "block", fontSize: 9, color: "rgba(255,255,255,0.4)", marginBottom: 4, fontWeight: 700, letterSpacing: 0.5 }}>🎵 ÂM THANH / TIẾNG ĐỘNG (SOUND FX)</label>
                    <textarea
                      rows={2}
                      value={selectedSeg.audio}
                      onChange={e => updateSelected({ audio: e.target.value })}
                      placeholder="Mô tả âm thanh tương ứng... (ví dụ: Tiếng vỗ cánh phành phạch và tiếng chim hót líu lo)"
                      style={{ width: "100%", background: "#0b0f19", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, color: "#fff", padding: 8, fontSize: 10, resize: "none" }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "center", color: "rgba(255,255,255,0.2)", fontSize: 12 }}>
                Click chọn một phân cảnh trên timeline để cấu hình chi tiết...
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div style={{ padding: "12px 24px", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,0.25)", marginBottom: 3, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: 1 }}>📝 Cấu trúc mô tả phân cảnh gửi tới AI:</div>
            <div style={{ fontSize: 9, color: "#f59e0b", fontFamily: "monospace", lineHeight: 1.4, maxHeight: 36, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {compiledPrompt}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={onClose} style={{ padding: "10px 20px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#94a3b8", cursor: "pointer", fontSize: 11 }}>Hủy</button>
            <button onClick={handleConfirm}
              style={{ padding: "10px 28px", background: "linear-gradient(135deg, #f59e0b, #ea580c)", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 700, letterSpacing: 0.5, boxShadow: "0 4px 14px rgba(245,158,11,0.3)" }}
            >
              ✓ Áp Dụng Studio
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
