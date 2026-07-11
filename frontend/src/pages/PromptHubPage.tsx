import { useCallback, useEffect, useState } from "react";
import {
  createPrompt,
  deletePrompt,
  fetchPrompts,
  updatePrompt,
  usePrompt,
  type HubPrompt,
} from "../api";
import { useUiDialog } from "../components/UiDialog";

interface PromptHubPageProps {
  onError: (msg: string) => void;
  onUseInQueue?: (text: string, kind: string) => void;
}

export default function PromptHubPage({ onError }: PromptHubPageProps) {
  const dialog = useUiDialog();
  const [prompts, setPrompts] = useState<HubPrompt[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [newKind, setNewKind] = useState("any");
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setPrompts(await fetchPrompts({ kind: kind === "all" ? undefined : kind, q: q || undefined }));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [kind, q, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    try {
      setLoading(true);
      if (editId) {
        await updatePrompt(editId, { title, text, kind: newKind });
        setEditId(null);
      } else {
        await createPrompt({ title, text, kind: newKind });
      }
      setTitle("");
      setText("");
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="prompt-hub-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Prompt Hub</h1>
          <span className="pill pill-green">THƯ VIỆN</span>
        </div>
      </header>

      <section className="panel-card">
        <h2>{editId ? "Sửa prompt" : "Thêm prompt"}</h2>
        <div className="form-grid">
          <label>
            Tiêu đề
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Tên gợi nhớ" />
          </label>
          <label>
            Loại
            <select value={newKind} onChange={(e) => setNewKind(e.target.value)}>
              <option value="any">Any</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </label>
          <label className="span-2">
            Nội dung prompt
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Prompt…" />
          </label>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <button type="button" className="btn btn-primary" disabled={loading || !text.trim()} onClick={() => void handleSave()}>
            {editId ? "Cập nhật" : "Lưu vào Hub"}
          </button>
          {editId && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setEditId(null);
                setTitle("");
                setText("");
              }}
            >
              Hủy sửa
            </button>
          )}
        </div>
      </section>

      <section className="panel-card" style={{ marginTop: 16 }}>
        <h2>Danh sách ({prompts.length})</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
          <input
            placeholder="Tìm…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 180 }}
          />
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">Tất cả</option>
            <option value="image">Image</option>
            <option value="video">Video</option>
            <option value="any">Any</option>
          </select>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>
            Lọc
          </button>
        </div>
        {prompts.length === 0 ? (
          <p className="muted">Chưa có prompt — thêm ở trên.</p>
        ) : (
          <div className="prompt-list">
            {prompts.map((p) => (
              <article key={p.id} className="prompt-card">
                <div className="prompt-card-header">
                  <h3 className="prompt-card-title">{p.title}</h3>
                  <span className={`prompt-card-kind-badge ${p.kind || "any"}`}>
                    {p.kind}
                  </span>
                </div>
                <p className="prompt-card-content">{p.text}</p>
                <div className="prompt-card-footer">
                  <span className="prompt-card-use-count">Dùng {p.use_count ?? 0} lần</span>
                  <div className="account-card-actions" style={{ marginTop: 0 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      title="Copy prompt"
                      onClick={async () => {
                        try {
                          await usePrompt(p.id);
                          await navigator.clipboard.writeText(p.text);
                          await load();
                        } catch (e) {
                          onError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setEditId(p.id);
                        setTitle(p.title);
                        setText(p.text);
                        setNewKind(p.kind || "any");
                      }}
                    >
                      Sửa
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost danger btn-sm"
                      onClick={async () => {
                        const ok = await dialog.confirm({
                          title: "Xóa prompt?",
                          message: "Prompt này sẽ bị xóa khỏi Hub.",
                          confirmLabel: "Xóa",
                          cancelLabel: "Hủy",
                          tone: "danger",
                        });
                        if (!ok) return;
                        try {
                          await deletePrompt(p.id);
                          await load();
                        } catch (e) {
                          onError(e instanceof Error ? e.message : String(e));
                        }
                      }}
                    >
                      Xóa
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
