export const MAX_EXCEPTIONS_CHARS = 10000;

/** Count declared items: bullet / numbered lines, or 1 for free text. */
export function countExceptionItems(text) {
  const value = String(text || "").trim();
  if (!value) return 0;
  const bullets = value.split("\n").filter((l) => /^\s*([-*+]|\d+[.)])\s+\S/.test(l)).length;
  return bullets || 1;
}

/** Compact status for the PR table. */
export function exceptionStatus(e) {
  return { updatedAt: e.updatedAt, filename: e.filename, source: e.source, itemCount: countExceptionItems(e.text) };
}
