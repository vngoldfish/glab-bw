export type NavPage =
  | "flow-image"
  | "flow-video"
  | "references"
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
  results: string[];
  status: RowStatus;
  error: string | null;
  savedFolder: string | null;
}

export interface ImageConfig {
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
  { value: "nano_banana_2_lite", label: "Nano Banana 2 Lite" },
  { value: "nano_banana_2", label: "Nano Banana 2" },
  { value: "nano_banana_pro", label: "Nano Banana Pro" },
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