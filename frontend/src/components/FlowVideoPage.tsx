import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeFileUrl, openOutputFolder, submitBatch } from "../api";
import {
  clearFlowVideoSnapshot,
  loadFlowVideoSnapshot,
  saveFlowVideoSnapshot,
} from "../flowVideoStorage";
import { NAV_ROUTES } from "../routes";
import PromptMentionField, {
  type PromptMentionFieldHandle,
} from "./PromptMentionField";
import QueueFramePicker from "./QueueFramePicker";
import { useReferenceLibrary } from "../referenceLibraryContext";
import {
  buildNamedReferencesPayload,
  findLibraryRef,
  parseMentions,
  slugifyRefName,
  validatePromptMentions,
} from "../referenceUtils";
import {
  OMNI_FLASH_DURATIONS,
  SAVE_MODES,
  VIDEO_ASPECT_RATIOS,
  VIDEO_MODES,
  VIDEO_MODELS,
  VIDEO_RESOLUTIONS,
  type NamedReference,
  type QueueRow,
  type RowStatus,
  type VideoConfig,
  type VideoMode,
} from "../types";
import { createId, readFileAsDataUrl, runWithConcurrency } from "../utils";

const DEFAULT_CONFIG: VideoConfig = {
  model: "omni_flash",
  aspectRatio: "16:9",
  mode: "start_image", // smart: T2V / I2V / FL theo ảnh trên dòng
  concurrency: 1,
  saveMode: "task",
  outputFolder: "G-Labs BW/video_output",
  resolution: [],
  duration: 8,
};

function emptyRow(): QueueRow {
  return {
    id: createId(),
    selected: true,
    prompt: "",
    referenceImage: null,
    referenceName: null,
    startFrameName: null,
    startFrameImage: null,
    endFrameName: null,
    endFrameImage: null,
    results: [],
    status: "idle",
    error: null,
    savedFolder: null,
  };
}

/**
 * Smart mode shows frame pickers.
 * Runtime: no image → T2V, start → I2V, start+end → First & Last Frame.
 */
function isFrameMode(mode: VideoMode): boolean {
  return mode === "start_image" || mode === "start_end_image";
}

function refPayload(item: NamedReference) {
  return {
    name: item.name,
    data: item.filePath || item.image,
    label: item.label,
  };
}

function framePayload(
  name: string | null,
  image: string | null,
  library: NamedReference[],
  fallbackName: string,
): { name: string; data: string; label?: string } | null {
  // Prefer row-local image (picked from folder — NOT reference library)
  if (image) {
    return {
      name: name || fallbackName,
      data: image,
      label: name || fallbackName,
    };
  }
  if (name) {
    const lib = findLibraryRef(library, name);
    if (lib) return refPayload(lib);
  }
  return null;
}

function hasRowFrame(
  name: string | null,
  image: string | null,
  library: NamedReference[],
): boolean {
  if (image) return true;
  if (name && findLibraryRef(library, name)) return true;
  return false;
}

/** Badge on each queue row for auto-detected path. */
function rowAutoModeLabel(
  row: QueueRow,
  library: NamedReference[],
): { label: string; kind: "t2v" | "i2v" | "fl" | "r2v" } {
  const hasStart = hasRowFrame(row.startFrameName, row.startFrameImage, library);
  const hasEnd = hasRowFrame(row.endFrameName, row.endFrameImage, library);
  if (hasStart && hasEnd) return { label: "Đầu → Cuối", kind: "fl" };
  if (hasStart) return { label: "Ảnh → Video", kind: "i2v" };
  const n = parseMentions(row.prompt, library).length;
  if (n >= 1) return { label: "Ingredients @", kind: "r2v" };
  return { label: "Text → Video", kind: "t2v" };
}

/**
 * Build named_references for the API from queue-row frame picks (I2V/FL)
 * or from @mentions in prompt (Ingredients only).
 */
function buildVideoNamedRefs(
  prompt: string,
  mode: VideoMode,
  library: NamedReference[],
  row: QueueRow,
): { name: string; data: string; label?: string }[] {
  if (mode === "start_image") {
    const start = framePayload(row.startFrameName, row.startFrameImage, library, "start");
    return start ? [start] : [];
  }
  if (mode === "start_end_image") {
    const start = framePayload(row.startFrameName, row.startFrameImage, library, "start");
    const end = framePayload(row.endFrameName, row.endFrameImage, library, "end");
    const out: { name: string; data: string; label?: string }[] = [];
    if (start) out.push(start);
    if (end) out.push(end);
    return out;
  }
  return buildNamedReferencesPayload(prompt, library);
}

async function filesToLocalFrames(
  files: File[],
): Promise<{ name: string; image: string }[]> {
  const out: { name: string; image: string }[] = [];
  for (const file of files) {
    const image = await readFileAsDataUrl(file);
    const base = file.name.replace(/\.[^.]+$/, "");
    out.push({ name: slugifyRefName(base), image });
  }
  return out;
}

function confirmRerun(targetRows: QueueRow[]): boolean {
  const completedCount = targetRows.filter((r) => r.status === "completed").length;
  if (completedCount === 0) return true;
  const message =
    completedCount === 1
      ? "Prompt này đã hoàn thành. Bạn có chắc muốn chạy lại?"
      : `${completedCount} prompt đã hoàn thành. Bạn có chắc muốn chạy lại?`;
  return window.confirm(message);
}

function statusLabel(status: RowStatus): string {
  switch (status) {
    case "running":
      return "Đang tạo video...";
    case "completed":
      return "Hoàn thành";
    case "failed":
      return "Lỗi";
    case "queued":
      return "Chờ xử lý";
    default:
      return "Sẵn sàng";
  }
}

/**
 * Resolve API mode from UI selection + row images + @mentions.
 *
 * Smart mode (start_image UI):
 *   - start + end frames → start_end_image (First & Last)
 *   - start only         → start_image (I2V)
 *   - no frames + @tên   → components (Ingredients / nhân vật tham chiếu)
 *   - no frames, no @    → text_to_video
 *
 * Frame pickers win over @ when both are present.
 */
function resolveVideoRunMode(
  prompt: string,
  mode: VideoMode,
  library: NamedReference[],
  row: QueueRow,
): { mode: VideoMode; error: string | null } {
  // Smart "Ảnh → Video": auto by frames, then @character refs
  if (mode === "start_image" || mode === "start_end_image") {
    const hasStart = hasRowFrame(row.startFrameName, row.startFrameImage, library);
    const hasEnd = hasRowFrame(row.endFrameName, row.endFrameImage, library);

    if (!hasStart && hasEnd) {
      return {
        mode: "start_image",
        error: "Có Ảnh cuối nhưng chưa có Ảnh đầu — chọn Ảnh đầu, hoặc xóa Ảnh cuối",
      };
    }
    if (hasStart && hasEnd) return { mode: "start_end_image", error: null };
    if (hasStart) return { mode: "start_image", error: null };

    // No frame pickers: allow @nhân vật tham chiếu → Ingredients
    const mentionError = validatePromptMentions(prompt, library);
    if (mentionError) return { mode: "components", error: mentionError };
    const mentions = parseMentions(prompt, library);
    if (mentions.length >= 1) return { mode: "components", error: null };
    return { mode: "text_to_video", error: null };
  }

  // Ingredients + pure T2V still parse @mentions from prompt
  const mentionError = validatePromptMentions(prompt, library);
  if (mentionError) return { mode, error: mentionError };

  const mentions = parseMentions(prompt, library);
  const n = mentions.length;

  if (mode === "components") {
    if (n < 1) {
      return { mode, error: "Ingredients cần ít nhất 1 @tên trong prompt" };
    }
    return { mode: "components", error: null };
  }

  // text_to_video only: plain OK; @ auto ingredients
  if (n === 0) return { mode: "text_to_video", error: null };
  return { mode: "components", error: null };
}

function modeGuide(mode: VideoMode): {
  title: string;
  hint: string;
  steps: string[];
  example: string;
} {
  const meta = VIDEO_MODES.find((m) => m.value === mode) ??
    (mode === "start_end_image" ? VIDEO_MODES.find((m) => m.value === "start_image") : undefined);
  if (mode === "start_image" || mode === "start_end_image") {
    return {
      title: "Ảnh → Video (tự nhận loại tạo)",
      hint: meta?.hint ?? "",
      steps: [
        "Không ảnh / không @ → Text → Video",
        "Gõ @tên_nhân_vật (chip tham chiếu) → Ingredients video",
        "Ảnh đầu → I2V · Ảnh đầu+cuối → First & Last Frame (ưu tiên hơn @)",
      ],
      example: "@hoa đi dạo trên bãi biển  ·  quay đầu cinematic  ·  Drone bay lúc hoàng hôn",
    };
  }
  switch (mode) {
    case "components":
      return {
        title: "Ingredients (ảnh tham chiếu @)",
        hint: meta?.hint ?? "",
        steps: [
          "Gắn @tên nhân vật / vật thể trong prompt",
          "Tối đa 3 (Veo) hoặc 7 (Omni)",
          "Tách biệt với chế độ Ảnh → Video (cột ảnh trên bảng)",
        ],
        example: "@a và @b ngồi đối diện nói chuyện trong quán cafe",
      };
    default:
      return {
        title: "Chỉ văn bản → Video",
        hint: meta?.hint ?? "",
        steps: ["Chỉ prompt, không dùng cột ảnh", "Có @tên sẽ tự Ingredients / I2V"],
        example: "Drone bay trên bãi biển lúc hoàng hôn, sóng vỗ nhẹ",
      };
  }
}

type SortDirection = "asc" | "desc";
type QueueStatusFilter = "all" | RowStatus;

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

const STATUS_FILTER_OPTIONS: { value: QueueStatusFilter; label: string }[] = [
  { value: "all", label: "Tất cả trạng thái" },
  { value: "idle", label: "Sẵn sàng" },
  { value: "queued", label: "Chờ xử lý" },
  { value: "running", label: "Đang tạo" },
  { value: "completed", label: "Hoàn thành" },
  { value: "failed", label: "Lỗi" },
];

function sortIndicator(active: boolean, direction: SortDirection): string {
  if (!active) return "";
  return direction === "asc" ? " ↑" : " ↓";
}

function getRowActionState(row: QueueRow, batchRunning: boolean) {
  const hasPrompt = Boolean(row.prompt.trim());
  const isBusy = row.status === "running" || row.status === "queued";

  return {
    canRun: hasPrompt && !batchRunning && !isBusy && row.status === "idle",
    canRetry:
      hasPrompt && !batchRunning && !isBusy &&
      (row.status === "completed" || row.status === "failed"),
    canOpenFolder: Boolean(row.savedFolder) && !batchRunning,
    canDelete: !batchRunning && !isBusy,
  };
}

interface FlowVideoPageProps {
  activeCount: number;
  onError: (msg: string) => void;
}

export default function FlowVideoPage({ activeCount, onError }: FlowVideoPageProps) {
  const navigate = useNavigate();
  const {
    library: referenceLibrary,
    refresh: refreshLibrary,
  } = useReferenceLibrary();
  // Lazy init so each mount re-reads localStorage (not a one-time module cache)
  const [config, setConfig] = useState<VideoConfig>(() => ({
    ...DEFAULT_CONFIG,
    ...(loadFlowVideoSnapshot()?.config ?? {}),
  }));
  const [advancedOpen, setAdvancedOpen] = useState(
    () => loadFlowVideoSnapshot()?.advancedOpen ?? false,
  );
  const [promptInput, setPromptInput] = useState(
    () => loadFlowVideoSnapshot()?.promptInput ?? "",
  );
  const [rows, setRows] = useState<QueueRow[]>(
    () => loadFlowVideoSnapshot()?.rows ?? [],
  );
  const [running, setRunning] = useState(false);
  const [queueSearch, setQueueSearch] = useState("");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [queueStatusFilter, setQueueStatusFilter] = useState<QueueStatusFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);
  const bulkPromptRef = useRef<PromptMentionFieldHandle>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveFlowVideoSnapshot({ config, rows, promptInput, advancedOpen });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      // Flush immediately on unmount / dep change so tab switch never drops the latest queue
      saveFlowVideoSnapshot({ config, rows, promptInput, advancedOpen });
    };
  }, [config, rows, promptInput, advancedOpen]);

  const updateRow = useCallback((id: string, patch: Partial<QueueRow>) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next = { ...r, ...patch };
        if (next.status === "completed") {
          next.selected = false;
        }
        return next;
      }),
    );
  }, []);

  function addPromptsToQueue() {
    const lines = promptInput
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    const newRows = lines.map((prompt) => ({ ...emptyRow(), prompt }));
    setRows((prev) => [...newRows, ...prev]);
    setPromptInput("");
  }

  function handleImportTxt(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) {
        onError("File trống hoặc không có prompt hợp lệ");
        return;
      }
      setPromptInput(lines.join("\n"));
      onError("");
    };
    reader.readAsText(file);
  }

  async function runRows(targetRows: QueueRow[]) {
    const valid = targetRows.filter((r) => r.prompt.trim());
    if (valid.length === 0) {
      onError("Không có prompt nào để chạy");
      return;
    }

    setRunning(true);
    onError("");

    valid.forEach((r) =>
      updateRow(r.id, { status: "queued", error: null, results: [], savedFolder: null }),
    );

    const tasks = valid.map((row) => async () => {
      updateRow(row.id, { status: "running" });
      try {
        const prompt = row.prompt.trim();
        const resolved = resolveVideoRunMode(prompt, config.mode, referenceLibrary, row);
        if (resolved.error) {
          updateRow(row.id, { status: "failed", error: resolved.error });
          return;
        }

        // I2V/FL: refs from row frame pickers. Ingredients: @ in prompt.
        // Auto I2V from T2V+1@mention: still uses prompt mentions.
        let namedRefs = buildVideoNamedRefs(prompt, resolved.mode, referenceLibrary, row);
        if (
          config.mode === "text_to_video" &&
          resolved.mode === "start_image" &&
          namedRefs.length === 0
        ) {
          namedRefs = buildNamedReferencesPayload(prompt, referenceLibrary);
        }
        const params = {
          model: config.model,
          aspect_ratio: config.aspectRatio,
          mode: resolved.mode,
          save_mode: config.saveMode,
          output_folder: config.outputFolder,
          ...(config.model === "omni_flash" ? { duration: config.duration || 8 } : {}),
          ...(config.resolution.length > 0 ? { resolution: config.resolution } : {}),
          ...(namedRefs.length > 0 ? { named_references: namedRefs } : {}),
        };
        const result = await submitBatch(
          [{ prompt, provider: "video", params }],
          1,
        );
        const item = result.results[0];
        if (item?.status === "completed" && item.results?.length) {
          updateRow(row.id, {
            status: "completed",
            results: item.results.map(normalizeFileUrl),
            savedFolder: item.saved_folder ?? null,
          });
        } else {
          updateRow(row.id, {
            status: "failed",
            error: item?.error || item?.error_detail || "Tạo video thất bại",
          });
        }
      } catch (err) {
        updateRow(row.id, {
          status: "failed",
          error: String(err),
        });
      }
    });

    await runWithConcurrency(tasks, config.concurrency);
    setRunning(false);
  }

  function runSelected() {
    const selected = rows.filter((r) => r.selected && r.prompt.trim());
    if (selected.length === 0) {
      onError("Chọn ít nhất một dòng có prompt");
      return;
    }
    if (!confirmRerun(selected)) return;
    runRows(selected);
  }

  function runSingle(row: QueueRow) {
    if (!row.prompt.trim()) {
      onError("Dòng này chưa có prompt");
      return;
    }
    if (!confirmRerun([row])) return;
    runRows([row]);
  }

  const displayRows = useMemo(() => {
    const query = queueSearch.trim().toLowerCase();
    let list = rows.map((row, originalIndex) => ({ row, originalIndex }));

    if (query) {
      list = list.filter(({ row }) => row.prompt.toLowerCase().includes(query));
    }

    if (queueStatusFilter !== "all") {
      list = list.filter(({ row }) => row.status === queueStatusFilter);
    }

    list = [...list].sort((a, b) =>
      sortDirection === "asc"
        ? a.originalIndex - b.originalIndex
        : b.originalIndex - a.originalIndex,
    );

    return list;
  }, [rows, queueSearch, sortDirection, queueStatusFilter]);

  const totalPages = Math.max(1, Math.ceil(displayRows.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);

  const paginatedRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return displayRows.slice(start, start + pageSize);
  }, [displayRows, safePage, pageSize]);

  const pageRows = useMemo(() => paginatedRows.map((item) => item.row), [paginatedRows]);
  const allPageSelected = pageRows.length > 0 && pageRows.every((row) => row.selected);
  const somePageSelected = pageRows.some((row) => row.selected);
  const pageStart = displayRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, displayRows.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [queueSearch, queueStatusFilter, sortDirection, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  function toggleSortStt() {
    setSortDirection((dir) => (dir === "asc" ? "desc" : "asc"));
  }

  function toggleAllPage(checked: boolean) {
    const pageIds = new Set(pageRows.map((row) => row.id));
    setRows((prev) =>
      prev.map((row) => (pageIds.has(row.id) ? { ...row, selected: checked } : row)),
    );
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  function insertMentionFromLibrary(name: string) {
    bulkPromptRef.current?.saveSelection();
    bulkPromptRef.current?.insertMentionAtCursor(name);
  }

  /** Apply local/library frame to all selected queue rows (I2V/FL only — not reference library). */
  function applyFrameToSelected(
    which: "start" | "end",
    frame: { name: string | null; image: string | null },
  ) {
    const selectedIds = new Set(rows.filter((r) => r.selected).map((r) => r.id));
    if (selectedIds.size === 0) {
      onError("Chọn ít nhất một dòng trong hàng chờ để gán ảnh");
      return;
    }
    setRows((prev) =>
      prev.map((row) => {
        if (!selectedIds.has(row.id)) return row;
        if (which === "start") {
          return { ...row, startFrameName: frame.name, startFrameImage: frame.image };
        }
        return { ...row, endFrameName: frame.name, endFrameImage: frame.image };
      }),
    );
  }

  /** Read files from OS folder → attach to video row only (does NOT add to Ảnh tham chiếu). */
  async function pickLocalFrameFiles(
    files: File[],
  ): Promise<{ name: string; image: string }[]> {
    try {
      const frames = await filesToLocalFrames(files);
      if (frames.length === 0) {
        onError("Không đọc được ảnh từ thư mục");
      }
      return frames;
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }

  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [editingPromptText, setEditingPromptText] = useState("");

  /** Edit prompt on the same queue row (for re-run) — do NOT jump to bulk create box. */
  function beginEditPrompt(row: QueueRow) {
    if (row.status === "running" || row.status === "queued") return;
    setEditingPromptId(row.id);
    setEditingPromptText(row.prompt);
  }

  function saveEditPrompt(rowId: string) {
    const next = editingPromptText.trim();
    if (!next) {
      onError("Prompt không được để trống");
      return;
    }
    updateRow(rowId, {
      prompt: next,
      status: "idle",
      error: null,
      results: [],
      savedFolder: null,
      selected: true,
    });
    setEditingPromptId(null);
    setEditingPromptText("");
  }

  function cancelEditPrompt() {
    setEditingPromptId(null);
    setEditingPromptText("");
  }

  function clearAllSelections() {
    setRows((prev) => prev.map((row) => ({ ...row, selected: false })));
  }

  function clearQueueTable() {
    if (!window.confirm("Xóa toàn bộ bảng prompt? Hành động này không thể hoàn tác.")) {
      return;
    }
    setRows([]);
    clearFlowVideoSnapshot();
    saveFlowVideoSnapshot({
      config,
      rows: [],
      promptInput,
      advancedOpen,
    });
  }

  async function openSavedFolder(row: QueueRow) {
    if (!row.savedFolder) {
      onError("Không có thông tin thư mục lưu");
      return;
    }
    try {
      await openOutputFolder(row.savedFolder);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  const selectedCount = rows.filter((r) => r.selected).length;
  const completedCount = rows.filter((r) => r.status === "completed").length;
  const runningCount = rows.filter((r) => r.status === "running" || r.status === "queued").length;

  const guide = modeGuide(config.mode);
  const frameMode = isFrameMode(config.mode);
  // check + stt + actions + start + end + auto + prompt + status + result
  const tableColSpan = frameMode ? 9 : 6;

  return (
    <div className="flow-page flow-video-page">
      <header className="flow-page-top">
        <div className="flow-page-top-main">
          <h1>Flow Video</h1>
          <span className="pill pill-purple">Batch</span>
          <span className="pill pill-green">{activeCount} tài khoản</span>
        </div>
        <div className="flow-page-stats">
          <div className="flow-stat-mini flow-stat-mini--accent">
            <strong>{rows.length}</strong>
            <span>Tổng</span>
          </div>
          <div className="flow-stat-mini">
            <strong>{selectedCount}</strong>
            <span>Chọn</span>
          </div>
          <div className="flow-stat-mini">
            <strong>{runningCount}</strong>
            <span>Chạy</span>
          </div>
          <div className="flow-stat-mini">
            <strong>{completedCount}</strong>
            <span>Xong</span>
          </div>
        </div>
      </header>

      <div className="flow-body">
        <aside className="config-panel">
          <h2>Cấu hình</h2>

          <section className="config-section">
            <h3>Cấu hình cơ bản</h3>
            <label>
              Model
              <select
                value={config.model}
                onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
              >
                {VIDEO_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              {config.model === "omni_flash" && (
                <small className="field-hint">
                  Omni Flash (abra): T2V / ảnh đầu / @tham chiếu · 4–10s · cần credit Flow
                </small>
              )}
            </label>
            {config.model === "omni_flash" && (
              <label>
                Độ dài video
                <select
                  value={config.duration || 8}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, duration: Number(e.target.value) }))
                  }
                >
                  {OMNI_FLASH_DURATIONS.map((d) => (
                    <option key={d.value} value={d.value}>{d.label}</option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Tỷ lệ video
              <select
                value={config.aspectRatio}
                onChange={(e) => setConfig((c) => ({ ...c, aspectRatio: e.target.value }))}
              >
                {VIDEO_ASPECT_RATIOS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </label>
            <label>
              Chế độ tạo
              <select
                value={config.mode}
                onChange={(e) => setConfig((c) => ({ ...c, mode: e.target.value as VideoMode }))}
              >
                {VIDEO_MODES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <small className="field-hint">{guide.hint}</small>
            </label>

            <div className="video-mode-guide">
              <strong>{guide.title}</strong>
              <ol>
                {guide.steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
              <code className="video-mode-example">{guide.example}</code>
            </div>

            {frameMode && (
              <small className="field-hint video-mode-note">
                Tự nhận: <strong>@nhân_vật</strong> → Ingredients · <strong>Ảnh đầu</strong> → I2V ·{" "}
                <strong>đầu+cuối</strong> → First &amp; Last · không ảnh/@ → Text→Video. Ảnh khung
                (cột bảng) ưu tiên hơn @ nếu cùng dòng.
              </small>
            )}
            <label>
              Số luồng chạy đồng thời
              <input
                type="number"
                min={1}
                max={10}
                value={config.concurrency}
                onChange={(e) => setConfig((c) => ({ ...c, concurrency: Number(e.target.value) }))}
              />
            </label>
            <label>
              Chế độ lưu
              <select
                value={config.saveMode}
                onChange={(e) => setConfig((c) => ({ ...c, saveMode: e.target.value }))}
              >
                {SAVE_MODES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label>
              Thư mục lưu
              <input
                value={config.outputFolder}
                onChange={(e) => setConfig((c) => ({ ...c, outputFolder: e.target.value }))}
                placeholder="G-Labs BW/video_output"
              />
              <small className="field-hint">Lưu vào thư mục data/{config.outputFolder || "video_output"}</small>
            </label>
          </section>

          <button
            type="button"
            className="config-toggle"
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            Cấu hình nâng cao {advancedOpen ? "▲" : "▼"}
          </button>
          {advancedOpen && (
            <section className="config-section">
              {VIDEO_RESOLUTIONS.map((res) => (
                <label key={res.value} className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={config.resolution.includes(res.value)}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        resolution: e.target.checked
                          ? [...c.resolution.filter((r) => r !== res.value), res.value]
                          : c.resolution.filter((r) => r !== res.value),
                      }))
                    }
                  />
                  {res.label}
                </label>
              ))}
            </section>
          )}

        </aside>

        <section className="queue-panel">
          <input
            ref={importInputRef}
            type="file"
            accept=".txt,.csv"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportTxt(file);
              e.target.value = "";
            }}
          />

          <section className="flow-input-card">
            <div className="flow-input-card-head">
              <div>
                <h3 className="flow-section-title">Nhập prompt</h3>
                <p className="flow-section-desc">
                  {frameMode
                    ? "Prompt + @nhân_vật tham chiếu · hoặc Ảnh đầu/cuối trên bảng (tự nhận loại tạo)"
                    : config.mode === "components"
                      ? "Mỗi dòng một prompt · gõ @ten_anh hoặc bấm chip ảnh tham chiếu"
                      : "Mỗi dòng một prompt · nhập TXT hoặc dán hàng loạt"}
                </p>
              </div>
              <div className="flow-input-card-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => importInputRef.current?.click()}
                >
                  Nhập TXT
                </button>
                <button type="button" className="btn btn-primary btn-sm" onClick={addPromptsToQueue}>
                  + Thêm vào hàng chờ
                </button>
              </div>
            </div>

            {/* Nhân vật / ảnh tham chiếu — luôn hiện để gõ @ (Ingredients) */}
            <div className="flow-ref-strip">
              <span className="flow-ref-strip-label">
                Nhân vật tham chiếu ({referenceLibrary.length})
              </span>
              {referenceLibrary.length > 0 ? (
                <div className="flow-ref-strip-chips">
                  {referenceLibrary.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="ref-global-chip"
                      title={`Chèn @${item.name} vào prompt`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        bulkPromptRef.current?.saveSelection();
                      }}
                      onClick={() => insertMentionFromLibrary(item.name)}
                    >
                      <img src={item.image} alt={item.name} />
                      <span>@{item.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <span className="flow-ref-strip-empty">
                  Chưa có ảnh — thêm trong tab Ảnh tham chiếu rồi gõ @tên trong prompt
                </span>
              )}
              <button
                type="button"
                className="flow-ref-strip-link"
                onClick={() => navigate(NAV_ROUTES.references)}
              >
                Quản lý
              </button>
            </div>

            {frameMode && (
              <div className="flow-frame-bulk-bar">
                <span className="flow-frame-bulk-label">
                  Gán nhanh cho dòng đã chọn ({selectedCount})
                </span>
                <div className="flow-frame-bulk-pickers">
                  <QueueFramePicker
                    label="Ảnh đầu (tuỳ chọn)"
                    valueName={null}
                    previewUrl={null}
                    library={referenceLibrary}
                    disabled={selectedCount === 0}
                    onOpen={() => void refreshLibrary().catch(() => undefined)}
                    onChange={(frame) => {
                      if (frame.name || frame.image) applyFrameToSelected("start", frame);
                    }}
                    onPickFiles={async (files) => {
                      const frames = await pickLocalFrameFiles(files);
                      if (frames[0]) {
                        applyFrameToSelected("start", {
                          name: frames[0].name,
                          image: frames[0].image,
                        });
                      }
                      return frames;
                    }}
                  />
                  <QueueFramePicker
                    label="Ảnh cuối (tuỳ chọn)"
                    valueName={null}
                    previewUrl={null}
                    library={referenceLibrary}
                    disabled={selectedCount === 0}
                    onOpen={() => void refreshLibrary().catch(() => undefined)}
                    onChange={(frame) => {
                      if (frame.name || frame.image) applyFrameToSelected("end", frame);
                    }}
                    onPickFiles={async (files) => {
                      const frames = await pickLocalFrameFiles(files);
                      if (frames[0]) {
                        applyFrameToSelected("end", {
                          name: frames[0].name,
                          image: frames[0].image,
                        });
                      }
                      return frames;
                    }}
                  />
                </div>
              </div>
            )}

            <PromptMentionField
              ref={bulkPromptRef}
              rows={5}
              className="queue-bulk-prompt"
              menuPlacement="above"
              placeholder={
                frameMode
                  ? "@hoa đi dạo trên bãi biển lúc hoàng hôn\n@lieu và @hoa ngồi nói chuyện trong quán cafe\nquay đầu cinematic (không @ = Text→Video; gắn ảnh đầu/cuối trên bảng nếu cần)"
                  : config.mode === "components"
                    ? "@a và @b ngồi đối diện nói chuyện trong quán cafe"
                    : "Drone bay trên bãi biển lúc hoàng hôn\nMột con mèo chạy qua cánh đồng lúa\nThành phố tương lai với xe bay"
              }
              value={promptInput}
              library={referenceLibrary}
              onChange={setPromptInput}
            />
          </section>

          <section className="flow-queue-section">
            <div className="flow-queue-bar">
              <div className="flow-queue-bar-left">
                <h3 className="flow-section-title">Hàng chờ</h3>
                <div className="queue-table-search flow-queue-search">
                  <span className="queue-table-search-icon" aria-hidden>
                    ⌕
                  </span>
                  <input
                    type="search"
                    className="queue-table-search-input"
                    placeholder="Tìm prompt..."
                    value={queueSearch}
                    onChange={(e) => setQueueSearch(e.target.value)}
                  />
                  {queueSearch && (
                    <button
                      type="button"
                      className="queue-table-search-clear"
                      title="Xóa tìm kiếm"
                      onClick={() => setQueueSearch("")}
                    >
                      ✕
                    </button>
                  )}
                </div>
                <label className="queue-table-filter">
                  <span className="sr-only">Lọc trạng thái</span>
                  <select
                    value={queueStatusFilter}
                    onChange={(e) => setQueueStatusFilter(e.target.value as QueueStatusFilter)}
                  >
                    {STATUS_FILTER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flow-queue-bar-right">
                <label className="queue-table-filter">
                  <span className="sr-only">Số dòng mỗi trang</span>
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                  >
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <option key={size} value={size}>
                        {size}/trang
                      </option>
                    ))}
                  </select>
                </label>
                <span className="flow-queue-meta">
                  {displayRows.length === 0
                    ? "0 dòng"
                    : displayRows.length === rows.length
                      ? `${pageStart}–${pageEnd} / ${rows.length}`
                      : `${pageStart}–${pageEnd} / ${displayRows.length} (lọc)`}
                </span>
                <div className="flow-queue-actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={runSelected}
                    disabled={running || selectedCount === 0}
                  >
                    {running ? "Đang chạy..." : `▶ Chạy (${selectedCount})`}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={clearAllSelections}
                    disabled={running || selectedCount === 0}
                  >
                    Bỏ chọn
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm btn-ghost-danger"
                    onClick={clearQueueTable}
                    disabled={running || rows.length === 0}
                  >
                    Xóa bảng
                  </button>
                </div>
              </div>
            </div>

            <div className="queue-table-wrap">
              <table className="queue-table">
                <thead>
                  <tr>
                    <th className="col-check" title="Chọn các dòng trên trang này">
                      <input
                        type="checkbox"
                        aria-label="Chọn các dòng trên trang này"
                        checked={allPageSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = somePageSelected && !allPageSelected;
                        }}
                        onChange={(e) => toggleAllPage(e.target.checked)}
                      />
                    </th>
                    <th className="col-stt">
                      <button
                        type="button"
                        className="queue-th-sort queue-th-sort--active"
                        onClick={toggleSortStt}
                        title="Bấm để đổi thứ tự STT"
                      >
                        STT{sortIndicator(true, sortDirection)}
                      </button>
                    </th>
                    <th className="col-control">Thao tác</th>
                    {frameMode && (
                      <>
                        <th className="col-frame">Ảnh đầu</th>
                        <th className="col-frame">Ảnh cuối</th>
                        <th className="col-auto-mode">Loại</th>
                      </>
                    )}
                    <th className="col-prompt">Prompt</th>
                    <th className="col-status">Tiến độ</th>
                    <th className="col-result">Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {displayRows.length === 0 ? (
                    <tr>
                      <td colSpan={tableColSpan} className="queue-table-empty">
                        {rows.length === 0 ? (
                          <div className="queue-table-empty-inner">
                            <p>Chưa có prompt trong hàng chờ</p>
                            <span className="queue-table-empty-hint">
                              Nhập prompt ở ô phía trên rồi bấm <strong>Thêm vào hàng chờ</strong>
                              {frameMode && (
                                <>
                                  {" "}
                                  — có thể chọn <strong>Ảnh đầu</strong> /{" "}
                                  <strong>Ảnh cuối</strong> (tuỳ chọn)
                                </>
                              )}
                            </span>
                          </div>
                        ) : (
                          "Không tìm thấy prompt phù hợp — thử đổi từ khóa hoặc bộ lọc"
                        )}
                      </td>
                    </tr>
                  ) : (
                    paginatedRows.map(({ row, originalIndex }, index) => {
                      const actions = getRowActionState(row, running);
                      const frameDisabled =
                        running && (row.status === "running" || row.status === "queued");
                      return (
                        <tr
                          key={row.id}
                          className={[
                            `queue-row--${row.status}`,
                            row.selected ? "queue-row--selected" : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                      <td className="col-check">
                        <input
                          type="checkbox"
                          checked={row.selected}
                          onChange={(e) => updateRow(row.id, { selected: e.target.checked })}
                        />
                      </td>
                      <td className="col-stt" title={`Thứ tự gốc: ${originalIndex + 1}`}>
                        {pageStart + index}
                      </td>
                      <td className="col-control">
                        <div className="row-action-toolbar" role="group" aria-label="Thao tác dòng">
                            <button
                              type="button"
                              className="row-action-btn row-action-btn--run"
                              aria-label="Chạy dòng này"
                              title={
                                actions.canRun
                                  ? "Chạy dòng này"
                                  : "Chỉ chạy khi dòng sẵn sàng và có prompt"
                              }
                              onClick={() => runSingle(row)}
                              disabled={!actions.canRun}
                            >
                              ▶
                            </button>
                            <button
                              type="button"
                              className="row-action-btn row-action-btn--retry"
                              aria-label="Chạy lại"
                              title={
                                actions.canRetry
                                  ? "Chạy lại"
                                  : "Chỉ chạy lại khi đã hoàn thành hoặc lỗi"
                              }
                              onClick={() => runSingle(row)}
                              disabled={!actions.canRetry}
                            >
                              ↻
                            </button>
                            <button
                              type="button"
                              className="row-action-btn row-action-btn--folder"
                              aria-label="Mở thư mục lưu"
                              title={
                                actions.canOpenFolder
                                  ? `Mở thư mục: ${row.savedFolder}`
                                  : "Chưa có thư mục lưu"
                              }
                              onClick={() => openSavedFolder(row)}
                              disabled={!actions.canOpenFolder}
                            >
                              ▣
                            </button>
                            <button
                              type="button"
                              className="row-action-btn row-action-btn--delete"
                              aria-label="Xóa dòng này"
                              title={
                                actions.canDelete
                                  ? "Xóa dòng này"
                                  : "Không xóa được khi đang chạy"
                              }
                              onClick={() => removeRow(row.id)}
                              disabled={!actions.canDelete}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                <path
                                  fill="currentColor"
                                  d="M9 3h6a1 1 0 0 1 1 1v1h4a1 1 0 1 1 0 2h-1.05l-1.02 12.04A3 3 0 0 1 14.94 23H9.06a3 3 0 0 1-2.99-2.96L5.05 7H4a1 1 0 1 1 0-2h4V4a1 1 0 0 1 1-1Zm1 2h4V5h-4V5Zm-1.89 2 1 12h7.78l1-12H8.11ZM10 10a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm4 0a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Z"
                                />
                              </svg>
                            </button>
                        </div>
                      </td>
                      {frameMode && (
                        <td className="col-frame">
                          <QueueFramePicker
                            label="Ảnh đầu (tuỳ chọn)"
                            valueName={row.startFrameName}
                            previewUrl={
                              row.startFrameImage ||
                              (row.startFrameName
                                ? findLibraryRef(referenceLibrary, row.startFrameName)?.image ?? null
                                : null)
                            }
                            library={referenceLibrary}
                            disabled={frameDisabled}
                            onOpen={() => void refreshLibrary().catch(() => undefined)}
                            onChange={(frame) =>
                              updateRow(row.id, {
                                startFrameName: frame.name,
                                startFrameImage: frame.image,
                              })
                            }
                            onPickFiles={async (files) => {
                              const frames = await pickLocalFrameFiles(files);
                              if (frames[0]) {
                                updateRow(row.id, {
                                  startFrameName: frames[0].name,
                                  startFrameImage: frames[0].image,
                                });
                              }
                              return frames;
                            }}
                          />
                        </td>
                      )}
                      {frameMode && (
                        <td className="col-frame">
                          <QueueFramePicker
                            label="Ảnh cuối (tuỳ chọn)"
                            valueName={row.endFrameName}
                            previewUrl={
                              row.endFrameImage ||
                              (row.endFrameName
                                ? findLibraryRef(referenceLibrary, row.endFrameName)?.image ?? null
                                : null)
                            }
                            library={referenceLibrary}
                            disabled={frameDisabled}
                            onOpen={() => void refreshLibrary().catch(() => undefined)}
                            onChange={(frame) =>
                              updateRow(row.id, {
                                endFrameName: frame.name,
                                endFrameImage: frame.image,
                              })
                            }
                            onPickFiles={async (files) => {
                              const frames = await pickLocalFrameFiles(files);
                              if (frames[0]) {
                                updateRow(row.id, {
                                  endFrameName: frames[0].name,
                                  endFrameImage: frames[0].image,
                                });
                              }
                              return frames;
                            }}
                          />
                        </td>
                      )}
                      {frameMode && (
                        <td className="col-auto-mode">
                          {(() => {
                            const auto = rowAutoModeLabel(row, referenceLibrary);
                            return (
                              <span className={`queue-frame-mode-tag is-${auto.kind}`}>
                                {auto.label}
                              </span>
                            );
                          })()}
                        </td>
                      )}
                      <td className="col-prompt">
                        {editingPromptId === row.id ? (
                          <div className="queue-prompt-box queue-prompt-box--editing">
                            <textarea
                              className="queue-prompt-inline-input"
                              value={editingPromptText}
                              rows={3}
                              autoFocus
                              onChange={(e) => setEditingPromptText(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelEditPrompt();
                                }
                                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                  e.preventDefault();
                                  saveEditPrompt(row.id);
                                }
                              }}
                            />
                            <div className="queue-prompt-edit-actions">
                              <button
                                type="button"
                                className="btn btn-primary btn-sm"
                                onClick={() => saveEditPrompt(row.id)}
                              >
                                Lưu
                              </button>
                              <button
                                type="button"
                                className="btn btn-ghost btn-sm"
                                onClick={cancelEditPrompt}
                              >
                                Hủy
                              </button>
                              <span className="queue-prompt-edit-hint">Ctrl+Enter lưu · Esc hủy</span>
                            </div>
                          </div>
                        ) : (
                          <div className="queue-prompt-box">
                            <p
                              className="queue-prompt-text"
                              title={`${row.prompt || ""}\n\nDouble-click hoặc bấm ✎ để sửa trên dòng này`}
                              onDoubleClick={() => beginEditPrompt(row)}
                            >
                              {row.prompt || "—"}
                            </p>
                            <button
                              type="button"
                              className="queue-prompt-edit-btn"
                              aria-label="Sửa prompt"
                              title="Sửa prompt trên dòng này rồi chạy lại"
                              onClick={() => beginEditPrompt(row)}
                              disabled={row.status === "running" || row.status === "queued"}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                <path
                                  fill="currentColor"
                                  d="M4 17.25V20h2.75L17.81 8.94l-2.75-2.75L4 17.25Zm14.71-9.04a1 1 0 0 0 0-1.41l-1.5-1.5a1 1 0 0 0-1.41 0l-1.13 1.13 2.75 2.75 1.29-1.47Z"
                                />
                              </svg>
                            </button>
                          </div>
                        )}
                      </td>
                      <td className="col-status">
                        <div className="status-cell">
                          <span className={`status-badge status-badge--row status-${row.status}`}>
                            {statusLabel(row.status)}
                          </span>
                          {row.error && (
                            <span className="result-error-tag" title={row.error}>
                              {row.error}
                            </span>
                          )}
                          {row.status === "completed" && row.savedFolder && (
                            <span className="result-folder-hint" title={row.savedFolder}>
                              data/{row.savedFolder}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="col-result">
                        <div className="result-cell">
                          {row.results.length > 0 ? (
                            <div className="result-grid">
                              {row.results.map((url) => (
                                <a
                                  key={url}
                                  className="result-frame result-frame--video"
                                  href={url}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Mở video"
                                >
                                  <video
                                    src={url}
                                    className="result-video"
                                    muted
                                    playsInline
                                    preload="metadata"
                                    onMouseEnter={(e) => {
                                      void e.currentTarget.play().catch(() => undefined);
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.pause();
                                      e.currentTarget.currentTime = 0;
                                    }}
                                  />
                                </a>
                              ))}
                            </div>
                          ) : (
                            <span className="result-empty">
                              {row.status === "running" ? "Đang render video..." : "—"}
                            </span>
                          )}
                        </div>
                      </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {displayRows.length > 0 && totalPages > 1 && (
              <div className="flow-queue-footer">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={safePage <= 1}
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                >
                  ‹ Trước
                </button>
                <span className="flow-queue-page">
                  Trang {safePage} / {totalPages}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={safePage >= totalPages}
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                >
                  Sau ›
                </button>
              </div>
            )}
          </section>
        </section>
      </div>
    </div>
  );
}