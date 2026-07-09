import type { NamedReference } from "./types";

const MENTION_PATTERN = /@([a-zA-Z][a-zA-Z0-9_]*)/g;
const FULLWIDTH_AT = /\uFF20/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePromptText(prompt: string): string {
  return prompt.replace(FULLWIDTH_AT, "@");
}

export function slugifyRefName(input: string): string {
  const ascii = input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (ascii || "ref").slice(0, 32);
}

/**
 * Return @mentions in order of first appearance in the prompt.
 * Critical for I2V (first frame) and start+end (frame 0 / frame 1).
 */
export function parseMentions(prompt: string, library: NamedReference[] = []): string[] {
  const text = normalizePromptText(prompt);
  const hits: { index: number; key: string }[] = [];
  const occupied: [number, number][] = [];

  function overlaps(start: number, end: number): boolean {
    return occupied.some(([s, e]) => start < e && end > s);
  }

  // Longer library names first so @cat_orange wins over @cat
  for (const item of [...library].sort((a, b) => b.name.length - a.name.length)) {
    const pattern = new RegExp(`@${escapeRegExp(item.name)}(?![a-zA-Z0-9_])`, "gi");
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (overlaps(start, end)) continue;
      occupied.push([start, end]);
      hits.push({ index: start, key: item.name.toLowerCase() });
    }
  }

  for (const match of text.matchAll(MENTION_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (overlaps(start, end)) continue;
    occupied.push([start, end]);
    hits.push({ index: start, key: match[1].toLowerCase() });
  }

  hits.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const names: string[] = [];
  for (const hit of hits) {
    if (seen.has(hit.key)) continue;
    seen.add(hit.key);
    names.push(hit.key);
  }
  return names;
}

export function findLibraryRef(library: NamedReference[], name: string): NamedReference | undefined {
  const key = name.toLowerCase();
  return library.find((item) => item.name.toLowerCase() === key);
}

export function buildNamedReferencesPayload(
  prompt: string,
  library: NamedReference[],
): { name: string; data: string; label?: string }[] {
  return parseMentions(prompt, library)
    .map((mention) => findLibraryRef(library, mention))
    .filter((item): item is NamedReference => Boolean(item))
    .map((item) => ({
      name: item.name,
      data: item.filePath || item.image,
      label: item.label,
    }));
}

export function validatePromptMentions(prompt: string, library: NamedReference[]): string | null {
  for (const mention of parseMentions(prompt, library)) {
    if (!findLibraryRef(library, mention)) {
      return `Không tìm thấy ảnh '@${mention}' trong thư viện tham chiếu`;
    }
  }
  if (parseMentions(prompt, library).length > 10) {
    return "Tối đa 10 ảnh tham chiếu trong một prompt";
  }
  return null;
}

export function isValidRefName(name: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(name);
}

export function ensureUniqueRefName(base: string, library: NamedReference[], excludeId?: string): string {
  let candidate = slugifyRefName(base);
  if (!isValidRefName(candidate)) {
    candidate = "ref";
  }
  let suffix = 1;
  while (
    library.some(
      (item) => item.id !== excludeId && item.name.toLowerCase() === candidate.toLowerCase(),
    )
  ) {
    suffix += 1;
    candidate = `${slugifyRefName(base).slice(0, 28)}_${suffix}`;
  }
  return candidate;
}