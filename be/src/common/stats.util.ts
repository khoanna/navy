// be/src/common/stats.util.ts
export interface PaidRow {
  paidAt: Date | null;
  amount: bigint;
}

export interface SeriesBucket {
  date: string; // YYYY-MM-DD (UTC)
  amount: string; // base units, stringified
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Zero-filled daily buckets for the last `days` days (inclusive of `now`'s day),
 * oldest first. Sums `amount` of rows whose `paidAt` falls in each UTC day.
 * Money stays BigInt internally and is stringified on the way out (JSON-safe).
 */
export function buildDailySeries(rows: PaidRow[], now: Date, days: number): SeriesBucket[] {
  const totals = new Map<string, bigint>();
  const keys: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
    const key = utcDayKey(d);
    keys.push(key);
    totals.set(key, 0n);
  }
  for (const r of rows) {
    if (!r.paidAt) continue;
    const key = utcDayKey(r.paidAt);
    if (!totals.has(key)) continue;
    totals.set(key, totals.get(key)! + r.amount);
  }
  return keys.map((key) => ({ date: key, amount: totals.get(key)!.toString() }));
}
