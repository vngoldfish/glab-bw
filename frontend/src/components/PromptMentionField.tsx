import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { findLibraryRef, parseMentions } from "../referenceUtils";
import type { NamedReference } from "../types";

export interface PromptMentionFieldHandle {
  insertMentionAtCursor: (name: string) => void;
  saveSelection: () => void;
  focus: () => void;
}

interface PromptMentionFieldProps {
  value: string;
  library: NamedReference[];
  rows?: number;
  placeholder?: string;
  className?: string;
  menuPlacement?: "above" | "below";
  onFocus?: () => void;
  onChange: (value: string) => void;
}

function getActiveMentionQuery(text: string, cursor: number): string | null {
  const before = text.slice(0, cursor).replace(/\uFF20/g, "@");
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineBefore = before.slice(lineStart);
  if (!/@([a-zA-Z0-9_]*)$/.test(lineBefore)) return null;
  const match = lineBefore.match(/@([a-zA-Z0-9_]*)$/);
  return match ? match[1] : null;
}

const PromptMentionField = forwardRef<PromptMentionFieldHandle, PromptMentionFieldProps>(
  function PromptMentionField(
    {
      value,
      library,
      rows = 3,
      placeholder,
      className = "queue-prompt-input",
      menuPlacement = "below",
      onFocus,
      onChange,
    },
    ref,
  ) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const lastSelectionRef = useRef({ start: 0, end: 0 });
    const pendingCursorRef = useRef<number | null>(null);
    const [mentionQuery, setMentionQuery] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);

    const mentions = useMemo(() => parseMentions(value, library), [value, library]);

    const suggestions = useMemo(() => {
      if (mentionQuery === null || library.length === 0) return [];
      const q = mentionQuery.toLowerCase();
      return library
        .filter((item) => {
          if (!q) return true;
          return (
            item.name.toLowerCase().includes(q) ||
            item.label.toLowerCase().includes(q)
          );
        })
        .slice(0, 8);
    }, [library, mentionQuery]);

    useLayoutEffect(() => {
      if (pendingCursorRef.current === null) return;
      const el = textareaRef.current;
      if (!el) return;
      const pos = pendingCursorRef.current;
      pendingCursorRef.current = null;
      if (document.activeElement !== el) {
        el.focus({ preventScroll: true });
      }
      el.setSelectionRange(pos, pos);
      lastSelectionRef.current = { start: pos, end: pos };
    }, [value]);

    function saveSelection() {
      const el = textareaRef.current;
      if (!el) return;
      lastSelectionRef.current = {
        start: el.selectionStart,
        end: el.selectionEnd,
      };
    }

    function getSelectionRange() {
      const el = textareaRef.current;
      if (!el) return lastSelectionRef.current;
      if (document.activeElement === el) {
        return { start: el.selectionStart, end: el.selectionEnd };
      }
      return lastSelectionRef.current;
    }

    function restoreCursor(pos: number) {
      pendingCursorRef.current = pos;
      lastSelectionRef.current = { start: pos, end: pos };
    }

    function syncMentionState() {
      const el = textareaRef.current;
      if (!el) return;
      saveSelection();
      setMentionQuery(getActiveMentionQuery(el.value, el.selectionStart));
      setActiveIndex(0);
    }

    function applyTextUpdate(next: string, cursor: number) {
      const el = textareaRef.current;
      if (!el) return;

      setMentionQuery(null);
      restoreCursor(cursor);
      onChange(next);
    }

    function insertMentionAtCursor(name: string) {
      const el = textareaRef.current;
      if (!el) return;

      const { start, end } = getSelectionRange();
      const token = `@${name} `;
      const cursor = start + token.length;

      if (document.activeElement !== el) {
        el.setSelectionRange(start, end);
      }

      el.setRangeText(token, start, end, "end");
      applyTextUpdate(el.value, cursor);
    }

    function completePartialMention(name: string) {
      const el = textareaRef.current;
      if (!el) return;

      const cursor = document.activeElement === el
        ? el.selectionStart
        : lastSelectionRef.current.start;
      const text = el.value;
      const before = text.slice(0, cursor).replace(/\uFF20/g, "@");
      const atIndex = before.lastIndexOf("@");

      if (atIndex < 0) {
        insertMentionAtCursor(name);
        return;
      }

      const replacement = `@${name} `;
      const pos = atIndex + replacement.length;

      if (document.activeElement !== el) {
        el.setSelectionRange(atIndex, cursor);
      }

      el.setRangeText(replacement, atIndex, cursor, "end");
      applyTextUpdate(el.value, pos);
    }

    useImperativeHandle(ref, () => ({
      insertMentionAtCursor,
      saveSelection,
      focus: () => textareaRef.current?.focus({ preventScroll: true }),
    }));

    function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
      if (mentionQuery === null || suggestions.length === 0) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        completePartialMention(suggestions[activeIndex].name);
      } else if (e.key === "Escape") {
        setMentionQuery(null);
      }
    }

    const menuClass =
      menuPlacement === "above"
        ? "prompt-mention-menu prompt-mention-menu--above"
        : "prompt-mention-menu";

    return (
      <div className={`prompt-mention-field${menuPlacement === "above" ? " prompt-mention-field--above-menu" : ""}`}>
        <div className="prompt-mention-input-wrap">
          <textarea
            ref={textareaRef}
            rows={rows}
            className={className}
            value={value}
            placeholder={placeholder}
            onFocus={() => {
              onFocus?.();
              syncMentionState();
            }}
            onBlur={saveSelection}
            onSelect={saveSelection}
            onMouseUp={saveSelection}
            onKeyUp={syncMentionState}
            onClick={syncMentionState}
            onKeyDown={(e) => {
              saveSelection();
              handleKeyDown(e);
            }}
            onChange={(e) => {
              saveSelection();
              onChange(e.target.value);
              window.requestAnimationFrame(syncMentionState);
            }}
          />

          {mentionQuery !== null && suggestions.length > 0 && (
            <div className={menuClass} role="listbox">
              {suggestions.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  className={[
                    "prompt-mention-option",
                    index === activeIndex ? "prompt-mention-option--active" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => completePartialMention(item.name)}
                >
                  <img src={item.image} alt={item.name} />
                  <span className="prompt-mention-option-name">@{item.name}</span>
                  <span className="prompt-mention-option-label">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {mentions.length > 0 ? (
          <div className="prompt-mention-preview">
            {mentions.map((mention) => {
              const refItem = findLibraryRef(library, mention);
              return (
                <span
                  key={mention}
                  className={[
                    "prompt-mention-chip",
                    refItem ? "prompt-mention-chip--ok" : "prompt-mention-chip--missing",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  title={refItem ? refItem.label : "Không có trong thư viện"}
                >
                  {refItem ? (
                    <img src={refItem.image} alt={mention} />
                  ) : (
                    <span className="prompt-mention-chip-missing">?</span>
                  )}
                  @{mention}
                </span>
              );
            })}
          </div>
        ) : value.includes("@") ? (
          <p className="prompt-mention-hint">
            Gõ <code>@tên</code> đúng như trong thư viện (vd. @hoa, @lieu) — gõ <code>@</code> để gợi ý.
          </p>
        ) : null}
      </div>
    );
  },
);

export default PromptMentionField;