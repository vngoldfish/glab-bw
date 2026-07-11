export type NavPage =
  | "dashboard"
  | "flow-image"
  | "flow-video"
  | "references"
  | "prompt-hub"
  | "workflow"
  | "video-editor"
  | "projects"
  | "docs"
  | "api-docs"
  | "grok"
  | "webhook"
  | "settings"
  | "extension";

export type RowStatus = "idle" | "queued" | "running" | "completed" | "failed";

export type ReferenceCategory = "character" | "scene" | "prop" | "other";

export interface NamedReference {
  id: string;
  name: string;
  label: string;
  image: string;
  filePath: string;
  category: ReferenceCategory;
}

export interface QueueRow {
  id: string;
  selected: boolean;
  prompt: string;
  referenceImage: string | null;
  referenceName: string | null;
  /** I2V / FL: nhãn hiển thị khung đầu (không bắt buộc là @thư viện) */
  startFrameName: string | null;
  /** I2V / FL: data URL / URL ảnh khung đầu — gắn dòng, không vào Ảnh tham chiếu */
  startFrameImage: string | null;
  /** FL: nhãn khung cuối */
  endFrameName: string | null;
  /** FL: data URL / URL ảnh khung cuối */
  endFrameImage: string | null;
  results: string[];
  status: RowStatus;
  error: string | null;
  savedFolder: string | null;
}

/** Engine backend: Google Flow (labs) or Grok (Auth Helper / web) */
export type MediaEngine = "flow" | "grok" | "meta";

export interface ImageConfig {
  /** flow = Google Flow · grok = Grok via Auth Helper */
  engine: MediaEngine;
  model: string;
  aspectRatio: string;
  concurrency: number;
  imagesPerPrompt: number;
  saveMode: string;
  outputFolder: string;
  upscale: string[];
}

export const REFERENCE_CATEGORIES: { value: ReferenceCategory; label: string }[] = [
  { value: "character", label: "Nhân vật" },
  { value: "scene", label: "Cảnh / bối cảnh" },
  { value: "prop", label: "Đồ vật" },
  { value: "other", label: "Khác" },
];

export const IMAGE_MODELS = [
  { value: "nano_banana_2_lite", label: "Nano Banana 2 Lite (ổn định)" },
  { value: "nano_banana_2", label: "Nano Banana 2 (ổn định)" },
  { value: "nano_banana_pro", label: "Nano Banana Pro (hay INTERNAL trên free)" },
] as const;

export const GROK_IMAGE_MODELS = [
  { value: "grok-3", label: "Grok Imagine (web · Auth Helper)" },
  { value: "grok-imagine-image", label: "Grok Imagine API (cần key xAI)" },
  { value: "grok-imagine-image-quality", label: "Grok Imagine Quality API" },
] as const;

export const META_IMAGE_MODELS = [
  { value: "midjen-base", label: "Meta Imagine Base (web · cookie)" },
  { value: "midjen-short", label: "Meta Imagine Short (web · cookie)" },
] as const;

export const ASPECT_RATIOS = [
  { value: "auto", label: "Tự động (theo ảnh tham chiếu)" },
  { value: "1:1", label: "1:1 Vuông" },
  { value: "3:4", label: "3:4 Dọc" },
  { value: "4:3", label: "4:3 Ngang" },
  { value: "9:16", label: "9:16 Dọc" },
  { value: "16:9", label: "16:9 Ngang" },
] as const;

export const SAVE_MODES = [
  { value: "task", label: "Tạo thư mục theo Task" },
  { value: "flat", label: "Lưu phẳng (cùng thư mục)" },
] as const;

export type VideoMode = "text_to_video" | "start_image" | "start_end_image" | "components";

export interface VideoConfig {
  engine: MediaEngine;
  model: string;
  aspectRatio: string;
  mode: VideoMode;
  concurrency: number;
  saveMode: string;
  outputFolder: string;
  resolution: string[];
  /** Omni Flash / Grok clip length in seconds. */
  duration: number;
}

export const VIDEO_MODELS = [
  { value: "omni_flash", label: "Gemini Omni Flash" },
  { value: "veo_31_fast", label: "Veo 3.1 Fast" },
  { value: "veo_31_lite", label: "Veo 3.1 Lite" },
  { value: "veo_31_quality", label: "Veo 3.1 Quality" },
  { value: "veo_31_lite_relaxed", label: "Veo 3.1 Lite Relaxed" },
] as const;

export const GROK_VIDEO_MODELS = [
  { value: "grok-3", label: "Grok Imagine Video (web · Auth Helper)" },
  { value: "grok-imagine-video", label: "Grok Video API (cần key xAI)" },
  { value: "grok-imagine-video-1.5", label: "Grok Video 1.5 API" },
] as const;

export const META_VIDEO_MODELS = [
  { value: "meta-video", label: "Meta Video 480p (web · cookie)" },
] as const;

export const MEDIA_ENGINES: { value: MediaEngine; label: string; hint: string }[] = [
  {
    value: "flow",
    label: "Google Flow",
    hint: "labs.google · cookie Flow + Auth Helper reCAPTCHA",
  },
  {
    value: "grok",
    label: "Grok",
    hint: "grok.com/imagine · Auth Helper gfetch (cùng extension Flow)",
  },
  {
    value: "meta",
    label: "Meta AI",
    hint: "vibes.ai · cookie meta_session nhập trong Cài đặt",
  },
];

export const OMNI_FLASH_DURATIONS = [
  { value: 4, label: "4 giây" },
  { value: 6, label: "6 giây" },
  { value: 8, label: "8 giây" },
  { value: 10, label: "10 giây" },
] as const;

export const VIDEO_ASPECT_RATIOS = [
  { value: "16:9", label: "16:9 Ngang" },
  { value: "9:16", label: "9:16 Dọc" },
] as const;

export const VIDEO_MODES = [
  {
    value: "start_image",
    label: "Ảnh → Video (tự nhận)",
    short: "Auto",
    hint: "@nhân_vật → Ingredients · Ảnh đầu → I2V · đầu+cuối → First&Last · không ảnh → Text→Video.",
  },
  {
    value: "text_to_video",
    label: "Chỉ văn bản → Video",
    short: "T2V",
    hint: "Chỉ prompt, ẩn cột ảnh. Có @tên sẽ tự chuyển Ingredients.",
  },
  {
    value: "components",
    label: "Ingredients (nhiều @tên)",
    short: "R2V",
    hint: "Dùng tab Ảnh tham chiếu + @tên trong prompt.",
  },
] as const;

export const VIDEO_RESOLUTIONS = [
  { value: "1080p", label: "Upscale 1080p" },
  { value: "4K", label: "Upscale 4K" },
] as const;