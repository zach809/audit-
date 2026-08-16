export type JobShortcut = "next" | "prev" | "act" | "clear" | "find";

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

type TypingLike = {
  tagName?: string;
  isContentEditable?: boolean;
};

export function isTypingTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const el = target as TypingLike;
  if (el.tagName && TYPING_TAGS.has(el.tagName)) return true;
  return el.isContentEditable === true;
}

export function jobShortcut(key: string, target: unknown): JobShortcut | null {
  if (isTypingTarget(target)) return null;
  if (key === "j" || key === "ArrowDown") return "next";
  if (key === "k" || key === "ArrowUp") return "prev";
  if (key === "Enter") return "act";
  if (key === "0") return "clear";
  if (key === "/") return "find";
  return null;
}

export function nextRowIndex(current: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return 0;
  return Math.min(count - 1, current + 1);
}

export function prevRowIndex(current: number, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return 0;
  return Math.max(0, current - 1);
}
