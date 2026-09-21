import { getStore } from "../store/recordStore.js";

function monthKey(iso) {
  return (iso || "").slice(0, 7); // "YYYY-MM"
}

/**
 * PR reopen rate per month — the best available proxy for whether code quality (and by
 * extension, the app's impact) is trending better (lower reopen rate) or worse over time.
 */
export async function getImpactTrend() {
  const store = await getStore();
  const records = (await store.getAll()).filter((r) => r.createdAt);

  const buckets = new Map();
  for (const r of records) {
    const key = monthKey(r.createdAt);
    if (!key) continue;
    if (!buckets.has(key)) buckets.set(key, { total: 0, reopened: 0 });
    const bucket = buckets.get(key);
    bucket.total += 1;
    if (r.reopened || (r.reopenCount || 0) > 0) bucket.reopened += 1;
  }

  const points = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { total, reopened }]) => ({
      month,
      totalPRs: total,
      reopenedPRs: reopened,
      reopenRate: total ? Number((reopened / total).toFixed(3)) : 0,
    }));

  let trend = "flat";
  if (points.length >= 2) {
    const first = points[0].reopenRate;
    const last = points[points.length - 1].reopenRate;
    if (last < first) trend = "improving";
    else if (last > first) trend = "worsening";
  }

  return { points, trend };
}
