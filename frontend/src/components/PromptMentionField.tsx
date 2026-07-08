import { useMemo, useRef, useState } from "react";
import { findLibraryRef, parseMentions } from "../referenceUtils";
import type { NamedReference } from "../types";

interface PromptMentionFieldProps {
  value: string;
  library: NamedReference[];
  rows?: number;
  placeholder?: string;
  className?: string;
  onFocus?: () => void;
  onChange: (value: string) => void;
}

function getActiveMentionQuery(text: string, cursor: number): string | null {
  const before = text.slice(0, cursor).replace(/\uFF20/g, "@");
  const match = before.match(/@([a-zA-Z0-9_]*)$/);
  return match ? match[1] : null;
}

export default function PromptMentionField({
  value,
  library,
  rows = 3,
  placeholder,
  className = "queue-prompt-input",
  onFocus,
  onChange,
}: PromptMentionFieldProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const mentions = useMemo(() => parseMentions(value, library), [value, library]);

  const suggestions = useMemo(() => {
    if (mentionQuery === null) return [];
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

  function syncMentionState() {
    const el = textareaRef.current;
    if (!el) return;
    setMentionQuery(getActiveMentionQuery(el.value, el.selectionStart));
    setActiveIndex(0);
  }

  function insertMention(name: string) {
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const before = value.slice(0, cursor).replace(/\uFF20/g, "@");
    const after = value.slice(cursor);
    const atIndex = before.lastIndexOf("@");
    if (atIndex < 0) return;
    const next = `${value.slice(0, atIndex)}@${name} ${after}`;
    onChange(next);
    setMentionQuery(null);
    window.requestAnimationFrame(() => {
      const pos = atIndex + name.length + 2;
      el.focus();
      el.setSelectionRange(pos, pos);
    });
  }

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
      insertMention(suggestions[activeIndex].name);
    } else if (e.key === "Escape") {
      setMentionQuery(null);
    }
  }

  return (
    <div className="prompt-mention-field">
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
          onClick={syncMentionState}
          onKeyUp={syncMentionState}
          onKeyDown={handleKeyDown}
          onChange={(e) => {
            onChange(e.target.value);
            window.requestAnimationFrame(syncMentionState);
          }}
        />

        {mentionQuery !== null && suggestions.length > 0 && (
          <div className="prompt-mention-menu" role="listbox">
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
                onClick={() => insertMention(item.name)}
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
            const ref = findLibraryRef(library, mention);
            return (
              <span
                key={mention}
                className={[
                  "prompt-mention-chip",
                  ref ? "prompt-mention-chip--ok" : "prompt-mention-chip--missing",
                ]
                  .filter(Boolean)
                  .join(" ")}
                title={ref ? ref.label : "Không có trong thư viện"}
              >
                {ref ? (
                  <img src={ref.image} alt={mention} />
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
}