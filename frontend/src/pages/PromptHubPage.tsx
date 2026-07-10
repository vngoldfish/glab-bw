import { useCallback, useEffect, useRef, useState } from "react";
import {
  createPrompt,
  deletePrompt,
  fetchPrompts,
  updatePrompt,
  usePrompt,
  type HubPrompt,
} from "../api";
import { useUiDialog } from "../components/UiDialog";
import { useReferenceLibrary } from "../referenceLibraryContext";
import { slugifyRefName, isValidRefName, ensureUniqueRefName } from "../referenceUtils";
import type { NamedReference } from "../types";

interface PromptHubPageProps {
  onError: (msg: string) => void;
  onUseInQueue?: (text: string, kind: string) => void;
}

export default function PromptHubPage({ onError }: PromptHubPageProps) {
  const dialog = useUiDialog();
  const {
    library,
    addReferences,
    updateReference,
    removeReference,
  } = useReferenceLibrary();

  const [activeTab, setActiveTab] = useState<"prompts" | "characters">("prompts");
  
  // Prompt Hub state
  const [prompts, setPrompts] = useState<HubPrompt[]>([]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("all");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [newKind, setNewKind] = useState("any");
  const [loading, setLoading] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  // Characters tab state
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [charSearch, setCharSearch] = useState("");

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
    if (activeTab === "prompts") {
      void load();
    }
  }, [load, activeTab]);

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

  // Character management functions
  async function handleCharUpload(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      const added = await addReferences(list);
      for (const item of added) {
        // Set category to "character" immediately
        await updateReference(item.id, { category: "character" });
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }

  async function saveCharName(item: NamedReference, raw: string) {
    const next = slugifyRefName(raw);
    if (!isValidRefName(next)) {
      onError("Tên chỉ gồm chữ, số và _ — bắt đầu bằng chữ cái");
      return;
    }
    const unique = ensureUniqueRefName(next, library, item.id);
    if (unique === item.name) return;
    try {
      await updateReference(item.id, { name: unique });
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }

  // Filter character items
  const characters = library.filter((item) => item.category === "character");
  const filteredChars = characters.filter((item) => {
    const q = charSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      item.name.toLowerCase().includes(q) ||
      item.label.toLowerCase().includes(q)
    );
  });

  return (
    <div className="prompt-hub-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Prompt Hub</h1>
          <span className="pill pill-green">THƯ VIỆN</span>
        </div>
      </header>

      {/* Tab Selectors */}
      <div className="hub-tab-container">
        <button
          type="button"
          className={`hub-tab-btn ${activeTab === "prompts" ? "active" : ""}`}
          onClick={() => setActiveTab("prompts")}
        >
          Thư viện prompt
        </button>
        <button
          type="button"
          className={`hub-tab-btn ${activeTab === "characters" ? "active" : ""}`}
          onClick={() => setActiveTab("characters")}
        >
          Nhân vật của tôi (Consistent Character)
        </button>
      </div>

      {activeTab === "prompts" ? (
        <>
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
        </>
      ) : (
        <div className="ref-page-body" style={{ marginTop: 0 }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={async (e) => {
              const files = e.target.files;
              if (files) await handleCharUpload(files);
              e.target.value = "";
            }}
          />

          <aside className="ref-page-aside">
            <section className="ref-page-guide">
              <h3>Nhân vật nhất quán (Veo)</h3>
              <p>
                Đặt tên gợi nhớ cho nhân vật mẫu (Ví dụ: <code>nam_chinh</code>). 
                Khi viết prompt tạo video, gọi tên nhân vật mẫu bằng cú pháp <code>@nam_chinh</code>.
              </p>
              <div className="ref-page-example">
                <span className="ref-page-example-label">Ví dụ</span>
                <code>@nam_chinh đi dạo trong công viên vào buổi sáng</code>
              </div>
              <ul className="ref-page-guide-list">
                <li>Google Veo sẽ sử dụng ảnh này làm cref/sref tham chiếu khuôn mặt.</li>
                <li>Hệ thống tự động đồng bộ ảnh nhân vật với thư viện ảnh tham chiếu chung.</li>
              </ul>
            </section>

            <button
              type="button"
              className="btn btn-primary"
              style={{ width: "100%", marginTop: 12 }}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Đang tải ảnh..." : "+ Thêm ảnh nhân vật"}
            </button>
          </aside>

          <main className="ref-page-main">
            <div className="ref-page-toolbar">
              <div className="ref-page-search">
                <span className="ref-page-search-icon" aria-hidden>⌕</span>
                <input
                  type="search"
                  placeholder="Tìm nhân vật..."
                  value={charSearch}
                  onChange={(e) => setCharSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="ref-page-scroll">
              {characters.length === 0 ? (
                <div className="ref-page-state ref-page-state--empty">
                  <div className="ref-page-state-icon">👥</div>
                  <h3>Chưa có nhân vật nào</h3>
                  <p>Tải ảnh chân dung khuôn mặt lên để sử dụng làm nhân vật nhất quán trong Veo.</p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    + Thêm nhân vật đầu tiên
                  </button>
                </div>
              ) : filteredChars.length === 0 ? (
                <div className="ref-page-state">
                  <p>Không tìm thấy nhân vật phù hợp.</p>
                </div>
              ) : (
                <div className="ref-page-grid">
                  {filteredChars.map((item) => (
                    <article key={item.id} className="ref-gallery-card">
                      <div className="ref-gallery-media">
                        <img src={item.image} alt={item.label} loading="lazy" />
                        <span className="ref-gallery-cat ref-cat-character">
                          Nhân vật
                        </span>
                      </div>

                      <div className="ref-gallery-body">
                        <div className="ref-gallery-token">@{item.name}</div>
                        <label className="ref-gallery-field">
                          <span>Tên gọi</span>
                          <input
                            defaultValue={item.name}
                            key={`${item.id}-${item.name}`}
                            onBlur={(e) => saveCharName(item, e.target.value)}
                          />
                        </label>
                        <label className="ref-gallery-field">
                          <span>Mô tả nhãn</span>
                          <input
                            defaultValue={item.label}
                            key={`${item.id}-${item.label}`}
                            onBlur={(e) => {
                              const label = e.target.value.trim() || item.name;
                              if (label !== item.label) {
                                updateReference(item.id, { label }).catch((err) =>
                                  onError(String(err))
                                );
                              }
                            }}
                          />
                        </label>
                      </div>

                      <div className="ref-gallery-footer">
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs ref-gallery-copy"
                          onClick={() => {
                            void navigator.clipboard.writeText(`@${item.name}`);
                          }}
                        >
                          Copy @{item.name}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs danger"
                          onClick={async () => {
                            const ok = await dialog.confirm({
                              title: "Xóa nhân vật?",
                              message: `Ảnh nhân vật @${item.name} sẽ bị xóa hoàn toàn khỏi thư viện.`,
                              confirmLabel: "Xóa",
                              cancelLabel: "Hủy",
                              tone: "danger",
                            });
                            if (!ok) return;
                            removeReference(item.id).catch((err) => onError(String(err)));
                          }}
                        >
                          Xóa
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
