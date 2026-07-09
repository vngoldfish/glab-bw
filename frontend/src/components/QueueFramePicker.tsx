import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import type { NamedReference } from "../types";

export type FramePick = { name: string | null; image: string | null };

interface QueueFramePickerProps {
  label: string;
  /** Display name (local file or library) */
  valueName: string | null;
  /** Preview URL / data URL for the selected frame */
  previewUrl: string | null;
  /** Optional: still allow picking from reference library */
  library?: NamedReference[];
  disabled?: boolean;
  onChange: (frame: FramePick) => void;
  /**
   * Read files from OS folder. Parent should NOT upload to reference library —
   * only attach to the video row.
   */
  onPickFiles?: (files: File[]) => Promise<{ name: string; image: string }[]>;
  onOpen?: () => void;
}

/**
 * I2V / first-last frame picker.
 * Primary path: OS folder (local to the video row).
 * Optional: pick from reference library if user wants.
 */
export default function QueueFramePicker({
  label,
  valueName,
  previewUrl,
  library = [],
  disabled,
  onChange,
  onPickFiles,
  onOpen,
}: QueueFramePickerProps) {
  const [open, setOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 300 });
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasValue = Boolean(previewUrl || valueName);

  function openFolderDialog(e?: ReactMouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (disabled || uploading || !onPickFiles) return;
    fileRef.current?.click();
  }

  function togglePanel() {
    if (disabled || uploading) return;
    setOpen((prev) => {
      const next = !prev;
      if (next) onOpen?.();
      return next;
    });
  }

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(340, Math.max(280, window.innerWidth - 24));
    let left = rect.left;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - width - 12);
    }
    let top = rect.bottom + 6;
    const estimatedHeight = 360;
    if (top + estimatedHeight > window.innerHeight - 12) {
      top = Math.max(12, rect.top - estimatedHeight - 6);
    }
    setPos({ top, left, width });
  }, [open, library.length]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onScroll(e: Event) {
      const target = e.target;
      if (target === document || target === document.documentElement || target === document.body) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length || !onPickFiles) return;
    setUploading(true);
    try {
      const frames = await onPickFiles(Array.from(fileList));
      const first = frames[0];
      if (first) {
        onChange({ name: first.name, image: first.image });
        setOpen(false);
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const popover = open
    ? createPortal(
        <div
          ref={popoverRef}
          className="queue-frame-popover"
          role="dialog"
          aria-label={label}
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <div className="queue-frame-popover-head">
            <strong>{label}</strong>
            <div className="queue-frame-popover-actions">
              {hasValue && (
                <button
                  type="button"
                  className="queue-frame-clear"
                  onClick={() => {
                    onChange({ name: null, image: null });
                    setOpen(false);
                  }}
                >
                  Xóa
                </button>
              )}
              <button type="button" className="queue-frame-close" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
          </div>

          {onPickFiles && (
            <button
              type="button"
              className="queue-frame-folder-btn"
              disabled={uploading}
              onClick={(e) => openFolderDialog(e)}
            >
              {uploading ? "Đang đọc ảnh..." : "📂 Chọn ảnh từ thư mục máy"}
            </button>
          )}

          <p className="queue-frame-hint">
            Ảnh gắn vào <strong>dòng video này</strong> — không đưa vào tab Ảnh tham chiếu.
          </p>

          {library.length > 0 && (
            <>
              <div className="queue-frame-section-label">
                Hoặc lấy từ thư viện tham chiếu ({library.length})
              </div>
              <div className="queue-frame-grid">
                {library.map((item) => {
                  const active =
                    valueName?.toLowerCase() === item.name.toLowerCase() &&
                    !previewUrl?.startsWith("data:");
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={`queue-frame-grid-item${active ? " active" : ""}`}
                      onClick={() => {
                        onChange({
                          name: item.name,
                          image: item.filePath || item.image,
                        });
                        setOpen(false);
                      }}
                      title={`@${item.name}`}
                    >
                      <img src={item.image} alt={item.name} />
                      <span>@{item.name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <div className={`queue-frame-picker${open ? " is-open" : ""}`} ref={rootRef}>
      {onPickFiles && (
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
          multiple
          className="queue-frame-file-input"
          disabled={disabled || uploading}
          onChange={(e) => void handleFiles(e.target.files)}
        />
      )}

      <div className="queue-frame-actions">
        <button
          ref={triggerRef}
          type="button"
          className={`queue-frame-trigger${hasValue ? " is-set" : " is-empty"}`}
          disabled={disabled || uploading}
          onClick={togglePanel}
          title={
            hasValue
              ? `${valueName || "Ảnh đã chọn"} — bấm để đổi`
              : `${label} — bấm 📂 chọn từ thư mục`
          }
        >
          {previewUrl ? (
            <>
              <img src={previewUrl} alt="" />
              <span className="queue-frame-trigger-text">{valueName || "Đã chọn"}</span>
            </>
          ) : (
            <>
              <span className="queue-frame-plus" aria-hidden>
                +
              </span>
              <span className="queue-frame-trigger-text">
                {uploading ? "Đang đọc..." : label}
              </span>
            </>
          )}
        </button>

        {onPickFiles && (
          <button
            type="button"
            className="queue-frame-folder-icon"
            disabled={disabled || uploading}
            title="Mở File Explorer — chọn ảnh từ thư mục (không vào Ảnh tham chiếu)"
            onClick={(e) => openFolderDialog(e)}
          >
            📂
          </button>
        )}
      </div>
      {popover}
    </div>
  );
}
