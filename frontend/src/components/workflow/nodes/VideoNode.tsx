import { useState, useMemo } from "react";
import { Handle, Position, useNodes, useEdges, useReactFlow, type NodeProps, type Node, type Edge } from "@xyflow/react";
import {
  WNodeData,
  Shell,
  handleLabelStyle,
  ImageAttachBar,
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

  const computedMode = useMemo(() => {
    const hasStartActive = fromEdge || Boolean(d.start_image) || Boolean(resolvedStartImage);
    const hasEndActive = hasEndEdge || Boolean(d.end_image) || Boolean(resolvedEndImage);
    if (hasStartActive && hasEndActive) return "start_end_image";
    if (hasStartActive) return "start_image";
    return "text_to_video";
  }, [fromEdge, d.start_image, resolvedStartImage, hasEndEdge, d.end_image, resolvedEndImage]);

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
      if (n.type === "generate" && nd?.refName && nd?.resultUrls?.[0]) {
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
      } else if (srcNode.type === "generate" && nd?.refName && nd?.resultUrls?.[0]) {
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

  const modeLabel = hasEndEdge
    ? "Ảnh đầu + khung cuối (từ node frame)"
    : hasStart
      ? "Từ ảnh → video"
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
    >
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        style={{ top: "18%", background: "#6366f1" }}
        title="Cổng nhận Prompt: Nối từ node Prompt"
      />
      <div style={handleLabelStyle("left", "18%")}>← Prompt</div>

      <Handle
        type="target"
        position={Position.Left}
        id="start_image"
        style={{ top: "38%", background: "#22c55e" }}
        title="Cổng nhận Ảnh đầu: Nối từ node Tạo ảnh hoặc cổng end_image của Tách frame"
      />
      <div style={handleLabelStyle("left", "38%")}>← Ảnh đầu</div>

      <Handle
        type="target"
        position={Position.Left}
        id="reference"
        style={{ top: "58%", background: "#06b6d4" }}
        title="Cổng nhận Nhân vật ref: Nối từ node Ảnh có sẵn để giữ nhất quán nhân vật"
      />
      <div style={handleLabelStyle("left", "58%")}>← Nhân vật ref</div>

      <Handle
        type="target"
        position={Position.Left}
        id="end_image"
        style={{ top: "78%", background: "#14b8a6" }}
        title="Cổng nhận Khung cuối: Nối từ cổng end_image của node Tách frame (Video-to-Video)"
      />
      <div style={handleLabelStyle("left", "78%")}>← Khung cuối</div>

      <Handle
        type="source"
        position={Position.Right}
        id="video"
        style={{ background: "#f59e0b" }}
        title="Cổng xuất Video kết quả: Nối sang cổng Video của node Tách frame"
      />
      <div style={handleLabelStyle("right", "50%")}>Video kết quả →</div>

      {plus && (
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
      )}

      {plus && (
        <ConfigBadges
          cameraAngle={d.cameraAngle}
          style={d.style}
          cameraMovement={d.cameraMovement}
          movementSpeed={d.movementSpeed}
          studioDuration={d.studioDuration}
        />
      )}

      <EngineModelSelector
        type="video"
        engine={d.engine}
        model={d.model}
        onChange={(patch: Partial<WNodeData>) => d.onChange?.(id, patch)}
      />

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
        <MediaPreview urls={d.resultUrls} onPreview={d.onPreview} max={2} label="Kết quả video" />
      ) : (
        <div className="node-media-empty">
          {d.runStatus === "running" || d.runStatus === "pending"
            ? "Đang tạo video…"
            : "Video kết quả gen hiện ở đây"}
        </div>
      )}

      {plus && showModal && (
        <VideoStudioModal
          initial={{
            cameraAngle: d.cameraAngle || "",
            style: d.style || "",
            cameraMovement: d.cameraMovement || "",
            movementSpeed: d.movementSpeed || "",
            duration: d.studioDuration || 8,
            timelineSegments: d.timelineSegments || [],
            mode: computedMode,
            start_image: resolvedStartImage,
            end_image: resolvedEndImage,
            characterAssets: d.characterAssets || [],
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
              timelineSegments: s.timelineSegments,
              mode: s.mode,
              start_image: s.start_image,
              end_image: s.end_image,
              characterAssets: s.characterAssets,
            });

            const newNodesToAdd: Node[] = [];
            const newEdgesToAdd: Edge[] = [];
            const edgesToRemove: string[] = [];

            const videoNode = nodes.find(n => n.id === id);
            const basePos = videoNode ? videoNode.position : { x: 0, y: 0 };

            // Handle start_image
            const startEdge = edges.find(e => e.target === id && e.targetHandle === "start_image");
            if (s.start_image) {
              if (startEdge) {
                setNodes(nds => nds.map(n => n.id === startEdge.source ? {
                  ...n,
                  data: {
                    ...n.data,
                    image: s.start_image,
                    resultUrls: [s.start_image]
                  }
                } : n));
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
                setNodes(nds => nds.filter(n => n.id !== startEdge.source));
              }
            }

            // Handle end_image
            const endEdge = edges.find(e => e.target === id && e.targetHandle === "end_image");
            if (s.end_image) {
              if (endEdge) {
                setNodes(nds => nds.map(n => n.id === endEdge.source ? {
                  ...n,
                  data: {
                    ...n.data,
                    image: s.end_image,
                    resultUrls: [s.end_image]
                  }
                } : n));
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
                setNodes(nds => nds.filter(n => n.id !== endEdge.source));
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
                  setNodes(nds => nds.filter(n => n.id !== edge.source));
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
                    setNodes(nds => nds.map(n => n.id === srcNode.id ? {
                      ...n,
                      data: {
                        ...n.data,
                        image: char.url,
                        resultUrls: [char.url]
                      }
                    } : n));
                  }
                });
              }
            });

            if (newNodesToAdd.length > 0) {
              setNodes(nds => [...nds, ...newNodesToAdd]);
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
    </Shell>
  );
}
