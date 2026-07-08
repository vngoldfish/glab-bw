import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeFileUrl, openOutputFolder, submitBatch } from "../api";
import {
  clearFlowImageSnapshot,
  loadFlowImageSnapshot,
  saveFlowImageSnapshot,
} from "../flowImageStorage";
import PromptMentionField from "./PromptMentionField";
import { useReferenceLibrary } from "../referenceLibraryContext";
import {
  buildNamedReferencesPayload,
  parseMentions,
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
import { createId, readFileAsDataUrl, runWithConcurrency } from "../utils";

const DEFAULT_CONFIG: ImageConfig = {
  model: "nano_banana_2_lite",
  aspectRatio: "1:1",
  concurrency: 1,
  imagesPerPrompt: 1,
  saveMode: "task",
  outputFolder: "G-Labs BW/image_output",
  upscale: [],
};

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024;

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

interface FlowImagePageProps {
  activeCount: number;
  onError: (msg: string) => void;
  onOpenReferences: () => void;
}

export default function FlowImagePage({
  activeCount,
  onError,
  onOpenReferences,
}: FlowImagePageProps) {
  const { library: referenceLibrary } = useReferenceLibrary();
  const [config, setConfig] = useState<ImageConfig>({
    ...DEFAULT_CONFIG,
    ...(savedSnapshot?.config ?? {}),
  });
  const [advancedOpen, setAdvancedOpen] = useState(savedSnapshot?.advancedOpen ?? false);
  const [promptInput, setPromptInput] = useState(savedSnapshot?.promptInput ?? "");
  const [rows, setRows] = useState<QueueRow[]>(
    savedSnapshot?.rows ?? [emptyRow(), emptyRow(), emptyRow()],
  );
  const [running, setRunning] = useState(false);
  const [refUploadRowId, setRefUploadRowId] = useState<string | null>(null);
  const [activePromptRowId, setActivePromptRowId] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const refFileInputRef = useRef<HTMLInputElement>(null);

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
      const newRows = lines.map((prompt) => ({ ...emptyRow(), prompt }));
      setRows((prev) => [...newRows, ...prev]);
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

  function toggleAll(checked: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, selected: checked })));
  }

  function addRow(afterId?: string) {
    const newRow = emptyRow();
    if (!afterId) {
      setRows((prev) => [newRow, ...prev]);
      return;
    }
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.id === afterId);
      if (idx < 0) return [...prev, newRow];
      const next = [...prev];
      next.splice(idx + 1, 0, newRow);
      return next;
    });
  }

  function removeRow(id: string) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== id)));
  }

  async function loadReferenceFile(file: File): Promise<string> {
    if (!file.type.startsWith("image/")) {
      throw new Error("Chỉ hỗ trợ file ảnh (PNG, JPG, WebP...)");
    }
    if (file.size > MAX_REFERENCE_BYTES) {
      throw new Error("Ảnh tham chiếu quá lớn — tối đa 10MB");
    }
    return readFileAsDataUrl(file);
  }

  async function pickReference(rowId: string, file: File) {
    try {
      const dataUrl = await loadReferenceFile(file);
      updateRow(rowId, { referenceImage: dataUrl, referenceName: file.name });
    } catch (err) {
      onError(String(err));
    }
  }

  function openRefUpload(rowId: string) {
    setRefUploadRowId(rowId);
    refFileInputRef.current?.click();
  }

  function insertMention(name: string, rowId?: string | null) {
    const targetId = rowId ?? activePromptRowId;
    if (!targetId) {
      onError("Chọn ô prompt trước khi chèn @tên ảnh");
      return;
    }
    const row = rows.find((r) => r.id === targetId);
    if (!row) return;
    const token = `@${name}`;
    const nextPrompt = row.prompt.trim()
      ? `${row.prompt.trimEnd()} ${token} `
      : `${token} `;
    updateRow(targetId, { prompt: nextPrompt });
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
      <header className="page-header">
        <div className="page-title-group">
          <h1>Flow Image</h1>
          <span className="pill pill-purple">Batch</span>
          <span className="pill pill-green">{activeCount} tài khoản</span>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={runSelected}
            disabled={running}
          >
            {running ? "Đang chạy..." : `▶ Chạy đã chọn (${selectedCount})`}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              if (!window.confirm("Xóa toàn bộ bảng prompt? Hành động này không thể hoàn tác.")) {
                return;
              }
              const fresh = [emptyRow()];
              setRows(fresh);
              clearFlowImageSnapshot();
              saveFlowImageSnapshot({
                config,
                rows: fresh,
                promptInput,
                advancedOpen,
              });
            }}
            disabled={running}
          >
            Xóa bảng
          </button>
        </div>
      </header>

      <div className="flow-stats">
        <div className="stat-chip accent">
          <span className="stat-value">{rows.length}</span>
          <span className="stat-label">Tổng prompt</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value">{selectedCount}</span>
          <span className="stat-label">Đã chọn</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value">{runningCount}</span>
          <span className="stat-label">Đang chạy</span>
        </div>
        <div className="stat-chip">
          <span className="stat-value">{completedCount}</span>
          <span className="stat-label">Hoàn thành</span>
        </div>
      </div>

      <div className="flow-body">
        <aside className="config-panel">
          <h2>Cấu hình & Prompts</h2>

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

          <div className="config-import">
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
            <button
              type="button"
              className="btn btn-purple"
              onClick={() => importInputRef.current?.click()}
            >
              Nhập tệp (TXT)
            </button>
            <PromptMentionField
              rows={5}
              className="config-prompt-mention"
              placeholder="Nhập danh sách prompt (mỗi dòng một prompt, dùng @hoa @lieu...)"
              value={promptInput}
              library={referenceLibrary}
              onChange={setPromptInput}
            />
            <div className="config-import-actions">
              <button type="button" className="btn btn-ghost" onClick={addPromptsToQueue}>
                + Thêm vào hàng chờ
              </button>
              <span className="muted">{rows.length} dòng · {completedCount} hoàn thành</span>
            </div>
          </div>
        </aside>

        <section className="queue-panel">
          <div className="ref-global-banner">
            <div>
              <strong>Thư viện ảnh tham chiếu</strong>
              <span className="ref-global-count">{referenceLibrary.length} ảnh</span>
              <p>
                Gọi trong prompt bằng <code>@ten_anh</code> — quản lý tại tab{" "}
                <em>Ảnh tham chiếu</em> (dùng chung ảnh &amp; video).
              </p>
            </div>
            <div className="ref-global-actions">
              {referenceLibrary.length > 0 && (
                <div className="ref-global-preview">
                  {referenceLibrary.slice(0, 6).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="ref-global-chip"
                      title={`Chèn @${item.name}`}
                      onClick={() => insertMention(item.name)}
                    >
                      <img src={item.image} alt={item.name} />
                      <span>@{item.name}</span>
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className="btn btn-purple btn-sm" onClick={onOpenReferences}>
                Quản lý ảnh tham chiếu
              </button>
            </div>
          </div>

          <div className="queue-panel-header">
            <div>
              <h3>Hàng chờ tạo ảnh</h3>
              <p className="queue-panel-sub">Mới nhất ở trên · chọn nhiều để chạy batch</p>
            </div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => addRow()}>
              + Thêm dòng
            </button>
          </div>

          <input
            ref={refFileInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file && refUploadRowId) {
                await pickReference(refUploadRowId, file);
              }
              e.target.value = "";
              setRefUploadRowId(null);
            }}
          />

          <div className="queue-toolbar">
            <label className="queue-select-all">
              <input
                type="checkbox"
                checked={rows.length > 0 && rows.every((r) => r.selected)}
                onChange={(e) => toggleAll(e.target.checked)}
              />
              <span>Chọn tất cả</span>
            </label>
            <div className="queue-legend">
              <span className="legend-item">
                <span className="legend-dot idle" /> Sẵn sàng
              </span>
              <span className="legend-item">
                <span className="legend-dot running" /> Đang chạy
              </span>
              <span className="legend-item">
                <span className="legend-dot done" /> Hoàn thành
              </span>
            </div>
          </div>

          <div className="queue-table-wrap">
            <table className="queue-table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      checked={rows.length > 0 && rows.every((r) => r.selected)}
                      onChange={(e) => toggleAll(e.target.checked)}
                    />
                  </th>
                  <th className="col-stt">STT</th>
                  <th className="col-actions">Thao tác</th>
                  <th className="col-ref">@ trong prompt</th>
                  <th className="col-prompt">Prompt</th>
                  <th className="col-result">Kết quả</th>
                  <th className="col-status">Tiến độ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
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
                    <td className="col-stt">{index + 1}</td>
                    <td className="col-actions">
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
                        <button
                          type="button"
                          className="icon-btn"
                          title="Thêm dòng bên dưới"
                          onClick={() => addRow(row.id)}
                        >
                          +
                        </button>
                        <button
                          type="button"
                          className="icon-btn danger"
                          title="Xóa dòng"
                          onClick={() => removeRow(row.id)}
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                    <td className="col-ref">
                      <div className="ref-cell">
                        {parseMentions(row.prompt, referenceLibrary).length > 0 ? (
                          <div className="ref-mention-list">
                            {parseMentions(row.prompt, referenceLibrary).map((mention) => {
                              const ref = referenceLibrary.find(
                                (item) => item.name.toLowerCase() === mention,
                              );
                              return (
                                <div key={mention} className="ref-mention-chip">
                                  {ref ? (
                                    <img src={ref.image} alt={mention} className="ref-mention-thumb" />
                                  ) : (
                                    <span className="ref-mention-missing">?</span>
                                  )}
                                  <span>@{mention}</span>
                                </div>
                              );
                            })}
                          </div>
                        ) : row.referenceImage ? (
                          <>
                            <button
                              type="button"
                              className="ref-upload ref-upload-sm"
                              onClick={() => openRefUpload(row.id)}
                              title="Ảnh tham chiếu riêng cho dòng này"
                            >
                              <img src={row.referenceImage} alt="ref" className="ref-thumb" />
                            </button>
                            <small className="ref-name">{row.referenceName || "Ảnh riêng"}</small>
                            <button
                              type="button"
                              className="ref-clear-btn"
                              onClick={() =>
                                updateRow(row.id, { referenceImage: null, referenceName: null })
                              }
                            >
                              Xóa
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="ref-upload ref-upload-sm"
                            onClick={() => openRefUpload(row.id)}
                            title="Ảnh riêng (khi không dùng @tên trong prompt)"
                          >
                            <span className="ref-placeholder">+ Riêng</span>
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="col-prompt">
                      <PromptMentionField
                        value={row.prompt}
                        library={referenceLibrary}
                        placeholder="Ví dụ: @hoa và @lieu đứng trong cảnh hoàng hôn"
                        onFocus={() => setActivePromptRowId(row.id)}
                        onChange={(prompt) => updateRow(row.id, { prompt })}
                      />
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
                    <td className="col-status">
                      {row.status === "completed" ? (
                        <div className="completion-panel">
                          <span className="completion-label">Hoàn thành</span>
                          <div className="completion-actions">
                            <button
                              type="button"
                              className="completion-btn completion-btn-retry"
                              title="Tạo lại"
                              onClick={() => runSingle(row)}
                              disabled={running}
                            >
                              ↻
                            </button>
                            <button
                              type="button"
                              className="completion-btn completion-btn-folder"
                              title="Mở thư mục lưu"
                              onClick={() => openSavedFolder(row)}
                            >
                              <span className="folder-icon" aria-hidden>▣</span>
                            </button>
                          </div>
                          {row.savedFolder && (
                            <small className="completion-msg">
                              Đã lưu: data/{row.savedFolder}
                            </small>
                          )}
                        </div>
                      ) : (
                        <>
                          <span className={`status-badge status-${row.status}`}>
                            {statusLabel(row.status)}
                          </span>
                          {row.error && <small className="row-error">{row.error}</small>}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="queue-panel-footer">
            <button type="button" className="btn btn-ghost" onClick={() => addRow()}>
              + Thêm dòng mới
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}