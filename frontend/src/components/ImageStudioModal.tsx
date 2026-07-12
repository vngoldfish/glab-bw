import { useState, useMemo } from "react";
import { createPortal } from "react-dom";

/* ───── DATA: Camera Angles ───── */
const CAMERA_ANGLES = [
  { id: "closeup", label: "Cận cảnh", en: "Close-up shot, shallow depth of field, subject filling the frame", icon: "🔍", desc: "Chi tiết khuôn mặt / vật thể", cx: 200, cy: 270, fov: 45 },
  { id: "medium", label: "Trung cảnh", en: "Medium shot from waist up, balanced composition", icon: "👤", desc: "Từ thắt lưng trở lên", cx: 200, cy: 310, fov: 55 },
  { id: "wide", label: "Toàn cảnh", en: "Wide establishing shot showing full environment and context", icon: "🏔", desc: "Toàn bộ cảnh, bối cảnh rõ", cx: 200, cy: 360, fov: 75 },
  { id: "high", label: "Trên cao xuống", en: "High angle looking down on subject, making subject appear smaller", icon: "🦅", desc: "Nhìn từ trên xuống", cx: 230, cy: 130, fov: 50 },
  { id: "low", label: "Dưới nhìn lên", en: "Low angle looking up, dramatic powerful perspective", icon: "⬆️", desc: "Nhìn từ dưới lên, tạo uy lực", cx: 170, cy: 340, fov: 50 },
  { id: "eye", label: "Ngang mắt", en: "Eye-level shot, natural perspective, straight on", icon: "👁", desc: "Góc nhìn tự nhiên ngang tầm mắt", cx: 320, cy: 200, fov: 50 },
  { id: "drone", label: "Flycam / Drone", en: "Aerial drone top-down bird's eye view, looking straight down", icon: "🚁", desc: "Nhìn thẳng từ trên (bird's eye)", cx: 200, cy: 200, fov: 90 },
  { id: "dutch", label: "Nghiêng (Dutch)", en: "Dutch angle tilted 15 degrees, creating sense of unease", icon: "📐", desc: "Khung hình nghiêng, bất ổn", cx: 120, cy: 310, fov: 50 },
  { id: "macro", label: "Siêu cận (Macro)", en: "Macro extreme close-up showing fine textures and details", icon: "🔬", desc: "Siêu cận, chi tiết cực nhỏ", cx: 200, cy: 240, fov: 25 },
  { id: "ots", label: "Qua vai (OTS)", en: "Over the shoulder shot, showing subject from behind another character", icon: "🧑", desc: "Nhìn qua vai nhân vật", cx: 280, cy: 130, fov: 50 },
  { id: "cinematic", label: "Điện ảnh rộng", en: "Cinematic ultra-wide shot, anamorphic lens, 2.39:1 aspect ratio", icon: "🎬", desc: "Góc rộng điện ảnh, ống kính anamorphic", cx: 200, cy: 365, fov: 85 },
  { id: "pov", label: "Góc nhìn thứ nhất", en: "First person POV shot, seeing through character's eyes", icon: "🎮", desc: "Nhìn qua mắt nhân vật (FPS)", cx: 200, cy: 215, fov: 70 },
];

/* ───── DATA: Art Styles ───── */
const ART_STYLES = [
  { id: "realistic", label: "Tả thực", en: "Photorealistic, shot on Canon EOS R5 mirrorless camera, 85mm lens, f/1.4 aperture, natural lighting, 8K resolution", accent: "#4ade80", icon: "📷" },
  { id: "cinematic", label: "Điện ảnh", en: "Cinematic film style, anamorphic lens flare, professional color grading, film grain, shallow depth of field", accent: "#f59e0b", icon: "🎬" },
  { id: "anime", label: "Anime", en: "Anime art style, cel shading, vibrant saturated colors, clean line art, manga illustration", accent: "#ec4899", icon: "🌸" },
  { id: "oil", label: "Sơn dầu", en: "Classical oil painting, thick impasto brushstrokes, impressionist style, canvas texture", accent: "#a855f7", icon: "🎨" },
  { id: "watercolor", label: "Màu nước", en: "Delicate watercolor painting, soft bleeding edges, flowing transparent colors, wet on wet technique, paper texture", accent: "#06b6d4", icon: "💧" },
  { id: "3d", label: "3D Render", en: "Professional 3D rendered, Octane render engine, highly detailed, subsurface scattering, ray tracing, volumetric lighting", accent: "#8b5cf6", icon: "🧊" },
  { id: "pencil", label: "Vẽ chì", en: "Detailed graphite pencil sketch, cross-hatching technique, on textured paper, fine details, high contrast", accent: "#94a3b8", icon: "✏️" },
  { id: "cyberpunk", label: "Cyberpunk", en: "Cyberpunk neon aesthetic, rain-slicked streets, holographic displays, dark futuristic atmosphere, glowing neon lights", accent: "#f43f5e", icon: "🌆" },
  { id: "retro", label: "Phim cổ điển", en: "Retro vintage film photography, film grain, faded warm colors, 70s nostalgic aesthetic, Kodak Portra film", accent: "#d97706", icon: "📼" },
  { id: "ghibli", label: "Ghibli", en: "Studio Ghibli style, lush detailed nature, dreamy whimsical atmosphere, soft pastel colors, hand-painted background", accent: "#34d399", icon: "🍃" },
  { id: "noir", label: "Film Noir", en: "Film noir style, dramatic black and white, high contrast, deep shadows, venetian blind light patterns", accent: "#64748b", icon: "🕵️" },
  { id: "pixel", label: "Pixel Art", en: "Retro pixel art style, 16-bit aesthetic, limited color palette, clean pixels, nostalgic video game art", accent: "#22d3ee", icon: "👾" },
  { id: "comic", label: "Truyện tranh", en: "American comic book style, bold ink outlines, halftone dots, dynamic action composition, speech bubbles", accent: "#ef4444", icon: "💥" },
  { id: "ukiyoe", label: "Ukiyo-e", en: "Traditional Japanese ukiyo-e woodblock print style, flat colors, flowing lines, decorative patterns", accent: "#dc2626", icon: "🗾" },
  { id: "surreal", label: "Siêu thực", en: "Surrealist dreamscape, impossible geometry, melting reality, inspired by Salvador Dali, vivid imagination", accent: "#c084fc", icon: "🌀" },
  { id: "fantasy", label: "Fantasy", en: "Epic high fantasy illustration, magical atmosphere, enchanted lighting, detailed fantasy world, dramatic sky", accent: "#818cf8", icon: "⚔️" },
];

/* ───── DATA: Lighting ───── */
const LIGHTING_PRESETS = [
  { id: "golden", label: "Hoàng hôn", en: "Golden hour natural lighting, warm orange tones, long soft shadows, magical glow", accent: "#fbbf24", icon: "🌅" },
  { id: "studio", label: "Studio 3 đèn", en: "Professional studio three-point lighting setup, key light, fill light, back light, clean even illumination", accent: "#e2e8f0", icon: "💡" },
  { id: "dramatic", label: "Chiaroscuro", en: "Dramatic chiaroscuro lighting, extreme contrast between bright light and deep shadow, Caravaggio style", accent: "#475569", icon: "🌓" },
  { id: "neon", label: "Neon đêm", en: "Neon urban lighting, vibrant cyan and magenta glow, rainy night city atmosphere, reflective surfaces", accent: "#a855f7", icon: "✨" },
  { id: "soft", label: "Mềm mại", en: "Soft diffused lighting, overcast cloudy day, no harsh shadows, gentle even illumination", accent: "#cbd5e1", icon: "☁️" },
  { id: "backlit", label: "Ngược sáng", en: "Backlighting creating beautiful silhouette, golden rim light halo around subject, lens flare", accent: "#f59e0b", icon: "🌟" },
  { id: "rembrandt", label: "Rembrandt", en: "Rembrandt lighting, triangle of light on cheek, moody portrait, single source dramatic", accent: "#b45309", icon: "🎭" },
  { id: "moon", label: "Ánh trăng", en: "Cool moonlight, blue silver tones, mysterious quiet night atmosphere, long shadows", accent: "#3b82f6", icon: "🌙" },
  { id: "ring", label: "Ring Light", en: "Ring light, even frontal illumination, catchlights in eyes, beauty photography, smooth skin", accent: "#f9a8d4", icon: "⭕" },
  { id: "natural", label: "Tự nhiên", en: "Natural window light, soft directional sunlight through window, warm indoor atmosphere", accent: "#fcd34d", icon: "🪟" },
  { id: "fire", label: "Ánh lửa", en: "Warm firelight, flickering orange glow, intimate cozy atmosphere, dancing shadows", accent: "#ea580c", icon: "🔥" },
  { id: "underwater", label: "Dưới nước", en: "Underwater caustic lighting, blue-green rays filtering through water surface, rippling patterns", accent: "#0ea5e9", icon: "🌊" },
];

/* ───── DATA: Composition ───── */
const COMPOSITIONS = [
  { id: "rule3", label: "Quy tắc 1/3", en: "Composed with rule of thirds, subject placed at intersection point", accent: "#6366f1", icon: "▦" },
  { id: "center", label: "Trung tâm", en: "Centered symmetrical composition, subject in the dead center of frame", accent: "#8b5cf6", icon: "◉" },
  { id: "leading", label: "Đường dẫn", en: "Leading lines composition, guiding viewer's eye towards subject", accent: "#14b8a6", icon: "⟋" },
  { id: "golden_ratio", label: "Tỷ lệ vàng", en: "Golden ratio spiral composition, natural harmonious balance", accent: "#f59e0b", icon: "🐚" },
  { id: "frame", label: "Khung trong khung", en: "Frame within a frame composition, subject framed by architectural or natural elements", accent: "#22c55e", icon: "🖼" },
  { id: "negative", label: "Khoảng trống", en: "Negative space composition, lots of empty space around subject, minimalist", accent: "#94a3b8", icon: "◻️" },
  { id: "diagonal", label: "Đường chéo", en: "Dynamic diagonal composition, creating energy and movement across the frame", accent: "#ef4444", icon: "⟍" },
  { id: "depth", label: "Lớp chiều sâu", en: "Layered depth composition, foreground middle-ground background separation, bokeh", accent: "#06b6d4", icon: "🔭" },
];

/* ───── SVG VIEWPORT ───── */
function StudioViewport({ angle }: { angle: typeof CAMERA_ANGLES[0] | null }) {
  const isDrone = angle?.id === "drone";
  const camX = angle?.cx ?? 200;
  const camY = angle?.cy ?? 360;
  const fovDeg = angle?.fov ?? 50;

  // Calculate FOV cone
  const dx = 200 - camX;
  const dy = 200 - camY;
  const angleToCenter = Math.atan2(dy, dx);
  const fovRad = (fovDeg / 2) * Math.PI / 180;
  const coneDist = isDrone ? 0 : Math.min(Math.hypot(dx, dy) + 30, 180);
  const f1x = camX + Math.cos(angleToCenter - fovRad) * coneDist;
  const f1y = camY + Math.sin(angleToCenter - fovRad) * coneDist;
  const f2x = camX + Math.cos(angleToCenter + fovRad) * coneDist;
  const f2y = camY + Math.sin(angleToCenter + fovRad) * coneDist;

  return (
    <svg viewBox="0 0 400 400" style={{ width: "100%", height: "100%", maxHeight: "100%" }}>
      <defs>
        <pattern id="stGrid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
        </pattern>
        <radialGradient id="stageGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(99,102,241,0.08)" />
          <stop offset="100%" stopColor="transparent" />
        </radialGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Background */}
      <rect width="400" height="400" fill="#0a0f1a" />
      <rect width="400" height="400" fill="url(#stGrid)" />

      {/* Stage */}
      <circle cx="200" cy="200" r="170" fill="url(#stageGlow)" />
      <circle cx="200" cy="200" r="170" fill="none" stroke="rgba(255,255,255,0.04)" strokeDasharray="6 4" />
      <circle cx="200" cy="200" r="110" fill="none" stroke="rgba(255,255,255,0.04)" strokeDasharray="4 4" />
      <circle cx="200" cy="200" r="50" fill="none" stroke="rgba(99,102,241,0.15)" />

      {/* Cross hairs */}
      <line x1="200" y1="30" x2="200" y2="370" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
      <line x1="30" y1="200" x2="370" y2="200" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />

      {/* Subject */}
      <circle cx="200" cy="200" r="24" fill="rgba(99,102,241,0.1)" stroke="rgba(99,102,241,0.35)" strokeWidth="1.5" />
      {/* Person silhouette (simplified) */}
      <circle cx="200" cy="190" r="7" fill="rgba(129,140,248,0.6)" />
      <ellipse cx="200" cy="208" rx="10" ry="12" fill="rgba(129,140,248,0.4)" />
      <text x="200" y="236" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="8" fontFamily="monospace">CHỦ THỂ</text>

      {/* FOV Cone */}
      {angle && !isDrone && (
        <path
          d={`M ${camX},${camY} L ${f1x},${f1y} L ${f2x},${f2y} Z`}
          fill="rgba(34,197,94,0.06)"
          stroke="rgba(34,197,94,0.2)"
          strokeWidth="0.5"
        >
          <animate attributeName="opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite" />
        </path>
      )}
      {angle && isDrone && (
        <circle cx="200" cy="200" r="80" fill="rgba(34,197,94,0.04)" stroke="rgba(34,197,94,0.15)" strokeWidth="0.5" strokeDasharray="4 4">
          <animate attributeName="r" values="70;85;70" dur="3s" repeatCount="indefinite" />
        </circle>
      )}

      {/* Camera line to subject */}
      {angle && !isDrone && (
        <line x1={camX} y1={camY} x2={200} y2={200} stroke="rgba(34,197,94,0.15)" strokeWidth="0.5" strokeDasharray="4 3" />
      )}

      {/* Camera */}
      {angle && (
        <g filter="url(#glow)">
          <circle cx={camX} cy={camY} r="16" fill="rgba(34,197,94,0.15)" stroke="#22c55e" strokeWidth="1.5">
            <animate attributeName="r" values="15;17;15" dur="2s" repeatCount="indefinite" />
          </circle>
          <text x={camX} y={camY + 5} textAnchor="middle" fontSize="14">📷</text>
          <text x={camX} y={camY - 22} textAnchor="middle" fill="#22c55e" fontSize="7" fontFamily="monospace" fontWeight="bold">
            {angle.label}
          </text>
          {(angle.id === "high" || angle.id === "drone") && (
            <text x={camX + 20} y={camY + 4} fill="#22c55e" fontSize="8">↓ cao</text>
          )}
          {angle.id === "low" && (
            <text x={camX + 20} y={camY + 4} fill="#22c55e" fontSize="8">↑ thấp</text>
          )}
          {angle.id === "dutch" && (
            <text x={camX + 20} y={camY + 4} fill="#22c55e" fontSize="8">↗ nghiêng</text>
          )}
        </g>
      )}

      {/* No camera selected */}
      {!angle && (
        <g>
          <text x="200" y="360" textAnchor="middle" fill="rgba(255,255,255,0.15)" fontSize="10">Chọn góc chụp bên phải →</text>
          <text x="200" y="375" textAnchor="middle" fill="rgba(255,255,255,0.1)" fontSize="8">Camera sẽ hiển thị vị trí ở đây</text>
        </g>
      )}

      {/* Label */}
      <text x="200" y="395" textAnchor="middle" fill="rgba(255,255,255,0.1)" fontSize="7" fontFamily="monospace">
        STUDIO VIEWPORT — TOP-DOWN VIEW
      </text>
    </svg>
  );
}

/* ───── CARD GRID ───── */
function CardGrid({ items, selected, onSelect, cols = 3 }: {
  items: { id: string; label: string; icon: string; accent?: string; desc?: string }[];
  selected: string;
  onSelect: (id: string) => void;
  cols?: number;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6 }}>
      {items.map(it => {
        const active = it.id === selected;
        const c = it.accent || "#22c55e";
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onSelect(it.id === selected ? "" : it.id)}
            title={it.desc || it.label}
            style={{
              background: active ? `${c}18` : "rgba(255,255,255,0.02)",
              border: `1px solid ${active ? `${c}60` : "rgba(255,255,255,0.06)"}`,
              borderRadius: 8,
              padding: "10px 6px 8px",
              cursor: "pointer",
              textAlign: "center",
              transition: "all 0.2s ease",
              color: active ? c : "rgba(255,255,255,0.7)",
              outline: "none",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {active && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, background: c }} />}
            <div style={{ fontSize: 20, lineHeight: 1 }}>{it.icon}</div>
            <div style={{ fontSize: 9, marginTop: 5, fontWeight: active ? 700 : 400, lineHeight: 1.2 }}>{it.label}</div>
          </button>
        );
      })}
    </div>
  );
}

/* ───── SECTION ───── */
function Section({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 }}>
        <span style={{ fontSize: 14 }}>{icon}</span> {title}
      </h3>
      {children}
    </div>
  );
}

/* ───── MAIN MODAL ───── */
export interface ImageStudioSettings {
  cameraAngle: string;
  style: string;
  lighting: string;
  composition: string;
}

interface Props {
  initial: ImageStudioSettings;
  onConfirm: (s: ImageStudioSettings) => void;
  onClose: () => void;
}

function findIdByPrompt(items: { id: string; en: string }[], prompt: string): string {
  if (!prompt) return "";
  const item = items.find(i => i.en === prompt);
  return item?.id || "";
}

export default function ImageStudioModal({ initial, onConfirm, onClose }: Props) {
  const [angleId, setAngleId] = useState(() => findIdByPrompt(CAMERA_ANGLES, initial.cameraAngle));
  const [styleId, setStyleId] = useState(() => findIdByPrompt(ART_STYLES, initial.style));
  const [lightId, setLightId] = useState(() => findIdByPrompt(LIGHTING_PRESETS, initial.lighting));
  const [compId, setCompId] = useState(() => findIdByPrompt(COMPOSITIONS, initial.composition));

  const selAngle = CAMERA_ANGLES.find(a => a.id === angleId) || null;
  const selStyle = ART_STYLES.find(s => s.id === styleId) || null;
  const selLight = LIGHTING_PRESETS.find(l => l.id === lightId) || null;
  const selComp = COMPOSITIONS.find(c => c.id === compId) || null;

  const summary = useMemo(() => {
    const parts: string[] = [];
    if (selAngle) parts.push(selAngle.en);
    if (selStyle) parts.push(selStyle.en);
    if (selLight) parts.push(selLight.en);
    if (selComp) parts.push(selComp.en);
    return parts.join(", ");
  }, [selAngle, selStyle, selLight, selComp]);

  const count = [selAngle, selStyle, selLight, selComp].filter(Boolean).length;

  function handleConfirm() {
    onConfirm({
      cameraAngle: selAngle?.en || "",
      style: selStyle?.en || "",
      lighting: selLight?.en || "",
      composition: selComp?.en || "",
    });
  }

  return createPortal(
    <div
      onClick={onClose}
      className="nodrag nowheel"
      style={{
        position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
        background: "rgba(0,0,0,0.88)",
        display: "flex", padding: 16,
        zIndex: 99999, backdropFilter: "blur(10px)",
        animation: "fadeIn 0.25s ease",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          flex: 1, display: "flex", flexDirection: "column",
          background: "linear-gradient(145deg, #0c1222 0%, #162032 50%, #0f172a 100%)",
          borderRadius: 16, border: "1px solid rgba(255,255,255,0.08)",
          overflow: "hidden",
          boxShadow: "0 0 80px rgba(99,102,241,0.08), 0 25px 50px rgba(0,0,0,0.5)",
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: "14px 24px", display: "flex", justifyContent: "space-between", alignItems: "center",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(0,0,0,0.3)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg, #22c55e, #14b8a6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📷</div>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, color: "#fff", fontWeight: 800, letterSpacing: 1 }}>STUDIO ẢNH NÂNG CAO</h2>
              <p style={{ margin: 0, fontSize: 10, color: "rgba(255,255,255,0.35)", letterSpacing: 0.5 }}>Giả lập studio — Góc chụp • Phong cách • Ánh sáng • Bố cục</p>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {count > 0 && (
              <span style={{ fontSize: 10, background: "rgba(34,197,94,0.15)", color: "#22c55e", padding: "4px 10px", borderRadius: 20, border: "1px solid rgba(34,197,94,0.2)", fontWeight: 700 }}>
                {count} cấu hình đã chọn
              </span>
            )}
            <button onClick={onClose} style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8, color: "#94a3b8", padding: "8px 14px", cursor: "pointer", fontSize: 16, transition: "all 0.2s" }}>✕</button>
          </div>
        </div>

        {/* ── Body ── */}
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          {/* Left: Viewport */}
          <div style={{ width: "40%", minWidth: 320, padding: 16, display: "flex", flexDirection: "column", borderRight: "1px solid rgba(255,255,255,0.05)" }}>
            <div style={{ flex: 1, background: "rgba(0,0,0,0.4)", borderRadius: 12, border: "1px solid rgba(255,255,255,0.04)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <StudioViewport angle={selAngle} />
            </div>
            {selAngle && (
              <div style={{ marginTop: 10, padding: "10px 14px", background: "rgba(34,197,94,0.06)", borderRadius: 8, border: "1px solid rgba(34,197,94,0.12)" }}>
                <div style={{ fontSize: 12, color: "#22c55e", fontWeight: 700 }}>{selAngle.icon} {selAngle.label}</div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 3 }}>{selAngle.desc}</div>
              </div>
            )}
            {/* Quick style + light badges */}
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 4 }}>
              {selStyle && <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 20, background: `${selStyle.accent}15`, color: selStyle.accent, border: `1px solid ${selStyle.accent}30` }}>{selStyle.icon} {selStyle.label}</span>}
              {selLight && <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 20, background: `${selLight.accent}15`, color: selLight.accent, border: `1px solid ${selLight.accent}30` }}>{selLight.icon} {selLight.label}</span>}
              {selComp && <span style={{ fontSize: 9, padding: "3px 8px", borderRadius: 20, background: `${selComp.accent}15`, color: selComp.accent, border: `1px solid ${selComp.accent}30` }}>{selComp.icon} {selComp.label}</span>}
            </div>
          </div>

          {/* Right: Controls */}
          <div style={{ flex: 1, padding: "16px 20px", overflowY: "auto" }}>
            <Section icon="📷" title="Góc Chụp / Camera Angle">
              <CardGrid items={CAMERA_ANGLES} selected={angleId} onSelect={setAngleId} cols={4} />
            </Section>
            <Section icon="🎨" title="Phong Cách Nghệ Thuật / Art Style">
              <CardGrid items={ART_STYLES} selected={styleId} onSelect={setStyleId} cols={4} />
            </Section>
            <Section icon="💡" title="Ánh Sáng / Lighting">
              <CardGrid items={LIGHTING_PRESETS} selected={lightId} onSelect={setLightId} cols={4} />
            </Section>
            <Section icon="▦" title="Bố Cục / Composition">
              <CardGrid items={COMPOSITIONS} selected={compId} onSelect={setCompId} cols={4} />
            </Section>
          </div>
        </div>

        {/* ── Footer ── */}
        <div style={{
          padding: "12px 24px",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(0,0,0,0.3)",
          display: "flex", alignItems: "center", gap: 16,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", marginBottom: 3, fontFamily: "monospace", textTransform: "uppercase", letterSpacing: 1 }}>📝 Prompt bổ sung sẽ gửi cho AI:</div>
            <div style={{ fontSize: 10, color: summary ? "#22c55e" : "rgba(255,255,255,0.15)", fontFamily: "monospace", lineHeight: 1.5, maxHeight: 40, overflowY: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {summary || "Chưa chọn cấu hình nào — hãy chọn ở bên phải..."}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button onClick={onClose} style={{ padding: "10px 20px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#94a3b8", cursor: "pointer", fontSize: 12, transition: "all 0.2s" }}>Hủy</button>
            <button
              onClick={handleConfirm}
              style={{ padding: "10px 28px", background: "linear-gradient(135deg, #22c55e, #16a34a)", border: "none", borderRadius: 8, color: "#fff", cursor: "pointer", fontSize: 13, fontWeight: 700, letterSpacing: 0.5, boxShadow: "0 4px 14px rgba(34,197,94,0.3)", transition: "all 0.2s" }}
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
