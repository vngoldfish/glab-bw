import type { QueueRow, VideoConfig } from "./types";

const STORAGE_KEY = "g-labs-bw:flow-video:v1";

export interface FlowVideoSnapshot {
  config: VideoConfig;
  rows: QueueRow[];
  promptInput: string;
  advancedOpen: boolean;
}

/** Persist row as-is (keep running/queued so remount can show last known status). */
function prepareRowForSave(row: QueueRow): QueueRow {
  return { ...row, savedFolder: row.savedFolder ?? null };
}

/**
 * On full reload, in-flight HTTP jobs are gone — demote busy rows to idle
 * so the user can re-run them instead of seeing a stuck "Đang tạo".
 */
function normalizeRowOnLoad(row: QueueRow): QueueRow {
  let next: QueueRow = {
    ...row,
    savedFolder: row.savedFolder ?? null,
    startFrameName: row.startFrameName ?? null,
    startFrameImage: row.startFrameImage ?? null,
    endFrameName: row.endFrameName ?? null,
    endFrameImage: row.endFrameImage ?? null,
  };
  if (next.status === "running" || next.status === "queued") {
    next = { ...next, status: "idle" as const, error: null };
  }
  if (next.status === "completed") {
    next = { ...next, selected: false };
  }
  return next;
}

function normalizeRowsOnLoad(rows: QueueRow[]): QueueRow[] {
  return rows.map(normalizeRowOnLoad);
}

function stripReferenceImages(rows: QueueRow[]): QueueRow[] {
  return rows.map((row) => ({
    ...row,
    referenceImage: null,
    referenceName: row.referenceName,
    // data URL frames are large — drop on quota fallback; library names kept
    startFrameImage: row.startFrameImage?.startsWith("data:") ? null : row.startFrameImage,
    endFrameImage: row.endFrameImage?.startsWith("data:") ? null : row.endFrameImage,
  }));
}

function migrateConfig(config: Partial<VideoConfig> | undefined): VideoConfig {
  const source = config ?? {};
  let mode = source.mode ?? "text_to_video";
  // Old separate FL mode → unified image mode (end frame optional per row)
  if (mode === "start_end_image") mode = "start_image";
  const validModes = new Set(["text_to_video", "start_image", "components"]);
  const durationRaw = Number(source.duration ?? 8);
  const duration = [4, 6, 8, 10, 12, 15].includes(durationRaw) ? durationRaw : 8;
  const engine = source.engine === "grok" ? "grok" : "flow";
  return {
    engine,
    model: String(
      source.model ?? (engine === "grok" ? "grok-3" : "veo_31_fast"),
    ),
    aspectRatio: String(source.aspectRatio ?? "16:9"),
    // Default smart mode: auto T2V / I2V / FL from row images
    mode: validModes.has(mode) ? (mode as VideoConfig["mode"]) : "start_image",
    concurrency: Number(source.concurrency ?? 1),
    saveMode: String(source.saveMode ?? "task"),
    outputFolder: String(
      source.outputFolder ??
        (engine === "grok" ? "G-Labs BW/grok_output" : "G-Labs BW/video_output"),
    ),
    resolution: Array.isArray(source.resolution) ? source.resolution : [],
    duration,
  };
}

export function loadFlowVideoSnapshot(): FlowVideoSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as FlowVideoSnapshot;
    if (!Array.isArray(data.rows) || data.rows.length === 0) return null;
    return {
      config: migrateConfig(data.config ?? {}),
      rows: normalizeRowsOnLoad(data.rows),
      promptInput: data.promptInput ?? "",
      advancedOpen: Boolean(data.advancedOpen),
    };
  } catch {
    return null;
  }
}

export function saveFlowVideoSnapshot(snapshot: FlowVideoSnapshot): void {
  const payload: FlowVideoSnapshot = {
    config: snapshot.config,
    rows: snapshot.rows.map(prepareRowForSave),
    promptInput: snapshot.promptInput,
    advancedOpen: snapshot.advancedOpen,
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return;
  } catch {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          ...payload,
          rows: stripReferenceImages(payload.rows),
        }),
      );
    } catch {
      // Bỏ qua nếu vượt quota
    }
  }
}

export function clearFlowVideoSnapshot(): void {
  localStorage.removeItem(STORAGE_KEY);
}