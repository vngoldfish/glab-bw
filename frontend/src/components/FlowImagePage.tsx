import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeFileUrl, openOutputFolder, submitBatch } from "../api";
import {
  clearFlowImageSnapshot,
  loadFlowImageSnapshot,
  saveFlowImageSnapshot,
} from "../flowImageStorage";
import { NAV_ROUTES } from "../routes";
import PromptMentionField, {
  type PromptMentionFieldHandle,
} from "./PromptMentionField";
import { useReferenceLibrary } from "../referenceLibraryContext";
import {
  buildNamedReferencesPayload,
  validatePromptMentions,
} from "../referenceUtils";
import {
  ASPECT_RATIOS,
  IMAGE_MODELS,
  SAVE_MODES,
  type ImageConfig,
  type QueueRow,
  type RowStatus,
} from "../types";
import { createId, runWithConcurrency } from "../utils";

const DEFAULT_CONFIG: ImageConfig = {
  model: "nano_banana_2_lite",
  aspectRatio: "1:1",
  concurrency: 1,
  imagesPerPrompt: 1,
  saveMode: "task",
  outputFolder: "G-Labs BW/image_output",
  upscale: [],
};

function emptyRow(): QueueRow {
  return {
    id: createId(),
    selected: true,
    prompt: "",
    referenceImage: null,
    referenceName: null,
    results: [],
    status: "idle",
    error: null,
    savedFolder: null,
  };
}

const savedSnapshot = loadFlowImageSnapshot();

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

interface FlowImagePageProps {
  activeCount: number;
  onError: (msg: string) => void;
}

export default function FlowImagePage({ activeCount, onError }: FlowImagePageProps) {
  const navigate = useNavigate();
  const { library: referenceLibrary } = useReferenceLibrary();
  const [config, setConfig] = useState<ImageConfig>({
    ...DEFAULT_CONFIG,
    ...(savedSnapshot?.config ?? {}),
  });
  const [advancedOpen, setAdvancedOpen] = useState(savedSnapshot?.advancedOpen ?? false);
  const [promptInput, setPromptInput] = useState(savedSnapshot?.promptInput ?? "");
  const [rows, setRows] = useState<QueueRow[]>(savedSnapshot?.rows ?? []);
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
      saveFlowImageSnapshot({ config, rows, promptInput, advancedOpen });
    }, 400);
    return () => window.clearTimeout(timer);
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
        const params = {
          model: config.model,
          aspect_ratio: config.aspectRatio,
          upscale: config.upscale,
          count: config.imagesPerPrompt,
          save_mode: config.saveMode,
          output_folder: config.outputFolder,
          ...(namedRefs.length > 0 ? { named_references: namedRefs } : {}),
          ...(!namedRefs.length && row.referenceImage
            ? { reference_images: [row.referenceImage] }
            : {}),
        };
        const result = await submitBatch(
          [{ prompt, provider: "image", params }],
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

  function loadPromptToBulk(prompt: string) {
    setPromptInput((prev) => (prev.trim() ? `${prev.trim()}\n${prompt}` : prompt));
    bulkPromptRef.current?.focus();
  }

  function clearAllSelections() {
    setRows((prev) => prev.map((row) => ({ ...row, selected: false })));
  }

  function clearQueueTable() {
    if (!window.confirm("Xóa toàn bộ bảng prompt? Hành động này không thể hoàn tác.")) {
      return;
    }
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
          <h1>Flow Image</h1>
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
                {IMAGE_MODELS.map((m) => (
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
                  <th className="col-control">Thao tác · Tiến độ</th>
                  <th className="col-prompt">Prompt</th>
                  <th className="col-result">Kết quả</th>
                </tr>
              </thead>
              <tbody>
                {displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="queue-table-empty">
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
                  paginatedRows.map(({ row, originalIndex }, index) => (
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
                        <div className="row-control">
                          <span className={`status-badge status-badge--compact status-${row.status}`}>
                            {statusLabel(row.status)}
                          </span>
                          {row.error && <small className="row-error">{row.error}</small>}
                          {row.status === "completed" && row.savedFolder && (
                            <small className="completion-msg" title={row.savedFolder}>
                              data/{row.savedFolder}
                            </small>
                          )}
                          <div className="row-actions">
                            <button
                              type="button"
                              className="icon-btn icon-btn-run"
                              title="Chạy dòng này"
                              onClick={() => runSingle(row)}
                              disabled={running}
                            >
                              ▶
                            </button>
                            {row.status === "completed" && (
                              <>
                                <button
                                  type="button"
                                  className="icon-btn icon-btn-retry"
                                  title="Tạo lại"
                                  onClick={() => runSingle(row)}
                                  disabled={running}
                                >
                                  ↻
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn icon-btn-folder"
                                  title="Mở thư mục lưu"
                                  onClick={() => openSavedFolder(row)}
                                >
                                  ▣
                                </button>
                              </>
                            )}
                          </div>
                          <button
                            type="button"
                            className="row-delete-btn"
                            title="Xóa dòng này"
                            onClick={() => removeRow(row.id)}
                          >
                            Xóa
                          </button>
                        </div>
                      </td>
                      <td className="col-prompt">
                        <div className="queue-prompt-readonly">
                          <p className="queue-prompt-text" title={row.prompt}>
                            {row.prompt || "—"}
                          </p>
                          <button
                            type="button"
                            className="queue-prompt-edit-btn"
                            title="Đưa prompt lên ô nhập hàng loạt để sửa"
                            onClick={() => loadPromptToBulk(row.prompt)}
                          >
                            Sửa
                          </button>
                        </div>
                      </td>
                      <td className="col-result">
                        {row.results.length > 0 ? (
                          <div className="result-grid">
                            {row.results.map((url) => (
                              <a
                                key={url}
                                className="result-frame"
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                title="Mở ảnh"
                              >
                                <img src={url} alt="result" className="result-thumb" />
                              </a>
                            ))}
                          </div>
                        ) : (
                          <span className="result-empty">
                            {row.status === "running" ? "Đang render..." : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
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