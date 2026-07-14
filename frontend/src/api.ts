export type Provider = "flow" | "grok" | "meta" | "openai";
export type BatchProvider = "image" | "video" | "grok" | "meta" | "openai";

export interface Account {
  id: string;
  provider: Provider;
  label: string;
  /** Real email from last session refresh (Flow), if known */
  email?: string | null;
  image_enabled: boolean;
  video_enabled: boolean;
  enabled: boolean;
  has_credentials: boolean;
  last_used_at?: number | null;
  cooldown_until?: number | null;
  cooldown_left_sec?: number;
  in_cooldown?: boolean;
  last_error?: string | null;
  /** short hint: cookie in app vs browser tab */
  auth_hint?: string | null;
  credits_remaining?: number | null;
}

export interface AppInfo {
  name: string;
  api_key: string;
}

export interface NamedReferencePayload {
  name: string;
  data: string;
  label?: string;
}

export interface BatchItemParams {
  model?: string;
  aspect_ratio?: string;
  mode?: string;
  reference_images?: string[];
  named_references?: NamedReferencePayload[];
  upscale?: string[];
  resolution?: string[];
  count?: number;
  save_mode?: string;
  output_folder?: string;
}

export interface BatchItemResult {
  index: number;
  prompt: string;
  provider: string;
  status: "completed" | "failed";
  results?: string[];
  saved_folder?: string;
  error?: string;
  error_detail?: string;
}

export interface BatchResult {
  total: number;
  completed: number;
  failed: number;
  queue: { pending: number; running: number };
  results: BatchItemResult[];
}

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.userAgent);
const BACKEND_HINT = isMac
  ? "Backend chưa chạy — hãy mở Terminal và chạy ./start.sh hoặc npm start"
  : "Backend chưa chạy — hãy mở PowerShell và chạy .\\start-backend.ps1 (giữ cửa sổ mở)";

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message === "Failed to fetch" ||
      message.includes("NetworkError") ||
      message.includes("ECONNREFUSED")
    ) {
      throw new Error(BACKEND_HINT);
    }
    throw err;
  }
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      isMac
        ? "Backend không phản hồi — hãy chạy ./start.sh hoặc npm start"
        : "Backend không phản hồi — hãy chạy .\\start-backend.ps1 và giữ cửa sổ PowerShell mở",
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.trim().slice(0, 80);
    if (preview.toLowerCase().startsWith("<!doctype") || preview.startsWith("<html")) {
      throw new Error(
        isMac
          ? "Backend chưa chạy hoặc proxy lỗi — hãy chạy ./start.sh hoặc npm start"
          : "Backend chưa chạy hoặc proxy lỗi — hãy chạy .\\start-backend.ps1",
      );
    }
    throw new Error(`Phản hồi không phải JSON: ${preview || "(rỗng)"}`);
  }
}

async function ensureOk(res: Response, fallback: string): Promise<Response> {
  if (res.ok) return res;
  // Clone so callers can still read body if needed; parse error once
  let message = fallback;
  try {
    const data = (await res.clone().json()) as {
      error?: string;
      detail?: { error?: string } | string | Array<{ msg?: string }>;
    };
    const detail = data.detail;
    message = data.error || fallback;
    if (typeof detail === "string") message = detail;
    else if (Array.isArray(detail) && detail[0]?.msg) message = detail[0].msg;
    else if (detail && typeof detail === "object" && "error" in detail && detail.error) {
      message = String(detail.error);
    }
  } catch {
    try {
      const text = (await res.clone().text()).trim().slice(0, 200);
      if (text) message = text;
    } catch {
      /* keep fallback */
    }
  }
  throw new Error(message);
}

export function normalizeFileUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/api/files/")) {
      return parsed.pathname + (parsed.search || "");
    }
  } catch {
    if (url.startsWith("/api/files/")) return url;
  }
  return url;
}

/**
 * Safe media URL for <video>/<img> src.
 * Encodes path segments so spaces in "G-Labs BW/..." work through Vite proxy.
 */
export function mediaUrl(url: string): string {
  const raw = normalizeFileUrl(url || "");
  if (!raw) return raw;
  if (!raw.startsWith("/api/files/")) return raw;
  try {
    const [pathPart, queryPart] = raw.split("?");
    const rest = pathPart.slice("/api/files/".length);
    const encoded = rest
      .split("/")
      .map((seg) => {
        try {
          return encodeURIComponent(decodeURIComponent(seg));
        } catch {
          return encodeURIComponent(seg);
        }
      })
      .join("/");
    const suffix = queryPart ? `?${queryPart}` : "";
    return `/api/files/${encoded}${suffix}`;
  } catch {
    return raw.replace(/ /g, "%20");
  }
}

export async function fetchAppInfo(): Promise<AppInfo> {
  const res = await apiFetch("/api/info");
  await ensureOk(res, "Cannot reach backend");
  return readJson<AppInfo>(res);
}

export async function fetchAccounts(): Promise<Account[]> {
  const res = await apiFetch("/api/accounts");
  await ensureOk(res, "Failed to load accounts");
  const data = await readJson<{ accounts: Account[] }>(res);
  return data.accounts;
}

export async function createAccount(payload: {
  provider: Provider;
  label: string;
  credentials: Record<string, string>;
  image_enabled: boolean;
  video_enabled: boolean;
}): Promise<Account> {
  const res = await apiFetch("/api/accounts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, enabled: true }),
  });
  await ensureOk(res, "Failed to create account");
  const data = await readJson<{ account: Account }>(res);
  return data.account;
}

export async function deleteAccount(id: string): Promise<void> {
  const res = await apiFetch(`/api/accounts/${id}`, { method: "DELETE" });
  await ensureOk(res, "Failed to delete account");
}

export async function updateAccount(
  id: string,
  payload: {
    label?: string;
    enabled?: boolean;
    image_enabled?: boolean;
    video_enabled?: boolean;
    credentials?: Record<string, string>;
    clear_cooldown?: boolean;
  },
): Promise<Account> {
  const res = await apiFetch(`/api/accounts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureOk(res, "Failed to update account");
  const data = await readJson<{ account: Account }>(res);
  return data.account;
}

export async function submitBatch(
  items: { prompt: string; provider: BatchProvider; params?: BatchItemParams }[],
  concurrency: number,
): Promise<BatchResult> {
  const res = await apiFetch("/api/batch/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, concurrency }),
  });
  await ensureOk(res, "Batch submit failed");
  return readJson<BatchResult>(res);
}

export interface AiSettings {
  enabled: boolean;
  provider: string;
  base_url: string;
  model: string;
  has_api_key: boolean;
  /** Alias of has_api_key — key đã lưu trên server */
  api_key_set?: boolean;
  api_key_masked: string;
  image_enabled: boolean;
  video_enabled: boolean;
  image_style: string;
  video_style: string;
  image_custom_instruction: string;
  video_custom_instruction: string;
}

export function aiHasSavedKey(data: AiSettings | null | undefined): boolean {
  if (!data) return false;
  return Boolean(data.has_api_key || data.api_key_set);
}

const AI_API_MISSING =
  "API AI chưa sẵn sàng (404) — restart backend (CHAY-APP / start-backend) rồi thử lại";

async function ensureAiOk(res: Response, fallback: string): Promise<Response> {
  if (res.status === 404) {
    throw new Error(AI_API_MISSING);
  }
  await ensureOk(res, fallback);
  return res;
}

export async function fetchAiSettings(): Promise<AiSettings> {
  const res = await apiFetch("/api/ai/settings");
  await ensureAiOk(res, "Không tải được cài đặt AI");
  return readJson<AiSettings>(res);
}

/** Full patch — prefer saveAiApiSettings / savePromptSettings for UI. */
export async function saveAiSettings(payload: {
  enabled?: boolean;
  provider?: string;
  api_key?: string;
  base_url?: string;
  model?: string;
  image_enabled?: boolean;
  video_enabled?: boolean;
  image_style?: string;
  video_style?: string;
  image_custom_instruction?: string;
  video_custom_instruction?: string;
}): Promise<AiSettings> {
  const res = await apiFetch("/api/ai/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureAiOk(res, "Không lưu được cài đặt AI");
  return readJson<AiSettings>(res);
}

/** Chỉ API: bật/tắt, provider, model, base URL, key — không đụng style prompt. */
export async function saveAiApiSettings(payload: {
  enabled?: boolean;
  provider?: string;
  api_key?: string;
  base_url?: string;
  model?: string;
}): Promise<AiSettings> {
  return saveAiSettings(payload);
}

/** Chỉ cách viết lại prompt (ảnh/video) — không đụng API key. */
export async function savePromptSettings(payload: {
  image_enabled?: boolean;
  video_enabled?: boolean;
  image_style?: string;
  video_style?: string;
  image_custom_instruction?: string;
  video_custom_instruction?: string;
}): Promise<AiSettings> {
  return saveAiSettings(payload);
}

export interface AiTestResult {
  ok: boolean;
  model?: string;
  base_url?: string;
  latency_ms?: number;
  reply?: string;
  message?: string;
}

/** Gọi thử chat/completions — có thể truyền form chưa lưu (key trống = dùng key đã lưu). */
export async function testAiApi(payload?: {
  provider?: string;
  api_key?: string;
  base_url?: string;
  model?: string;
}): Promise<AiTestResult> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 55_000);
  try {
    const res = await apiFetch("/api/ai/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
      signal: controller.signal,
    });
    await ensureAiOk(res, "Test API AI thất bại");
    return readJson<AiTestResult>(res);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Test quá lâu — kiểm tra Base URL / mạng / model");
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export interface WorkflowAiNodeContext {
  id: string;
  type: string;
  title?: string;
  prompt?: string;
  model?: string;
  mode?: string;
  has_image?: boolean;
  /** graph distance from current (1 = direct neighbor) */
  hop?: number;
  /** short note: has results, frame positions, etc. */
  note?: string;
  role: "upstream" | "current" | "downstream";
}

export async function rewritePromptAi(payload: {
  prompt: string;
  kind?: "video" | "image";
  locale?: string;
  current_node_id?: string;
  workflow_context?: WorkflowAiNodeContext[];
}): Promise<{ prompt: string; original: string; changed?: boolean }> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 100_000);
  try {
    const res = await apiFetch("/api/ai/rewrite-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: payload.prompt,
        kind: payload.kind ?? "video",
        locale: payload.locale ?? "vi",
        current_node_id: payload.current_node_id ?? null,
        workflow_context: payload.workflow_context ?? null,
      }),
      signal: controller.signal,
    });
    await ensureAiOk(res, "AI sửa prompt thất bại");
    return readJson(res);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("AI quá lâu / API ngoài không phản hồi — kiểm tra Base URL, Model, Key trong Cài đặt");
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function rewritePromptsAi(payload: {
  prompts: string[];
  kind?: "video" | "image";
  locale?: string;
}): Promise<{
  total: number;
  ok: number;
  failed: number;
  results: { index: number; original: string; prompt: string; status: string; error?: string }[];
}> {
  const res = await apiFetch("/api/ai/rewrite-prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompts: payload.prompts,
      kind: payload.kind ?? "video",
      locale: payload.locale ?? "vi",
    }),
  });
  await ensureAiOk(res, "AI sửa prompt hàng loạt thất bại");
  return readJson(res);
}

export interface ReferenceRecord {
  id: string;
  name: string;
  label: string;
  category: string;
  filename: string;
  file_path: string;
  image_url: string;
  created_at?: string;
  updated_at?: string;
}

export interface ReferenceLibraryResponse {
  references: ReferenceRecord[];
  folder: string;
  max_items: number;
  count: number;
}

export function mapReferenceRecord(record: ReferenceRecord) {
  return {
    id: record.id,
    name: record.name,
    label: record.label,
    category: record.category as import("./types").ReferenceCategory,
    image: normalizeFileUrl(record.image_url),
    filePath: record.file_path,
  };
}

export async function fetchReferenceLibrary(): Promise<ReferenceLibraryResponse> {
  const res = await apiFetch("/api/references");
  await ensureOk(res, "Không tải được thư viện ảnh tham chiếu");
  return readJson<ReferenceLibraryResponse>(res);
}

export async function uploadReferenceImages(files: File[]): Promise<ReferenceRecord[]> {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  const res = await apiFetch("/api/references", { method: "POST", body: form });
  await ensureOk(res, "Không tải lên được ảnh tham chiếu");
  const data = await readJson<{ references: ReferenceRecord[]; errors?: string[] }>(res);
  if (data.errors?.length) {
    throw new Error(data.errors.join("; "));
  }
  return data.references;
}

export async function addReferenceFromPath(
  filePath: string,
  label: string,
  category: string,
): Promise<ReferenceRecord> {
  const res = await apiFetch("/api/references/from-path", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filePath, label, category }),
  });
  await ensureOk(res, "Không thể thêm ảnh từ thư viện app");
  const data = await readJson<{ reference: ReferenceRecord }>(res);
  return data.reference;
}

export async function updateReferenceRecord(
  id: string,
  patch: { name?: string; label?: string; category?: string },
): Promise<ReferenceRecord> {
  const res = await apiFetch(`/api/references/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  await ensureOk(res, "Không cập nhật được ảnh tham chiếu");
  const data = await readJson<{ reference: ReferenceRecord }>(res);
  return data.reference;
}

export async function replaceReferenceImage(id: string, file: File): Promise<ReferenceRecord> {
  const form = new FormData();
  form.append("file", file);
  const res = await apiFetch(`/api/references/${id}/image`, { method: "PUT", body: form });
  await ensureOk(res, "Không thay được ảnh tham chiếu");
  const data = await readJson<{ reference: ReferenceRecord }>(res);
  return data.reference;
}

export async function deleteReferenceRecord(id: string): Promise<void> {
  const res = await apiFetch(`/api/references/${id}`, { method: "DELETE" });
  await ensureOk(res, "Không xóa được ảnh tham chiếu");
}

export async function openOutputFolder(folder: string): Promise<void> {
  const res = await apiFetch("/api/open-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder }),
  });
  await ensureOk(res, "Không mở được thư mục");
}

export interface HealthStatus {
  status: string;
  uptime?: number;
  tasks_pending?: number;
  tasks_running?: number;
  max_concurrent?: number;
  extension_connected?: boolean;
  flow_tab?: string;
  grok_tab?: string;
  flow_accounts?: number;
  flow_image_ready?: number;
  flow_video_ready?: number;
  grok_ready?: number;
  disk_free_gb?: number | null;
  disk_ok?: boolean;
  flow_session_ok?: boolean;
  ready_to_generate?: boolean;
  readiness_reasons?: string[];
  session?: {
    flow_session_ok?: boolean;
    last_flow_error?: string | null;
    hint?: string | null;
  };
  [key: string]: unknown;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await apiFetch("/api/health");
  await ensureOk(res, "Health check failed");
  return readJson<HealthStatus>(res);
}

export async function exportAccountsBackup(includeSecrets = false): Promise<unknown> {
  const q = includeSecrets ? "?include_secrets=true" : "";
  const res = await apiFetch(`/api/accounts/export/backup${q}`);
  await ensureOk(res, "Export accounts failed");
  return readJson(res);
}

export async function importAccountsBackup(payload: {
  accounts: Array<{
    provider: Provider;
    label?: string;
    credentials?: Record<string, string>;
    image_enabled?: boolean;
    video_enabled?: boolean;
    enabled?: boolean;
  }>;
}): Promise<{ created: number; skipped: number; errors: string[] }> {
  const res = await apiFetch("/api/accounts/import/backup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureOk(res, "Import accounts failed");
  return readJson(res);
}

export async function fetchDiskInfo(): Promise<Record<string, unknown>> {
  const res = await apiFetch("/api/maintenance/disk");
  await ensureOk(res, "Disk info failed");
  return readJson(res);
}

export async function cleanupOutputs(opts?: {
  olderThanDays?: number;
  dryRun?: boolean;
}): Promise<Record<string, unknown>> {
  const days = opts?.olderThanDays ?? 30;
  const dry = opts?.dryRun ?? true;
  const res = await apiFetch(
    `/api/maintenance/cleanup-outputs?older_than_days=${days}&dry_run=${dry}`,
    { method: "POST" },
  );
  await ensureOk(res, "Cleanup failed");
  return readJson(res);
}

export type TestSuite = "all" | "smoke" | "api";

export interface TestRunResult {
  ok: boolean;
  exit_code: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
  duration_sec: number;
  summary: string;
  output: string;
  suite?: string;
  tests_path?: string;
  command?: string[];
}

export async function runProjectTests(
  suite: TestSuite = "all",
  verbose = false,
): Promise<TestRunResult> {
  const res = await apiFetch("/api/maintenance/run-tests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ suite, verbose }),
  });
  await ensureOk(res, "Chạy test thất bại");
  return readJson<TestRunResult>(res);
}

export interface ExtensionStatus {
  connected: boolean;
  flow_tab: string;
  grok_tab: string;
  token_count: number;
  extensions: number;
  pending_captcha: number;
  pending_grok?: number;
  uptime?: number;
  has_statsig?: boolean;
  statsig_wanted?: boolean;
}

export async function fetchExtensionStatus(): Promise<ExtensionStatus> {
  const res = await apiFetch("/api/extension/status");
  await ensureOk(res, "Extension status failed");
  return readJson<ExtensionStatus>(res);
}

/* —— G-Labs feature parity APIs —— */

export interface LoginBrowserJob {
  job_id: string;
  status: string;
  message: string;
  email?: string | null;
  account_id?: string | null;
  error?: string | null;
}

export async function startLoginBrowser(label = ""): Promise<LoginBrowserJob> {
  const res = await apiFetch("/api/accounts/login/browser", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label, timeout_sec: 600 }),
  });
  await ensureOk(res, "Không mở được browser login");
  return readJson(res);
}

export async function fetchLoginBrowserStatus(jobId: string): Promise<LoginBrowserJob> {
  const res = await apiFetch(`/api/accounts/login/browser/${jobId}`);
  await ensureOk(res, "Không lấy được trạng thái login");
  return readJson(res);
}

export interface HubPrompt {
  id: string;
  title: string;
  text: string;
  kind: string;
  tags: string[];
  created_at?: number;
  updated_at?: number;
  use_count?: number;
}

export async function fetchPrompts(opts?: {
  kind?: string;
  q?: string;
}): Promise<HubPrompt[]> {
  const params = new URLSearchParams();
  if (opts?.kind) params.set("kind", opts.kind);
  if (opts?.q) params.set("q", opts.q);
  const qs = params.toString();
  const res = await apiFetch(`/api/prompts${qs ? `?${qs}` : ""}`);
  await ensureOk(res, "Không tải Prompt Hub");
  const data = await readJson<{ prompts: HubPrompt[] }>(res);
  return data.prompts;
}

export async function createPrompt(payload: {
  title: string;
  text: string;
  kind?: string;
  tags?: string[];
}): Promise<HubPrompt> {
  const res = await apiFetch("/api/prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureOk(res, "Không lưu prompt");
  const data = await readJson<{ prompt: HubPrompt }>(res);
  return data.prompt;
}

export async function updatePrompt(
  id: string,
  payload: Partial<{ title: string; text: string; kind: string; tags: string[] }>,
): Promise<HubPrompt> {
  const res = await apiFetch(`/api/prompts/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureOk(res, "Không cập nhật prompt");
  const data = await readJson<{ prompt: HubPrompt }>(res);
  return data.prompt;
}

export async function deletePrompt(id: string): Promise<void> {
  const res = await apiFetch(`/api/prompts/${id}`, { method: "DELETE" });
  await ensureOk(res, "Không xóa prompt");
}

export async function usePrompt(id: string): Promise<HubPrompt> {
  const res = await apiFetch(`/api/prompts/${id}/use`, { method: "POST" });
  await ensureOk(res, "Không dùng prompt");
  const data = await readJson<{ prompt: HubPrompt }>(res);
  return data.prompt;
}

export interface ExtractedFrame {
  position: string;
  path: string;
  url: string;
}

export async function extractFramesFromPath(
  filePathOrUrl: string,
  positions: string[] = ["start", "middle", "end"],
): Promise<ExtractedFrame[]> {
  const body =
    filePathOrUrl.includes("/api/files/") || filePathOrUrl.startsWith("http")
      ? { file_url: filePathOrUrl, positions }
      : { file_path: filePathOrUrl, positions };
  const res = await apiFetch("/api/media/extract-frames", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  await ensureOk(res, "Tách frame thất bại");
  const data = await readJson<{ frames: ExtractedFrame[] }>(res);
  return data.frames;
}

export async function extractFramesUpload(
  file: File,
  positions = "start,middle,end",
): Promise<ExtractedFrame[]> {
  const form = new FormData();
  form.append("file", file);
  form.append("positions", positions);
  const res = await apiFetch("/api/media/extract-frames/upload", {
    method: "POST",
    body: form,
  });
  await ensureOk(res, "Upload/tách frame thất bại");
  const data = await readJson<{ frames: ExtractedFrame[] }>(res);
  return data.frames;
}

export async function fileAsDataUrl(filePath: string): Promise<string> {
  const res = await apiFetch("/api/media/file-as-data-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path: filePath }),
  });
  await ensureOk(res, "Không đọc file");
  const data = await readJson<{ data_url: string }>(res);
  return data.data_url;
}

export async function deleteMediaFile(filePath: string): Promise<void> {
  const params = new URLSearchParams();
  params.set("file_path", filePath);
  const res = await apiFetch(`/api/media/delete-file?${params}`, {
    method: "DELETE",
  });
  await ensureOk(res, "Xóa file thất bại");
}

export interface PipelineResult {
  job_id: string;
  status: string;
  step?: string;
  image_urls?: string[];
  video_urls?: string[];
  image_folder?: string | null;
  video_folder?: string | null;
  error?: string | null;
}

export async function runImageThenVideoPipeline(payload: {
  prompt: string;
  video_prompt?: string;
  image_params?: Record<string, unknown>;
  video_params?: Record<string, unknown>;
}): Promise<PipelineResult> {
  const res = await apiFetch("/api/pipeline/image-then-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureOk(res, "Pipeline thất bại");
  return readJson(res);
}

export async function fetchDashboard(): Promise<Record<string, unknown>> {
  const res = await apiFetch("/api/dashboard");
  await ensureOk(res, "Không tải dashboard");
  return readJson(res);
}

export async function fetchFlowModels(): Promise<{ is_placeholder: boolean; models: Array<{ value: string; label: string; credits: number }> }> {
  const res = await apiFetch("/api/dashboard/flow-models");
  await ensureOk(res, "Không tải danh sách model");
  return readJson(res);
}

export async function clearDashboardHistory(type: "all" | "completed" | "failed"): Promise<void> {
  const res = await apiFetch("/api/dashboard/clear", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type }),
  });
  await ensureOk(res, "Không thể xóa lịch sử");
}

/* —— Workflow (G-Labs node editor) —— */

export interface WorkflowMeta {
  id: string;
  name: string;
  description?: string;
  updated_at?: number;
  created_at?: number;
  node_count?: number;
}

export interface WorkflowDoc {
  id?: string | null;
  name: string;
  description?: string;
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  viewport?: { x: number; y: number; zoom: number };
}

export interface WorkflowRunResult {
  run_id: string;
  status: string;
  node_results?: Record<string, unknown>;
  logs?: Array<{ t: number; msg: string }>;
  error?: string | null;
  started_at?: number;
  finished_at?: number | null;
  progress?: { done?: number; total?: number; current?: string | null };
  mode?: { skip_completed?: boolean; only_node_ids?: string[] | null };
}

export interface WorkflowRunOptions {
  async_mode?: boolean;
  skip_completed?: boolean;
  only_node_ids?: string[];
  prior_results?: Record<string, unknown>;
  project_id?: string | null;
}

export async function listWorkflows(): Promise<WorkflowMeta[]> {
  const res = await apiFetch("/api/workflows");
  await ensureOk(res, "Không tải workflows");
  const data = await readJson<{ workflows: WorkflowMeta[] }>(res);
  return data.workflows;
}

export async function fetchWorkflow(id: string): Promise<WorkflowDoc> {
  const res = await apiFetch(`/api/workflows/${id}`);
  await ensureOk(res, "Không tải workflow");
  const data = await readJson<{ workflow: WorkflowDoc }>(res);
  return data.workflow;
}

export async function fetchSampleWorkflow(): Promise<WorkflowDoc> {
  const res = await apiFetch("/api/workflows/sample/default");
  await ensureOk(res, "Không tải mẫu");
  const data = await readJson<{ workflow: WorkflowDoc }>(res);
  return data.workflow;
}

/** Ảnh → Video1 → frame cuối → Video2 */
export async function fetchSampleVideoChain(): Promise<WorkflowDoc> {
  const res = await apiFetch("/api/workflows/sample/video-chain");
  await ensureOk(res, "Không tải mẫu video chain");
  const data = await readJson<{ workflow: WorkflowDoc }>(res);
  return data.workflow;
}

/** Bóc tách sản phẩm */
export async function fetchSampleProductIsolate(): Promise<WorkflowDoc> {
  const res = await apiFetch("/api/workflows/sample/product-isolate");
  await ensureOk(res, "Không tải mẫu bóc tách sản phẩm");
  const data = await readJson<{ workflow: WorkflowDoc }>(res);
  return data.workflow;
}

/** Ghép sản phẩm vào nhân vật */
export async function fetchSampleProductPlacement(): Promise<WorkflowDoc> {
  const res = await apiFetch("/api/workflows/sample/product-placement");
  await ensureOk(res, "Không tải mẫu ghép sản phẩm");
  const data = await readJson<{ workflow: WorkflowDoc }>(res);
  return data.workflow;
}

/** Bóc tách nhiều sản phẩm */
export async function fetchSampleMultiProductIsolate(): Promise<WorkflowDoc> {
  const res = await apiFetch("/api/workflows/sample/multi-product-isolate");
  await ensureOk(res, "Không tải mẫu bóc tách nhiều sản phẩm");
  const data = await readJson<{ workflow: WorkflowDoc }>(res);
  return data.workflow;
}

export async function saveWorkflow(
  doc: WorkflowDoc,
  id?: string | null,
): Promise<WorkflowDoc> {
  const res = await apiFetch(id ? `/api/workflows/${id}` : "/api/workflows", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: doc.name,
      nodes: doc.nodes,
      edges: doc.edges,
      viewport: doc.viewport,
    }),
  });
  await ensureOk(res, "Không lưu workflow");
  const data = await readJson<{ workflow: WorkflowDoc }>(res);
  return data.workflow;
}

export async function deleteWorkflow(id: string): Promise<void> {
  const res = await apiFetch(`/api/workflows/${id}`, { method: "DELETE" });
  await ensureOk(res, "Không xóa workflow");
}

export async function runWorkflowGraph(
  doc: WorkflowDoc,
  opts: WorkflowRunOptions = {},
): Promise<WorkflowRunResult> {
  const res = await apiFetch("/api/workflows/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: doc.name,
      nodes: doc.nodes,
      edges: doc.edges,
      async_mode: opts.async_mode !== false,
      skip_completed: Boolean(opts.skip_completed),
      only_node_ids: opts.only_node_ids ?? null,
      prior_results: opts.prior_results ?? null,
      project_id: opts.project_id ?? null,
    }),
  });
  await ensureOk(res, "Chạy workflow thất bại");
  return readJson(res);
}

export async function fetchWorkflowRun(runId: string): Promise<WorkflowRunResult> {
  const res = await apiFetch(`/api/workflows/runs/${runId}`);
  await ensureOk(res, "Không lấy được tiến độ workflow");
  return readJson(res);
}

export async function checkActiveWorkflowRun(projectId: string): Promise<WorkflowRunResult | null> {
  const res = await apiFetch(`/api/workflows/active-run/${projectId}`);
  await ensureOk(res, "Không kiểm tra được tiến trình đang chạy");
  const data = await readJson<{ run: WorkflowRunResult | null }>(res);
  return data.run;
}

/* —— Workflow Projects —— */

export interface ProjectMeta {
  id: string;
  name: string;
  description?: string;
  updated_at?: number;
  created_at?: number;
  node_count?: number;
  edge_count?: number;
  thumbnail?: string | null;
  tags?: string[];
  asset_stats?: ProjectAssetStats;
  output_folder?: string;
}

export interface ProjectDoc {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
  viewport?: { x: number; y: number; zoom: number };
  node_states?: Record<string, unknown>;
  created_at?: number;
  updated_at?: number;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const res = await apiFetch("/api/projects");
  await ensureOk(res, "Không tải projects");
  const data = await readJson<{ projects: ProjectMeta[] }>(res);
  return data.projects;
}

export async function fetchProject(id: string): Promise<ProjectDoc> {
  const res = await apiFetch(`/api/projects/${id}`);
  await ensureOk(res, "Không mở project");
  const data = await readJson<{ project: ProjectDoc }>(res);
  return data.project;
}

export async function saveProject(
  doc: {
    name: string;
    description?: string;
    tags?: string[];
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    viewport?: { x: number; y: number; zoom: number };
    node_states?: Record<string, unknown>;
  },
  id?: string | null,
): Promise<ProjectDoc> {
  const res = await apiFetch(id ? `/api/projects/${id}` : "/api/projects", {
    method: id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(doc),
  });
  await ensureOk(res, "Không lưu project");
  const data = await readJson<{ project: ProjectDoc }>(res);
  return data.project;
}

export async function deleteProject(id: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
  await ensureOk(res, "Không xóa project");
}

export async function duplicateProject(id: string): Promise<ProjectDoc> {
  const res = await apiFetch(`/api/projects/${id}/duplicate`, { method: "POST" });
  await ensureOk(res, "Không nhân bản project");
  const data = await readJson<{ project: ProjectDoc }>(res);
  return data.project;
}

export interface ProjectAsset {
  path: string;
  name: string;
  kind: "image" | "video" | string;
  url: string;
  bytes?: number;
  mb?: number;
  mtime?: number;
  folder?: string;
}

export interface ProjectAssetStats {
  images: number;
  videos: number;
  total: number;
  total_mb: number;
  thumbnails?: string[];
  latest?: ProjectAsset | null;
}

export async function fetchProjectAssets(
  id: string,
  kind?: "image" | "video" | "all",
): Promise<{ assets: ProjectAsset[]; stats: ProjectAssetStats; output_folder: string }> {
  const q = kind && kind !== "all" ? `?kind=${kind}` : "";
  const res = await apiFetch(`/api/projects/${id}/assets${q}`);
  await ensureOk(res, "Không tải media project");
  return readJson(res);
}

export async function fetchAllProjectAssets(
  kind: "image" | "video" | "all" = "image",
  limit = 200,
): Promise<{ assets: ProjectAsset[]; total: number }> {
  const res = await apiFetch(`/api/projects/assets/all?kind=${kind}&limit=${limit}`);
  await ensureOk(res, "Không tải media tất cả projects");
  return readJson(res);
}

export async function deleteProjectAsset(id: string, path: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${id}/assets`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  await ensureOk(res, "Không xóa file");
}

export async function clearProjectAssets(
  id: string,
  kind: "image" | "video" | "all" = "all",
): Promise<{ removed: number; freed_mb: number }> {
  const res = await apiFetch(`/api/projects/${id}/assets/clear?kind=${kind}`, {
    method: "POST",
  });
  await ensureOk(res, "Không dọn media");
  return readJson(res);
}

export async function openProjectFolder(id: string): Promise<void> {
  const res = await apiFetch(`/api/projects/${id}/open-folder`, { method: "POST" });
  await ensureOk(res, "Không mở thư mục project");
}

export async function openFolderByPath(folderPath: string): Promise<void> {
  const res = await apiFetch(`/api/projects/open-folder-by-path?folder_path=${encodeURIComponent(folderPath)}`, { method: "POST" });
  await ensureOk(res, "Không mở được thư mục");
}

/* —— Video Editor (dựng / ghép clip, G-Labs parity) —— */

export interface VideoEditorClipIn {
  path?: string;
  url?: string;
  trim_start?: number | null;
  trim_end?: number | null;
  title?: string;
}

export interface VideoEditorAudioIn {
  path?: string;
  url?: string;
  start?: number;
  trim_start?: number | null;
  trim_end?: number | null;
  volume?: number;
  title?: string;
}

export interface VideoEditorTextIn {
  text: string;
  start: number;
  end: number;
  style?: string;
  color?: string;
  font_size?: number | null;
  /** 0–100, center of text on frame */
  x_pct?: number | null;
  y_pct?: number | null;
}

export interface VideoAssembleResult {
  ok: boolean;
  path: string;
  url: string;
  name: string;
  bytes?: number;
  mb?: number;
  duration?: number | null;
  width?: number | null;
  height?: number | null;
  clip_count?: number;
  audio_count?: number;
  text_count?: number;
  folder?: string;
}

export async function fetchVideoEditorStatus(): Promise<{
  ffmpeg: boolean;
  ffprobe: boolean;
  ready: boolean;
  message: string;
  text_styles?: string[];
}> {
  const res = await apiFetch("/api/video-editor/status");
  await ensureOk(res, "Không kiểm tra video editor");
  return readJson(res);
}

export async function assembleVideoClips(payload: {
  clips: VideoEditorClipIn[];
  audios?: VideoEditorAudioIn[];
  texts?: VideoEditorTextIn[];
  /** Workflow project (legacy) — prefer edit_project_id */
  project_id?: string | null;
  /** Project dựng video (riêng, không dùng chung workflow) */
  edit_project_id?: string | null;
  output_folder?: string | null;
  filename?: string | null;
  reencode?: boolean;
}): Promise<VideoAssembleResult> {
  const res = await apiFetch("/api/video-editor/assemble", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clips: payload.clips,
      audios: payload.audios ?? [],
      texts: payload.texts ?? [],
      project_id: payload.project_id ?? null,
      edit_project_id: payload.edit_project_id ?? null,
      output_folder: payload.output_folder ?? null,
      filename: payload.filename ?? null,
      reencode: payload.reencode !== false,
    }),
  });
  await ensureOk(res, "Dựng video thất bại");
  return readJson(res);
}

/* —— Edit projects (dựng video — tách khỏi Workflow) —— */

export interface EditProjectMeta {
  id: string;
  name: string;
  description?: string;
  clip_count?: number;
  updated_at?: number;
  created_at?: number;
  output_folder?: string;
  last_export_name?: string | null;
}

export interface EditProjectClip {
  id?: string;
  path: string;
  url: string;
  name: string;
  duration?: number | null;
}

export interface EditProjectDoc {
  id: string;
  name: string;
  description?: string;
  clips: EditProjectClip[];
  filename?: string;
  last_export?: VideoAssembleResult | Record<string, unknown> | null;
  created_at?: number;
  updated_at?: number;
  output_folder?: string;
}

export type MediaInsertSource = "workflow" | "flow_video" | "flow_image" | "all";

export async function listEditProjects(): Promise<EditProjectMeta[]> {
  const res = await apiFetch("/api/video-editor/edit-projects");
  await ensureOk(res, "Không tải project dựng video");
  const data = await readJson<{ projects: EditProjectMeta[] }>(res);
  return data.projects || [];
}

export async function fetchEditProject(id: string): Promise<EditProjectDoc> {
  const res = await apiFetch(`/api/video-editor/edit-projects/${id}`);
  await ensureOk(res, "Không mở project dựng video");
  const data = await readJson<{ project: EditProjectDoc }>(res);
  return data.project;
}

export async function saveEditProject(
  doc: {
    name: string;
    description?: string;
    clips?: EditProjectClip[];
    filename?: string;
    last_export?: Record<string, unknown> | null;
  },
  id?: string | null,
): Promise<EditProjectDoc> {
  const res = await apiFetch(
    id ? `/api/video-editor/edit-projects/${id}` : "/api/video-editor/edit-projects",
    {
      method: id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    },
  );
  await ensureOk(res, "Không lưu project dựng video");
  const data = await readJson<{ project: EditProjectDoc }>(res);
  return data.project;
}

export async function deleteEditProject(id: string, deleteFiles = false): Promise<void> {
  const q = deleteFiles ? "?delete_files=true" : "";
  const res = await apiFetch(`/api/video-editor/edit-projects/${id}${q}`, {
    method: "DELETE",
  });
  await ensureOk(res, "Không xóa project dựng video");
}

export async function fetchMediaSources(): Promise<{
  sources: Array<{
    id: MediaInsertSource | string;
    label: string;
    description: string;
    needs_project: boolean;
  }>;
  workflow_projects: Array<{ id: string; name: string; updated_at?: number }>;
}> {
  const res = await apiFetch("/api/video-editor/media-sources");
  await ensureOk(res, "Không tải nguồn media");
  return readJson(res);
}

export async function browseInsertMedia(opts: {
  source: MediaInsertSource | string;
  workflow_project_id?: string | null;
  kind?: "video" | "image" | "all" | null;
}): Promise<{ assets: ProjectAsset[]; count: number; source: string }> {
  const params = new URLSearchParams();
  params.set("source", opts.source);
  if (opts.workflow_project_id) params.set("workflow_project_id", opts.workflow_project_id);
  if (opts.kind) params.set("kind", opts.kind);
  const res = await apiFetch(`/api/video-editor/media-browse?${params}`);
  await ensureOk(res, "Không tải media");
  return readJson(res);
}

export async function probeVideoClips(
  sources: string[],
): Promise<{ items: Array<Record<string, unknown>> }> {
  const res = await apiFetch("/api/video-editor/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sources }),
  });
  await ensureOk(res, "Không probe clip");
  return readJson(res);
}

export async function uploadEditorAudio(
  file: File,
  projectId?: string | null,
): Promise<{ path: string; url: string; name: string; mb?: number }> {
  const fd = new FormData();
  fd.append("file", file);
  if (projectId) fd.append("project_id", projectId);
  const res = await apiFetch("/api/video-editor/upload-audio", {
    method: "POST",
    body: fd,
  });
  await ensureOk(res, "Upload audio thất bại");
  return readJson(res);
}

export async function listEditorAudioLibrary(
  projectId?: string | null,
): Promise<{ items: Array<{ path: string; url: string; name: string; mb?: number; mtime?: number }> }> {
  const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : "";
  const res = await apiFetch(`/api/video-editor/audio-library${q}`);
  await ensureOk(res, "Không tải audio library");
  return readJson(res);
}

export async function deleteProjectFull(id: string, deleteFiles = false): Promise<void> {
  const q = deleteFiles ? "?delete_files=true" : "";
  const res = await apiFetch(`/api/projects/${id}${q}`, { method: "DELETE" });
  await ensureOk(res, "Không xóa project");
}

export async function runSavedWorkflow(
  id: string,
  opts: WorkflowRunOptions = {},
): Promise<WorkflowRunResult> {
  const res = await apiFetch(`/api/workflows/${id}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      async_mode: opts.async_mode !== false,
      skip_completed: Boolean(opts.skip_completed),
      only_node_ids: opts.only_node_ids ?? null,
      prior_results: opts.prior_results ?? null,
    }),
  });
  await ensureOk(res, "Chạy workflow thất bại");
  return readJson(res);
}

/** Parse CSV/TSV/TXT lines into prompt strings (first column or whole line). */
export function parsePromptCsv(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // CSV: take first column if comma-separated; strip quotes
    let cell = trimmed;
    if (cell.includes("\t")) cell = cell.split("\t")[0] ?? cell;
    else if (cell.includes(",") && !cell.startsWith('"')) {
      cell = cell.split(",")[0] ?? cell;
    }
    cell = cell.replace(/^["']|["']$/g, "").trim();
    if (cell && cell.toLowerCase() !== "prompt") out.push(cell);
  }
  return out;
}

export interface PortsConfig {
  port: number;
  auth_bridge_port: number;
}

export async function fetchPortsConfig(): Promise<PortsConfig> {
  const res = await apiFetch("/api/maintenance/ports");
  await ensureOk(res, "Không tải được cài đặt cổng");
  return readJson<PortsConfig>(res);
}

export async function savePortsConfig(
  payload: { port: number; auth_bridge_port: number; restart: boolean }
): Promise<{ success: boolean; message: string }> {
  const res = await apiFetch("/api/maintenance/ports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureOk(res, "Không lưu được cấu hình cổng");
  return readJson<{ success: boolean; message: string }>(res);
}

export interface ModelCreditDetails {
  runs: number;
  credits: number;
}

export interface CreditUsageConfig {
  total_runs: number;
  total_credits: number;
  models: {
    omni_flash: ModelCreditDetails;
    veo_31_lite: ModelCreditDetails;
    veo_31_fast: ModelCreditDetails;
    veo_31_quality: ModelCreditDetails;
    free_image: ModelCreditDetails;
    free_video: ModelCreditDetails;
  };
}

export async function fetchCreditsUsage(): Promise<CreditUsageConfig> {
  const res = await apiFetch("/api/maintenance/credits");
  await ensureOk(res, "Không tải được thống kê sử dụng credit");
  return readJson<CreditUsageConfig>(res);
}