/** Format as YYYY-MM-DD in the browser's local timezone (not UTC). */
export function toDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function defaultFrom(daysAgo = 7) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return toDateInput(d);
}

export function defaultTo() {
  return toDateInput(new Date());
}
