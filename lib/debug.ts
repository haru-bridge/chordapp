// lib/debug.ts
const hasQuery = (name: string): boolean => {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has(name);
};

export const DEBUG: boolean =
  process.env.NODE_ENV !== "production" && hasQuery("debug");

// 単音ログ（Tone.js側に渡してるノート列）
// 例: http://localhost:3000/?debug&notes
export const NOTES_DEBUG: boolean = DEBUG && hasQuery("notes");

export const dlog = (...args: unknown[]): void => {
  if (!DEBUG) return;
  // eslint-disable-next-line no-console
  console.log(...args);
};

export const dwarn = (...args: unknown[]): void => {
  if (!DEBUG) return;
  // eslint-disable-next-line no-console
  console.warn(...args);
};

export const derror = (...args: unknown[]): void => {
  if (!DEBUG) return;
  // eslint-disable-next-line no-console
  console.error(...args);
};
