import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

export type FramePick = { name: string | null; image: string | null };

interface QueueFramePickerProps {
  label: string;
  /** Display label (filename slug) — only for UI */
  valueName: string | null;
  /** data URL preview — chỉ gắn dòng prompt, không vào thư viện tham chiếu */
  previewUrl: string | null;
  disabled?: boolean;
  onChange: (frame: FramePick) => void;
  /**
   * Đọc file local → parent lưu data URL trên row.
   * KHÔNG upload vào tab Ảnh tham chiếu.
   */
  onPickFiles?: (files: File[]) => Promise<{ name: string; image: string }[]>;
}

/**
 * Ảnh đầu / ảnh cuối theo từng prompt.
 * Chỉ chọn từ thư mục máy → hiển thị trên dòng; không dùng / không lưu thư viện tham chiếu.
 */
export default function QueueFramePicker({
  label,
  valueName,
  previewUrl,
  disabled,
  onChange,
  onPickFiles,
}: QueueFramePickerProps) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasValue = Boolean(previewUrl);

  function openFolderDialog(e?: ReactMouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    if (disabled || uploading || !onPickFiles) return;
    fileRef.current?.click();
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList?.length || !onPickFiles) return;
    setUploading(true);
    try {
      const frames = await onPickFiles(Array.from(fileList));
      const first = frames[0];
      if (first) {
        onChange({ name: first.name, image: first.image });
      }
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="queue-frame-picker">
      {onPickFiles && (
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif"
          className="queue-frame-file-input"
          disabled={disabled || uploading}
          onChange={(e) => void handleFiles(e.target.files)}
        />
      )}

      <div className="queue-frame-actions">
        <button
          type="button"
          className={`queue-frame-trigger${hasValue ? " is-set" : " is-empty"}`}
          disabled={disabled || uploading}
          onClick={(e) => openFolderDialog(e)}
          title={
            hasValue
              ? `${valueName || "Ảnh đã gắn"} — chỉ cho prompt này, bấm để đổi`
              : `${label} — chọn từ máy, chỉ gắn prompt này`
          }
        >
          {previewUrl ? (
            previewUrl === "loading" ? (
              <>
                <span className="mhp-spinner" style={{ margin: "4px auto" }} />
                <span className="queue-frame-trigger-text" style={{ fontSize: 9 }}>Trích xuất...</span>
              </>
            ) : (
              <>
                <img src={previewUrl} alt="" />
                <span className="queue-frame-trigger-text">{valueName || "Đã gắn"}</span>
              </>
            )
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


        {hasValue && (
          <button
            type="button"
            className="queue-frame-clear-inline"
            disabled={disabled || uploading}
            title="Gỡ ảnh khỏi prompt này"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onChange({ name: null, image: null });
            }}
          >
            ✕
          </button>
        )}

        {onPickFiles && !hasValue && (
          <button
            type="button"
            className="queue-frame-folder-icon"
            disabled={disabled || uploading}
            title="Chọn ảnh từ thư mục máy (không vào Ảnh tham chiếu)"
            onClick={(e) => openFolderDialog(e)}
          >
            📂
          </button>
        )}
      </div>
    </div>
  );
}
