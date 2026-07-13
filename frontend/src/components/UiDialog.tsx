/**
 * In-app modal dialogs — replaces ugly window.alert / confirm / prompt.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type DialogTone = "default" | "danger" | "success";

type ConfirmOpts = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
};

type PromptOpts = {
  title?: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DialogTone;
};

type AlertOpts = {
  title?: string;
  message: string;
  confirmLabel?: string;
  tone?: DialogTone;
};

type DialogApi = {
  confirm: (opts: ConfirmOpts | string) => Promise<boolean>;
  prompt: (opts: PromptOpts | string, defaultValue?: string) => Promise<string | null>;
  alert: (opts: AlertOpts | string) => Promise<void>;
};

type Mode = "confirm" | "prompt" | "alert";

type ActiveDialog = {
  mode: Mode;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  tone: DialogTone;
  defaultValue: string;
  placeholder: string;
  resolve: (value: boolean | string | null | void) => void;
};

const UiDialogContext = createContext<DialogApi | null>(null);

function normalizeConfirm(opts: ConfirmOpts | string): ConfirmOpts {
  if (typeof opts === "string") return { message: opts };
  return opts;
}

function normalizePrompt(opts: PromptOpts | string, defaultValue?: string): PromptOpts {
  if (typeof opts === "string") return { message: opts, defaultValue };
  return { ...opts, defaultValue: opts.defaultValue ?? defaultValue };
}

function normalizeAlert(opts: AlertOpts | string): AlertOpts {
  if (typeof opts === "string") return { message: opts };
  return opts;
}

export function UiDialogProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveDialog | null>(null);
  const [closingValue, setClosingValue] = useState<boolean | string | null | void | undefined>(undefined);
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const lastActiveRef = useRef<ActiveDialog | null>(null);
  const titleId = useId();
  const descId = useId();

  if (active) {
    lastActiveRef.current = active;
  }
  const rendered = active || lastActiveRef.current;

  const close = useCallback((value: boolean | string | null | void) => {
    setClosingValue(value);
  }, []);

  useEffect(() => {
    if (closingValue === undefined) return;
    const t = setTimeout(() => {
      setActive((cur) => {
        if (cur) cur.resolve(closingValue);
        return null;
      });
      setClosingValue(undefined);
    }, 180); // Matches CSS transition (0.18s)
    return () => clearTimeout(t);
  }, [closingValue]);

  const confirm = useCallback((opts: ConfirmOpts | string) => {
    const o = normalizeConfirm(opts);
    return new Promise<boolean>((resolve) => {
      setInput("");
      setActive({
        mode: "confirm",
        title: o.title || "Xác nhận",
        message: o.message,
        confirmLabel: o.confirmLabel || "Đồng ý",
        cancelLabel: o.cancelLabel || "Hủy",
        tone: o.tone || "default",
        defaultValue: "",
        placeholder: "",
        resolve: (v) => resolve(Boolean(v)),
      });
    });
  }, []);

  const prompt = useCallback((opts: PromptOpts | string, defaultValue?: string) => {
    const o = normalizePrompt(opts, defaultValue);
    return new Promise<string | null>((resolve) => {
      const def = o.defaultValue ?? "";
      setInput(def);
      setActive({
        mode: "prompt",
        title: o.title || "Nhập thông tin",
        message: o.message || "",
        confirmLabel: o.confirmLabel || "Lưu",
        cancelLabel: o.cancelLabel || "Hủy",
        tone: o.tone || "default",
        defaultValue: def,
        placeholder: o.placeholder || "",
        resolve: (v) => resolve(v === null || v === undefined ? null : String(v)),
      });
    });
  }, []);

  const alert = useCallback((opts: AlertOpts | string) => {
    const o = normalizeAlert(opts);
    return new Promise<void>((resolve) => {
      setInput("");
      setActive({
        mode: "alert",
        title: o.title || "Thông báo",
        message: o.message,
        confirmLabel: o.confirmLabel || "Đã hiểu",
        cancelLabel: "",
        tone: o.tone || "default",
        defaultValue: "",
        placeholder: "",
        resolve: () => resolve(),
      });
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    if (active.mode === "prompt") {
      const t = window.setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
      return () => window.clearTimeout(t);
    } else {
      const t = window.setTimeout(() => {
        const btn = document.querySelector<HTMLButtonElement>(".ui-dialog-actions button");
        btn?.focus();
      }, 30);
      return () => window.clearTimeout(t);
    }
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (active.mode === "alert") close(undefined);
        else if (active.mode === "confirm") close(false);
        else close(null);
      }
      if (e.key === "Enter" && active.mode !== "prompt") {
        if (e.target instanceof HTMLInputElement) return;
        e.preventDefault();
        if (active.mode === "confirm") close(true);
        else close(undefined);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, close]);

  const api: DialogApi = { confirm, prompt, alert };

  function onConfirmClick() {
    if (!rendered) return;
    if (rendered.mode === "prompt") {
      const v = input.trim();
      if (!v) return;
      close(v);
      return;
    }
    if (rendered.mode === "confirm") close(true);
    else close(undefined);
  }

  function onCancelClick() {
    if (!rendered) return;
    if (rendered.mode === "confirm") close(false);
    else if (rendered.mode === "prompt") close(null);
    else close(undefined);
  }

  const onOverlayKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Tab") return;
    const overlay = e.currentTarget;
    const focusables = overlay.querySelectorAll<HTMLElement>(
      'a[href], area[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex="0"]'
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        last.focus();
        e.preventDefault();
      }
    } else {
      if (document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    }
  };

  return (
    <UiDialogContext.Provider value={api}>
      {children}
      {rendered && (active || closingValue !== undefined) && (
        <div
          className={`ui-dialog-overlay ${closingValue !== undefined ? "closing" : ""}`}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onCancelClick();
          }}
          onKeyDown={onOverlayKeyDown}
        >
          <div
            className={`ui-dialog ui-dialog--${rendered.tone}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={rendered.message ? descId : undefined}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="ui-dialog-icon" aria-hidden>
              {rendered.tone === "danger" ? "!" : rendered.tone === "success" ? "✓" : "i"}
            </div>
            <h2 id={titleId} className="ui-dialog-title">
              {rendered.title}
            </h2>
            {rendered.message ? (
              <p id={descId} className="ui-dialog-message">
                {rendered.message}
              </p>
            ) : null}

            {rendered.mode === "prompt" && (
              <form
                className="ui-dialog-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  onConfirmClick();
                }}
              >
                <input
                  ref={inputRef}
                  className="ui-dialog-input"
                  value={input}
                  placeholder={rendered.placeholder}
                  onChange={(e) => setInput(e.target.value)}
                  autoComplete="off"
                />
              </form>
            )}

            <div className="ui-dialog-actions">
              {rendered.mode !== "alert" && (
                <button type="button" className="ui-dialog-btn ghost" onClick={onCancelClick}>
                  {rendered.cancelLabel}
                </button>
              )}
              <button
                type="button"
                className={`ui-dialog-btn primary${rendered.tone === "danger" ? " danger" : ""}`}
                onClick={onConfirmClick}
                disabled={rendered.mode === "prompt" && !input.trim()}
              >
                {rendered.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </UiDialogContext.Provider>
  );
}

export function useUiDialog(): DialogApi {
  const ctx = useContext(UiDialogContext);
  if (!ctx) {
    return {
      confirm: async (opts) => {
        const o = normalizeConfirm(opts);
        return window.confirm([o.title, o.message].filter(Boolean).join("\n\n"));
      },
      prompt: async (opts, def) => {
        const o = normalizePrompt(opts, def);
        return window.prompt(o.message || o.title || "", o.defaultValue ?? "");
      },
      alert: async (opts) => {
        const o = normalizeAlert(opts);
        window.alert([o.title, o.message].filter(Boolean).join("\n\n"));
      },
    };
  }
  return ctx;
}




