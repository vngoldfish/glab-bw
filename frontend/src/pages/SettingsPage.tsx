import { useCallback, useEffect, useState } from "react";
import {
  Account,
  AiSettings,
  Provider,
  aiHasSavedKey,
  cleanupOutputs,
  createAccount,
  deleteAccount,
  exportAccountsBackup,
  fetchAiSettings,
  fetchDiskInfo,
  importAccountsBackup,
  runProjectTests,
  saveAiApiSettings,
  savePromptSettings,
  testAiApi,
  updateAccount,
  fetchPortsConfig,
  savePortsConfig,
  fetchCreditsUsage,
  fetchFlowModels,
  fetchGoogleDriveSettings,
  saveGoogleDriveSettings,
  testGoogleDriveConnection,
  authGoogleDrive,
  type CreditUsageConfig,
  type TestRunResult,
  type TestSuite,
} from "../api";
import { useUiDialog } from "../components/UiDialog";
import { parseFlowCookieInput, parseMetaCookieInput } from "../cookie";
import {
  Users,
  Sparkles,
  Cpu,
  UserPlus,
  Globe,
  Download,
  Upload,
  Trash2,
  Play,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Key,
  Database,
  History,
  Layers,
  Cloud
} from "lucide-react";

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
  const dialog = useUiDialog();
  const [activeTab, setActiveTab] = useState<"accounts" | "ai" | "ports" | "system" | "changelog" | "models" | "gdrive">("accounts");
  const [showGuide, setShowGuide] = useState(false);
  const [flowModels, setFlowModels] = useState<Array<{ value: string; label: string; credits: number; api_value?: string }>>([]);
  const [flowModelsLoading, setFlowModelsLoading] = useState(false);

  // Google Drive Configuration State
  const [gdriveEnabled, setGdriveEnabled] = useState(false);
  const [gdriveFolderId, setGdriveFolderId] = useState("");
  const [gdriveHasSecrets, setGdriveHasSecrets] = useState(false);
  const [gdriveHasCredentials, setGdriveHasCredentials] = useState(false);
  const [gdriveClientId, setGdriveClientId] = useState("");
  const [gdriveAuthorizedEmail, setGdriveAuthorizedEmail] = useState("");
  const [gdriveJsonInput, setGdriveJsonInput] = useState("");
  const [gdriveAuthing, setGdriveAuthing] = useState(false);

  const [gdriveLoading, setGdriveLoading] = useState(false);
  const [gdriveSaving, setGdriveSaving] = useState(false);
  const [gdriveTesting, setGdriveTesting] = useState(false);
  const [gdriveMsg, setGdriveMsg] = useState("");
  const [gdriveOk, setGdriveOk] = useState<boolean | null>(null);

  // Ports Configuration State
  const [apiPort, setApiPort] = useState(8765);
  const [authBridgePort, setAuthBridgePort] = useState(18923);
  const [portsLoading, setPortsLoading] = useState(false);
  const [portsSaving, setPortsSaving] = useState(false);
  const [portsMsg, setPortsMsg] = useState("");
  const [portsOk, setPortsOk] = useState<boolean | null>(null);

  // Edit Account State
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editCookie, setEditCookie] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editSessionToken, setEditSessionToken] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const [creditsUsage, setCreditsUsage] = useState<CreditUsageConfig | null>(null);
  const [creditsLoading, setCreditsLoading] = useState(false);

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
  const [testSuite, setTestSuite] = useState<TestSuite>("all");
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<TestRunResult | null>(null);


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

  const loadPortsConfig = useCallback(async () => {
    setPortsLoading(true);
    try {
      const data = await fetchPortsConfig();
      setApiPort(data.port);
      setAuthBridgePort(data.auth_bridge_port);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setPortsLoading(false);
    }
  }, [onError]);

  const loadCreditsUsage = useCallback(async () => {
    setCreditsLoading(true);
    try {
      const data = await fetchCreditsUsage();
      setCreditsUsage(data);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreditsLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    if (activeTab === "models") {
      async function load() {
        setFlowModelsLoading(true);
        try {
          const data = await fetchFlowModels();
          if (data && data.models) {
            setFlowModels(data.models);
          }
        } catch (err) {
          console.error("Failed to load models for settings page", err);
        } finally {
          setFlowModelsLoading(false);
        }
      }
      load();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "gdrive") {
      async function loadGdriveSettings() {
        setGdriveLoading(true);
        setGdriveMsg("");
        setGdriveOk(null);
        try {
          const cfg = await fetchGoogleDriveSettings();
          setGdriveEnabled(cfg.enabled);
          setGdriveFolderId(cfg.folder_id);
          setGdriveHasSecrets(cfg.has_secrets);
          setGdriveHasCredentials(cfg.has_credentials);
          setGdriveClientId(cfg.client_id || "");
          setGdriveAuthorizedEmail(cfg.authorized_email || "");
        } catch (err) {
          console.error("Failed to load Google Drive settings", err);
          onError(err instanceof Error ? err.message : String(err));
        } finally {
          setGdriveLoading(false);
        }
      }
      loadGdriveSettings();
    }
  }, [activeTab, onError]);

  const handleSaveGdrive = async () => {
    setGdriveSaving(true);
    setGdriveMsg("");
    setGdriveOk(null);
    try {
      const secretsText = gdriveJsonInput.trim();
      const payload: { enabled: boolean; folder_id: string; client_secrets_json?: string } = {
        enabled: gdriveEnabled,
        folder_id: gdriveFolderId,
      };
      if (secretsText) {
        try {
          JSON.parse(secretsText);
          payload.client_secrets_json = secretsText;
        } catch (e) {
          throw new Error("Thông tin OAuth Client Secrets không đúng định dạng JSON!");
        }
      }
      const cfg = await saveGoogleDriveSettings(payload);
      setGdriveEnabled(cfg.enabled);
      setGdriveFolderId(cfg.folder_id);
      setGdriveHasSecrets(cfg.has_secrets);
      setGdriveHasCredentials(cfg.has_credentials);
      setGdriveClientId(cfg.client_id || "");
      setGdriveAuthorizedEmail(cfg.authorized_email || "");
      setGdriveJsonInput("");
      setGdriveOk(true);
      setGdriveMsg("Lưu cấu hình Google Drive thành công!");
    } catch (err) {
      setGdriveOk(false);
      setGdriveMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGdriveSaving(false);
    }
  };

  const handleAuthGdrive = async () => {
    setGdriveAuthing(true);
    setGdriveMsg("Đang mở trình duyệt xác thực Google... Vui lòng cấp quyền ở tab mới.");
    setGdriveOk(null);
    try {
      const res = await authGoogleDrive();
      setGdriveOk(res.success);
      setGdriveMsg(res.message);
      const cfg = await fetchGoogleDriveSettings();
      setGdriveHasCredentials(cfg.has_credentials);
      setGdriveAuthorizedEmail(cfg.authorized_email || "");
    } catch (err) {
      setGdriveOk(false);
      setGdriveMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGdriveAuthing(false);
    }
  };

  const handleTestGdrive = async () => {
    setGdriveTesting(true);
    setGdriveMsg("");
    setGdriveOk(null);
    try {
      const res = await testGoogleDriveConnection();
      setGdriveOk(res.success);
      setGdriveMsg(res.message);
    } catch (err) {
      setGdriveOk(false);
      setGdriveMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setGdriveTesting(false);
    }
  };

  const handleSavePorts = async (restart: boolean) => {
    setPortsSaving(true);
    setPortsMsg("");
    setPortsOk(null);
    try {
      const res = await savePortsConfig({ port: apiPort, auth_bridge_port: authBridgePort, restart });
      if (res.success) {
        setPortsOk(true);
        setPortsMsg(res.message);
        if (restart) {
          await dialog.alert({
            title: "Khởi động lại Server",
            message: "Hệ thống đang khởi động lại uvicorn trên cổng mới. Hãy đợi ~3-5 giây và tải lại trang này hoặc chạy lệnh start.",
            tone: "success",
          });
        }
      } else {
        setPortsOk(false);
        setPortsMsg(res.message || "Lỗi lưu cấu hình");
      }
    } catch (err) {
      setPortsOk(false);
      setPortsMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setPortsSaving(false);
    }
  };

  useEffect(() => {
    void loadAiSettings();
    void loadPortsConfig();
    void loadCreditsUsage();
  }, [loadAiSettings, loadPortsConfig, loadCreditsUsage]);

  function applyAiProviderPreset(value: string) {
    setAiProvider(value);
    const preset = AI_PROVIDERS.find((p) => p.value === value);
    if (preset) {
      if (preset.base) setAiBaseUrl(preset.base);
      if (preset.model) setAiModel(preset.model);
    }
  }

  async function handleSaveAiApi() {
    setAiSaving(true);
    setAiMsg("");
    onError("");
    try {
      const typedKey = aiApiKey.trim();
      const sendKey = !hasSavedKey || aiReplaceKey;
      const newKey = sendKey ? typedKey : "";
      if (sendKey && !newKey && !hasSavedKey) {
        onError("Nhập API key trước khi lưu");
        setAiSaving(false);
        return;
      }
      if (aiReplaceKey && !newKey && hasSavedKey) {
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
    if (newProvider === "meta" && !newCookie.trim()) {
      onError("Dán cookie vibes.ai (phải chứa meta_session=...).");
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
      } else if (newProvider === "meta") {
        const parsedCookie = parseMetaCookieInput(newCookie);
        credentials = { cookie: parsedCookie };
        if (!label) label = "Meta AI";
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

  function handleStartEdit(account: Account) {
    setEditingAccount(account);
    setEditCookie("");
    setEditApiKey("");
    setEditSessionToken("");
    onError("");
  }

  async function handleSaveEdit() {
    if (!editingAccount) return;
    setLoading(true);
    onError("");
    try {
      let credentials: Record<string, string> = {};
      if (editingAccount.provider === "openai") {
        if (!editApiKey.trim()) throw new Error("Nhập API Key");
        credentials = { api_key: editApiKey.trim() };
      } else if (editingAccount.provider === "grok") {
        if (editCookie.trim()) {
          credentials = { cookie: editCookie.trim() };
          if (editApiKey.trim()) credentials.api_key = editApiKey.trim();
        } else if (editApiKey.trim()) {
          credentials = { api_key: editApiKey.trim() };
        } else {
          throw new Error("Nhập Cookie hoặc API Key");
        }
      } else if (editingAccount.provider === "flow") {
        if (!editSessionToken.trim()) throw new Error("Dán session token");
        const parsed = parseFlowCookieInput(editSessionToken);
        credentials = { session_token: parsed.session_token };
      } else if (editingAccount.provider === "meta") {
        if (!editCookie.trim()) throw new Error("Dán cookie vibes.ai");
        const parsedCookie = parseMetaCookieInput(editCookie);
        credentials = { cookie: parsedCookie };
      } else {
        if (!editCookie.trim()) throw new Error("Dán cookie");
        credentials = { cookie: editCookie.trim() };
      }

      await updateAccount(editingAccount.id, {
        credentials,
      });
      setEditingAccount(null);
      await onRefresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
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
          <span className="pill pill-purple">CẤU HÌNH</span>
          <span className="pill pill-green">
            Flow hoạt động: {flowReady.length}/{flowAccounts.length}
          </span>
        </div>
      </header>

      <div className="settings-container">
        {/* Left column: Sidebar Tabs */}
        <aside className="settings-sidebar">
          <button
            type="button"
            className={`settings-sidebar-tab ${activeTab === "accounts" ? "active" : ""}`}
            onClick={() => setActiveTab("accounts")}
          >
            <Users size={16} />
            <span>Tài khoản ({accounts.length})</span>
          </button>
          <button
            type="button"
            className={`settings-sidebar-tab ${activeTab === "ai" ? "active" : ""}`}
            onClick={() => setActiveTab("ai")}
          >
            <Sparkles size={16} />
            <span>Trợ lý AI & Prompt</span>
          </button>
          <button
            type="button"
            className={`settings-sidebar-tab ${activeTab === "ports" ? "active" : ""}`}
            onClick={() => setActiveTab("ports")}
          >
            <Globe size={16} />
            <span>Cổng kết nối (Ports)</span>
          </button>
          <button
            type="button"
            className={`settings-sidebar-tab ${activeTab === "system" ? "active" : ""}`}
            onClick={() => setActiveTab("system")}
          >
            <Cpu size={16} />
            <span>Hệ thống & Tiện ích</span>
          </button>
          <button
            type="button"
            className={`settings-sidebar-tab ${activeTab === "changelog" ? "active" : ""}`}
            onClick={() => setActiveTab("changelog")}
          >
            <History size={16} />
            <span>Lịch sử nâng cấp</span>
          </button>
          <button
            type="button"
            className={`settings-sidebar-tab ${activeTab === "models" ? "active" : ""}`}
            onClick={() => setActiveTab("models")}
          >
            <Layers size={16} />
            <span>Danh sách Model</span>
          </button>
          <button
            type="button"
            className={`settings-sidebar-tab ${activeTab === "gdrive" ? "active" : ""}`}
            onClick={() => setActiveTab("gdrive")}
          >
            <Cloud size={16} />
            <span>Google Drive</span>
          </button>
        </aside>

        {/* Right column: Content Area */}
        <div className="settings-main-content">

      {/* TAB 1: ACCOUNTS */}
      {activeTab === "accounts" && (
        <div className="settings-tab-content">
          {/* Guide dropdown */}
          <section className="panel-card" style={{ paddingBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <HelpCircle size={18} style={{ color: "var(--purple-bright)" }} />
                <h3 style={{ margin: 0, fontSize: "15px" }}>Cách hoạt động &amp; Xoay vòng tài khoản</h3>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setShowGuide(!showGuide)}
                style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px" }}
              >
                {showGuide ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {showGuide ? "Thu gọn" : "Xem chi tiết"}
              </button>
            </div>

            {showGuide && (
              <div style={{ marginTop: 14 }}>
                <p className="muted" style={{ marginTop: 0, lineHeight: 1.5, fontSize: "13.5px" }}>
                  Bạn có thể thêm **nhiều account Flow** (mỗi account dùng cookie riêng).
                  Hệ thống sẽ **tự động xoay vòng** giữa các tài khoản đang bật. 
                  Khi một account **hết quota**, hệ thống sẽ cho cooldown ~1 giờ và tự động chuyển sang tài khoản tiếp theo.
                </p>
                <div
                  className="muted"
                  style={{
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "rgba(251, 191, 36, 0.08)",
                    border: "1px solid rgba(251, 191, 36, 0.25)",
                    fontSize: "13px",
                    lineHeight: 1.6,
                  }}
                >
                  <strong style={{ color: "#fbbf24", display: "block", marginBottom: 4 }}>
                    ⚠️ Lưu ý quan trọng về Captcha:
                  </strong>
                  Quy trình gen bằng cookie, nhưng reCAPTCHA sẽ được giải bằng **tab Google Flow đang mở trên Chrome**. 
                  Hai phần này **bắt buộc phải đăng nhập cùng một tài khoản Gmail**. 
                  Nếu tab Chrome đang đăng nhập Gmail A mà cookie đang gen lại của Gmail B, quá trình tạo ảnh/video sẽ thất bại.
                  <br />
                  <strong style={{ display: "block", marginTop: 8, marginBottom: 2 }}>Cách setup nhiều tài khoản chuẩn:</strong>
                  <ol style={{ margin: 0, paddingLeft: 18 }}>
                    <li>Mở một profile Chrome ẩn danh (hoặc profile phụ) → Đăng nhập Gmail tương ứng trên tab Google Flow.</li>
                    <li>Sử dụng extension F12/Cookie Editor để lấy mã cookie <code>__Secure-next-auth.session-token</code>.</li>
                    <li>Dán vào form "Thêm tài khoản" ở dưới (Đặt tên nhãn bằng Email để dễ quản lý).</li>
                    <li>Khi chuyển đổi gen giữa các Gmail, hãy đảm bảo mở tab Google Flow tương ứng có hoạt động Auth Helper.</li>
                  </ol>
                </div>
              </div>
            )}
          </section>

          {/* Account Lists */}
          <section className="panel-card" style={{ marginTop: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <h2 style={{ margin: 0 }}>Danh sách tài khoản ({accounts.length})</h2>
              <button
                type="button"
                className="btn btn-primary"
                style={{ display: "flex", alignItems: "center", gap: 6 }}
                onClick={() => setShowAddForm(!showAddForm)}
              >
                <UserPlus size={14} />
                {showAddForm ? "Đóng form" : "Thêm tài khoản"}
              </button>
            </div>

            {showAddForm && (
              <div style={{ background: "rgba(255,255,255,0.015)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 10, padding: 18, marginBottom: 18 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <UserPlus size={16} style={{ color: "var(--purple-bright)" }} />
                  <strong style={{ fontSize: "14px", color: "#fff" }}>Thêm tài khoản thủ công</strong>
                </div>
                <div className="form-grid" style={{ gap: "10px 14px", marginBottom: 14 }}>
                  <label>
                    Nền tảng
                    <select value={newProvider} onChange={(e) => setNewProvider(e.target.value as Provider)}>
                      {(Object.keys(PROVIDER_LABELS) as Provider[]).map((p) => (
                        <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Tên hiển thị (Email)
                    <input
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="vd: email@gmail.com"
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
                        Cookie Grok.com
                        <textarea
                          rows={3}
                          value={newCookie}
                          onChange={(e) => setNewCookie(e.target.value)}
                          placeholder="sso=...; sso-rw=..."
                          style={{ fontFamily: "monospace", fontSize: "11px" }}
                        />
                      </label>
                      <label className="span-2">
                        xAI API Key (Tùy chọn fallback)
                        <input
                          type="password"
                          value={newApiKey}
                          onChange={(e) => setNewApiKey(e.target.value)}
                          placeholder="xai-..."
                          autoComplete="new-password"
                        />
                      </label>
                    </>
                  ) : newProvider === "flow" ? (
                    <label className="span-2">
                      Cookie Google Flow (session token)
                      <textarea
                        rows={3}
                        value={newSessionToken}
                        onChange={(e) => setNewSessionToken(e.target.value)}
                        placeholder="Mã key __Secure-next-auth.session-token..."
                        style={{ fontFamily: "monospace", fontSize: "11px" }}
                      />
                    </label>
                  ) : newProvider === "meta" ? (
                    <label className="span-2">
                      Cookie Vibes.ai (chứa meta_session)
                      <textarea
                        rows={3}
                        value={newCookie}
                        onChange={(e) => setNewCookie(e.target.value)}
                        placeholder="Dán Cookie vibes.ai vào đây (phải chứa meta_session=...)..."
                        style={{ fontFamily: "monospace", fontSize: "11px" }}
                      />
                    </label>
                  ) : (
                    <label className="span-2">
                      Session / Cookie
                      <textarea
                        rows={3}
                        value={newCookie}
                        onChange={(e) => setNewCookie(e.target.value)}
                        placeholder="Dán Cookie..."
                        style={{ fontFamily: "monospace", fontSize: "11px" }}
                      />
                    </label>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button type="button" className="btn btn-ghost" onClick={() => setShowAddForm(false)}>
                    Hủy
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={async () => {
                      await handleAddAccount();
                      setShowAddForm(false);
                    }}
                    disabled={loading}
                  >
                    Thêm tài khoản
                  </button>
                </div>
              </div>
            )}

            <div className="account-list" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
              {accounts.length === 0 && <p className="muted">Chưa có tài khoản nào được cấu hình.</p>}
              {accounts.map((account) => (
                <article
                  key={account.id}
                  className={`account-card${account.in_cooldown ? " account-card--cooldown" : ""}${!account.enabled ? " account-card--off" : ""}`}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className={`status-dot ${account.enabled ? "online" : "offline"}`} />
                      <strong style={{ fontSize: "14px" }}>{account.label}</strong>
                    </div>
                    <p style={{ margin: "2px 0", fontSize: "12px", color: "var(--text-secondary)", display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
                      <span>{PROVIDER_LABELS[account.provider]}</span>
                      {account.email && account.email !== account.label ? <span>· {account.email}</span> : ""}
                      {account.credits_remaining !== undefined && account.credits_remaining !== null && (
                        <span style={{ color: "var(--success)", fontWeight: 600, background: "rgba(16, 185, 129, 0.1)", padding: "1px 6px", borderRadius: "4px", fontSize: "11px" }}>
                          Còn {Number(account.credits_remaining).toLocaleString()} credit
                        </span>
                      )}
                    </p>
                    <small style={{ color: "var(--muted)" }}>
                      {account.enabled ? "Đang bật" : "Đã tắt"} ·
                      {account.has_credentials ? " Đã cấu hình" : " Chưa có cookie"}
                      {account.image_enabled ? " · Ảnh" : ""}
                      {account.video_enabled ? " · Video" : ""}
                      {account.in_cooldown ? ` · Cooldown ${formatCooldown(account.cooldown_left_sec)}` : ""}
                      {account.auth_hint ? ` · ${account.auth_hint}` : ""}
                    </small>
                    {account.last_error && (
                      <p className="account-error" style={{ color: "var(--red)", marginTop: 6, fontSize: "11px", lineHeight: "1.3" }} title={account.last_error}>
                        Lỗi: {account.last_error.slice(0, 90)}...
                      </p>
                    )}
                  </div>
                  <div className="account-card-actions" style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ width: "100%", padding: "5px 12px" }}
                      onClick={() => handleToggle(account)}
                      disabled={loading}
                    >
                      {account.enabled ? "Tắt" : "Bật"}
                    </button>
                    {account.in_cooldown && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ width: "100%", padding: "5px 12px" }}
                        onClick={() => handleClearCooldown(account)}
                        disabled={loading}
                      >
                        Bỏ cooldown
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ width: "100%", padding: "5px 12px" }}
                      onClick={() => handleStartEdit(account)}
                      disabled={loading}
                    >
                      Sửa
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost danger btn-sm"
                      style={{ width: "100%", padding: "5px 12px" }}
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
      )}

      {/* TAB 2: AI & PROMPT */}
      {activeTab === "ai" && (
        <div className="settings-tab-content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* AI API CONFIG */}
          <section className="panel-card">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Key size={18} style={{ color: "var(--blue)" }} />
              <h2 style={{ margin: 0 }}>1. Kết nối API Trợ lý AI</h2>
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: "13.5px", lineHeight: 1.5 }}>
              Cấu hình mô hình ngôn ngữ lớn (LLM) dùng để sửa đổi và tối ưu hóa các prompt thô thành dạng prompt chuyên nghiệp trước khi generate.
            </p>
            <div className="form-grid" style={{ marginBottom: 14 }}>
              <label className="checkbox-label span-2" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
                <input
                  type="checkbox"
                  checked={aiEnabled}
                  onChange={(e) => setAiEnabled(e.target.checked)}
                />
                Kích hoạt trợ lý AI sửa đổi Prompt thô (Bật ✦)
              </label>
              <label>
                Nhà cung cấp
                <select value={aiProvider} onChange={(e) => applyAiProviderPreset(e.target.value)}>
                  {AI_PROVIDERS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </label>
              <label>
                Tên Model
                <input
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  placeholder="gpt-4o-mini, grok-2-latest..."
                />
              </label>
              <label className="span-2">
                Endpoint URL (Base URL)
                <input
                  value={aiBaseUrl}
                  onChange={(e) => setAiBaseUrl(e.target.value)}
                  placeholder="https://api.openai.com/v1"
                />
              </label>
              <div className="span-2 ai-key-block" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="ai-key-label" style={{ fontSize: "12px", fontWeight: "600" }}>API Key</span>
                {aiLoading ? (
                  <p className="muted" style={{ margin: 0 }}>Đang tải khóa...</p>
                ) : hasSavedKey && !aiReplaceKey ? (
                  <div className="ai-key-saved" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span className="ai-key-masked" style={{ fontFamily: "monospace", letterSpacing: "0.08em" }}>
                        •••••••• {ai?.api_key_masked}
                      </span>
                      <span className="pill pill-green" style={{ fontSize: 9 }}>ĐÃ LƯU</span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        setAiReplaceKey(true);
                        setAiApiKey("");
                        setAiMsg("Hãy dán key mới ở dưới...");
                      }}
                    >
                      Thay đổi key
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <input
                      type="password"
                      value={aiApiKey}
                      onChange={(e) => setAiApiKey(e.target.value)}
                      placeholder={hasSavedKey ? "Dán mã khóa mới để lưu đè..." : "Nhập API Key..."}
                      autoComplete="new-password"
                    />
                    {hasSavedKey && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        style={{ width: "fit-content" }}
                        onClick={() => {
                          setAiReplaceKey(false);
                          setAiApiKey("");
                          setAiMsg("");
                        }}
                      >
                        Hủy đổi key
                      </button>
                    )}
                  </div>
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
                {aiSaving ? "Đang lưu cấu hình..." : "Lưu cấu hình API"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void handleTestAiApi()}
                disabled={aiTesting || aiSaving || aiLoading}
              >
                {aiTesting ? "Đang test API..." : "Test kết nối API"}
              </button>
              {aiMsg && <span className="muted" style={{ fontSize: "13px" }}>{aiMsg}</span>}
            </div>
            {aiTestMsg && (
              <p
                className={`ai-test-result ${aiTestOk === true ? "ai-test-result--ok" : aiTestOk === false ? "ai-test-result--fail" : ""}`}
                style={{ marginTop: 12, marginBottom: 0, padding: 10, borderRadius: 6 }}
              >
                {aiTestOk === true ? "✓ " : "✗ "}
                {aiTestMsg}
              </p>
            )}
          </section>

          {/* PROMPT SYSTEM INSTRUCTION CONFIG */}
          <section className="panel-card">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Sparkles size={18} style={{ color: "var(--purple-bright)" }} />
              <h2 style={{ margin: 0 }}>2. Cấu hình quy tắc tối ưu Prompt</h2>
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: "13.5px" }}>
              Tùy chỉnh các hướng dẫn hệ thống (System Instructions) được gửi tới AI để hướng dẫn cách tối ưu và nâng cấp các prompts.
            </p>

            <div className="ai-mode-grid" style={{ gap: 16 }}>
              {/* Image Prompts Rewrite */}
              <div className="ai-mode-card" style={{ background: "rgba(255,255,255,0.015)", border: "1px solid var(--border)", padding: 16, borderRadius: 12 }}>
                <h3 style={{ margin: "0 0 10px" }}>Tối ưu Prompt Tạo Ảnh</h3>
                <label className="checkbox-label" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={aiImageEnabled}
                    onChange={(e) => setAiImageEnabled(e.target.checked)}
                  />
                  Cho phép AI sửa prompt Ảnh
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                  Mức độ viết lại
                  <select value={aiImageStyle} onChange={(e) => setAiImageStyle(e.target.value)}>
                    {STYLE_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                  Hướng dẫn chi tiết (System Instruction)
                  <textarea
                    rows={4}
                    value={aiImageCustom}
                    onChange={(e) => setAiImageCustom(e.target.value)}
                    placeholder="VD: Viết rõ bối cảnh, ánh sáng, góc máy..."
                  />
                </label>
                <div className="ai-template-block">
                  <span className="ai-template-label" style={{ fontSize: "11px", fontWeight: "600", color: "var(--muted)", display: "block", marginBottom: 6 }}>
                    Mẫu Hướng Dẫn Nhanh:
                  </span>
                  <div className="ai-template-chips" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {IMAGE_PROMPT_TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`ai-template-chip${aiImageCustom === t.text ? " active" : ""}`}
                        style={{ fontSize: "11px", padding: "4px 8px", borderRadius: 6 }}
                        onClick={() => applyImageTemplate(t.text)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {aiImageCustom && (
                    <button
                      type="button"
                      className="ai-template-clear"
                      style={{ marginTop: 8, fontSize: "11px", color: "var(--red)", border: "none", background: "transparent", cursor: "pointer" }}
                      onClick={() => setAiImageCustom("")}
                    >
                      Xóa hướng dẫn tùy chỉnh
                    </button>
                  )}
                </div>
              </div>

              {/* Video Prompts Rewrite */}
              <div className="ai-mode-card" style={{ background: "rgba(255,255,255,0.015)", border: "1px solid var(--border)", padding: 16, borderRadius: 12 }}>
                <h3 style={{ margin: "0 0 10px" }}>Tối ưu Prompt Tạo Video</h3>
                <label className="checkbox-label" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={aiVideoEnabled}
                    onChange={(e) => setAiVideoEnabled(e.target.checked)}
                  />
                  Cho phép AI sửa prompt Video
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                  Mức độ viết lại
                  <select value={aiVideoStyle} onChange={(e) => setAiVideoStyle(e.target.value)}>
                    {STYLE_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                  Hướng dẫn chi tiết (System Instruction)
                  <textarea
                    rows={4}
                    value={aiVideoCustom}
                    onChange={(e) => setAiVideoCustom(e.target.value)}
                    placeholder="VD: Thêm chuyển động máy quay, zoom in, panning..."
                  />
                </label>
                <div className="ai-template-block">
                  <span className="ai-template-label" style={{ fontSize: "11px", fontWeight: "600", color: "var(--muted)", display: "block", marginBottom: 6 }}>
                    Mẫu Hướng Dẫn Nhanh:
                  </span>
                  <div className="ai-template-chips" style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {VIDEO_PROMPT_TEMPLATES.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`ai-template-chip${aiVideoCustom === t.text ? " active" : ""}`}
                        style={{ fontSize: "11px", padding: "4px 8px", borderRadius: 6 }}
                        onClick={() => applyVideoTemplate(t.text)}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                  {aiVideoCustom && (
                    <button
                      type="button"
                      className="ai-template-clear"
                      style={{ marginTop: 8, fontSize: "11px", color: "var(--red)", border: "none", background: "transparent", cursor: "pointer" }}
                      onClick={() => setAiVideoCustom("")}
                    >
                      Xóa hướng dẫn tùy chỉnh
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 16 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSavePrompt()}
                disabled={promptSaving}
              >
                {promptSaving ? "Đang lưu cấu hình..." : "Lưu cấu hình Prompt"}
              </button>
              {promptMsg && <span className="muted" style={{ fontSize: "13px" }}>{promptMsg}</span>}
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: SYSTEM UTILITIES */}
      {activeTab === "system" && (
        <div className="settings-tab-content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Backup Block */}
          <section className="panel-card">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Database size={18} style={{ color: "var(--purple-bright)" }} />
              <h2 style={{ margin: 0 }}>Sao lưu &amp; Phục hồi dữ liệu</h2>
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: "13.5px", lineHeight: 1.5 }}>
              Xuất dữ liệu danh sách tài khoản dưới dạng tệp tin JSON hoặc nhập lại từ tệp tin có sẵn để đồng bộ thiết bị.
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ display: "flex", alignItems: "center", gap: 8 }}
                disabled={loading}
                onClick={async () => {
                  try {
                    setLoading(true);
                    const data = await exportAccountsBackup(false);
                    const blob = new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json",
                    });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `glab-accounts-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  } catch (e) {
                    onError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <Download size={14} />
                Export backup (Không mật khẩu)
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                style={{ display: "flex", alignItems: "center", gap: 8 }}
                disabled={loading}
                onClick={async () => {
                  const ok = await dialog.confirm({
                    title: "Xuất dữ liệu chứa Secrets?",
                    message:
                      "Tệp tin tải xuống sẽ chứa Cookie và API Key. Hãy lưu trữ an toàn. Tiếp tục?",
                    confirmLabel: "Chấp nhận",
                    cancelLabel: "Hủy",
                    tone: "danger",
                  });
                  if (!ok) return;
                  try {
                    setLoading(true);
                    const data = await exportAccountsBackup(true);
                    const blob = new Blob([JSON.stringify(data, null, 2)], {
                      type: "application/json",
                    });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `glab-accounts-SECRETS-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(a.href);
                  } catch (e) {
                    onError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <Download size={14} />
                Export backup + secrets
              </button>
              <label className="btn btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <Upload size={14} />
                Nhập file Backup...
                <input
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      setLoading(true);
                      const text = await file.text();
                      const parsed = JSON.parse(text) as {
                        accounts?: Array<{
                          provider: Provider;
                          label?: string;
                          credentials?: Record<string, string>;
                          image_enabled?: boolean;
                          video_enabled?: boolean;
                          enabled?: boolean;
                        }>;
                      };
                      if (!parsed.accounts?.length) {
                        throw new Error("Tệp không đúng định dạng chứa danh sách accounts");
                      }
                      const result = await importAccountsBackup({ accounts: parsed.accounts });
                      await onRefresh();
                      await dialog.alert({
                        title: "Import thành công",
                        message:
                          `Đã nhập: +${result.created} · bỏ qua trùng lặp: ${result.skipped}` +
                          (result.errors?.length ? `\nLỗi: ${result.errors.join("; ")}` : ""),
                        tone: result.errors?.length ? "danger" : "success",
                      });
                    } catch (err) {
                      onError(err instanceof Error ? err.message : String(err));
                    } finally {
                      setLoading(false);
                    }
                  }}
                />
              </label>
              <button
                type="button"
                className="btn btn-ghost danger"
                style={{ display: "flex", alignItems: "center", gap: 8 }}
                disabled={loading}
                onClick={async () => {
                  try {
                    setLoading(true);
                    const disk = await fetchDiskInfo();
                    const preview = await cleanupOutputs({ olderThanDays: 30, dryRun: true });
                    const ok = await dialog.confirm({
                      title: "Dọn dẹp ổ đĩa?",
                      message:
                        `Ổ đĩa trống: ${disk.disk_free_gb} GB · Tổng dung lượng ảnh/video đã tạo: ~${disk.output_total_mb} MB\n` +
                        `Số lượng tệp quá 30 ngày sẽ dọn dẹp: ${preview.matched_files} tệp. Bạn có chắc chắn?`,
                      confirmLabel: "Xóa sạch",
                      cancelLabel: "Hủy",
                      tone: "danger",
                    });
                    if (!ok) return;
                    const done = await cleanupOutputs({ olderThanDays: 30, dryRun: false });
                    await dialog.alert({
                      title: "Đã hoàn tất",
                      message: `Đã dọn dẹp xong ${done.removed_files} tệp tin · giải phóng ~${done.freed_mb} MB dung lượng`,
                      tone: "success",
                    });
                  } catch (err) {
                    onError(err instanceof Error ? err.message : String(err));
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <Trash2 size={14} />
                Dọn tệp đã tạo quá 30 ngày
              </button>
            </div>
          </section>

          {/* Project tests */}
          <section className="panel-card">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Play size={18} style={{ color: "var(--green)" }} />
              <h2 style={{ margin: 0 }}>Chạy bài kiểm tra tự động (Unit test)</h2>
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: "13.5px" }}>
              Kích hoạt chạy Pytest nội bộ trên hệ thống backend (không thực hiện cuộc gọi thực tế tới Google/Grok).
            </p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginTop: 14 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "13.5px" }}>
                Chế độ test
                <select
                  value={testSuite}
                  onChange={(e) => setTestSuite(e.target.value as TestSuite)}
                  disabled={testRunning}
                  style={{ padding: "4px 8px" }}
                >
                  <option value="all">Tất cả (All)</option>
                  <option value="smoke">Khói (Smoke - Nhanh)</option>
                  <option value="api">Giao diện kết nối (API)</option>
                </select>
              </label>
              <button
                type="button"
                className="btn btn-primary"
                style={{ display: "flex", alignItems: "center", gap: 8 }}
                disabled={testRunning}
                onClick={async () => {
                  try {
                    setTestRunning(true);
                    setTestResult(null);
                    const result = await runProjectTests(testSuite, false);
                    setTestResult(result);
                    if (!result.ok) {
                      onError(`Tests FAIL: ${result.summary}`);
                    }
                  } catch (e) {
                    onError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setTestRunning(false);
                  }
                }}
              >
                <Play size={14} />
                {testRunning ? "Đang chạy kiểm tra..." : "Chạy kiểm tra"}
              </button>
            </div>
            {testResult && (
              <div style={{ marginTop: 14 }}>
                <p
                  style={{
                    margin: "0 0 8px",
                    fontWeight: 600,
                    color: testResult.ok ? "var(--green)" : "var(--red)",
                    fontSize: "14px"
                  }}
                >
                  Kết quả: {testResult.ok ? "HOÀN TẤT THÀNH CÔNG (PASS)" : "THẤT BẠI (FAIL)"} — {testResult.summary}
                  {typeof testResult.passed === "number"
                    ? ` · Đạt: ${testResult.passed} / Lỗi: ${testResult.failed}`
                    : ""}
                </p>
                <pre
                  className="code-block"
                  style={{
                    maxHeight: 280,
                    overflow: "auto",
                    fontSize: 12,
                    margin: 0,
                    whiteSpace: "pre-wrap",
                    background: "rgba(0,0,0,0.2)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: 12
                  }}
                >
                  {testResult.output || "(Không có phản hồi logs)"}
                </pre>
              </div>
            )}
          </section>

          {/* Credit Usage Statistics */}
          <section className="panel-card">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Sparkles size={18} style={{ color: "var(--amber-bright)" }} />
              <h2 style={{ margin: 0 }}>Thống kê Credit sử dụng</h2>
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: "13.5px", lineHeight: 1.5 }}>
              Theo dõi số lượt chạy và tổng số credit tiêu tốn khi sử dụng các mô hình tạo video Google Flow/Veo.
            </p>
            {creditsLoading ? (
              <p className="muted">Đang tải...</p>
            ) : creditsUsage ? (
              <div>
                <div style={{ display: "flex", gap: 24, marginBottom: 16, background: "rgba(255, 255, 255, 0.02)", padding: "12px 18px", borderRadius: 8, border: "1px solid rgba(255, 255, 255, 0.05)" }}>
                  <div>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Tổng số lượt chạy:</span>
                    <div style={{ fontSize: "20px", fontWeight: "bold", color: "#fff" }}>{creditsUsage.total_runs} lượt</div>
                  </div>
                  <div style={{ width: 1, background: "rgba(255, 255, 255, 0.1)" }}></div>
                  <div>
                    <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Tổng credit đã xài:</span>
                    <div style={{ fontSize: "20px", fontWeight: "bold", color: "var(--purple-bright)" }}>{creditsUsage.total_credits} credit</div>
                  </div>
                </div>

                <h3 style={{ fontSize: "14px", margin: "12px 0 8px", color: "var(--text-secondary)" }}>Chi tiết từng mô hình:</h3>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
                  <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#fff" }}>Gemini Omni Flash</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>Giá: 12 credit/lượt</div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span>Lượt chạy:</span>
                      <span style={{ fontWeight: 600 }}>{creditsUsage.models?.omni_flash?.runs || 0}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
                      <span>Credit tiêu thụ:</span>
                      <span style={{ color: "var(--amber-bright)", fontWeight: 600 }}>{creditsUsage.models?.omni_flash?.credits || 0}</span>
                    </div>
                  </div>

                  <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#fff" }}>Veo 3.1 Lite</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>Giá: 5 credit/lượt</div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span>Lượt chạy:</span>
                      <span style={{ fontWeight: 600 }}>{creditsUsage.models?.veo_31_lite?.runs || 0}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
                      <span>Credit tiêu thụ:</span>
                      <span style={{ color: "var(--amber-bright)", fontWeight: 600 }}>{creditsUsage.models?.veo_31_lite?.credits || 0}</span>
                    </div>
                  </div>

                  <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#fff" }}>Veo 3.1 Fast</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>Giá: 10 credit/lượt</div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span>Lượt chạy:</span>
                      <span style={{ fontWeight: 600 }}>{creditsUsage.models?.veo_31_fast?.runs || 0}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
                      <span>Credit tiêu thụ:</span>
                      <span style={{ color: "var(--amber-bright)", fontWeight: 600 }}>{creditsUsage.models?.veo_31_fast?.credits || 0}</span>
                    </div>
                  </div>

                  <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#fff" }}>Veo 3.1 Quality</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>Giá: 100 credit/lượt</div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span>Lượt chạy:</span>
                      <span style={{ fontWeight: 600 }}>{creditsUsage.models?.veo_31_quality?.runs || 0}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
                      <span>Credit tiêu thụ:</span>
                      <span style={{ color: "var(--amber-bright)", fontWeight: 600 }}>{creditsUsage.models?.veo_31_quality?.credits || 0}</span>
                    </div>
                  </div>

                  <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#fff" }}>Model Ảnh Miễn Phí</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>Giá: Miễn phí (0 credit)</div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span>Lượt chạy:</span>
                      <span style={{ fontWeight: 600 }}>{creditsUsage.models?.free_image?.runs || 0}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
                      <span>Credit tiêu thụ:</span>
                      <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>0</span>
                    </div>
                  </div>

                  <div style={{ background: "rgba(255,255,255,0.01)", border: "1px solid rgba(255,255,255,0.04)", borderRadius: 8, padding: 12 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: "#fff" }}>Model Video Miễn Phí</div>
                    <div style={{ fontSize: 11, color: "var(--text-secondary)", marginBottom: 8 }}>Giá: Miễn phí (0 credit)</div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span>Lượt chạy:</span>
                      <span style={{ fontWeight: 600 }}>{creditsUsage.models?.free_video?.runs || 0}</span>
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginTop: 2 }}>
                      <span>Credit tiêu thụ:</span>
                      <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>0</span>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <p className="muted">Không có dữ liệu credit.</p>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ marginTop: 14 }}
              onClick={loadCreditsUsage}
            >
              🔄 Tải lại thống kê
            </button>
          </section>
        </div>
      )}

      {/* TAB 3: PORTS CONFIG */}
      {activeTab === "ports" && (
        <div className="settings-tab-content" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section className="panel-card">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <Globe size={18} style={{ color: "var(--blue)" }} />
              <h2 style={{ margin: 0 }}>Cấu hình Cổng Dịch Vụ</h2>
            </div>
            <p className="muted" style={{ marginTop: 0, fontSize: "13.5px", lineHeight: 1.5 }}>
              Thay đổi cổng API Backend và cổng Auth Bridge cho G-Labs BW. Dữ liệu cấu hình sẽ được lưu trực tiếp vào file <code>.env</code>.
            </p>

            <div
              className="muted"
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                fontSize: "13px",
                lineHeight: 1.6,
                marginBottom: 16,
              }}
            >
              <strong style={{ color: "var(--red-bright)", display: "block", marginBottom: 4 }}>
                ⚠️ Lưu ý quan trọng:
              </strong>
              Sau khi thay đổi cổng, bạn cần khởi động lại máy chủ (Backend) để cấu hình mới có hiệu lực.
              Nếu chọn <strong>"Lưu & Tự động khởi động lại"</strong>, Backend sẽ lập tức tự tắt để watchdog script khởi động lại Backend trên cổng mới.
            </div>

            {portsLoading ? (
              <p className="muted">Đang tải cấu hình cổng...</p>
            ) : (
              <div className="form-grid" style={{ marginBottom: 14 }}>
                <label>
                  Cổng API Backend (uvicorn)
                  <input
                    type="number"
                    value={apiPort}
                    onChange={(e) => setApiPort(Number(e.target.value))}
                    placeholder="8765"
                    min={1024}
                    max={65535}
                  />
                </label>
                <label>
                  Cổng Auth Bridge (Chrome Extension)
                  <input
                    type="number"
                    value={authBridgePort}
                    onChange={(e) => setAuthBridgePort(Number(e.target.value))}
                    placeholder="18923"
                    min={1024}
                    max={65535}
                  />
                </label>
              </div>
            )}

            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void handleSavePorts(true)}
                disabled={portsSaving || portsLoading}
              >
                {portsSaving ? "Đang xử lý..." : "Lưu & Tự động khởi động lại"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => void handleSavePorts(false)}
                disabled={portsSaving || portsLoading}
              >
                Lưu cấu hình (Không tự động khởi động lại)
              </button>
              {portsMsg && (
                <span
                  style={{
                    fontSize: "13px",
                    color: portsOk ? "var(--success)" : "var(--red-bright)",
                    fontWeight: 600,
                  }}
                >
                  {portsMsg}
                </span>
              )}
            </div>
          </section>
        </div>
      )}

      {/* TAB 5: CHANGELOG */}
      {activeTab === "changelog" && (
        <div className="settings-tab-content">
          <section className="panel-card">
            <h3 style={{ margin: "0 0 16px", fontSize: "17px", display: "flex", alignItems: "center", gap: 8 }}>
              <History size={20} style={{ color: "var(--purple-bright)" }} />
              Lịch sử nâng cấp & Tối ưu hóa
            </h3>
            <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 20 }}>
              Ghi chép các thay đổi quan trọng, tối ưu hiệu năng và tính năng mới được thêm vào ứng dụng.
            </p>

            {/* v2.1 */}
            <div className="changelog-entry">
              <div className="changelog-header">
                <span className="changelog-version">v2.1.0</span>
                <span className="changelog-date">13/07/2026</span>
                <span className="changelog-tag tag-feature">Tính năng mới</span>
              </div>
              <h4 className="changelog-title">🔴 Real-time Progress Tracker (SSE)</h4>
              <ul className="changelog-list">
                <li><strong>Backend — Event Bus:</strong> Hệ thống <code>ProgressBus</code> fan-out events tới tất cả SSE clients. Rate-limit 300ms/task, log batching 500ms.</li>
                <li><strong>Backend — SSE Endpoint:</strong> <code>GET /api/events/stream</code> với heartbeat 30s, graceful disconnect.</li>
                <li><strong>Frontend — useEventStream Hook:</strong> Auto-reconnect (exponential backoff 1s→16s), circular buffer 200 dòng log.</li>
                <li><strong>Frontend — ProgressTracker Panel:</strong> Floating panel góc dưới-phải, progress bar cho từng task, live log stream color-coded.</li>
                <li><strong>Task Queue Integration:</strong> 5 emit points cho status changes (running/completed/failed).</li>
                <li><strong>Generation Integration:</strong> 9 progress emit points (Đang chọn tài khoản → Đang gửi prompt → Đang lưu kết quả).</li>
                <li><strong>Workflow Integration:</strong> Pipe logs + node progress vào event bus.</li>
              </ul>
              <div className="changelog-files">Files: progress.py, events.py, useEventStream.ts, ProgressTracker.tsx, ProgressTracker.css, main.py, task_queue.py, generation.py, workflow_runner.py, App.tsx</div>
            </div>

            {/* v2.0 */}
            <div className="changelog-entry">
              <div className="changelog-header">
                <span className="changelog-version">v2.0.0</span>
                <span className="changelog-date">13/07/2026</span>
                <span className="changelog-tag tag-perf">Tối ưu hiệu năng</span>
              </div>
              <h4 className="changelog-title">⚡ Tối ưu hóa toàn diện (24 files)</h4>

              <h5 className="changelog-subtitle">🔴 Phase 1 — Critical Backend</h5>
              <ul className="changelog-list">
                <li><strong>task_queue.py:</strong> Fix memory leak (eviction policy max 500), O(1) counters, task ref storage, token_hex(8).</li>
                <li><strong>task_store.py:</strong> Persistent SQLite + WAL mode + busy_timeout + indexes (status, created_at).</li>
                <li><strong>video_assemble.py:</strong> Async FFmpeg (<code>asyncio.create_subprocess_exec</code>), Semaphore(2), Windows font paths.</li>
                <li><strong>frame_extract.py:</strong> Async FFmpeg với semaphore(2).</li>
                <li><strong>account_store.py:</strong> Debounced saves (1 write/sec), xóa dead code <code>_clear_expired</code>.</li>
                <li><strong>session_health.py:</strong> Bounded stale set với timestamps, auto-cleanup &gt; 1h.</li>
                <li><strong>flow_session.py:</strong> Lock dict cleanup khi &gt; 100 entries.</li>
              </ul>

              <h5 className="changelog-subtitle">🔴 Phase 2 — Critical Frontend</h5>
              <ul className="changelog-list">
                <li><strong>WorkflowPage.tsx:</strong> Stable handler refs (chặn cascading re-renders toàn bộ graph nodes), consolidate 5 localStorage effects → 1.</li>
                <li><strong>FlowVideoPage.tsx + FlowImagePage.tsx:</strong> Memoize selectedCount/completedCount/runningCount.</li>
                <li><strong>VideoStudioModal.tsx:</strong> Extract 23 static inline styles → module-level constants.</li>
                <li><strong>vite.config.ts:</strong> Manual chunk splitting (react, xyflow, lucide).</li>
              </ul>

              <h5 className="changelog-subtitle">🟠 Phase 3 — Async &amp; I/O</h5>
              <ul className="changelog-list">
                <li><strong>grok_web_client.py + prompt_ai.py:</strong> Shared httpx.AsyncClient (thay vì tạo mới mỗi request).</li>
                <li><strong>flow_client.py:</strong> Parallel image downloads (<code>asyncio.gather</code>), fix operator precedence bug.</li>
              </ul>

              <h5 className="changelog-subtitle">🟡 Phase 4 — DRY Refactor</h5>
              <ul className="changelog-list">
                <li><strong>generation.py:</strong> Extract <code>_validate_prompt</code> (5 chỗ) + <code>_track</code> helper (7 chỗ).</li>
                <li><strong>meta_client.py:</strong> Extract <code>_poll_until_done</code> (2 poll loops → 1 method).</li>
                <li><strong>utils/open_folder.py:</strong> Cross-platform folder opener (mới).</li>
              </ul>

              <h5 className="changelog-subtitle">🔒 Phase 5 — Security &amp; Stability</h5>
              <ul className="changelog-list">
                <li><strong>main.py:</strong> Path traversal fix, <code>time.sleep</code> → <code>await asyncio.sleep</code>.</li>
                <li><strong>media.py:</strong> Upload size limit 500MB, path traversal fix.</li>
                <li><strong>reference_storage.py:</strong> Thread locking + atomic writes.</li>
                <li><strong>flow_models.py:</strong> API key từ <code>os.getenv</code>.</li>
                <li><strong>batch.py:</strong> Route ordering fix, cleanup in submit.</li>
              </ul>

              <h5 className="changelog-subtitle">🟢 Phase 6 — API Parallel</h5>
              <ul className="changelog-list">
                <li><strong>ai.py:</strong> <code>rewrite_many</code> sequential → <code>asyncio.gather</code> với Semaphore(5).</li>
              </ul>
              <div className="changelog-files">24 files modified | Python py_compile ✅ | TypeScript tsc ✅ | 0 errors</div>
            </div>

          </section>
        </div>
      )}

      {/* TAB 6: MODELS LIST */}
      {activeTab === "models" && (
        <div className="settings-tab-content">
          <section className="panel-card">
            <h3 style={{ margin: "0 0 16px", fontSize: "17px", display: "flex", alignItems: "center", gap: 8 }}>
              <Layers size={20} style={{ color: "var(--purple-bright)" }} />
              Danh sách Model Google Flow
            </h3>
            <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 20 }}>
              Thông tin chi tiết các mô hình, mã khóa API và mức tiêu hao credit tương ứng quét được từ tab Google Flow.
            </p>

            {flowModelsLoading ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)" }}>
                Đang tải danh sách model...
              </div>
            ) : flowModels.length === 0 ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "var(--red-bright)", fontWeight: 500 }}>
                ⚠️ Không tìm thấy model. Hãy đảm bảo tab Google Flow đang mở trên trình duyệt để đồng bộ.
              </div>
            ) : (
              <div className="table-responsive" style={{ marginTop: "10px" }}>
                <table className="queue-table" style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                      <th style={{ padding: "10px", color: "var(--muted)", fontSize: "12px" }}>Tên hiển thị</th>
                      <th style={{ padding: "10px", color: "var(--muted)", fontSize: "12px" }}>Value Key nội bộ</th>
                      <th style={{ padding: "10px", color: "var(--muted)", fontSize: "12px" }}>Key gửi đi API</th>
                      <th style={{ padding: "10px", color: "var(--muted)", fontSize: "12px" }}>Giá Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flowModels.map((m, idx) => (
                      <tr key={idx} style={{ borderBottom: "1px solid var(--border-light)" }}>
                        <td style={{ padding: "12px 10px", fontWeight: 600 }}>{m.label.split(" (")[0]}</td>
                        <td style={{ padding: "12px 10px" }}><code style={{ color: "var(--purple-bright)", fontSize: "12px" }}>{m.value}</code></td>
                        <td style={{ padding: "12px 10px" }}><code style={{ color: "var(--blue-bright)", fontSize: "12px" }}>{m.api_value || m.value}</code></td>
                        <td style={{ padding: "12px 10px" }}>
                          <span style={{ 
                            padding: "3px 8px", 
                            borderRadius: "4px", 
                            fontSize: "11px", 
                            fontWeight: 600,
                            background: m.credits > 0 ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)",
                            color: m.credits > 0 ? "#f59e0b" : "#10b981"
                          }}>
                            {m.credits > 0 ? `${m.credits} credits` : "0 credit (Free)"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 7: GOOGLE DRIVE CONFIG */}
      {activeTab === "gdrive" && (
        <div className="settings-tab-content">
          <section className="panel-card">
            <h3 style={{ margin: "0 0 16px", fontSize: "17px", display: "flex", alignItems: "center", gap: 8 }}>
              <Cloud size={20} style={{ color: "var(--purple-bright)" }} />
              Cấu hình Google Drive Auto-Upload
            </h3>
            <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 20 }}>
              Tự động tải lên các tệp tin ảnh hoặc video được tạo thành công lên tài khoản Google Drive cá nhân của bạn thông qua liên kết Google OAuth2.
            </p>

            {gdriveLoading ? (
              <div style={{ padding: "40px 0", textAlign: "center", color: "var(--muted)" }}>
                Đang tải cài đặt Google Drive...
              </div>
            ) : (
              <div>
                {/* Switch enabled status */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24, padding: "12px 16px", background: "rgba(255,255,255,0.03)", borderRadius: 8, border: "1px solid var(--border-light)" }}>
                  <div>
                    <h4 style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>Tự động tải lên Google Drive</h4>
                    <span style={{ fontSize: "12px", color: "var(--muted)" }}>Bật tính năng tự động tải lên khi tác vụ tạo ảnh/video hoàn thành.</span>
                  </div>
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={gdriveEnabled}
                      onChange={(e) => setGdriveEnabled(e.target.checked)}
                    />
                    <span className="slider round"></span>
                  </label>
                </div>

                <div className="form-grid" style={{ marginBottom: 20 }}>
                  <label className="span-2">
                    Google Drive Folder ID (Thư mục đích)
                    <input
                      type="text"
                      value={gdriveFolderId}
                      onChange={(e) => setGdriveFolderId(e.target.value)}
                      placeholder="Dán ID thư mục của bạn vào đây (để trống sẽ lưu vào thư mục gốc của Drive)"
                      style={{ marginTop: 6 }}
                    />
                    <span style={{ fontSize: "11px", color: "var(--muted)", marginTop: 4, display: "block" }}>
                      * LƯU Ý: Đảm bảo tài khoản Google cá nhân của bạn có quyền xem/sửa thư mục này.
                    </span>
                  </label>

                  <label className="span-2" style={{ marginTop: 12 }}>
                    Cấu hình Google OAuth Client Secrets JSON
                    <textarea
                      rows={6}
                      value={gdriveJsonInput}
                      onChange={(e) => setGdriveJsonInput(e.target.value)}
                      placeholder='Dán toàn bộ nội dung tệp tin JSON OAuth Client ID (loại Desktop app) tải về từ Google Cloud Console vào đây. Ví dụ:
{
  "installed": {
    "client_id": "...",
    "project_id": "...",
    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
    "token_uri": "https://oauth2.googleapis.com/token",
    "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
    "client_secret": "...",
    "redirect_uris": ["http://localhost"]
  }
}'
                      style={{ fontFamily: "monospace", fontSize: "11px", marginTop: 6 }}
                    />
                  </label>
                </div>

                {/* OAuth Configuration connection status */}
                {gdriveHasSecrets ? (
                  <div style={{ marginBottom: 20, padding: "14px", background: gdriveHasCredentials ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.08)", border: gdriveHasCredentials ? "1px solid rgba(16, 185, 129, 0.2)" : "1px solid rgba(245, 158, 11, 0.2)", borderRadius: 6 }}>
                    {gdriveHasCredentials ? (
                      <div>
                        <h5 style={{ margin: "0 0 6px", color: "#10b981", fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                          ✅ Đã liên kết tài khoản Google Drive cá nhân
                        </h5>
                        <div style={{ fontSize: "12px", color: "var(--muted)", lineHeight: 1.5 }}>
                          <div><strong>Tài khoản hoạt động:</strong> <span style={{ color: "var(--blue-bright)" }}>{gdriveAuthorizedEmail}</span></div>
                          <div><strong>OAuth Client ID:</strong> {gdriveClientId}</div>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <h5 style={{ margin: "0 0 8px", color: "#f59e0b", fontSize: "13px", fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                          ⚠️ Chưa liên kết tài khoản Google Drive
                        </h5>
                        <p style={{ margin: "0 0 12px", fontSize: "12px", color: "var(--muted)" }}>
                          Đã lưu cấu hình Client Secrets (Client ID: {gdriveClientId}). Bạn cần bấm nút bên dưới để đăng nhập tài khoản Google cá nhân của bạn và cấp quyền truy cập.
                        </p>
                        <button
                          type="button"
                          className="btn btn-primary"
                          onClick={handleAuthGdrive}
                          disabled={gdriveAuthing || gdriveSaving}
                        >
                          {gdriveAuthing ? "Đang mở trình duyệt..." : "Liên kết tài khoản Google Drive"}
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginBottom: 20, padding: "14px", background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)", borderRadius: 6, fontSize: "12px", color: "var(--red-bright)", fontWeight: 500 }}>
                    ⚠️ Vui lòng cấu hình và lưu tệp JSON Client Secrets (loại Desktop app) để mở tính năng liên kết tài khoản Google Drive.
                  </div>
                )}

                {/* Status messages and Save / Test buttons */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border-light)" }}>
                  <div style={{ flex: 1, marginRight: 16 }}>
                    {gdriveMsg && (
                      <span
                        style={{
                          fontSize: "13px",
                          color: gdriveOk ? "var(--success)" : "var(--red-bright)",
                          fontWeight: 600,
                        }}
                      >
                        {gdriveMsg}
                      </span>
                    )}
                  </div>
                  
                  <div style={{ display: "flex", gap: 12 }}>
                    {gdriveHasCredentials && (
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={handleTestGdrive}
                        disabled={gdriveTesting || gdriveSaving || gdriveAuthing}
                      >
                        {gdriveTesting ? "Đang kiểm tra..." : "Test Connection"}
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={handleSaveGdrive}
                      disabled={gdriveSaving || gdriveTesting || gdriveAuthing}
                    >
                      {gdriveSaving ? "Đang lưu..." : "Lưu thay đổi"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

        </div>
      </div>

      {editingAccount && (
        <div className="ui-dialog-overlay" style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div className="ui-dialog-panel panel-card" style={{ maxWidth: 500, width: "100%", margin: "auto", padding: 24 }}>
            <h3 style={{ margin: "0 0 12px", color: "#fff" }}>Cập nhật Cookie / Credentials</h3>
            <p className="muted" style={{ fontSize: "13px", marginTop: 0, marginBottom: 16 }}>
              Tài khoản: <strong>{editingAccount.label}</strong> ({PROVIDER_LABELS[editingAccount.provider]})
            </p>

            {editingAccount.provider === "openai" && (
              <div className="form-grid" style={{ marginBottom: 14 }}>
                <label className="span-2">
                  OpenAI API Key
                  <input
                    type="password"
                    value={editApiKey}
                    onChange={(e) => setEditApiKey(e.target.value)}
                    placeholder="sk-proj-..."
                  />
                </label>
              </div>
            )}

            {editingAccount.provider === "grok" && (
              <div className="form-grid" style={{ marginBottom: 14 }}>
                <label className="span-2">
                  Cookie Grok (chứa sso + sso-rw)
                  <textarea
                    rows={4}
                    value={editCookie}
                    onChange={(e) => setEditCookie(e.target.value)}
                    placeholder="Dán Cookie hoặc chuỗi JSON cookie grok.com..."
                    style={{ fontFamily: "monospace", fontSize: "11px" }}
                  />
                </label>
                <label className="span-2">
                  API Key xAI (tùy chọn)
                  <input
                    type="password"
                    value={editApiKey}
                    onChange={(e) => setEditApiKey(e.target.value)}
                    placeholder="xai-..."
                  />
                </label>
              </div>
            )}

            {editingAccount.provider === "flow" && (
              <div className="form-grid" style={{ marginBottom: 14 }}>
                <label className="span-2">
                  Session Token Flow (__Secure-next-auth.session-token)
                  <textarea
                    rows={4}
                    value={editSessionToken}
                    onChange={(e) => setEditSessionToken(e.target.value)}
                    placeholder="Dán Session Token Google Labs Flow..."
                    style={{ fontFamily: "monospace", fontSize: "11px" }}
                  />
                </label>
              </div>
            )}

            {editingAccount.provider === "meta" && (
              <div className="form-grid" style={{ marginBottom: 14 }}>
                <label className="span-2">
                  Cookie Vibes.ai (chứa meta_session)
                  <textarea
                    rows={4}
                    value={editCookie}
                    onChange={(e) => setEditCookie(e.target.value)}
                    placeholder="Dán Cookie vibes.ai chứa meta_session=..."
                    style={{ fontFamily: "monospace", fontSize: "11px" }}
                  />
                </label>
              </div>
            )}

            {editingAccount.provider !== "openai" &&
              editingAccount.provider !== "grok" &&
              editingAccount.provider !== "flow" &&
              editingAccount.provider !== "meta" && (
                <div className="form-grid" style={{ marginBottom: 14 }}>
                  <label className="span-2">
                    Cookie / Token
                    <textarea
                      rows={4}
                      value={editCookie}
                      onChange={(e) => setEditCookie(e.target.value)}
                      placeholder="Dán Cookie hoặc Session Token..."
                      style={{ fontFamily: "monospace", fontSize: "11px" }}
                    />
                  </label>
                </div>
              )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setEditingAccount(null)}
                disabled={loading}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSaveEdit}
                disabled={loading}
              >
                {loading ? "Đang cập nhật..." : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
