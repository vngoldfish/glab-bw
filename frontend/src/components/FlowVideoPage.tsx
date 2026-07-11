import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  extractFramesFromPath,
  extractFramesUpload,
  fileAsDataUrl,
  normalizeFileUrl,
  openOutputFolder,
  parsePromptCsv,
  rewritePromptAi,
  rewritePromptsAi,
  submitBatch,
} from "../api";
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
  parseMentions,
  slugifyRefName,
  validatePromptMentions,
} from "../referenceUtils";
import { useUiDialog } from "./UiDialog";
import {
  META_VIDEO_MODELS,
  GROK_VIDEO_MODELS,
  MEDIA_ENGINES,
  OMNI_FLASH_DURATIONS,
  SAVE_MODES,
  VIDEO_ASPECT_RATIOS,
  VIDEO_MODES,
  VIDEO_MODELS,
  VIDEO_RESOLUTIONS,
  type MediaEngine,
  type NamedReference,
  type QueueRow,
  type RowStatus,
  type VideoConfig,
  type VideoMode,
} from "../types";
import { createId, readFileAsDataUrl, runWithConcurrency } from "../utils";
import MediaHistoryPanel from "./MediaHistoryPanel";

const DEFAULT_CONFIG: VideoConfig = {
  engine: "flow",
  model: "omni_flash",
  aspectRatio: "16:9",
  mode: "start_image", // smart: T2V / I2V / FL theo ảnh trên dòng
  concurrency: 1,
  saveMode: "task",
  outputFolder: "G-Labs BW/video_output",
  resolution: [],
  duration: 8,
};

function videoModelsForEngine(engine: MediaEngine) {
  return engine === "grok" ? GROK_VIDEO_MODELS : engine === "meta" ? META_VIDEO_MODELS : VIDEO_MODELS;
}

function defaultVideoModel(engine: MediaEngine): string {
  return engine === "grok" ? GROK_VIDEO_MODELS[0].value : engine === "meta" ? META_VIDEO_MODELS[0].value : VIDEO_MODELS[0].value;
}

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

/** Frame payload from row-local data only (never reference library). */
function framePayload(
  name: string | null,
  image: string | null,
  fallbackName: string,
): { name: string; data: string; label?: string } | null {
  if (!image) return null;
  return {
    name: name || fallbackName,
    data: image,
    label: name || fallbackName,
  };
}

/** Ảnh đầu/cuối chỉ tính khi có data URL gắn trên dòng prompt. */
function hasRowFrame(image: string | null | undefined): boolean {
  return Boolean(image && image.length > 20);
}

/** Badge on each queue row for auto-detected path. */
function rowAutoModeLabel(
  row: QueueRow,
  library: NamedReference[],
): { label: string; kind: "t2v" | "i2v" | "fl" | "r2v" } {
  const hasStart = hasRowFrame(row.startFrameImage);
  const hasEnd = hasRowFrame(row.endFrameImage);
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
    const start = framePayload(row.startFrameName, row.startFrameImage, "start");
    return start ? [start] : [];
  }
  if (mode === "start_end_image") {
    const start = framePayload(row.startFrameName, row.startFrameImage, "start");
    const end = framePayload(row.endFrameName, row.endFrameImage, "end");
    const out: { name: string; data: string; label?: string }[] = [];
    if (start) out.push(start);
    if (end) out.push(end);
    return out;
  }
  // Ingredients only: @mentions → thư viện tham chiếu
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

async function confirmRerun(
  dialog: { confirm: (opts: { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; tone?: "danger" | "default" }) => Promise<boolean> },
  targetRows: QueueRow[],
): Promise<boolean> {
  const completedCount = targetRows.filter((r) => r.status === "completed").length;
  if (completedCount === 0) return true;
  const message =
    completedCount === 1
      ? "Prompt này đã hoàn thành. Bạn có chắc muốn chạy lại?"
      : `${completedCount} prompt đã hoàn thành. Bạn có chắc muốn chạy lại?`;
  return dialog.confirm({
    title: "Chạy lại?",
    message,
    confirmLabel: "Chạy lại",
    cancelLabel: "Hủy",
  });
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
  // Smart "Ảnh → Video": auto by per-prompt frames, then @character refs
  if (mode === "start_image" || mode === "start_end_image") {
    const hasStart = hasRowFrame(row.startFrameImage);
    const hasEnd = hasRowFrame(row.endFrameImage);

    if (!hasStart && hasEnd) {
      return {
        mode: "start_image",
        error: "Có Ảnh cuối nhưng chưa có Ảnh đầu — chọn Ảnh đầu, hoặc xóa Ảnh cuối",
      };
    }
    if (hasStart && hasEnd) return { mode: "start_end_image", error: null };
    if (hasStart) return { mode: "start_image", error: null };

    // No per-prompt frames: @nhân vật từ thư viện → Ingredients
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
        "Gõ @tên (chip Nhân vật tham chiếu) → Ingredients — ảnh trong thư viện, dùng lại được",
        "Ảnh đầu/cuối trên dòng: chọn từ máy, chỉ cho prompt đó (không vào thư viện)",
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
  const dialog = useUiDialog();
  const navigate = useNavigate();
  const { library: referenceLibrary } = useReferenceLibrary();
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

  const [continueModal, setContinueModal] = useState<{
    open: boolean;
    videoUrl: string;
    promptText: string;
  } | null>(null);

  const [modalSubmitting, setModalSubmitting] = useState(false);
  const [customActionVal, setCustomActionVal] = useState("");

  const handleContinueVideo = (videoUrl: string, originalPrompt: string) => {
    setContinueModal({
      open: true,
      videoUrl,
      promptText: originalPrompt,
    });
  };

  const submitContinueVideo = async (actionText: string, useAi: boolean) => {
    if (!continueModal) return;
    const { videoUrl, promptText } = continueModal;

    let finalPrompt = promptText;
    const trimmedAction = actionText.trim();

    if (useAi) {
      setModalSubmitting(true);
      try {
        if (trimmedAction) {
          try {
            const response = await rewritePromptAi({
              prompt: `Prompt gốc: "${promptText}"\nDiễn biến cảnh tiếp theo: "${trimmedAction}"`,
              kind: "video",
              locale: "vi",
            });
            if (response && response.prompt) {
              finalPrompt = response.prompt;
            } else {
              finalPrompt = `${promptText}, ${trimmedAction}`;
            }
          } catch {
            finalPrompt = `${promptText}, ${trimmedAction}`;
          }
        } else {
          // AI automatic suggestion
          try {
            const response = await rewritePromptAi({
              prompt: `Prompt gốc: "${promptText}"\nViết tiếp cảnh tiếp theo (storyboard next scene)`,
              kind: "video",
              locale: "vi",
            });
            if (response && response.prompt) {
              finalPrompt = response.prompt;
            }
          } catch {
            // fallback to original
          }
        }
      } finally {
        setContinueModal(null);
        setModalSubmitting(false);
      }
    } else {
      // Gắn trực tiếp không dùng AI (Chạy ngay lập tức 0ms)
      if (trimmedAction) {
        finalPrompt = `${promptText}, ${trimmedAction}`;
      }
      setContinueModal(null);
    }

    const newId = createId();
    const newRow: QueueRow = {
      id: newId,
      selected: true,
      prompt: finalPrompt,
      referenceImage: null,
      referenceName: null,
      startFrameName: "Đang trích xuất frame...",
      startFrameImage: "loading",
      endFrameName: null,
      endFrameImage: null,
      results: [],
      status: "idle",
      error: null,
      savedFolder: null,
    };

    // Thêm dòng mới lên đầu bảng hàng chờ
    setRows((prev) => [newRow, ...prev]);

    try {
      // Gọi API trích xuất khung hình cuối (end)
      const frames = await extractFramesFromPath(videoUrl, ["end"]);
      const endFrame = frames.find((f) => f.position === "end") || frames[0];
      if (endFrame && endFrame.url) {
        const updatedRow: QueueRow = {
          ...newRow,
          startFrameName: "frame_cuoi.png",
          startFrameImage: endFrame.url,
        };
        setRows((prev) =>
          prev.map((r) => (r.id === newId ? updatedRow : r))
        );
      } else {
        throw new Error("Không lấy được khung hình cuối");
      }
    } catch (err) {
      setRows((prev) =>
        prev.map((r) =>
          r.id === newId
            ? {
                ...r,
                startFrameName: null,
                startFrameImage: null,
                error: "Lỗi trích xuất frame cuối: " + (err instanceof Error ? err.message : String(err)),
              }
            : r
        )
      );
    }
  };




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
        const isGrok = config.engine === "grok";
        const isMeta = config.engine === "meta";
        // Grok/Meta: map Flow modes → t2v / i2v
        const extraMode =
          resolved.mode === "text_to_video" || namedRefs.length === 0 ? "t2v" : "i2v";
        const params = {
          model: config.model,
          aspect_ratio: config.aspectRatio,
          mode: (isGrok || isMeta) ? extraMode : resolved.mode,
          save_mode: config.saveMode,
          output_folder: isGrok
            ? config.outputFolder.replace("video_output", "grok_output") ||
              "G-Labs BW/grok_output"
            : isMeta
            ? config.outputFolder.replace("video_output", "meta_output") ||
              "G-Labs BW/meta_output"
            : config.outputFolder,
          ...((config.model === "omni_flash" || isGrok || isMeta)
            ? { duration: config.duration || 8, video_length: config.duration || 8 }
            : {}),
          ...(config.resolution.length > 0 ? { resolution: config.resolution } : {}),
          ...(namedRefs.length > 0 ? { named_references: namedRefs } : {}),
        };
        const result = await submitBatch(
          [{ prompt, provider: isGrok ? "grok" : isMeta ? "meta" : "video", params }],
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
      } finally {
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    });

    await runWithConcurrency(tasks, config.concurrency);
    setRunning(false);
  }

  async function runSelected() {
    const selected = rows.filter((r) => r.selected && r.prompt.trim());
    if (selected.length === 0) {
      onError("Chọn ít nhất một dòng có prompt");
      return;
    }
    if (!(await confirmRerun(dialog, selected))) return;
    void runRows(selected);
  }

  function importCsvFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const prompts = parsePromptCsv(String(reader.result || ""));
        if (prompts.length === 0) {
          onError("File không có prompt");
          return;
        }
        setRows((prev) => {
          const next = [...prev];
          let i = 0;
          for (const p of prompts) {
            while (i < next.length && next[i].prompt.trim()) i += 1;
            if (i < next.length) {
              next[i] = { ...next[i], prompt: p, selected: true };
              i += 1;
            } else {
              next.push({ ...emptyRow(), prompt: p, selected: true });
            }
          }
          return next;
        });
      } catch (e) {
        onError(e instanceof Error ? e.message : String(e));
      }
    };
    reader.readAsText(file);
  }

  async function extractFramesForRow(row: QueueRow) {
    const videoUrl = row.results.find((u) => /\.mp4($|\?)/i.test(u) || u.includes("video"));
    if (!videoUrl) {
      onError("Dòng này chưa có video kết quả để tách frame");
      return;
    }
    try {
      updateRow(row.id, { status: "running", error: null });
      const frames = await extractFramesFromPath(videoUrl, ["start", "middle", "end"]);
      if (!frames.length) throw new Error("Không tách được frame");
      const startPath = frames.find((f) => f.position === "start") || frames[0];
      const endPath = frames.find((f) => f.position === "end") || frames[frames.length - 1];
      const startData = await fileAsDataUrl(startPath.path);
      const endData = await fileAsDataUrl(endPath.path);
      updateRow(row.id, {
        status: "completed",
        startFrameImage: startData,
        startFrameName: `frame_${startPath.position}`,
        endFrameImage: endData,
        endFrameName: `frame_${endPath.position}`,
        error: null,
      });
    } catch (e) {
      updateRow(row.id, {
        status: "failed",
        error: e instanceof Error ? e.message : String(e),
      });
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function extractFramesFromUpload(file: File) {
    try {
      const frames = await extractFramesUpload(file);
      if (!frames.length) throw new Error("Không tách được frame");
      const start = frames.find((f) => f.position === "start") || frames[0];
      const end = frames.find((f) => f.position === "end") || frames[frames.length - 1];
      const startData = await fileAsDataUrl(start.path);
      const endData = await fileAsDataUrl(end.path);
      // apply to first selected empty-ish row or add new
      setRows((prev) => {
        const next = [...prev];
        const idx = next.findIndex((r) => r.selected);
        const target = idx >= 0 ? idx : 0;
        if (!next[target]) next.push(emptyRow());
        const i = idx >= 0 ? idx : next.length - 1;
        next[i] = {
          ...next[i],
          startFrameImage: startData,
          startFrameName: `upload_${start.position}`,
          endFrameImage: endData,
          endFrameName: `upload_${end.position}`,
          selected: true,
        };
        return next;
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  }

  async function runSingle(row: QueueRow) {
    if (!row.prompt.trim()) {
      onError("Dòng này chưa có prompt");
      return;
    }
    if (!(await confirmRerun(dialog, [row]))) return;
    void runRows([row]);
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
  const [aiBusyId, setAiBusyId] = useState<string | null>(null);
  const [aiBulkBusy, setAiBulkBusy] = useState(false);
  const [aiNotice, setAiNotice] = useState<{ type: "ok" | "err"; text: string } | null>(null);

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

  /**
   * AI polish prompt — apply to row + open popup so user always sees the new text.
   */
  async function aiRewriteRow(
    row: QueueRow,
    opts?: { source?: string },
  ) {
    const source = (opts?.source ?? (editingPromptId === row.id ? editingPromptText : row.prompt)).trim();
    if (!source || row.status === "running" || row.status === "queued") return;
    setAiBusyId(row.id);
    setAiNotice({ type: "ok", text: "AI đang phân tích prompt…" });
    onError("");
    try {
      const res = await rewritePromptAi({ prompt: source, kind: "video", locale: "vi" });
      const next = (res.prompt || "").trim();
      if (!next) {
        const msg = "AI trả về prompt rỗng — kiểm tra Model/Base URL trong Cài đặt → API AI";
        setAiNotice({ type: "err", text: msg });
        onError(msg);
        return;
      }
      updateRow(row.id, {
        prompt: next,
        status: "idle",
        error: null,
        results: [],
        savedFolder: null,
        selected: true,
      });
      // Always open popup so user sees full rewritten prompt (truncated line looks similar)
      setEditingPromptId(row.id);
      setEditingPromptText(next);
      if (next === source) {
        setAiNotice({
          type: "err",
          text: "AI trả về gần như giống prompt cũ — thử model khác trong Cài đặt",
        });
      } else {
        setAiNotice({ type: "ok", text: "Đã cập nhật prompt bằng AI — kiểm tra trong popup rồi bấm Lưu nếu muốn chỉnh thêm" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiNotice({ type: "err", text: msg });
      onError(msg);
    } finally {
      setAiBusyId(null);
    }
  }

  async function aiRewriteSelected() {
    const targets = rows.filter(
      (r) => r.selected && r.prompt.trim() && r.status !== "running" && r.status !== "queued",
    );
    if (targets.length === 0) {
      onError("Chọn ít nhất một dòng có prompt (không đang chạy) để AI sửa");
      return;
    }
    setAiBulkBusy(true);
    setAiNotice({ type: "ok", text: `AI đang sửa ${targets.length} prompt…` });
    onError("");
    try {
      const res = await rewritePromptsAi({
        prompts: targets.map((r) => r.prompt.trim()),
        kind: "video",
        locale: "vi",
      });
      const byId = new Map(targets.map((r, i) => [r.id, res.results[i]]));
      setRows((prev) =>
        prev.map((row) => {
          const item = byId.get(row.id);
          if (!item || item.status !== "ok") return row;
          return {
            ...row,
            prompt: item.prompt,
            status: "idle" as const,
            error: null,
            results: [],
            savedFolder: null,
            selected: true,
          };
        }),
      );
      if (res.failed > 0) {
        const msg = `AI xong ${res.ok}/${res.total}; ${res.failed} lỗi — xem Cài đặt → API AI`;
        setAiNotice({ type: "err", text: msg });
        onError(msg);
      } else {
        setAiNotice({ type: "ok", text: `Đã AI sửa ${res.ok} prompt — double-click dòng để xem đầy đủ` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAiNotice({ type: "err", text: msg });
      onError(msg);
    } finally {
      setAiBulkBusy(false);
    }
  }

  function clearAllSelections() {
    setRows((prev) => prev.map((row) => ({ ...row, selected: false })));
  }

  async function clearQueueTable() {
    const ok = await dialog.confirm({
      title: "Xóa toàn bộ bảng?",
      message: "Toàn bộ prompt trong bảng sẽ bị xóa. Hành động này không thể hoàn tác.",
      confirmLabel: "Xóa hết",
      cancelLabel: "Hủy",
      tone: "danger",
    });
    if (!ok) return;
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
          <h1>{config.engine === "grok" ? "Grok Video" : config.engine === "meta" ? "Meta Video" : "Flow Video"}</h1>
          <span className="pill pill-purple">
            {config.engine === "grok" ? "Grok · Auth Helper" : config.engine === "meta" ? "Meta AI · Vibes" : "Google Flow"}
          </span>
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
              Engine
              <select
                value={config.engine || "flow"}
                onChange={(e) => {
                  const engine = e.target.value as MediaEngine;
                  setConfig((c) => ({
                    ...c,
                    engine,
                    model: defaultVideoModel(engine),
                    mode: (engine === "grok" || engine === "meta") ? "text_to_video" : c.mode,
                    outputFolder:
                      engine === "grok"
                        ? "G-Labs BW/grok_output"
                        : engine === "meta"
                        ? "G-Labs BW/meta_output"
                        : "G-Labs BW/video_output",
                  }));
                }}
              >
                {MEDIA_ENGINES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <small className="field-hint">
                {(MEDIA_ENGINES.find((m) => m.value === (config.engine || "flow")) || MEDIA_ENGINES[0]).hint}
              </small>
            </label>
            <label>
              Model
              <select
                value={config.model}
                onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
              >
                {videoModelsForEngine(config.engine || "flow").map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              {config.model === "omni_flash" && config.engine !== "grok" && (
                <small className="field-hint">
                  Omni Flash (abra): T2V / ảnh đầu / @tham chiếu · 4–10s · cần credit Flow
                </small>
              )}
              {config.engine === "grok" && (
                <small className="field-hint">
                  Grok Imagine video: tab /imagine + Auth Helper. T2V (text); duration 6/10/15s · 480p/720p.
                </small>
              )}
            </label>
            {(config.model === "omni_flash" || config.engine === "grok") && (
              <label>
                Độ dài video
                <select
                  value={config.duration || 8}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, duration: Number(e.target.value) }))
                  }
                >
                  {(config.engine === "grok"
                    ? [4, 6, 8, 10, 12, 15].map((v) => ({ value: v, label: `${v} giây` }))
                    : OMNI_FLASH_DURATIONS
                  ).map((d) => (
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
                <strong>@nhân_vật</strong> = thư viện tham chiếu (dùng lại).{" "}
                <strong>Ảnh đầu/cuối</strong> = chỉ gắn 1 prompt (chọn từ máy, không vào thư viện).
                Tự nhận: @ → Ingredients · đầu → I2V · đầu+cuối → First&amp;Last · không → Text→Video.
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
                    disabled={selectedCount === 0}
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
                    disabled={selectedCount === 0}
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
            {aiNotice && (
              <div className={`ai-notice ai-notice--${aiNotice.type}`} role="status">
                <span>{aiNotice.text}</span>
                <button type="button" onClick={() => setAiNotice(null)} aria-label="Đóng">
                  ✕
                </button>
              </div>
            )}
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
                  <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", margin: 0 }}>
                    Import CSV
                    <input
                      type="file"
                      accept=".csv,.tsv,.txt,text/csv,text/plain"
                      hidden
                      disabled={running}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) importCsvFile(f);
                      }}
                    />
                  </label>
                  <label className="btn btn-ghost btn-sm" style={{ cursor: "pointer", margin: 0 }} title="Upload video → tách frame đầu/cuối gán dòng">
                    Tách frame
                    <input
                      type="file"
                      accept="video/mp4,video/*,.mp4"
                      hidden
                      disabled={running}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        if (f) void extractFramesFromUpload(f);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={running || selectedCount === 0}
                    title="Tách frame từ video kết quả của dòng đã chọn"
                    onClick={() => {
                      const selected = rows.filter((r) => r.selected && r.results.length);
                      if (!selected.length) {
                        onError("Chọn dòng đã có video kết quả");
                        return;
                      }
                      void (async () => {
                        for (const row of selected) {
                          await extractFramesForRow(row);
                        }
                      })();
                    }}
                  >
                    Frame từ KQ
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void aiRewriteSelected()}
                    disabled={running || aiBulkBusy || selectedCount === 0}
                    title="AI làm lại prompt chuyên nghiệp cho các dòng đã chọn (cần API AI trong Cài đặt)"
                  >
                    {aiBulkBusy ? "…" : `✦ ${selectedCount}`}
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
                              className="row-action-btn row-action-btn--ai"
                              aria-label="AI sửa prompt"
                              title="AI làm prompt chuyên nghiệp hơn (giữ @tên). Cần API AI trong Cài đặt."
                              onClick={() => void aiRewriteRow(row)}
                              disabled={
                                !row.prompt.trim() ||
                                row.status === "running" ||
                                row.status === "queued" ||
                                aiBusyId === row.id ||
                                aiBulkBusy
                              }
                            >
                              {aiBusyId === row.id ? "…" : "✦"}
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
                            label="Ảnh đầu"
                            valueName={row.startFrameName}
                            previewUrl={row.startFrameImage}
                            disabled={frameDisabled}
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
                            label="Ảnh cuối"
                            valueName={row.endFrameName}
                            previewUrl={row.endFrameImage}
                            disabled={frameDisabled}
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
                        <div
                          className="queue-prompt-box"
                          title="Double-click để xem / sửa đầy đủ"
                          onDoubleClick={() => beginEditPrompt(row)}
                        >
                          <p className="queue-prompt-text">{row.prompt || "—"}</p>
                          <div className="queue-prompt-side-actions">
                            <button
                              type="button"
                              className="queue-prompt-edit-btn queue-prompt-ai-btn"
                              aria-label="Sửa bằng AI"
                              title="Sửa prompt bằng AI"
                              onClick={(e) => {
                                e.stopPropagation();
                                void aiRewriteRow(row, { source: row.prompt });
                              }}
                              disabled={
                                !row.prompt.trim() ||
                                row.status === "running" ||
                                row.status === "queued" ||
                                aiBusyId === row.id ||
                                aiBulkBusy
                              }
                            >
                              {aiBusyId === row.id ? "…" : "✦"}
                            </button>
                          </div>
                        </div>
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
                              {row.results.map((url, ri) => (
                                <div key={`${row.id}-vid-${ri}`} className="flow-video-result-item" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                  <a
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
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-xs btn-create-video-flow"
                                    onClick={() => void handleContinueVideo(url, row.prompt)}
                                    title="Tạo cảnh tiếp theo (lấy khung hình cuối)"
                                  >
                                    🎬 Tạo tiếp video
                                  </button>
                                </div>
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

      {editingPromptId && (
        <div
          className="prompt-edit-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Sửa prompt"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) cancelEditPrompt();
          }}
        >
          <div className="prompt-edit-modal">
            <div className="prompt-edit-modal-head">
              <strong>Sửa prompt</strong>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={cancelEditPrompt}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>
            <textarea
              value={editingPromptText}
              autoFocus
              rows={6}
              placeholder="Nhập prompt..."
              onChange={(e) => setEditingPromptText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEditPrompt();
                }
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  saveEditPrompt(editingPromptId);
                }
              }}
            />
            <div className="prompt-edit-modal-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => saveEditPrompt(editingPromptId)}
              >
                Lưu
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm btn-ai-prompt"
                onClick={() => {
                  const row = rows.find((r) => r.id === editingPromptId);
                  if (row) void aiRewriteRow(row, { source: editingPromptText });
                }}
                disabled={!editingPromptText.trim() || aiBusyId === editingPromptId || aiBulkBusy}
                title="Sửa bằng AI"
              >
                {aiBusyId === editingPromptId ? "…" : "✦"}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEditPrompt}>
                Hủy
              </button>
              <span className="prompt-edit-modal-hint">
                Double-click dòng để mở · Ctrl+Enter lưu · Esc đóng
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ─── Lịch sử video đã tạo (quét từ đĩa, không phụ thuộc localStorage) ─── */}
      <div className="flow-history-section">
        <MediaHistoryPanel kind="video" />
      </div>

      {/* ─── Custom Modal Tạo Cảnh Tiếp Theo (Storyboard) ─── */}
      {continueModal && continueModal.open && (
        <div className="ui-lightbox node-picker-overlay" onClick={() => setContinueModal(null)}>
          <div
            className="node-picker-modal continue-storyboard-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 460, background: "#0f172a", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.5)" }}
          >
            <div className="node-picker-head" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 10 }}>
              <strong style={{ color: "#c4b5fd" }}>Tạo cảnh tiếp theo (Storyboard)</strong>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setContinueModal(null)}>
                Đóng
              </button>
            </div>
            <p className="muted" style={{ fontSize: 12.5, margin: "12px 0 16px" }}>
              Chọn một hành động hoặc góc máy gợi ý bên dưới (click là chạy ngay) để tạo tiếp cảnh mới cho nhân vật:
            </p>

            {modalSubmitting ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 0", gap: 12 }}>
                <span className="mhp-spinner" style={{ width: 32, height: 32 }} />
                <span style={{ fontSize: 13, color: "#a78bfa", fontWeight: 600 }}>🌀 Đang kết nối AI để tối ưu prompt...</span>
                <span style={{ fontSize: 11, color: "#64748b" }}>Hàng chờ sẽ tự động chạy khi hoàn tất</span>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6, fontWeight: 700, letterSpacing: "0.05em" }}>TÙY CHỌN TỰ ĐỘNG:</div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ width: "100%", justifyContent: "center", background: "linear-gradient(135deg, #8b5cf6, #3b82f6)", border: "none", fontWeight: 700 }}
                    onClick={() => void submitContinueVideo("", true)}
                  >
                    ✦ AI tự động gợi ý diễn biến tiếp theo
                  </button>
                </div>

                <div>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6, fontWeight: 700, letterSpacing: "0.05em" }}>GÓC MÁY & HÀNH ĐỘNG GỢI Ý (CLICK LÀ CHẠY NGAY):</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {[
                      { label: "📸 Cận cảnh mặt", action: "close-up portrait" },
                      { label: "📐 Góc nghiêng 3/4", action: "3/4 view" },
                      { label: "👤 Nghiêng hoàn toàn", action: "side profile" },
                      { label: "🏃 Chạy bộ", action: "running" },
                      { label: "🚶 Đi bộ thong thả", action: "walking slowly" },
                      { label: "😊 Mỉm cười", action: "smiling happily" },
                      { label: "😢 Đang khóc", action: "crying with tears" },
                      { label: "☕ Ngồi suy tư", action: "sitting thoughtfully" },
                      { label: "🌅 Đứng nhìn hoàng hôn", action: "standing and looking at sunset" },
                    ].map((item, idx) => (
                      <button
                        key={idx}
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ fontSize: 11, padding: "4px 8px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)", color: "#cbd5e1" }}
                        onClick={() => void submitContinueVideo(item.action, false)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 14 }}>
                  <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6, fontWeight: 700, letterSpacing: "0.05em" }}>TỰ NHẬP HÀNH ĐỘNG TÙY CHỈNH:</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      name="customAction"
                      type="text"
                      placeholder="Ví dụ: đang cười lớn, nhảy múa..."
                      className="form-control"
                      value={customActionVal}
                      onChange={(e) => setCustomActionVal(e.target.value)}
                      style={{ height: 32, fontSize: 12, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#fff", padding: "0 10px", width: "100%" }}
                      autoFocus
                    />
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        style={{ height: 30, padding: "0 12px", fontSize: 11, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                        onClick={() => {
                          void submitContinueVideo(customActionVal, false);
                          setCustomActionVal("");
                        }}
                      >
                        Gắn trực tiếp (Không AI)
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        style={{ height: 30, padding: "0 12px", fontSize: 11, fontWeight: 700, background: "linear-gradient(135deg, #8b5cf6, #3b82f6)", border: "none" }}
                        onClick={() => {
                          void submitContinueVideo(customActionVal, true);
                          setCustomActionVal("");
                        }}
                      >
                        ✦ Trợ lý AI tối ưu
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}