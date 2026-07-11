import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  normalizeFileUrl,
  openOutputFolder,
  parsePromptCsv,
  rewritePromptAi,
  rewritePromptsAi,
  runImageThenVideoPipeline,
  submitBatch,
} from "../api";
import {
  clearFlowImageSnapshot,
  loadFlowImageSnapshot,
  saveFlowImageSnapshot,
} from "../flowImageStorage";
import {
  loadFlowVideoSnapshot,
  saveFlowVideoSnapshot,
} from "../flowVideoStorage";
import { NAV_ROUTES } from "../routes";

import PromptMentionField, {
  type PromptMentionFieldHandle,
} from "./PromptMentionField";
import { useReferenceLibrary } from "../referenceLibraryContext";
import {
  buildNamedReferencesPayload,
  validatePromptMentions,
} from "../referenceUtils";
import { useUiDialog } from "./UiDialog";
import {
  META_IMAGE_MODELS,
  ASPECT_RATIOS,
  GROK_IMAGE_MODELS,
  IMAGE_MODELS,
  MEDIA_ENGINES,
  SAVE_MODES,
  type ImageConfig,
  type MediaEngine,
  type QueueRow,
  type RowStatus,
} from "../types";
import { createId, runWithConcurrency } from "../utils";
import MediaHistoryPanel from "./MediaHistoryPanel";

const DEFAULT_CONFIG: ImageConfig = {
  engine: "flow",
  model: "nano_banana_2_lite",
  aspectRatio: "1:1",
  concurrency: 1,
  imagesPerPrompt: 1,
  saveMode: "task",
  outputFolder: "G-Labs BW/image_output",
  upscale: [],
};

function modelsForEngine(engine: MediaEngine) {
  return engine === "grok" ? GROK_IMAGE_MODELS : engine === "meta" ? META_IMAGE_MODELS : IMAGE_MODELS;
}

function defaultModelForEngine(engine: MediaEngine): string {
  return engine === "grok" ? GROK_IMAGE_MODELS[0].value : engine === "meta" ? META_IMAGE_MODELS[0].value : IMAGE_MODELS[0].value;
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
    tone: "default",
  });
}

function statusLabel(status: RowStatus): string {
  switch (status) {
    case "running":
      return "Đang tạo...";
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

interface FlowImagePageProps {
  activeCount: number;
  onError: (msg: string) => void;
}

export default function FlowImagePage({ activeCount, onError }: FlowImagePageProps) {
  const dialog = useUiDialog();
  const navigate = useNavigate();
  const { library: referenceLibrary } = useReferenceLibrary();
  // Lazy init so each mount re-reads localStorage (not a one-time module cache)
  const [config, setConfig] = useState<ImageConfig>(() => ({
    ...DEFAULT_CONFIG,
    ...(loadFlowImageSnapshot()?.config ?? {}),
  }));
  const [advancedOpen, setAdvancedOpen] = useState(
    () => loadFlowImageSnapshot()?.advancedOpen ?? false,
  );
  const [promptInput, setPromptInput] = useState(
    () => loadFlowImageSnapshot()?.promptInput ?? "",
  );
  const [rows, setRows] = useState<QueueRow[]>(
    () => loadFlowImageSnapshot()?.rows ?? [],
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
    imageUrl: string;
    promptText: string;
  } | null>(null);

  const handleContinueImage = (imageUrl: string, promptText: string) => {
    setContinueModal({
      open: true,
      imageUrl,
      promptText,
    });
  };

  const submitContinueImage = async (actionText: string) => {
    if (!continueModal) return;
    const { imageUrl, promptText } = continueModal;
    setContinueModal(null); // Đóng modal

    let finalPrompt = promptText;
    const trimmedAction = actionText.trim();
    if (trimmedAction) {
      try {
        const response = await rewritePromptAi({
          prompt: `Hãy viết lại prompt tiếng Anh chất lượng cao, giữ nguyên phong cách và nhân vật của prompt gốc nhưng đổi hành động/diễn biến sang: "${trimmedAction}". Trả về duy nhất prompt tiếng Anh mới.\nPrompt gốc: "${promptText}"`,
          kind: "image",
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
          prompt: `Hãy viết tiếp cảnh tiếp theo (storyboard scene) cho prompt sau. Giữ nguyên nhân vật và phong cách gốc nhưng đổi hành động sang một diễn biến hợp lý tiếp theo. Hãy trả về duy nhất prompt tiếng Anh mới:\n"${promptText}"`,
          kind: "image",
          locale: "vi",
        });
        if (response && response.prompt) {
          finalPrompt = response.prompt;
        }
      } catch {
        // fallback to original
      }
    }

    const newRow: QueueRow = {
      id: createId(),
      selected: true,
      prompt: finalPrompt,
      referenceImage: imageUrl,
      referenceName: "style_ref",
      startFrameName: null,
      startFrameImage: null,
      endFrameName: null,
      endFrameImage: null,
      results: [],
      status: "idle",
      error: null,
      savedFolder: null,
    };

    setRows((prev) => [newRow, ...prev]);

    // Tự động chạy hàng chờ mới vừa tạo lập tức
    void runRows([newRow]);
  };


  const handleCreateVideoFromImage = (imageUrl: string, promptText: string) => {
    const snap = loadFlowVideoSnapshot() || {
      config: {
        engine: "flow",
        model: "veo_31_fast",
        aspectRatio: "16:9",
        mode: "start_image",
        concurrency: 1,
        saveMode: "task",
        outputFolder: "G-Labs BW/video_output",
        resolution: [],
        duration: 8,
      },
      rows: [],
      promptInput: "",
      advancedOpen: false,
    };

    const newRow: QueueRow = {
      id: createId(),
      selected: true,
      prompt: promptText,
      referenceImage: null,
      referenceName: null,
      startFrameName: "image_input.png",
      startFrameImage: imageUrl,
      endFrameName: null,
      endFrameImage: null,
      results: [],
      status: "idle",
      error: null,
      savedFolder: null,
    };

    snap.config.mode = "start_image";
    snap.rows = [newRow, ...snap.rows];

    saveFlowVideoSnapshot(snap);
    navigate(NAV_ROUTES["flow-video"] || "/flow-video");
  };







  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveFlowImageSnapshot({ config, rows, promptInput, advancedOpen });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      // Flush immediately on unmount / dep change so tab switch never drops the latest queue
      saveFlowImageSnapshot({ config, rows, promptInput, advancedOpen });
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
        const mentionError = validatePromptMentions(prompt, referenceLibrary);
        if (mentionError) {
          updateRow(row.id, { status: "failed", error: mentionError });
          return;
        }

        const namedRefs = buildNamedReferencesPayload(prompt, referenceLibrary);
        const isGrok = config.engine === "grok";
        const isMeta = config.engine === "meta";
        const params = {
          model: config.model,
          aspect_ratio: config.aspectRatio,
          upscale: (isGrok || isMeta) ? [] : config.upscale,
          count: config.imagesPerPrompt,
          save_mode: config.saveMode,
          output_folder: isGrok
            ? config.outputFolder.replace("image_output", "grok_output") || "G-Labs BW/grok_output"
            : isMeta
            ? config.outputFolder.replace("image_output", "meta_output") || "G-Labs BW/meta_output"
            : config.outputFolder,
          ...(isGrok ? { mode: "t2i" } : {}),
          ...(isMeta ? { mode: "t2i" } : {}),
          ...(namedRefs.length > 0 ? { named_references: namedRefs } : {}),
          ...(!namedRefs.length && row.referenceImage
            ? { reference_images: [row.referenceImage] }
            : {}),
        };
        const result = await submitBatch(
          [{ prompt, provider: isGrok ? "grok" : isMeta ? "meta" : "image", params }],
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
            error: item?.error || item?.error_detail || "Tạo ảnh thất bại",
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
        const text = String(reader.result || "");
        const prompts = parsePromptCsv(text);
        if (prompts.length === 0) {
          onError("File không có prompt (CSV/TSV/TXT, cột đầu hoặc mỗi dòng 1 prompt)");
          return;
        }
        setRows((prev) => {
          const next = [...prev];
          // fill empty rows first
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

  async function runPipelineSelected() {
    if (config.engine !== "flow") {
      onError("Pipeline Ảnh→Video chỉ hỗ trợ engine Google Flow");
      return;
    }
    const selected = rows.filter((r) => r.selected && r.prompt.trim());
    if (selected.length === 0) {
      onError("Chọn ít nhất một dòng có prompt");
      return;
    }
    const ok = await dialog.confirm({
      title: "Chạy pipeline Ảnh → Video?",
      message: `Sẽ chạy pipeline cho ${selected.length} dòng (lâu hơn gen ảnh).`,
      confirmLabel: "Chạy pipeline",
      cancelLabel: "Hủy",
    });
    if (!ok) return;
    setRunning(true);
    try {
      await runWithConcurrency(
        selected.map((row) => async () => {
          updateRow(row.id, { status: "running", error: null });
          try {
            const result = await runImageThenVideoPipeline({
              prompt: row.prompt.trim(),
              image_params: {
                model: config.model,
                aspect_ratio: config.aspectRatio,
                upscale: config.upscale,
                count: config.imagesPerPrompt,
                save_mode: config.saveMode,
                output_folder: config.outputFolder,
              },
              video_params: {
                model: "veo_31_fast",
                aspect_ratio: "16:9",
                mode: "start_image",
                save_mode: "task",
                output_folder: "G-Labs BW/video_output",
              },
            });
            if (result.status === "completed") {
              const urls = [
                ...(result.image_urls || []).map(normalizeFileUrl),
                ...(result.video_urls || []).map(normalizeFileUrl),
              ];
              updateRow(row.id, {
                status: "completed",
                results: urls,
                savedFolder: result.video_folder || result.image_folder || null,
              });
            } else {
              updateRow(row.id, {
                status: "failed",
                error: result.error || "Pipeline thất bại",
              });
            }
          } catch (err) {
            updateRow(row.id, { status: "failed", error: String(err) });
          }
        }),
        Math.min(config.concurrency, 2),
      );
    } finally {
      setRunning(false);
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

  async function aiRewriteRow(
    row: QueueRow,
    opts?: { source?: string },
  ) {
    const source = (
      opts?.source ??
      (editingPromptId === row.id ? editingPromptText : row.prompt)
    ).trim();
    if (!source || row.status === "running" || row.status === "queued") return;
    setAiBusyId(row.id);
    setAiNotice({ type: "ok", text: "AI đang phân tích prompt…" });
    onError("");
    try {
      const res = await rewritePromptAi({ prompt: source, kind: "image", locale: "vi" });
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
      setEditingPromptId(row.id);
      setEditingPromptText(next);
      setAiNotice({
        type: next === source ? "err" : "ok",
        text:
          next === source
            ? "AI trả về gần như giống prompt cũ — thử model khác"
            : "Đã cập nhật prompt bằng AI — xem trong popup",
      });
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
        kind: "image",
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
        setAiNotice({ type: "ok", text: `Đã AI sửa ${res.ok} prompt` });
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
    clearFlowImageSnapshot();
    saveFlowImageSnapshot({
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
  return (
    <div className="flow-page">
      <header className="flow-page-top">
        <div className="flow-page-top-main">
          <h1>{config.engine === "grok" ? "Grok Image" : config.engine === "meta" ? "Meta Image" : "Flow Image"}</h1>
          <span className={`pill ${config.engine === "grok" ? "pill-purple" : config.engine === "meta" ? "pill-purple" : "pill-purple"}`}>
            {config.engine === "grok" ? "Grok · Auth Helper" : config.engine === "meta" ? "Meta AI · Vibes" : "Google Flow"}
          </span>
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
                    model: defaultModelForEngine(engine),
                    outputFolder:
                      engine === "grok"
                        ? "G-Labs BW/grok_output"
                        : engine === "meta"
                        ? "G-Labs BW/meta_output"
                        : "G-Labs BW/image_output",
                  }));
                }}
              >
                {MEDIA_ENGINES.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <small className="field-hint">
                {(MEDIA_ENGINES.find((m) => m.value === (config.engine || "flow")) || MEDIA_ENGINES[0]).hint}
                {config.engine === "grok"
                  ? " · Grok = nick login trên tab grok.com (không dùng list account Flow). Flow = cookie trong Cài đặt."
                  : config.engine === "meta"
                  ? " · Meta = cookie meta_session trong Cài đặt."
                  : " · Flow = cookie/session trong Cài đặt (email thật sau khi refresh session)."}
              </small>
            </label>
            <label>
              Model
              <select
                value={config.model}
                onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
              >
                {modelsForEngine(config.engine || "flow").map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </label>
            <label>
              Tỷ lệ ảnh
              <select
                value={config.aspectRatio}
                onChange={(e) => setConfig((c) => ({ ...c, aspectRatio: e.target.value }))}
              >
                {ASPECT_RATIOS.map((a) => (
                  <option key={a.value} value={a.value}>{a.label}</option>
                ))}
              </select>
            </label>
            <label>
              Số luồng chạy đồng thời
              <input
                type="number"
                min={1}
                max={20}
                value={config.concurrency}
                onChange={(e) => setConfig((c) => ({ ...c, concurrency: Number(e.target.value) }))}
              />
            </label>
            <label>
              Số lượng ảnh / prompt
              <input
                type="number"
                min={1}
                max={4}
                value={config.imagesPerPrompt}
                onChange={(e) => setConfig((c) => ({ ...c, imagesPerPrompt: Number(e.target.value) }))}
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
                placeholder="G-Labs BW/image_output"
              />
              <small className="field-hint">Lưu vào thư mục data/{config.outputFolder || "image_output"}</small>
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
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.upscale.includes("2K")}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      upscale: e.target.checked
                        ? [...c.upscale.filter((u) => u !== "2K"), "2K"]
                        : c.upscale.filter((u) => u !== "2K"),
                    }))
                  }
                />
                Upscale 2K
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={config.upscale.includes("4K")}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      upscale: e.target.checked
                        ? [...c.upscale.filter((u) => u !== "4K"), "4K"]
                        : c.upscale.filter((u) => u !== "4K"),
                    }))
                  }
                />
                Upscale 4K
              </label>
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
                  Mỗi dòng một prompt · gõ <code>@ten_anh</code> hoặc bấm chip ảnh bên dưới
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

            <div className="flow-ref-strip">
              <span className="flow-ref-strip-label">
                Tham chiếu ({referenceLibrary.length})
              </span>
              {referenceLibrary.length > 0 ? (
                <div className="flow-ref-strip-chips">
                  {referenceLibrary.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="ref-global-chip"
                      title={`Chèn @${item.name}`}
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
                <span className="flow-ref-strip-empty">Chưa có ảnh — thêm trong tab Ảnh tham chiếu</span>
              )}
              <button
                type="button"
                className="flow-ref-strip-link"
                onClick={() => navigate(NAV_ROUTES.references)}
              >
                Quản lý
              </button>
            </div>

            <PromptMentionField
              ref={bulkPromptRef}
              rows={5}
              className="queue-bulk-prompt"
              menuPlacement="above"
              placeholder={"@hoa đứng giữa cánh đồng\n@lieu nhìn ra biển lúc hoàng hôn\nMột con mèo ngủ trên ghế sofa"}
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
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void runPipelineSelected()}
                    disabled={running || selectedCount === 0 || config.engine !== "flow"}
                    title="Pipeline G-Labs: gen ảnh rồi video (start frame = ảnh vừa tạo)"
                  >
                    Ảnh→Video
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
                  <th className="col-prompt">Prompt</th>
                  <th className="col-status">Tiến độ</th>
                  <th className="col-result">Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="queue-table-empty">
                      {rows.length === 0 ? (
                        <div className="queue-table-empty-inner">
                          <p>Chưa có prompt trong hàng chờ</p>
                          <span className="queue-table-empty-hint">
                            Nhập prompt ở ô phía trên rồi bấm <strong>Thêm vào hàng chờ</strong>
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
                      <td className="col-prompt">
                        <div
                          className="queue-prompt-box"
                          title="Double-click để xem / sửa đầy đủ"
                          onDoubleClick={() => beginEditPrompt(row)}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}>
                            {row.referenceImage && (
                              <div
                                style={{
                                  position: "relative",
                                  width: 24,
                                  height: 24,
                                  borderRadius: 4,
                                  border: "1px solid rgba(139, 92, 246, 0.4)",
                                  overflow: "hidden",
                                  flexShrink: 0
                                }}
                                title="Ảnh style reference (Ảnh tham chiếu phong cách)"
                              >
                                <img
                                  src={row.referenceImage}
                                  alt="Style Ref"
                                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    updateRow(row.id, { referenceImage: null, referenceName: null });
                                  }}
                                  style={{
                                    position: "absolute",
                                    top: 0,
                                    right: 0,
                                    background: "rgba(0,0,0,0.6)",
                                    color: "#ff4d4f",
                                    border: "none",
                                    fontSize: 8,
                                    width: 12,
                                    height: 12,
                                    cursor: "pointer",
                                    padding: 0,
                                    display: "grid",
                                    placeItems: "center",
                                    borderRadius: "0 0 0 2px"
                                  }}
                                >
                                  ✕
                                </button>
                              </div>
                            )}
                            <p className="queue-prompt-text" style={{ margin: 0 }}>
                              {row.prompt || "—"}
                            </p>
                          </div>

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
                                <div key={`${row.id}-img-${ri}`} className="flow-image-result-item">
                                  <a
                                    className="result-frame"
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    title="Mở ảnh"
                                  >
                                    <img src={url} alt="result" className="result-thumb" />
                                  </a>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-xs btn-create-video-flow"
                                    onClick={() => handleCreateVideoFromImage(url, row.prompt)}
                                    title="Tạo video tiếp từ ảnh này"
                                  >
                                    🎬 Tạo video tiếp
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-primary btn-xs btn-create-video-flow"
                                    onClick={() => handleContinueImage(url, row.prompt)}
                                    title="Tạo ảnh tiếp theo sử dụng ảnh này làm style"
                                    style={{ marginTop: 2 }}
                                  >
                                    🎨 Tạo ảnh tiếp
                                  </button>
                                </div>

                              ))}

                            </div>
                          ) : (
                            <span className="result-empty">
                              {row.status === "running" ? "Đang render..." : "—"}
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

      {/* ─── Lịch sử ảnh đã tạo (quét từ đĩa, không phụ thuộc localStorage) ─── */}
      <div className="flow-history-section">
        <MediaHistoryPanel kind="image" />
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

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6, fontWeight: 700, letterSpacing: "0.05em" }}>TÙY CHỌN TỰ ĐỘNG:</div>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ width: "100%", justifyContent: "center", background: "linear-gradient(135deg, #8b5cf6, #3b82f6)", border: "none", fontWeight: 700 }}
                  onClick={() => void submitContinueImage("")}
                >
                  ✦ AI tự động gợi ý diễn biến tiếp theo
                </button>
              </div>

              <div>
                <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6, fontWeight: 700, letterSpacing: "0.05em" }}>GÓC MÁY & HÀNH ĐỘNG GỢI Ý (CLICK LÀ CHẠY):</div>
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
                      onClick={() => void submitContinueImage(item.action)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>

              <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 14 }}>
                <div style={{ fontSize: 10, color: "#94a3b8", marginBottom: 6, fontWeight: 700, letterSpacing: "0.05em" }}>TỰ NHẬP HÀNH ĐỘNG TÙY CHỈNH:</div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const val = (e.currentTarget.elements.namedItem("customAction") as HTMLInputElement).value;
                    void submitContinueImage(val);
                  }}
                  style={{ display: "flex", gap: 6 }}
                >
                  <input
                    name="customAction"
                    type="text"
                    placeholder="Ví dụ: đang cười lớn, nhảy múa..."
                    className="form-control"
                    style={{ flex: 1, height: 32, fontSize: 12, background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, color: "#fff", padding: "0 10px" }}
                    autoFocus
                  />
                  <button type="submit" className="btn btn-primary btn-sm" style={{ height: 32, padding: "0 14px", fontWeight: 700 }}>
                    Tạo
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}