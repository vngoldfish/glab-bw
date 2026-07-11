import type { ImageConfig, QueueRow } from "./types";

const STORAGE_KEY = "g-labs-bw:flow-image:v1";

export interface FlowImageSnapshot {
  config: ImageConfig;
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
  }));
}

function migrateConfig(config: Partial<ImageConfig> | undefined): ImageConfig {
  const source = config ?? {};
  const engine = source.engine === "grok" ? "grok" : "flow";
  return {
    engine,
    model: String(source.model ?? (engine === "grok" ? "grok-3" : "nano_banana_2_lite")),
    aspectRatio: String(source.aspectRatio ?? "1:1"),
    concurrency: Number(source.concurrency ?? 1),
    imagesPerPrompt: Number(source.imagesPerPrompt ?? 1),
    saveMode: String(source.saveMode ?? "task"),
    outputFolder: String(source.outputFolder ?? "G-Labs BW/media_output"),
    upscale: Array.isArray(source.upscale) ? source.upscale : [],
  };
}

export function loadFlowImageSnapshot(): FlowImageSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as FlowImageSnapshot;
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

export function saveFlowImageSnapshot(snapshot: FlowImageSnapshot): void {
  const payload: FlowImageSnapshot = {
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
      // Bỏ qua nếu vượt quota — app vẫn chạy bình thường
    }
  }
}

export function clearFlowImageSnapshot(): void {
  localStorage.removeItem(STORAGE_KEY);
}