import { useCallback, useEffect, useState } from "react";
import {
  createPrompt,
  deletePrompt,
  fetchPrompts,
  updatePrompt,
  usePrompt,
  type HubPrompt,
} from "../api";

interface PromptHubPageProps {
  onError: (msg: string) => void;
  onUseInQueue?: (text: string, kind: string) => void;
}

export default function PromptHubPage({ onError }: PromptHubPageProps) {
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
          <div className="account-list">
            {prompts.map((p) => (
              <article key={p.id} className="account-card">
                <div style={{ flex: 1 }}>
                  <strong>{p.title}</strong>
                  <p>
                    {p.kind} · dùng {p.use_count ?? 0} lần
                  </p>
                  <small style={{ whiteSpace: "pre-wrap" }}>{p.text.slice(0, 240)}{p.text.length > 240 ? "…" : ""}</small>
                </div>
                <div className="account-card-actions">
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
                      if (!confirm("Xóa prompt này?")) return;
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
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
