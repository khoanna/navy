/**
 * §9.1's churn state, reconstructed from persisted decisions.
 *
 * WHY THIS MODULE EXISTS. `steps/cost.ts` implements the cooldown, the
 * rolling max-turnover window and the reversal allowance as real gates, but
 * the live driver used to hand them
 * `{ timestampSeconds: null, turnoverWindowBase: 0n }` — a permanently
 * neutral input. `timestampSeconds === null` short-circuits the cooldown and
 * a zero window can never approach `MAX_TURNOVER`, so all three brakes
 * passed silently on every production cycle (readiness audit NEW-19). This
 * module is the missing derivation.
 *
 * PURE: no Prisma, no clock, no I/O. `runtime/decision-driver.ts` owns the
 * database read and calls `summariseLastAction` with the rows; the
 * evaluation replay (`evaluation/kernel/harness.ts`) keeps its own in-memory
 * equivalent. Both feed the SAME `LastActionState` shape into the same gate,
 * which is what stops the two drivers diverging on churn state.
 *
 * UNITS: money is bigint USDC base units (6 dp); time is unix seconds.
 */

import type { LastActionState, MoveRecord } from './types.js';

/**
 * One past decision, as persisted. `moves` carries the SIGNED per-venue
 * exposure change the decision's plan committed to (positive = deploy).
 *
 * `isAction` is not `moves.length > 0`: a decision row written before move
 * recording existed carries an empty `moves` array but a non-null plan id,
 * and it is still an action for cooldown purposes. Conflating the two would
 * make the cooldown silently ignore exactly the history it is meant to see.
 */
export interface PersistedActionRecord {
  timestampSeconds: number;
  isAction: boolean;
  moves: Array<{ marketId: string; deltaBase: bigint }>;
}

export interface LastActionWindows {
  turnoverWindowSeconds: number;
  reversalWindowSeconds: number;
}

/**
 * Reduce persisted decision history to the three quantities §9.1's brakes
 * need at `originSeconds`.
 *
 * NO LOOK-AHEAD: a record stamped after the origin is dropped, never
 * counted. That mirrors `policy/input.ts`'s barrier on labels — the churn
 * state a decision is judged against must be knowable at its own origin.
 *
 * WINDOW BOUNDARIES: a record is inside a window when
 * `originSeconds - windowSeconds < t <= originSeconds`. Half-open at the old
 * end so a record exactly `windowSeconds` old has aged out, closed at the
 * new end so a record at the origin itself counts.
 *
 * The cooldown timestamp is deliberately NOT window-bounded: it is the most
 * recent action at any age. Bounding it by the turnover window would make a
 * cooldown longer than that window unenforceable.
 */
export function summariseLastAction(
  records: readonly PersistedActionRecord[],
  originSeconds: number,
  windows: LastActionWindows
): LastActionState {
  let timestampSeconds: number | null = null;
  let turnoverWindowBase = 0n;
  const recentMoves: MoveRecord[] = [];

  const turnoverStart = originSeconds - windows.turnoverWindowSeconds;
  const reversalStart = originSeconds - windows.reversalWindowSeconds;

  for (const r of records) {
    if (r.timestampSeconds > originSeconds) continue;
    if (!r.isAction) continue;

    if (timestampSeconds === null || r.timestampSeconds > timestampSeconds) {
      timestampSeconds = r.timestampSeconds;
    }

    if (r.timestampSeconds > turnoverStart) {
      for (const m of r.moves) turnoverWindowBase += m.deltaBase < 0n ? -m.deltaBase : m.deltaBase;
    }

    if (r.timestampSeconds > reversalStart) {
      for (const m of r.moves) {
        if (m.deltaBase === 0n) continue;
        recentMoves.push({
          marketId: m.marketId,
          deltaBase: m.deltaBase,
          timestampSeconds: r.timestampSeconds,
        });
      }
    }
  }

  return { timestampSeconds, turnoverWindowBase, recentMoves };
}

/**
 * The signed per-venue deltas a decision's target implies against the
 * positions observed at its own origin. This is what gets persisted onto the
 * decision row; nothing else in the schema records a realised exposure
 * change, so nothing else can reconstruct it later.
 */
export function signedMovesFor(
  markets: ReadonlyArray<{ marketId: string; positionBase: bigint }>,
  target: ReadonlyMap<string, bigint>
): Array<{ marketId: string; deltaBase: bigint }> {
  const out: Array<{ marketId: string; deltaBase: bigint }> = [];
  const ids = [...new Set([...markets.map((m) => m.marketId), ...target.keys()])].sort();
  for (const id of ids) {
    const position = markets.find((m) => m.marketId === id)?.positionBase ?? 0n;
    const delta = (target.get(id) ?? 0n) - position;
    if (delta !== 0n) out.push({ marketId: id, deltaBase: delta });
  }
  return out;
}

/**
 * Read a `Decision.actionDecision` JSON blob back into a
 * `PersistedActionRecord`. Defensive by construction: the column is `Json`,
 * so nothing in the type system guarantees its shape, and a malformed entry
 * must degrade to "no recorded move" rather than throwing inside a decision
 * cycle or — worse — being coerced to a plausible-looking zero.
 *
 * A blob that is not a rebalance with a plan id yields `isAction: false`;
 * a HOLD is not an action and must not start a cooldown.
 */
export function parseActionDecision(
  timestampSeconds: number,
  blob: unknown
): PersistedActionRecord {
  const empty: PersistedActionRecord = { timestampSeconds, isAction: false, moves: [] };
  if (typeof blob !== 'object' || blob === null) return empty;

  const record = blob as Record<string, unknown>;
  const isAction = record['action'] === 'rebalance' && typeof record['planId'] === 'string';
  if (!isAction) return empty;

  const raw = record['moves'];
  const moves: Array<{ marketId: string; deltaBase: bigint }> = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry !== 'object' || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const marketId = e['marketId'];
      const deltaBase = e['deltaBase'];
      if (typeof marketId !== 'string' || typeof deltaBase !== 'string') continue;
      let parsed: bigint;
      try {
        parsed = BigInt(deltaBase);
      } catch {
        continue;
      }
      moves.push({ marketId, deltaBase: parsed });
    }
  }

  return { timestampSeconds, isAction: true, moves };
}
