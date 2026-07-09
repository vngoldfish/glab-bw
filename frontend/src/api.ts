export type Provider = "flow" | "grok" | "meta" | "openai";
export type BatchProvider = "image" | "video" | "grok" | "meta" | "openai";

export interface Account {
  id: string;
  provider: Provider;
  label: string;
  image_enabled: boolean;
  video_enabled: boolean;
  enabled: boolean;
  has_credentials: boolean;
  last_used_at?: number | null;
  cooldown_until?: number | null;
  cooldown_left_sec?: number;
  in_cooldown?: boolean;
  last_error?: string | null;
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

const BACKEND_HINT =
  "Backend chưa chạy — mở PowerShell tại thư mục dự án và chạy .\\start-backend.ps1 (giữ cửa sổ mở)";

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
      "Backend không phản hồi — hãy chạy .\\start-backend.ps1 và giữ cửa sổ PowerShell mở",
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.trim().slice(0, 80);
    if (preview.toLowerCase().startsWith("<!doctype") || preview.startsWith("<html")) {
      throw new Error("Backend chưa chạy hoặc proxy lỗi — hãy chạy .\\start-backend.ps1");
    }
    throw new Error(`Phản hồi không phải JSON: ${preview || "(rỗng)"}`);
  }
}

async function ensureOk(res: Response, fallback: string): Promise<Response> {
  if (res.ok) return res;
  try {
    const data = await readJson<{
      error?: string;
      detail?: { error?: string } | string | Array<{ msg?: string }>;
    }>(res);
    const detail = data.detail;
    let message = data.error || fallback;
    if (typeof detail === "string") message = detail;
    else if (Array.isArray(detail) && detail[0]?.msg) message = detail[0].msg;
    else if (detail && typeof detail === "object" && "error" in detail && detail.error) {
      message = detail.error;
    }
    throw new Error(message);
  } catch (err) {
    if (err instanceof Error && err.message !== fallback) {
      throw err;
    }
    throw new Error(fallback);
  }
}

export function normalizeFileUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/api/files/")) {
      return parsed.pathname;
    }
  } catch {
    if (url.startsWith("/api/files/")) return url;
  }
  return url;
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
  api_key_masked: string;
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

export async function saveAiSettings(payload: {
  enabled?: boolean;
  provider?: string;
  api_key?: string;
  base_url?: string;
  model?: string;
}): Promise<AiSettings> {
  const res = await apiFetch("/api/ai/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureAiOk(res, "Không lưu được cài đặt AI");
  return readJson<AiSettings>(res);
}

export async function rewritePromptAi(payload: {
  prompt: string;
  kind?: "video" | "image";
  locale?: string;
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

export async function fetchHealth(): Promise<Record<string, unknown>> {
  const res = await apiFetch("/api/health");
  await ensureOk(res, "Health check failed");
  return readJson<Record<string, unknown>>(res);
}

export interface ExtensionStatus {
  connected: boolean;
  flow_tab: string;
  grok_tab: string;
  token_count: number;
  extensions: number;
  pending_captcha: number;
}

export async function fetchExtensionStatus(): Promise<ExtensionStatus> {
  const res = await apiFetch("/api/extension/status");
  await ensureOk(res, "Extension status failed");
  return readJson<ExtensionStatus>(res);
}