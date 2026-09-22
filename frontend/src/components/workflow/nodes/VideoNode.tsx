import { useState, useMemo } from "react";
import { Handle, Position, useNodes, useEdges, useReactFlow, type NodeProps, type Node, type Edge } from "@xyflow/react";
import {
  WNodeData,
  Shell,
  handleLabelStyle,
  ImageAttachBar,
  VideoAttachBar,
  MediaPreview,
  mediaUrl
} from "./shared";
import { useAiRewrite } from "../../../hooks/useAiRewrite";
import VideoStudioModal, { type VideoStudioSettings } from "../../VideoStudioModal";
import EngineModelSelector from "../EngineModelSelector";
import InlinePromptEditor from "../InlinePromptEditor";
import ConfigBadges from "../ConfigBadges";

export default function VideoNode({ id, data, selected, plus = false }: NodeProps & { plus?: boolean }) {
  const d = data as WNodeData;
  const nodes = useNodes();
  const edges = useEdges();
  const [showModal, setShowModal] = useState(false);
  const { setNodes, setEdges } = useReactFlow();

  const handleExtendVideo = () => {
    const videoNode = nodes.find(n => n.id === id);
    const basePos = videoNode ? videoNode.position : { x: 0, y: 0 };
    const feId = `frame_extract_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;
    const nextVidId = `video_gen_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 4)}`;

    const feNode: Node = {
      id: feId,
      type: "frame_extract",
      position: { x: basePos.x + 360, y: basePos.y },
      data: {
        title: "Tách frame (Frame cuối)",
        positions: "end",
        runStatus: "idle",
        onChange: d.onChange,
        onPreview: d.onPreview,
        onError: d.onError,
        onRerun: d.onRerun,
        onPickImage: d.onPickImage,
        getWorkflowContext: d.getWorkflowContext,
      } as WNodeData,
    };

    const nextVidNode: Node = {
      id: nextVidId,
      type: "video_generate_plus",
      position: { x: basePos.x + 720, y: basePos.y },
      data: {
        title: "Tạo video (Đoạn tiếp)",
        prompt_hint: d.prompt_hint || "",
        aspect_ratio: d.aspect_ratio || d.aspectRatio || "16:9",
        clipDuration: d.clipDuration || 8,
        resolution: d.resolution || "720p",
        transition: d.transition || "crossfade",
        aiAudio: d.aiAudio ?? false,
        negativePrompt: d.negativePrompt || "",
        runStatus: "idle",
        onChange: d.onChange,
        onPreview: d.onPreview,
        onError: d.onError,
        onRerun: d.onRerun,
        onPickImage: d.onPickImage,
        getWorkflowContext: d.getWorkflowContext,
      } as WNodeData,
    };

    const edge1: Edge = {
      id: `edge_${id}_to_${feId}`,
      source: id,
      sourceHandle: "video",
      target: feId,
      targetHandle: "video",
      animated: true,
      style: { stroke: "#f59e0b", strokeWidth: 2 },
    };

    const edge2: Edge = {
      id: `edge_${feId}_to_${nextVidId}`,
      source: feId,
      sourceHandle: "end_image",
      target: nextVidId,
      targetHandle: "start_image",
      animated: true,
      style: { stroke: "#ec4899", strokeWidth: 2 },
    };

    setNodes(nds => [...nds, feNode, nextVidNode]);
    setEdges(eds => [...eds, edge1, edge2]);
  };

  const resolvedStartImage = useMemo(() => {
    const edge = edges.find(e => e.target === id && e.targetHandle === "start_image");
    if (!edge) return d.start_image || "";
    const srcNode = nodes.find(n => n.id === edge.source);
    if (!srcNode) return d.start_image || "";
    const nd = srcNode.data as WNodeData;
    return nd.image || nd.resultUrls?.[0] || "";
  }, [edges, nodes, id, d.start_image]);

  const resolvedEndImage = useMemo(() => {
    const edge = edges.find(e => e.target === id && e.targetHandle === "end_image");
    if (!edge) return d.end_image || "";
    const srcNode = nodes.find(n => n.id === edge.source);
    if (!srcNode) return d.end_image || "";
    const nd = srcNode.data as WNodeData;
    return nd.image || nd.resultUrls?.[0] || "";
  }, [edges, nodes, id, d.end_image]);

  const fromEdge = edges.some(e => e.target === id && e.targetHandle === "start_image");
  const hasStart = fromEdge || Boolean(d.start_image);
  const hasEndEdge = edges.some(e => e.target === id && e.targetHandle === "end_image");

  const fromMotionEdge = edges.some(e => e.target === id && (e.targetHandle === "video_motion" || e.targetHandle === "video"));
  const resolvedMotionVideo = useMemo(() => {
    const edge = edges.find(e => e.target === id && (e.targetHandle === "video_motion" || e.targetHandle === "video"));
    if (!edge) return d.video_motion || "";
    const srcNode = nodes.find(n => n.id === edge.source);
    if (!srcNode) return d.video_motion || "";
    const nd = srcNode.data as WNodeData;
    return nd.video || nd.resultUrls?.[0] || "";
  }, [edges, nodes, id, d.video_motion]);
  const hasMotion = fromMotionEdge || Boolean(d.video_motion) || Boolean(resolvedMotionVideo);

  const computedMode = useMemo(() => {
    const hasStartActive = fromEdge || Boolean(d.start_image) || Boolean(resolvedStartImage);
    const hasEndActive = hasEndEdge || Boolean(d.end_image) || Boolean(resolvedEndImage);
    if (hasMotion) return "motion_transfer";
    if (hasStartActive && hasEndActive) return "start_end_image";
    if (hasStartActive) return "start_image";
    return "text_to_video";
  }, [fromEdge, d.start_image, resolvedStartImage, hasEndEdge, d.end_image, resolvedEndImage, hasMotion]);

  const hasRefEdge = edges.some(e => e.target === id && e.targetHandle === "reference");
  const hasPromptEdge = edges.some(e => e.target === id && e.targetHandle === "prompt");

  const { aiBusy, handleAiRewrite, ctxHint } = useAiRewrite({
    nodeId: id,
    kind: "video",
    prompt: d.prompt_hint || "",
    getWorkflowContext: d.getWorkflowContext,
    onChange: d.onChange,
    targetField: "prompt_hint",
    onError: d.onError,
  });

  const workflowCharacters = useMemo(() => {
    if (!plus) return [];
    const chars: Array<{ name: string; url: string }> = [];
    const seenNames = new Set<string>();
    nodes.forEach(n => {
      const nd = n.data as any;
      const imgUrl = nd?.image || nd?.resultUrls?.[0];
      if (n.type === "reference" && nd?.refName && imgUrl) {
        const name = String(nd.refName).trim();
        if (name && !seenNames.has(name)) {
          seenNames.add(name);
          chars.push({ name, url: String(imgUrl) });
        }
      }
      if ((n.type === "generate" || n.type === "generate_plus") && nd?.refName && nd?.resultUrls?.[0]) {
        const name = String(nd.refName).trim();
        if (name && !seenNames.has(name)) {
          seenNames.add(name);
          chars.push({ name, url: String(nd.resultUrls[0]) });
        }
      }
    });
    return chars;
  }, [nodes, plus]);

  const connectedCharacters = useMemo(() => {
    if (!plus) return [];
    const chars: Array<{ name: string; url: string }> = [];
    const seenNames = new Set<string>();
    const incomingEdges = edges.filter(e => e.target === id && e.targetHandle === "reference");
    incomingEdges.forEach(e => {
      const srcNode = nodes.find(n => n.id === e.source);
      if (!srcNode) return;
      const nd = srcNode.data as any;
      const imgUrl = nd?.image || nd?.resultUrls?.[0];
      if (srcNode.type === "reference" && nd?.refName && imgUrl) {
        const name = String(nd.refName).trim();
        if (name && !seenNames.has(name)) {
          seenNames.add(name);
          chars.push({ name, url: String(imgUrl) });
        }
      } else if ((srcNode.type === "generate" || srcNode.type === "generate_plus") && nd?.refName && nd?.resultUrls?.[0]) {
        const name = String(nd.refName).trim();
        if (name && !seenNames.has(name)) {
          seenNames.add(name);
          chars.push({ name, url: String(nd.resultUrls[0]) });
        }
      }
    });
    return chars;
  }, [nodes, edges, id, plus]);

  const allActiveCharacters = useMemo(() => {
    if (!plus) return [];
    const list: Array<{ name: string; url: string }> = [];
    const seenNames = new Set<string>();
    const normalize = (n: string) => n.replace(/^@/, "").trim().toLowerCase();

    // 1. Add connected characters
    connectedCharacters.forEach(c => {
      const norm = normalize(c.name);
      if (norm && !seenNames.has(norm)) {
        seenNames.add(norm);
        const displayName = c.name.startsWith("@") ? c.name : `@${c.name}`;
        list.push({ name: displayName, url: c.url });
      }
    });

    // 2. Add local characterAssets
    (d.characterAssets || []).forEach((c: any) => {
      const norm = normalize(c.name || "");
      if (norm && !seenNames.has(norm)) {
        seenNames.add(norm);
        const displayName = c.name.startsWith("@") ? c.name : `@${c.name}`;
        list.push({ name: displayName, url: String(c.url || "") });
      }
    });

    return list;
  }, [plus, connectedCharacters, d.characterAssets]);

  const hasSceneEdge = edges.some(e => e.target === id && e.targetHandle === "scene_ref");

  // Collect ALL named assets across the entire workflow for @tag display
  const availableTags = useMemo(() => {
    const tags: Array<{ name: string; type: "image" | "video" | "scene"; icon: string }> = [];
    const seen = new Set<string>();
    // Determine which source nodes are connected to scene_ref handle
    const sceneSourceIds = new Set(
      edges.filter(e => e.target === id && e.targetHandle === "scene_ref").map(e => e.source)
    );
    nodes.forEach(n => {
      const nd = n.data as any;
      const refName = String(nd?.refName || "").trim();
      if (!refName || seen.has(refName.toLowerCase())) return;
      seen.add(refName.toLowerCase());
      if (n.type === "video_reference") {
        tags.push({ name: refName, type: "video", icon: "📹" });
      } else if ((n.type === "reference" || n.type === "generate" || n.type === "generate_plus") && sceneSourceIds.has(n.id)) {
        tags.push({ name: refName, type: "scene", icon: "🏞️" });
      } else if (n.type === "reference" || n.type === "generate" || n.type === "generate_plus") {
        tags.push({ name: refName, type: "image", icon: "🖼" });
      }
    });
    return tags;
  }, [nodes, edges, id]);

  const modeLabel = hasMotion
    ? (hasSceneEdge
      ? "🎬🏞️ Chuyển động + Phong cảnh (Video mẫu + Nhân vật + Bối cảnh)"
      : "🎬 Bắt chước chuyển động (Video mẫu + Nhân vật)")
    : hasEndEdge
      ? "Ảnh đầu + khung cuối (từ node frame)"
      : hasStart
        ? "Từ ảnh → video"
        : hasSceneEdge
          ? "🏞️ Text → video (Nhân vật + Phong cảnh)"
          : hasRefEdge
            ? "Từ text → video (Tham chiếu nhân vật)"
            : "Từ text → video";

  return (
    <Shell
      type="video_generate"
      title={d.title || (plus ? "Tạo video +" : "Tạo video")}
      selected={selected}
      runStatus={d.runStatus}
      runError={d.runError}
      showRerun
      reused={d.reused}
      onRerun={() => d.onRerun?.(id)}
      percent={d.percent}
      step={d.step}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        style={{ top: "8%", background: "#6366f1" }}
        title="Cổng nhận Prompt: Nối từ node Prompt"
      />
      <div style={handleLabelStyle("left", "8%")}>← Prompt</div>

      <Handle
        type="target"
        position={Position.Left}
        id="start_image"
        style={{ top: "22%", background: "#22c55e" }}
        title="Cổng nhận Ảnh đầu: Nối từ node Tạo ảnh hoặc cổng end_image của Tách frame"
      />
      <div style={handleLabelStyle("left", "22%")}>← Ảnh đầu</div>

      <Handle
        type="target"
        position={Position.Left}
        id="reference"
        style={{ top: "36%", background: "#06b6d4" }}
        title="Cổng nhận Nhân vật ref: Nối từ node Ảnh có sẵn để giữ nhất quán nhân vật"
      />
      <div style={handleLabelStyle("left", "36%")}>← Nhân vật ref</div>

      <Handle
        type="target"
        position={Position.Left}
        id="scene_ref"
        style={{ top: "50%", background: "#a855f7" }}
        title="Cổng nhận Phong cảnh: Nối ảnh phong cảnh / bối cảnh để làm video sống động hơn"
      />
      <div style={handleLabelStyle("left", "50%")}>← Phong cảnh</div>

      <Handle
        type="target"
        position={Position.Left}
        id="end_image"
        style={{ top: "64%", background: "#14b8a6" }}
        title="Cổng nhận Khung cuối: Nối từ cổng end_image của node Tách frame (Video-to-Video)"
      />
      <div style={handleLabelStyle("left", "64%")}>← Khung cuối</div>

      <Handle
        type="target"
        position={Position.Left}
        id="video_motion"
        style={{ top: "78%", background: "#f59e0b" }}
        title="Cổng nhận Video mẫu (Motion / Điệu nhảy): Nối từ node Video có sẵn / Tách frame để nhân vật làm theo"
      />
      <div style={handleLabelStyle("left", "78%")}>← Video mẫu</div>

      <Handle
        type="target"
        position={Position.Left}
        id="audio_in"
        style={{ top: "92%", background: "#ec4899" }}
        title="Cổng nhận Nhạc: Nối từ node Nhạc nền để ghép nhạc custom vào video"
      />
      <div style={handleLabelStyle("left", "92%")}>← Nhạc 🎵</div>

      <Handle
        type="source"
        position={Position.Right}
        id="video"
        style={{ background: "#f59e0b" }}
        title="Cổng xuất Video kết quả: Nối sang cổng Video của node Tách frame"
      />
      <div style={handleLabelStyle("right", "50%")}>Video kết quả →</div>

      <div style={{ marginBottom: 8, display: "flex", gap: 6 }}>
        <button
          type="button"
          className="wf-btn wf-btn-secondary nodrag"
          style={{ width: "100%", padding: "6px 8px", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", gap: 4, background: "rgba(245, 158, 11, 0.1)", border: "1px solid rgba(245, 158, 11, 0.2)" }}
          onClick={() => setShowModal(true)}
        >
          ⚙️ Cấu hình quay & style +
        </button>
      </div>

      <ConfigBadges
        cameraAngle={d.cameraAngle}
        style={d.style}
        cameraMovement={d.cameraMovement}
        movementSpeed={d.movementSpeed}
        studioDuration={d.studioDuration}
        clipDuration={d.clipDuration}
        aspectRatio={d.aspect_ratio || d.aspectRatio}
        resolution={d.resolution}
        transition={d.transition}
        aiAudio={d.aiAudio}
        negativePrompt={d.negativePrompt}
        motionMode={d.motionMode}
      />

      <EngineModelSelector
        type="video"
        engine={d.engine}
        model={d.model}
        aspect_ratio={d.aspect_ratio || d.aspectRatio}
        onChange={(patch: Partial<WNodeData>) => d.onChange?.(id, patch)}
      />

      {/* Quick Controls: Duration & Resolution */}
      <div className="nodrag" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
        <label style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>
          ⏱ Thời lượng
          <select
            value={d.clipDuration || 8}
            onChange={(e) => d.onChange?.(id, { clipDuration: Number(e.target.value) })}
            style={{ width: "100%", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "inherit", padding: "4px 6px", fontSize: 10, marginTop: 2 }}
          >
            <option value={4}>⚡ 4s (Rất nhanh)</option>
            <option value={6}>🎬 6s</option>
            <option value={8}>🎬 8s (Mặc định)</option>
            <option value={10}>🎥 10s (Dài nhất)</option>
          </select>
        </label>
        <label style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>
          📐 Độ phân giải
          <select
            value={d.resolution || "720p"}
            onChange={(e) => d.onChange?.(id, { resolution: e.target.value })}
            style={{ width: "100%", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "inherit", padding: "4px 6px", fontSize: 10, marginTop: 2 }}
          >
            <option value="720p">📺 720p (Nhanh)</option>
            <option value="1080p">📺 1080p (Full HD)</option>
            <option value="4K">🎬 4K (Ultra HD)</option>
          </select>
        </label>
      </div>

      {/* Quick Controls: Transition & AI Audio */}
      <div className="nodrag" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 6 }}>
        <label style={{ fontSize: 10, color: "rgba(255,255,255,0.7)" }}>
          🔀 Chuyển cảnh
          <select
            value={d.transition || "none"}
            onChange={(e) => d.onChange?.(id, { transition: e.target.value })}
            style={{ width: "100%", background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "inherit", padding: "4px 6px", fontSize: 10, marginTop: 2 }}
          >
            <option value="none">Không hiệu ứng</option>
            <option value="crossfade">🔀 Crossfade</option>
            <option value="fade_black">⬛ Mờ đen</option>
            <option value="fade_white">⬜ Mờ trắng</option>
            <option value="wipe_left">◀️ Quét trái</option>
            <option value="wipe_right">▶️ Quét phải</option>
            <option value="slide_up">⬆️ Trượt lên</option>
            <option value="zoom_in">🔎 Zoom In</option>
          </select>
        </label>
        <div style={{ display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 10, color: "rgba(255,255,255,0.8)" }}>
            <input
              type="checkbox"
              checked={Boolean(d.aiAudio)}
              onChange={(e) => d.onChange?.(id, { aiAudio: e.target.checked })}
              style={{ accentColor: "#10b981" }}
            />
            🔊 Âm thanh AI
          </label>
        </div>
      </div>

      {/* Quick Controls: Negative Prompt */}
      <div className="nodrag" style={{ marginBottom: 6 }}>
        <input
          className="nodrag"
          placeholder="🚫 Negative prompt (blur, watermark, bad quality...)"
          value={d.negativePrompt || ""}
          onChange={(e) => d.onChange?.(id, { negativePrompt: e.target.value })}
          style={{
            width: "100%",
            padding: "4px 6px",
            fontSize: 10,
            borderRadius: 6,
            background: "rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.85)",
            boxSizing: "border-box",
          }}
        />
      </div>

      <div className="node-config-compact nodrag" style={{ marginBottom: 8 }}>
        <span>{modeLabel}</span>
      </div>

      {!hasPromptEdge && (
        <InlinePromptEditor
          kind="video"
          value={d.prompt_hint || ""}
          aiBusy={aiBusy}
          onAiRewrite={handleAiRewrite}
          onChange={(text: string) => d.onChange?.(id, { prompt_hint: text })}
          ctxHint={ctxHint}
        />
      )}

      {hasPromptEdge && (
        <div className="node-edge-hint" style={{ marginBottom: 6, borderColor: "rgba(99,102,241,0.3)", color: "#818cf8" }}>
          ✓ Đã nối node Prompt
        </div>
      )}

      {/* Available @tags from all named nodes in workflow */}
      {availableTags.length > 0 && (
        <div className="nodrag nopan" style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 9, color: "#64748b", marginBottom: 3 }}>Gõ @tag trong prompt:</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {availableTags.map(t => {
              const tagColors: Record<string, string> = { image: "#06b6d4", video: "#f59e0b", scene: "#a855f7" };
              const tagLabels: Record<string, string> = { image: "nhân vật", video: "video", scene: "phong cảnh" };
              const c = tagColors[t.type] || "#94a3b8";
              return (
                <button
                  key={t.name}
                  type="button"
                  onClick={() => {
                    const current = d.prompt_hint || "";
                    const tag = `@${t.name}`;
                    if (!current.includes(tag)) {
                      d.onChange?.(id, { prompt_hint: current ? `${current} ${tag}` : tag });
                    }
                  }}
                  style={{
                    fontSize: 9,
                    padding: "2px 6px",
                    borderRadius: 4,
                    background: `${c}20`,
                    color: c,
                    border: `1px solid ${c}40`,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                  title={`Click để chèn @${t.name} (${tagLabels[t.type]}) vào prompt`}
                >
                  {t.icon} @{t.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {hasRefEdge && (
        <div className="node-edge-hint" style={{ marginBottom: 6, borderColor: "rgba(6,182,212,0.3)", color: "#06b6d4" }}>
          ✓ Đã nối nhân vật tham chiếu
        </div>
      )}

      {plus ? (
        fromEdge && (
          <div className="node-edge-hint">
            ✓ Ảnh đầu lấy từ node ảnh đã nối
          </div>
        )
      ) : fromEdge ? (
        <div className="node-edge-hint">
          ✓ Ảnh đầu lấy từ node ảnh đã nối
        </div>
      ) : (
        <ImageAttachBar
          nodeId={id}
          field="start_image"
          value={d.start_image}
          onChange={(nid, patch) => {
            d.onChange?.(nid, {
              ...patch,
              mode: patch.start_image ? "start_image" : "text_to_video",
            });
          }}
          onPick={d.onPickImage}
          onPreview={d.onPreview}
          label="Ảnh đầu (khi không nối node ảnh)"
        />
      )}

      {hasEndEdge ? (
        <div className="node-edge-hint" style={{ marginTop: 6 }}>
          ✓ Khung cuối lấy từ node Tách frame
        </div>
      ) : plus ? null : (
        <div className="muted" style={{ fontSize: 10, marginTop: 6, lineHeight: 1.4 }}>
          Khung cuối: nối node <strong>Tách frame</strong> → chấm <code>end_image</code>
        </div>
      )}

      {hasMotion ? (
        <div className="nodrag nopan" style={{ marginTop: 6 }}>
          <div className="node-edge-hint" style={{ borderColor: "rgba(245, 158, 11, 0.4)", color: "#f59e0b", marginBottom: 4 }}>
            ✓ Đã kết nối Video mẫu
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
            <span style={{ fontSize: 10, color: "#94a3b8", whiteSpace: "nowrap" }}>Chế độ:</span>
            <select
              value={d.motionMode || "transform"}
              onChange={(e) => d.onChange?.(id, { motionMode: e.target.value as "transform" | "inspire" })}
              style={{
                flex: 1,
                fontSize: 10,
                padding: "3px 6px",
                borderRadius: 6,
                background: "rgba(0,0,0,0.4)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "#fff",
                cursor: "pointer",
              }}
            >
              <option value="transform">🔄 Biến đổi nhân vật (Motion Transfer)</option>
              <option value="inspire">✨ Học theo / Lấy cảm hứng</option>
            </select>
          </div>
          <div style={{ fontSize: 9, color: "#64748b", marginTop: 3, lineHeight: 1.4 }}>
            {(d.motionMode || "transform") === "transform"
              ? "Biến người trong video thành nhân vật tham chiếu, giữ nguyên chuyển động"
              : "Tạo video mới lấy cảm hứng từ phong cách, chuyển động, bố cục của video mẫu — viết prompt mô tả video bạn muốn"}
          </div>
        </div>
      ) : plus ? null : (
        <VideoAttachBar
          nodeId={id}
          field="video_motion"
          value={d.video_motion}
          onChange={d.onChange}
          onPick={d.onPickImage}
          onPreview={d.onPreview}
          label="Video mẫu (khi không nối node video)"
        />
      )}

      {plus && allActiveCharacters.length > 0 && (
        <div className="nodrag nopan node-attach-bar" style={{ marginTop: 6 }}>
          <div className="node-attach-head">
            <span>Nhân vật/Đồ vật tham chiếu ({allActiveCharacters.length})</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
            {allActiveCharacters.map((char, index) => (
              <button
                key={index}
                type="button"
                className="node-attach-thumb"
                onClick={() => char.url && d.onPreview?.(mediaUrl(char.url))}
                title={`Xem ${char.name}`}
                style={{ width: 40, height: 40, position: "relative", borderRadius: 4, overflow: "hidden", border: "1px solid rgba(255,255,255,0.15)" }}
              >
                <img src={mediaUrl(char.url)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                <span style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: 6, padding: "1px 0", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                  {char.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {d.resultUrls?.length ? (
        <>
          <MediaPreview urls={d.resultUrls} onPreview={d.onPreview} max={2} label="Kết quả video" />
          <button
            type="button"
            className="wf-btn nodrag"
            style={{
              width: "100%",
              marginTop: 6,
              padding: "5px 8px",
              fontSize: 10,
              fontWeight: 600,
              background: "rgba(168, 85, 247, 0.15)",
              border: "1px solid rgba(168, 85, 247, 0.3)",
              color: "#c084fc",
              borderRadius: 6,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
            onClick={handleExtendVideo}
          >
            ⏩ Nối tiếp video (Tạo đoạn tiếp theo)
          </button>
        </>
      ) : (
        <div className="node-media-empty">
          {d.runStatus === "running" || d.runStatus === "pending"
            ? "Đang tạo video…"
            : "Video kết quả gen hiện ở đây"}
        </div>
      )}

      {showModal && (
        <VideoStudioModal
          initial={{
            cameraAngle: d.cameraAngle || "",
            style: d.style || "",
            cameraMovement: d.cameraMovement || "",
            movementSpeed: d.movementSpeed || "",
            duration: d.studioDuration || 8,
            aspect_ratio: d.aspect_ratio || d.aspectRatio || "16:9",
            aspectRatio: d.aspect_ratio || d.aspectRatio || "16:9",
            timelineSegments: d.timelineSegments || [],
            mode: computedMode,
            start_image: resolvedStartImage,
            end_image: resolvedEndImage,
            characterAssets: d.characterAssets || [],
            transition: d.transition || "none",
            negativePrompt: d.negativePrompt || "",
            clipDuration: d.clipDuration || 8,
            resolution: d.resolution || "720p",
            aiAudio: d.aiAudio ?? false,
            hasStartImageEdge: fromEdge,
            hasEndImageEdge: hasEndEdge,
            workflowCharacters: workflowCharacters,
            connectedCharacters: connectedCharacters,
            runStatus: d.runStatus,
          }}
          onConfirm={(s: VideoStudioSettings, triggerRun?: boolean) => {
            d.onChange?.(id, {
              cameraAngle: s.cameraAngle,
              style: s.style,
              cameraMovement: s.cameraMovement,
              movementSpeed: s.movementSpeed,
              studioDuration: s.duration,
              aspect_ratio: s.aspect_ratio || s.aspectRatio,
              aspectRatio: s.aspect_ratio || s.aspectRatio,
              timelineSegments: s.timelineSegments,
              mode: s.mode,
              start_image: s.start_image,
              end_image: s.end_image,
              characterAssets: s.characterAssets,
              transition: s.transition,
              negativePrompt: s.negativePrompt,
              clipDuration: s.clipDuration,
              resolution: s.resolution,
              aiAudio: s.aiAudio,
            });

            // Consolidate all node/edge mutations into single calls to avoid racing setNodes
            const newNodesToAdd: Node[] = [];
            const newEdgesToAdd: Edge[] = [];
            const edgesToRemove: string[] = [];
            const nodeUpdates = new Map<string, Partial<Record<string, unknown>>>();
            const nodesToRemove: string[] = [];

            const videoNode = nodes.find(n => n.id === id);
            const basePos = videoNode ? videoNode.position : { x: 0, y: 0 };

            // Handle start_image
            const startEdge = edges.find(e => e.target === id && e.targetHandle === "start_image");
            if (s.start_image) {
              if (startEdge) {
                const srcNode = nodes.find(n => n.id === startEdge.source);
                if (srcNode && srcNode.type === "reference") {
                  nodeUpdates.set(startEdge.source, {
                    image: s.start_image,
                    resultUrls: [s.start_image]
                  });
                }
              } else {
                const newRefId = `node_ref_start_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                newNodesToAdd.push({
                  id: newRefId,
                  type: "reference",
                  position: { x: basePos.x - 320, y: basePos.y - 80 },
                  data: {
                    image: s.start_image,
                    resultUrls: [s.start_image],
                    title: "Ảnh có sẵn",
                    refName: "",
                    onChange: d.onChange,
                    onPreview: d.onPreview,
                    onPickImage: d.onPickImage,
                    onError: d.onError,
                  }
                });
                newEdgesToAdd.push({
                  id: `edge_start_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                  source: newRefId,
                  sourceHandle: "image",
                  target: id,
                  targetHandle: "start_image",
                  animated: true,
                  style: { stroke: "#64748b", strokeWidth: 2 },
                });
              }
            } else {
              if (startEdge && startEdge.source.startsWith("node_ref_start_")) {
                edgesToRemove.push(startEdge.id);
                nodesToRemove.push(startEdge.source);
              }
            }

            // Handle end_image
            const endEdge = edges.find(e => e.target === id && e.targetHandle === "end_image");
            if (s.end_image) {
              if (endEdge) {
                const srcNode = nodes.find(n => n.id === endEdge.source);
                if (srcNode && srcNode.type === "reference") {
                  nodeUpdates.set(endEdge.source, {
                    image: s.end_image,
                    resultUrls: [s.end_image]
                  });
                }
              } else {
                const newRefId = `node_ref_end_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                newNodesToAdd.push({
                  id: newRefId,
                  type: "reference",
                  position: { x: basePos.x - 320, y: basePos.y + 160 },
                  data: {
                    image: s.end_image,
                    resultUrls: [s.end_image],
                    title: "Ảnh có sẵn",
                    refName: "",
                    onChange: d.onChange,
                    onPreview: d.onPreview,
                    onPickImage: d.onPickImage,
                    onError: d.onError,
                  }
                });
                newEdgesToAdd.push({
                  id: `edge_end_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                  source: newRefId,
                  sourceHandle: "image",
                  target: id,
                  targetHandle: "end_image",
                  animated: true,
                  style: { stroke: "#64748b", strokeWidth: 2 },
                });
              }
            } else {
              if (endEdge && endEdge.source.startsWith("node_ref_end_")) {
                edgesToRemove.push(endEdge.id);
                nodesToRemove.push(endEdge.source);
              }
            }

            // Handle characterAssets
            const existingRefEdges = edges.filter(e => e.target === id && e.targetHandle === "reference");
            const newCharAssets = s.characterAssets || [];

            existingRefEdges.forEach(edge => {
              const srcNode = nodes.find(n => n.id === edge.source);
              if (srcNode && srcNode.type === "reference") {
                const nodeName = srcNode.data.refName || "";
                const isStillActive = newCharAssets.some(c => c.name.replace(/[^a-zA-Z0-9_]/g, "") === nodeName);
                if (!isStillActive && edge.source.startsWith("node_ref_char_")) {
                  edgesToRemove.push(edge.id);
                  nodesToRemove.push(edge.source);
                }
              }
            });

            newCharAssets.forEach((char, index) => {
              const cleanName = char.name.replace(/[^a-zA-Z0-9_]/g, "");
              const isRepresented = existingRefEdges.some(edge => {
                const srcNode = nodes.find(n => n.id === edge.source);
                return srcNode && (srcNode.data.refName === cleanName || srcNode.data.image === char.url);
              });

              if (!isRepresented) {
                const newRefId = `node_ref_char_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 5)}`;
                newNodesToAdd.push({
                  id: newRefId,
                  type: "reference",
                  position: { x: basePos.x - 320, y: basePos.y + 40 + (index * 60) },
                  data: {
                    image: char.url,
                    resultUrls: [char.url],
                    refName: cleanName,
                    title: cleanName ? `@${cleanName}` : "Ảnh có sẵn",
                    onChange: d.onChange,
                    onPreview: d.onPreview,
                    onPickImage: d.onPickImage,
                    onError: d.onError,
                  }
                });
                newEdgesToAdd.push({
                  id: `edge_char_${Date.now()}_${index}_${Math.random().toString(36).substr(2, 5)}`,
                  source: newRefId,
                  sourceHandle: "image",
                  target: id,
                  targetHandle: "reference",
                  animated: true,
                  style: { stroke: "#64748b", strokeWidth: 2 },
                });
              } else {
                existingRefEdges.forEach(edge => {
                  const srcNode = nodes.find(n => n.id === edge.source);
                  if (srcNode && srcNode.data.refName === cleanName) {
                    nodeUpdates.set(srcNode.id, {
                      image: char.url,
                      resultUrls: [char.url]
                    });
                  }
                });
              }
            });

            // Apply ALL mutations in single setNodes/setEdges calls
            const removeSet = new Set(nodesToRemove);
            if (nodeUpdates.size > 0 || newNodesToAdd.length > 0 || removeSet.size > 0) {
              setNodes(nds => {
                let result = nds
                  .filter(n => !removeSet.has(n.id))
                  .map(n => {
                    const update = nodeUpdates.get(n.id);
                    if (!update) return n;
                    return { ...n, data: { ...n.data, ...update } };
                  });
                if (newNodesToAdd.length > 0) {
                  result = [...result, ...newNodesToAdd];
                }
                return result;
              });
            }
            if (edgesToRemove.length > 0 || newEdgesToAdd.length > 0) {
              setEdges(eds => eds.filter(e => !edgesToRemove.includes(e.id)).concat(newEdgesToAdd));
            }

            setShowModal(false);
            if (triggerRun) {
              setTimeout(() => {
                d.onRerun?.(id);
              }, 100);
            }
          }}
          onClose={() => setShowModal(false)}
        />
      )}

      {d.onRerun && (
        <div style={{ marginTop: 12, display: "flex", gap: 6 }}>
          <button
            type="button"
            className="wf-btn nodrag"
            style={{
              width: "100%",
              padding: "6px 12px",
              fontSize: 11,
              fontWeight: 600,
              background: d.runStatus === "running" ? "rgba(56, 189, 248, 0.15)" : "rgba(245, 158, 11, 0.15)",
              border: d.runStatus === "running" ? "1px solid rgba(56, 189, 248, 0.3)" : "1px solid rgba(245, 158, 11, 0.3)",
              color: d.runStatus === "running" ? "#38bdf8" : "#fbbf24",
              borderRadius: 8,
              cursor: d.runStatus === "running" ? "not-allowed" : "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
            disabled={d.runStatus === "running"}
            onClick={() => d.onRerun?.(id)}
          >
            {d.runStatus === "running" ? (
              <>⏳ Đang chạy...</>
            ) : d.runStatus === "completed" || d.runStatus === "failed" ? (
              <>⟳ Chạy lại node này</>
            ) : (
              <>▶ Chạy node này</>
            )}
          </button>
        </div>
      )}
    </Shell>
  );
}
