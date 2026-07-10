import { useCallback, useEffect, useState } from "react";
import {
  Account,
  AiSettings,
  Provider,
  aiHasSavedKey,
  createAccount,
  deleteAccount,
  fetchAiSettings,
  saveAiApiSettings,
  savePromptSettings,
  testAiApi,
  updateAccount,
} from "../api";
import { parseFlowCookieInput } from "../cookie";

const AI_PROVIDERS = [
  { value: "openai", label: "OpenAI", base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  {
    value: "openai_compatible",
    label: "API ngoài (OpenAI-compatible)",
    base: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  { value: "grok", label: "xAI Grok", base: "https://api.x.ai/v1", model: "grok-2-latest" },
  {
    value: "custom",
    label: "Tùy chỉnh (Base URL + Key bất kỳ)",
    base: "",
    model: "",
  },
] as const;

/**
 * Hướng dẫn mẫu: user gõ prompt CHUNG CHUNG → AI phân tích → viết lại
 * thành prompt CHUYÊN NGHIỆP dễ cho model tạo ảnh/video.
 * Bấm chip → đổ vào "Hướng dẫn thêm".
 */
const IMAGE_PROMPT_TEMPLATES: { id: string; label: string; text: string }[] = [
  {
    id: "img-default-pro",
    label: "Chung → Pro (mặc định)",
    text:
      "User đưa ý ngắn/chung chung. Phân tích chủ thể – bối cảnh – hành động – cảm xúc, " +
      "rồi viết lại thành 1 prompt ảnh chuyên nghiệp: rõ người/vật, nơi chốn, pose, " +
      "ánh sáng, composition. Giữ đúng ý gốc, không đổi câu chuyện, không thêm nhân vật lạ. " +
      "Giữ @tên nếu user đã gõ; không bịa @.",
  },
  {
    id: "img-subject-bg",
    label: "Rõ chủ thể + nền",
    text:
      "Từ prompt mơ hồ, làm rõ: (1) chủ thể là ai/cái gì, (2) đang làm gì, (3) nền/bối cảnh, " +
      "(4) khoảng cách khung (close-up / nửa người / full). Dễ cho AI tạo ảnh hiểu ngay.",
  },
  {
    id: "img-light-comp",
    label: "Ánh sáng + khung hình",
    text:
      "Bổ sung ánh sáng (tự nhiên / studio / hoàng hôn…) và composition (rule of thirds, " +
      "độ sâu trường ảnh, góc máy) sao cho model gen ảnh ổn định. Không bịa cảnh mới.",
  },
  {
    id: "img-keep-at",
    label: "Giữ @ref nhân vật",
    text:
      "Nếu prompt có @tên (thư viện nhân vật), giữ nguyên token. " +
      "Chỉ viết thêm phần mô tả cảnh cho chuyên nghiệp; không đổi mặt/tuổi/trang phục @ref, " +
      "không invent @mới.",
  },
  {
    id: "img-short-clear",
    label: "Ngắn – rõ – 1–3 câu",
    text:
      "Viết lại ngắn gọn 1–3 câu, mỗi ý một lớp (chủ thể → cảnh → ánh sáng). " +
      "Tránh liệt kê keyword dài, tránh essay. Ưu tiên tiếng Việt dễ hiểu cho Flow Image.",
  },
  {
    id: "img-no-story",
    label: "Không bịa thêm chuyện",
    text:
      "Chỉ làm rõ ý user đã viết. Cấm thêm cốt truyện, địa điểm, hay nhân vật user không nhắc. " +
      "Nếu user chỉ viết 3–5 từ, suy ra bối cảnh tối thiểu hợp lý nhưng vẫn cùng ý.",
  },
];

const VIDEO_PROMPT_TEMPLATES: { id: string; label: string; text: string }[] = [
  {
    id: "vid-default-pro",
    label: "Chung → Pro (mặc định)",
    text:
      "User đưa ý ngắn/chung chung. Phân tích rồi viết prompt video chuyên nghiệp: " +
      "chủ thể, hành động, bối cảnh, chuyển động camera, nhịp clip. " +
      "Giữ đúng ý gốc; 1 cảnh liên tục; giữ @tên nếu có; không bịa @.",
  },
  {
    id: "vid-add-motion",
    label: "Thêm chuyển động",
    text:
      "Từ prompt tĩnh/chung, làm rõ motion: chủ thể làm gì, camera push-in/pan/dolly hay cố định, " +
      "tốc độ chậm hay bình thường — để model video hiểu dễ. Không đổi chủ đề.",
  },
  {
    id: "vid-one-shot",
    label: "1 take · 1 cảnh",
    text:
      "Viết cho 1 take duy nhất (không cắt nhiều cảnh). Mô tả liên tục đầu→cuối clip. " +
      "Phù hợp Veo/Flow 4–10s. Không kịch bản phim nhiều shot.",
  },
  {
    id: "vid-keep-at",
    label: "Giữ @ref nhân vật",
    text:
      "Có @tên thì giữ nguyên. Chỉ chuyên nghiệp hóa mô tả hành động/camera. " +
      "Không thay nhân vật, không thêm người ngoài @ đã có.",
  },
  {
    id: "vid-i2v-soft",
    label: "I2V: motion nhẹ",
    text:
      "Khi ý là “làm video từ ảnh”: ưu tiên chuyển động nhẹ tự nhiên (tóc, vải, hơi thở, bước chân), " +
      "giữ bố cục gần khung gốc. Không nhảy góc máy mạnh, không bịa @.",
  },
  {
    id: "vid-no-story",
    label: "Không bịa thêm chuyện",
    text:
      "Chỉ mở rộng chi tiết hình ảnh/chuyển động từ ý user. " +
      "Cấm thêm cốt truyện, địa điểm, hay nhân vật user không nhắc tới.",
  },
];

const PROVIDER_LABELS: Record<Provider, string> = {
  flow: "Google Flow / Veo",
  grok: "Grok AI",
  meta: "Meta AI",
  openai: "OpenAI",
};

interface SettingsPageProps {
  accounts: Account[];
  onRefresh: () => Promise<void>;
  onError: (msg: string) => void;
}

function formatCooldown(sec?: number): string {
  if (!sec || sec <= 0) return "";
  const m = Math.ceil(sec / 60);
  if (m < 60) return `~${m} phút`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `~${h}h ${rm}m` : `~${h}h`;
}

export default function SettingsPage({ accounts, onRefresh, onError }: SettingsPageProps) {
  const [loading, setLoading] = useState(false);
  const [newProvider, setNewProvider] = useState<Provider>("flow");
  const [newLabel, setNewLabel] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [newCookie, setNewCookie] = useState("");
  const [newSessionToken, setNewSessionToken] = useState("");

  const [ai, setAi] = useState<AiSettings | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiProvider, setAiProvider] = useState("openai_compatible");
  const [aiBaseUrl, setAiBaseUrl] = useState("https://api.openai.com/v1");
  const [aiModel, setAiModel] = useState("gpt-4o-mini");
  const [aiApiKey, setAiApiKey] = useState("");
  /** User bấm "Đổi key" — chỉ khi true mới gửi api_key lên server */
  const [aiReplaceKey, setAiReplaceKey] = useState(false);
  const [aiImageEnabled, setAiImageEnabled] = useState(true);
  const [aiVideoEnabled, setAiVideoEnabled] = useState(true);
  const [aiImageStyle, setAiImageStyle] = useState("pro");
  const [aiVideoStyle, setAiVideoStyle] = useState("pro");
  const [aiImageCustom, setAiImageCustom] = useState("");
  const [aiVideoCustom, setAiVideoCustom] = useState("");
  const [aiSaving, setAiSaving] = useState(false);
  const [aiTesting, setAiTesting] = useState(false);
  const [promptSaving, setPromptSaving] = useState(false);
  const [aiMsg, setAiMsg] = useState("");
  const [aiTestMsg, setAiTestMsg] = useState("");
  const [aiTestOk, setAiTestOk] = useState<boolean | null>(null);
  const [promptMsg, setPromptMsg] = useState("");
  const [aiLoading, setAiLoading] = useState(true);

  const flowAccounts = accounts.filter((a) => a.provider === "flow");
  const flowReady = flowAccounts.filter((a) => a.enabled && a.has_credentials && !a.in_cooldown);
  const hasSavedKey = aiHasSavedKey(ai);

  const applyAiSettings = useCallback((data: AiSettings) => {
    setAi(data);
    setAiEnabled(data.enabled);
    setAiProvider(data.provider || "openai_compatible");
    setAiBaseUrl(data.base_url || "https://api.openai.com/v1");
    setAiModel(data.model || "gpt-4o-mini");
    setAiImageEnabled(data.image_enabled !== false);
    setAiVideoEnabled(data.video_enabled !== false);
    setAiImageStyle(data.image_style || "pro");
    setAiVideoStyle(data.video_style || "pro");
    setAiImageCustom(data.image_custom_instruction || "");
    setAiVideoCustom(data.video_custom_instruction || "");
    // Không xóa key đã lưu trên server; form key luôn rỗng trừ khi user đổi
    setAiApiKey("");
    setAiReplaceKey(false);
  }, []);

  const loadAiSettings = useCallback(async () => {
    setAiLoading(true);
    try {
      const data = await fetchAiSettings();
      applyAiSettings(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }, [applyAiSettings, onError]);

  useEffect(() => {
    void loadAiSettings();
  }, [loadAiSettings]);

  function applyAiProviderPreset(value: string) {
    setAiProvider(value);
    const preset = AI_PROVIDERS.find((p) => p.value === value);
    if (preset) {
      if (preset.base) setAiBaseUrl(preset.base);
      if (preset.model) setAiModel(preset.model);
    }
  }

  /** Chỉ lưu kết nối API AI — key trống = giữ key đã lưu trên server. */
  async function handleSaveAiApi() {
    setAiSaving(true);
    setAiMsg("");
    onError("");
    try {
      // Lần đầu (chưa có key) HOẶC đang "Đổi key": gửi key đang gõ.
      // Đã có key + không đổi: không gửi field api_key → server giữ key cũ.
      const typedKey = aiApiKey.trim();
      const sendKey = !hasSavedKey || aiReplaceKey;
      const newKey = sendKey ? typedKey : "";
      if (sendKey && !newKey && !hasSavedKey) {
        onError("Nhập API key trước khi lưu");
        setAiSaving(false);
        return;
      }
      if (aiReplaceKey && !newKey && hasSavedKey) {
        // User bấm Đổi key rồi Lưu trống → giữ key cũ (không xóa)
        setAiMsg("Key trống — giữ key đã lưu, không thay");
      }
      const data = await saveAiApiSettings({
        enabled: aiEnabled,
        provider: aiProvider,
        base_url: aiBaseUrl,
        model: aiModel,
        ...(newKey ? { api_key: newKey } : {}),
      });
      applyAiSettings(data);
      if (!aiHasSavedKey(data)) {
        setAiMsg("Đã lưu — chưa có API key, dán key vào ô API Key rồi bấm Lưu");
      } else if (data.enabled) {
        setAiMsg(
          newKey
            ? `Đã lưu key mới (${data.api_key_masked}) — sẵn sàng bấm ✦`
            : `Đã lưu cấu hình — giữ key cũ (${data.api_key_masked})`,
        );
      } else {
        setAiMsg(`Đã lưu (key ${data.api_key_masked}) — tick Bật AI để dùng`);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setAiSaving(false);
    }
  }

  /** Gọi thử API — ưu tiên key form (lần đầu / đang đổi); không thì key đã lưu. */
  async function handleTestAiApi() {
    setAiTesting(true);
    setAiTestMsg("");
    setAiTestOk(null);
    onError("");
    try {
      const typed = !hasSavedKey || aiReplaceKey ? aiApiKey.trim() : "";
      if (!typed && !hasSavedKey) {
        throw new Error("Chưa có API key — dán key vào ô API Key rồi bấm Lưu hoặc Test");
      }
      const result = await testAiApi({
        provider: aiProvider,
        base_url: aiBaseUrl.trim(),
        model: aiModel.trim(),
        ...(typed ? { api_key: typed } : {}),
      });
      setAiTestOk(true);
      setAiTestMsg(
        result.message ||
          `Kết nối OK · ${result.model || aiModel} · ${result.latency_ms ?? "?"}ms` +
            (hasSavedKey && !typed ? " · dùng key đã lưu" : ""),
      );
    } catch (err) {
      setAiTestOk(false);
      const msg = err instanceof Error ? err.message : String(err);
      setAiTestMsg(msg);
      onError(msg);
    } finally {
      setAiTesting(false);
    }
  }

  /** Chỉ lưu cách viết lại prompt — không đụng API key / model. */
  async function handleSavePrompt() {
    setPromptSaving(true);
    setPromptMsg("");
    onError("");
    try {
      const data = await savePromptSettings({
        image_enabled: aiImageEnabled,
        video_enabled: aiVideoEnabled,
        image_style: aiImageStyle,
        video_style: aiVideoStyle,
        image_custom_instruction: aiImageCustom,
        video_custom_instruction: aiVideoCustom,
      });
      setAi(data);
      setPromptMsg("Đã lưu cấu hình prompt — ✦ Flow Ảnh / Video dùng style này");
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setPromptSaving(false);
    }
  }

  const STYLE_OPTIONS = [
    { value: "light", label: "Nhẹ — chỉ làm rõ câu, gần như giữ nguyên" },
    { value: "pro", label: "Pro — phân tích ý ngắn → prompt gen rõ ràng" },
    { value: "cinematic", label: "Điện ảnh — camera / ánh sáng / atmosphere" },
    { value: "custom", label: "Tùy chỉnh — theo hướng dẫn mẫu bên dưới" },
  ];

  function applyImageTemplate(text: string) {
    setAiImageCustom(text);
    setAiImageStyle("custom");
    setPromptMsg("Đã chèn hướng dẫn ảnh → bấm Lưu cấu hình Prompt");
  }

  function applyVideoTemplate(text: string) {
    setAiVideoCustom(text);
    setAiVideoStyle("custom");
    setPromptMsg("Đã chèn hướng dẫn video → bấm Lưu cấu hình Prompt");
  }

  async function handleAddAccount() {
    if (!newLabel.trim() && newProvider !== "flow" && newProvider !== "grok") {
      onError("Nhập tên tài khoản");
      return;
    }
    if (newProvider === "openai" && !newApiKey.trim()) {
      onError("Nhập API Key");
      return;
    }
    if (newProvider === "grok" && !newCookie.trim() && !newApiKey.trim()) {
      onError("Dán cookie grok.com (sso + sso-rw) — giống Flow. Hoặc API key xAI.");
      return;
    }
    setLoading(true);
    onError("");
    try {
      let label = newLabel.trim();
      let credentials: Record<string, string>;
      if (newProvider === "openai") {
        credentials = { api_key: newApiKey.trim() };
        if (!label) label = "OpenAI";
      } else if (newProvider === "grok") {
        // Cookie web (ưu tiên) + optional API key
        if (newCookie.trim()) {
          credentials = { cookie: newCookie.trim() };
          if (newApiKey.trim()) credentials.api_key = newApiKey.trim();
          if (!label) label = "Grok cookie";
        } else {
          credentials = { api_key: newApiKey.trim() };
          if (!label) label = "Grok API key";
        }
      } else if (newProvider === "flow") {
        const parsed = parseFlowCookieInput(newSessionToken);
        credentials = { session_token: parsed.session_token };
        if (!label && parsed.email) label = parsed.email;
      } else {
        credentials = { cookie: newCookie.trim() };
      }
      await createAccount({
        provider: newProvider,
        label: label || "Account",
        credentials,
        image_enabled: true,
        video_enabled: newProvider !== "openai",
      });
      setNewLabel("");
      setNewApiKey("");
      setNewCookie("");
      setNewSessionToken("");
      await onRefresh();
    } catch (err) {
      onError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteAccount(id: string) {
    setLoading(true);
    onError("");
    try {
      await deleteAccount(id);
      await onRefresh();
    } catch (err) {
      onError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleToggle(account: Account) {
    setLoading(true);
    onError("");
    try {
      await updateAccount(account.id, { enabled: !account.enabled });
      await onRefresh();
    } catch (err) {
      onError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleClearCooldown(account: Account) {
    setLoading(true);
    onError("");
    try {
      await updateAccount(account.id, { clear_cooldown: true });
      await onRefresh();
    } catch (err) {
      onError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="settings-page">
      <header className="page-header">
        <div className="page-title-group">
          <h1>Cài Đặt</h1>
          <span className="pill pill-purple">TÀI KHOẢN</span>
          <span className="pill pill-green">
            Flow sẵn sàng: {flowReady.length}/{flowAccounts.length}
          </span>
        </div>
      </header>

      <section className="panel-card">
        <h2>Xoay vòng tài khoản Flow (ảnh + video)</h2>
        <p className="muted" style={{ marginTop: 0, lineHeight: 1.5 }}>
          Thêm <strong>nhiều account Flow</strong> (mỗi account = cookie / session-token riêng).
          App <strong>round-robin</strong> giữa các account đang bật. Khi một account{" "}
          <strong>hết quota</strong>, app tự cooldown ~1 giờ và chuyển sang account khác.
        </p>
        <div
          className="muted"
          style={{
            marginTop: 10,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(251, 191, 36, 0.12)",
            border: "1px solid rgba(251, 191, 36, 0.35)",
            lineHeight: 1.55,
          }}
        >
          <strong>Vì sao chỉ 1 Gmail chạy, account add thêm bị lỗi?</strong>
          <br />
          App gen bằng <strong>cookie đã lưu</strong>, còn captcha lấy từ{" "}
          <strong>tab labs.google đang mở</strong>. Hai cái phải <strong>cùng một Gmail</strong>.
          <br />
          Ví dụ: tab Flow đang login <code>nktnclean@…</code> mà cookie account B khác → gen account B sẽ fail.
          <br />
          Cách đúng mỗi account:
          <ol style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li>
              Chrome <strong>profile riêng</strong> (hoặc ẩn danh) → login <em>đúng</em> Gmail đó trên{" "}
              <code>labs.google/fx/tools/flow</code>
            </li>
            <li>
              Copy cookie <code>__Secure-next-auth.session-token</code> <em>lúc đã login account đó</em>
            </li>
            <li>Dán vào form → Thêm tài khoản (label = email)</li>
            <li>
              Khi gen bằng account đó: mở tab Flow <strong>cùng Gmail</strong> (Auth Helper xanh)
            </li>
          </ol>
          Không chỉ “đổi email trên tab” mà vẫn để cookie cũ của nktnclean trong app.
        </div>
        <ol className="muted" style={{ margin: "12px 0 0", paddingLeft: 20, lineHeight: 1.55 }}>
          <li>Profile Chrome A → login account A → copy cookie → Thêm TK A</li>
          <li>Profile Chrome B → login account B → copy cookie → Thêm TK B (không xóa A)</li>
          <li>Gen: tab Flow phải login cùng account mà app đang pick (hoặc tắt account không dùng)</li>
          <li>Hết quota: cooldown ~1h; account khác còn bật sẽ được thử</li>
        </ol>
      </section>

      <section className="panel-card">
        <h2>Thêm tài khoản</h2>
        <div className="form-grid">
          <label>
            Provider
            <select value={newProvider} onChange={(e) => setNewProvider(e.target.value as Provider)}>
              {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
              ))}
            </select>
          </label>
          <label>
            Tên hiển thị
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="email@gmail.com hoặc Account #2"
            />
          </label>
          {newProvider === "openai" ? (
            <label className="span-2">
              OpenAI API Key
              <input
                type="password"
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                placeholder="sk-..."
                autoComplete="new-password"
              />
            </label>
          ) : newProvider === "grok" ? (
            <>
              <label className="span-2">
                Cookie Grok.com (giống Flow — không dùng API key)
                <textarea
                  rows={5}
                  value={newCookie}
                  onChange={(e) => setNewCookie(e.target.value)}
                  placeholder={
                    "1) Login https://grok.com\n" +
                    "2) F12 → Network → bấm bất kỳ request grok.com\n" +
                    "3) Copy header Cookie (cần sso=...; sso-rw=...)\n" +
                    "   hoặc export JSON cookie (EditThisCookie)"
                  }
                />
                <small className="field-hint">
                  Bắt buộc: <code>sso</code> + nên có <code>sso-rw</code>. Account SuperGrok có Imagine ảnh/video.
                  App gọi <code>grok.com/rest/app-chat/...</code> bằng cookie — giống Flow + Google.
                </small>
              </label>
              <label className="span-2">
                xAI API Key (tuỳ chọn — fallback nếu cookie fail)
                <input
                  type="password"
                  value={newApiKey}
                  onChange={(e) => setNewApiKey(e.target.value)}
                  placeholder="xai-... (không bắt buộc)"
                  autoComplete="new-password"
                />
              </label>
            </>
          ) : newProvider === "flow" ? (
            <label className="span-2">
              Cookie Google Flow (JSON export hoặc session token) — account MỚI
              <textarea
                rows={6}
                value={newSessionToken}
                onChange={(e) => setNewSessionToken(e.target.value)}
                placeholder="Dán JSON cookie hoặc __Secure-next-auth.session-token (eyJ...) của tài khoản khác"
              />
              <small className="field-hint">
                Export khi đang mở <code>labs.google</code> (đã login đúng Gmail).
                App lấy cookie domain <code>labs.google</code>, rồi hỏi Google email thật
                (không tin field email trong file cookie — dễ sai).
              </small>
            </label>
          ) : (
            <label className="span-2">
              Session / Cookie
              <textarea
                rows={4}
                value={newCookie}
                onChange={(e) => setNewCookie(e.target.value)}
                placeholder="Dán cookie hoặc session token..."
              />
            </label>
          )}
        </div>
        <button type="button" className="btn btn-primary" onClick={handleAddAccount} disabled={loading}>
          Thêm tài khoản
        </button>
      </section>

      {/* ——— 1) Cấu hình AI: kết nối API (không lẫn style prompt) ——— */}
      <section className="panel-card">
        <h2>1. Cấu hình AI (API)</h2>
        <p className="muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
          Chỉ phần <strong>kết nối</strong>: bật/tắt, nhà cung cấp, model, Base URL, API key.
          Không quyết định nội dung prompt — phần đó ở mục <strong>2. Cấu hình Prompt</strong>.
        </p>
        <div className="form-grid">
          <label className="checkbox-label span-2">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => setAiEnabled(e.target.checked)}
            />
            Bật AI sửa prompt (cần key + URL hợp lệ)
          </label>
          <label>
            Nhà cung cấp / loại key
            <select value={aiProvider} onChange={(e) => applyAiProviderPreset(e.target.value)}>
              {AI_PROVIDERS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            <small className="field-hint">
              “API ngoài” hoặc “Tùy chỉnh” để dán key + Base URL dịch vụ bên thứ ba
            </small>
          </label>
          <label>
            Model
            <input
              value={aiModel}
              onChange={(e) => setAiModel(e.target.value)}
              placeholder="gpt-4o-mini · deepseek-chat · grok-2-latest · …"
            />
          </label>
          <label className="span-2">
            Base URL (endpoint /v1)
            <input
              value={aiBaseUrl}
              onChange={(e) => setAiBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1  hoặc URL API ngoài của bạn"
            />
            <small className="field-hint">
              OpenAI: https://api.openai.com/v1 · OpenRouter: https://openrouter.ai/api/v1 ·
              DeepSeek: https://api.deepseek.com/v1 · xAI: https://api.x.ai/v1
            </small>
          </label>
          <div className="span-2 ai-key-block">
            <span className="ai-key-label">API Key</span>
            {aiLoading ? (
              <p className="muted" style={{ margin: "6px 0 0" }}>Đang tải key đã lưu…</p>
            ) : hasSavedKey && !aiReplaceKey ? (
              <div className="ai-key-saved">
                <div className="ai-key-saved-row">
                  <span className="ai-key-masked" title="Key đã lưu trên server — không hiện full">
                    ●●●●●●●●  {ai?.api_key_masked || "••••"}
                  </span>
                  <span className="pill pill-green">Đã lưu</span>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setAiReplaceKey(true);
                      setAiApiKey("");
                      setAiMsg("Dán key mới bên dưới rồi Lưu — để trống + Hủy nếu giữ key cũ");
                    }}
                  >
                    Đổi key
                  </button>
                </div>
                <small className="field-hint">
                  Key đã lưu được dùng khi bấm ✦ / Test. Vào lại Cài đặt <strong>không cần dán lại</strong>.
                  Chỉ bấm <strong>Đổi key</strong> khi muốn thay key mới.
                </small>
              </div>
            ) : (
              <>
                <input
                  type="password"
                  value={aiApiKey}
                  onChange={(e) => setAiApiKey(e.target.value)}
                  placeholder={
                    hasSavedKey
                      ? `Dán key mới để thay (${ai?.api_key_masked})`
                      : "sk-... · key OpenRouter · key DeepSeek · key API riêng…"
                  }
                  autoComplete="new-password"
                  name="glabs-ai-api-key"
                />
                <div className="ai-key-actions">
                  {hasSavedKey ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setAiReplaceKey(false);
                        setAiApiKey("");
                        setAiMsg("Giữ key đã lưu — không thay");
                      }}
                    >
                      Hủy đổi key
                    </button>
                  ) : null}
                  <small className="field-hint">
                    App gọi <code>POST {"{base}"}/chat/completions</code>. Lưu xong key được giữ trên server.
                  </small>
                </div>
              </>
            )}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSaveAiApi()}
            disabled={aiSaving || aiTesting || aiLoading}
          >
            {aiSaving ? "Đang lưu..." : "Lưu cấu hình AI"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void handleTestAiApi()}
            disabled={aiTesting || aiSaving || aiLoading}
            title="Dùng key đã lưu (hoặc key đang dán nếu đang Đổi key)"
          >
            {aiTesting ? "Đang test..." : "Test API"}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => void loadAiSettings()}
            disabled={aiLoading || aiSaving}
            title="Tải lại key + cấu hình từ server"
          >
            {aiLoading ? "…" : "Tải lại"}
          </button>
          {aiMsg && <span className="muted">{aiMsg}</span>}
          {ai && (
            <span className={`pill ${ai.enabled && hasSavedKey ? "pill-green" : "pill-purple"}`}>
              {ai.enabled && hasSavedKey
                ? `API sẵn sàng · ${ai.api_key_masked}`
                : hasSavedKey
                  ? `Có key · chưa bật`
                  : "Chưa có API key"}
            </span>
          )}
        </div>
        {aiTestMsg ? (
          <p
            className={`ai-test-result ${aiTestOk === true ? "ai-test-result--ok" : aiTestOk === false ? "ai-test-result--fail" : ""}`}
            style={{ marginTop: 12, marginBottom: 0 }}
          >
            {aiTestOk === true ? "✓ " : aiTestOk === false ? "✗ " : ""}
            {aiTestMsg}
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 10, marginBottom: 0, fontSize: 13 }}>
            Lần đầu: dán key → <strong>Lưu cấu hình AI</strong>. Đã có key: để trống khi Lưu = giữ key cũ;
            bấm <strong>Đổi key</strong> chỉ khi muốn thay. Test dùng key form hoặc key đã lưu.
          </p>
        )}
      </section>

      {/* ——— 2) Cấu hình Prompt: cách viết lại ý ngắn → pro ——— */}
      <section className="panel-card">
        <h2>2. Cấu hình Prompt (ảnh / video)</h2>
        <p className="muted" style={{ marginTop: 0, lineHeight: 1.55 }}>
          Luồng sản phẩm: user gõ <strong>prompt chung chung</strong> → bấm <strong>✦</strong> → AI
          phân tích và viết lại <strong>prompt chuyên nghiệp</strong> (dễ gen ảnh/video).
          Mục này chỉ chỉnh <strong>cách viết lại</strong> — không phải API key.
          {ai && !ai.enabled && (
            <> Cần bật API ở mục 1 trước.</>
          )}
        </p>

        <div className="ai-mode-grid">
          <div className="ai-mode-card">
            <h3>Prompt → Ảnh (Flow Ảnh)</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Khi bấm ✦ trên <strong>Flow Ảnh</strong>: ý ngắn → prompt gen ảnh rõ.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={aiImageEnabled}
                onChange={(e) => setAiImageEnabled(e.target.checked)}
              />
              Bật viết lại prompt ảnh
            </label>
            <label>
              Mức độ viết lại
              <select value={aiImageStyle} onChange={(e) => setAiImageStyle(e.target.value)}>
                {STYLE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label>
              Hướng dẫn thêm (tùy chọn)
              <textarea
                rows={3}
                value={aiImageCustom}
                onChange={(e) => setAiImageCustom(e.target.value)}
                placeholder="VD: từ ý ngắn, làm rõ chủ thể + nền + ánh sáng; giữ @tên; không bịa chuyện…"
              />
            </label>
            <div className="ai-template-block">
              <span className="ai-template-label">Mẫu hướng dẫn (ảnh)</span>
              <div className="ai-template-chips">
                {IMAGE_PROMPT_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`ai-template-chip${aiImageCustom === t.text ? " active" : ""}`}
                    title={t.text}
                    onClick={() => applyImageTemplate(t.text)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {aiImageCustom ? (
                <button
                  type="button"
                  className="ai-template-clear"
                  onClick={() => {
                    setAiImageCustom("");
                    setPromptMsg("Đã xóa hướng dẫn ảnh (chưa lưu)");
                  }}
                >
                  Xóa hướng dẫn
                </button>
              ) : null}
            </div>
          </div>

          <div className="ai-mode-card">
            <h3>Prompt → Video (Flow Video)</h3>
            <p className="muted" style={{ marginTop: 0 }}>
              Khi bấm ✦ trên <strong>Flow Video</strong>: ý ngắn → prompt gen video rõ.
            </p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={aiVideoEnabled}
                onChange={(e) => setAiVideoEnabled(e.target.checked)}
              />
              Bật viết lại prompt video
            </label>
            <label>
              Mức độ viết lại
              <select value={aiVideoStyle} onChange={(e) => setAiVideoStyle(e.target.value)}>
                {STYLE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </label>
            <label>
              Hướng dẫn thêm (tùy chọn)
              <textarea
                rows={3}
                value={aiVideoCustom}
                onChange={(e) => setAiVideoCustom(e.target.value)}
                placeholder="VD: từ ý ngắn, thêm chuyển động + camera; 1 cảnh; giữ @tên; không bịa…"
              />
            </label>
            <div className="ai-template-block">
              <span className="ai-template-label">Mẫu hướng dẫn (video)</span>
              <div className="ai-template-chips">
                {VIDEO_PROMPT_TEMPLATES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`ai-template-chip${aiVideoCustom === t.text ? " active" : ""}`}
                    title={t.text}
                    onClick={() => applyVideoTemplate(t.text)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {aiVideoCustom ? (
                <button
                  type="button"
                  className="ai-template-clear"
                  onClick={() => {
                    setAiVideoCustom("");
                    setPromptMsg("Đã xóa hướng dẫn video (chưa lưu)");
                  }}
                >
                  Xóa hướng dẫn
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void handleSavePrompt()}
            disabled={promptSaving}
          >
            {promptSaving ? "Đang lưu..." : "Lưu cấu hình Prompt"}
          </button>
          {promptMsg && <span className="muted">{promptMsg}</span>}
        </div>
      </section>

      <section className="panel-card">
        <h2>Danh sách tài khoản ({accounts.length})</h2>
        <div className="account-list">
          {accounts.length === 0 && <p className="muted">Chưa có tài khoản nào.</p>}
          {accounts.map((account) => (
            <article
              key={account.id}
              className={`account-card${account.in_cooldown ? " account-card--cooldown" : ""}${!account.enabled ? " account-card--off" : ""}`}
            >
              <div>
                <strong>{account.label}</strong>
                <p>
                  {PROVIDER_LABELS[account.provider]}
                  {account.email && account.email !== account.label
                    ? ` · session: ${account.email}`
                    : ""}
                </p>
                <small>
                  {account.enabled ? "Đang bật" : "Tắt"} ·
                  {account.has_credentials ? " Đã cấu hình" : " Chưa cấu hình"}
                  {account.image_enabled ? " · Ảnh" : ""}
                  {account.video_enabled ? " · Video" : ""}
                  {account.in_cooldown
                    ? ` · Cooldown ${formatCooldown(account.cooldown_left_sec)}`
                    : ""}
                  {account.auth_hint ? ` · ${account.auth_hint}` : ""}
                </small>
                {account.last_error && (
                  <p className="account-error" title={account.last_error}>
                    Lỗi gần nhất: {account.last_error.slice(0, 120)}
                    {account.last_error.length > 120 ? "…" : ""}
                  </p>
                )}
              </div>
              <div className="account-card-actions">
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleToggle(account)}
                  disabled={loading}
                  title={account.enabled ? "Tắt khỏi vòng xoay" : "Bật lại"}
                >
                  {account.enabled ? "Tắt" : "Bật"}
                </button>
                {account.in_cooldown && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => handleClearCooldown(account)}
                    disabled={loading}
                    title="Xóa cooldown, thử lại ngay"
                  >
                    Bỏ cooldown
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost danger btn-sm"
                  onClick={() => handleDeleteAccount(account.id)}
                  disabled={loading}
                >
                  Xóa
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
