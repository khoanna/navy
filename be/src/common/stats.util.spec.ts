// be/src/common/stats.util.spec.ts
import { buildDailySeries } from './stats.util';

describe('buildDailySeries', () => {
  const now = new Date('2026-07-05T12:00:00.000Z');

  it('returns one zero-filled bucket per day, oldest first, amounts as strings', () => {
    const series = buildDailySeries([], now, 3);
    expect(series).toEqual([
      { date: '2026-07-03', amount: '0' },
      { date: '2026-07-04', amount: '0' },
      { date: '2026-07-05', amount: '0' },
    ]);
  });

  it('sums amounts into the UTC day bucket of paidAt', () => {
    const rows = [
      { paidAt: new Date('2026-07-04T09:00:00Z'), amount: 100n },
      { paidAt: new Date('2026-07-04T23:59:00Z'), amount: 250n },
      { paidAt: new Date('2026-07-05T01:00:00Z'), amount: 400n },
    ];
    const series = buildDailySeries(rows, now, 3);
    expect(series.find((p) => p.date === '2026-07-04')!.amount).toBe('350');
    expect(series.find((p) => p.date === '2026-07-05')!.amount).toBe('400');
  });

  it('ignores rows with null paidAt or dates outside the window', () => {
    const rows = [
      { paidAt: null, amount: 999n },
      { paidAt: new Date('2026-06-01T00:00:00Z'), amount: 999n },
    ];
    const series = buildDailySeries(rows, now, 3);
    expect(series.every((p) => p.amount === '0')).toBe(true);
  });
});
