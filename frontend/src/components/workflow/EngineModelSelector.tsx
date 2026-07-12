import type { CSSProperties } from "react";
import {
  IMAGE_MODELS,
  GROK_IMAGE_MODELS,
  META_IMAGE_MODELS,
  VIDEO_MODELS,
  GROK_VIDEO_MODELS,
  META_VIDEO_MODELS,
} from "../../types";

const selectStyle: CSSProperties = {
  width: "100%",
  background: "rgba(0,0,0,0.35)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  color: "inherit",
  padding: 6,
  marginTop: 2,
};

const IMAGE_DEFAULTS: Record<string, string> = {
  flow: "nano_banana_2_lite",
  grok: "grok-3",
  meta: "midjen-base",
};

const VIDEO_DEFAULTS: Record<string, string> = {
  flow: "veo_31_fast",
  grok: "grok-3",
  meta: "meta-video",
};

interface EngineModelSelectorProps {
  type: "image" | "video";
  engine?: string;
  model?: string;
  aspect_ratio?: string;
  onChange: (patch: Record<string, any>) => void;
}

/**
 * Shared Engine + Model + Aspect Ratio selector.
 * Eliminates 4× copy-paste (~240 lines) across Generate/Video nodes.
 */
export default function EngineModelSelector({
  type,
  engine = "flow",
  model,
  aspect_ratio,
  onChange,
}: EngineModelSelectorProps) {
  const defaults = type === "image" ? IMAGE_DEFAULTS : VIDEO_DEFAULTS;
  const currentModel = model || defaults[engine] || defaults.flow;

  const modelLists = type === "image"
    ? { flow: IMAGE_MODELS, grok: GROK_IMAGE_MODELS, meta: META_IMAGE_MODELS }
    : { flow: VIDEO_MODELS, grok: GROK_VIDEO_MODELS, meta: META_VIDEO_MODELS };

  const models = modelLists[engine as keyof typeof modelLists] || modelLists.flow;

  return (
    <>
      <label className="nodrag" style={{ display: "block", marginBottom: 6 }}>
        Công cụ
        <select
          value={engine}
          onChange={(e) => {
            const nextEngine = e.target.value;
            onChange({ engine: nextEngine, model: defaults[nextEngine] || defaults.flow });
          }}
          style={selectStyle}
        >
          <option value="flow">Google Flow</option>
          <option value="grok">Grok Imagine</option>
          <option value="meta">Meta AI</option>
        </select>
      </label>
      <label className="nodrag" style={{ display: "block", marginBottom: 6 }}>
        Model
        <select
          value={currentModel}
          onChange={(e) => onChange({ model: e.target.value })}
          style={selectStyle}
        >
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </label>
      {type === "image" && (
        <label className="nodrag" style={{ display: "block", marginBottom: 6 }}>
          Tỷ lệ
          <select
            value={aspect_ratio || "16:9"}
            onChange={(e) => onChange({ aspect_ratio: e.target.value })}
            style={selectStyle}
          >
            <option value="1:1">1:1</option>
            <option value="16:9">16:9</option>
            <option value="9:16">9:16</option>
          </select>
        </label>
      )}
    </>
  );
}
