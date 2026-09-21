import { getAllEvents } from "../store/usageEventStore.js";

function bucketKey(iso, granularity) {
  if (granularity === "year") return iso.slice(0, 4);
  if (granularity === "month") return iso.slice(0, 7);
  return iso.slice(0, 10); // day
}

function withinRange(iso, from, to) {
  const t = new Date(iso).getTime();
  if (from && t < new Date(from).getTime()) return false;
  if (to && t > new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1) return false;
  return true;
}

/**
 * Usage events bucketed by time and split by user email + event type, for the line chart
 * and per-user table. Events without a resolved email are grouped under "unmapped" so
 * admins can see there's attribution work to do rather than silently dropping them.
 */
export async function getUsageTimeSeries({ granularity = "day", from, to } = {}) {
  const events = (await getAllEvents()).filter((e) => (from || to ? withinRange(e.timestamp, from, to) : true));

  const buckets = new Map(); // bucketKey -> { pr_review, performance_review }
  const users = new Map(); // email -> { pr_review, performance_review }

  for (const event of events) {
    const key = bucketKey(event.timestamp, granularity);
    if (!buckets.has(key)) buckets.set(key, { bucket: key, pr_review: 0, performance_review: 0 });
    buckets.get(key)[event.type] = (buckets.get(key)[event.type] || 0) + 1;

    const email = event.authorEmail || "unmapped";
    if (!users.has(email)) users.set(email, { email, pr_review: 0, performance_review: 0, lastActive: null });
    const userStats = users.get(email);
    userStats[event.type] = (userStats[event.type] || 0) + 1;
    if (!userStats.lastActive || event.timestamp > userStats.lastActive) userStats.lastActive = event.timestamp;
  }

  const series = [...buckets.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
  const byUser = [...users.values()].sort((a, b) => b.pr_review + b.performance_review - (a.pr_review + a.performance_review));

  return { series, byUser };
}

export async function getUsageSummary() {
  const events = await getAllEvents();

  const byType = { pr_review: 0, performance_review: 0 };
  const byUser = new Map();

  for (const event of events) {
    byType[event.type] = (byType[event.type] || 0) + 1;
    const email = event.authorEmail || "unmapped";
    byUser.set(email, (byUser.get(email) || 0) + 1);
  }

  return {
    totalEvents: events.length,
    byType: [
      { type: "pr_review", label: "PR Reviews", count: byType.pr_review || 0 },
      { type: "performance_review", label: "Performance Reviews", count: byType.performance_review || 0 },
    ],
    byUser: [...byUser.entries()]
      .map(([email, count]) => ({ email, count }))
      .sort((a, b) => b.count - a.count),
  };
}
