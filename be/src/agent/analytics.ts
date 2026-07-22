export interface SpendOrder { amount: string | bigint; createdAt: Date; status: string }
export interface SpendSeries { labels: string[]; values: string[]; totalBase: string; count: number; period: string }

const PAID = new Set(['paid', 'confirmed']);

function bucketKey(d: Date, period: 'day' | 'week' | 'month'): string {
  const iso = d.toISOString();
  if (period === 'month') return iso.slice(0, 7);
  if (period === 'week') {
    const day = iso.slice(0, 10);
    return day;
  }
  return iso.slice(0, 10);
}

/** Sum paid orders into an ordered, chart-ready series (base units as strings to preserve precision). */
export function spendingSeries(orders: SpendOrder[], period: 'day' | 'week' | 'month' = 'day'): SpendSeries {
  const buckets = new Map<string, bigint>();
  let total = 0n; let count = 0;
  for (const o of orders) {
    if (!PAID.has(o.status)) continue;
    const amt = BigInt(o.amount);
    const key = bucketKey(o.createdAt, period);
    buckets.set(key, (buckets.get(key) ?? 0n) + amt);
    total += amt; count += 1;
  }
  const labels = [...buckets.keys()].sort();
  const values = labels.map((l) => buckets.get(l)!.toString());
  return { labels, values, totalBase: total.toString(), count, period };
}
