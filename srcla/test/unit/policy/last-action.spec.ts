/**
 * §9.1's churn state (readiness audit NEW-19).
 *
 * The defect these tests exist against is ABSENCE READING AS SUCCESS: the
 * cooldown, the rolling max-turnover window and the reversal allowance were
 * all real, correct code fed `{ timestampSeconds: null,
 * turnoverWindowBase: 0n }` forever, so every one of them passed silently on
 * every production cycle. A test that only ever exercises an EMPTY history
 * would reproduce exactly that vacuum, so every case below either supplies
 * real history or asserts specifically that empty history is the reason
 * nothing fired.
 */
import {
  parseActionDecision,
  signedMovesFor,
  summariseLastAction,
  type PersistedActionRecord,
} from '../../../src/policy/last-action.js';

const ORIGIN = 1_000_000;
const DAY = 86_400;

const WINDOWS = { turnoverWindowSeconds: DAY, reversalWindowSeconds: DAY };

function action(
  timestampSeconds: number,
  moves: Array<[string, bigint]>
): PersistedActionRecord {
  return {
    timestampSeconds,
    isAction: true,
    moves: moves.map(([marketId, deltaBase]) => ({ marketId, deltaBase })),
  };
}

describe('summariseLastAction (§9.1 cooldown / turnover / reversal state)', () => {
  it('reports the most recent action timestamp, not the oldest', () => {
    const out = summariseLastAction(
      [action(ORIGIN - 5 * DAY, [['a', 100n]]), action(ORIGIN - 100, [['a', 200n]])],
      ORIGIN,
      WINDOWS
    );
    expect(out.timestampSeconds).toBe(ORIGIN - 100);
  });

  it('reports a cooldown timestamp OLDER than either rolling window', () => {
    // A cooldown may legitimately be longer than the turnover window. If the
    // timestamp were clipped to the window, a cooldown of 7 days could never
    // fire against a 1-day window.
    const out = summariseLastAction([action(ORIGIN - 5 * DAY, [['a', 100n]])], ORIGIN, WINDOWS);
    expect(out.timestampSeconds).toBe(ORIGIN - 5 * DAY);
    // ...and it contributes to NEITHER window.
    expect(out.turnoverWindowBase).toBe(0n);
    expect(out.recentMoves).toEqual([]);
  });

  it('ignores a HOLD: a decision that moved nothing starts no cooldown', () => {
    const hold: PersistedActionRecord = { timestampSeconds: ORIGIN - 100, isAction: false, moves: [] };
    const out = summariseLastAction([hold], ORIGIN, WINDOWS);
    expect(out.timestampSeconds).toBeNull();
    expect(out.turnoverWindowBase).toBe(0n);
  });

  it('rejects a record stamped after the origin (no look-ahead)', () => {
    const out = summariseLastAction([action(ORIGIN + 1, [['a', 500n]])], ORIGIN, WINDOWS);
    expect(out.timestampSeconds).toBeNull();
    expect(out.turnoverWindowBase).toBe(0n);
    expect(out.recentMoves).toEqual([]);
  });

  it('counts a record stamped exactly at the origin', () => {
    const out = summariseLastAction([action(ORIGIN, [['a', 500n]])], ORIGIN, WINDOWS);
    expect(out.timestampSeconds).toBe(ORIGIN);
    expect(out.turnoverWindowBase).toBe(500n);
  });

  it('sums turnover as MAGNITUDE, so a deploy and a divest do not cancel', () => {
    const out = summariseLastAction(
      [action(ORIGIN - 100, [['a', 700n], ['b', -300n]])],
      ORIGIN,
      WINDOWS
    );
    expect(out.turnoverWindowBase).toBe(1000n);
  });

  it('drops turnover that has aged exactly out of the window', () => {
    const inside = summariseLastAction([action(ORIGIN - DAY + 1, [['a', 900n]])], ORIGIN, WINDOWS);
    const outside = summariseLastAction([action(ORIGIN - DAY, [['a', 900n]])], ORIGIN, WINDOWS);
    expect(inside.turnoverWindowBase).toBe(900n);
    expect(outside.turnoverWindowBase).toBe(0n);
  });

  it('keeps the reversal window separate from the turnover window', () => {
    const out = summariseLastAction([action(ORIGIN - 2 * DAY, [['a', 900n]])], ORIGIN, {
      turnoverWindowSeconds: DAY,
      reversalWindowSeconds: 7 * DAY,
    });
    expect(out.turnoverWindowBase).toBe(0n);
    expect(out.recentMoves).toEqual([{ marketId: 'a', deltaBase: 900n, timestampSeconds: ORIGIN - 2 * DAY }]);
  });

  it('preserves the SIGN of each recent move', () => {
    const out = summariseLastAction([action(ORIGIN - 10, [['a', -400n]])], ORIGIN, WINDOWS);
    expect(out.recentMoves[0]!.deltaBase).toBe(-400n);
  });

  it('drops a zero-delta entry from recentMoves rather than recording a no-op', () => {
    const out = summariseLastAction([action(ORIGIN - 10, [['a', 0n], ['b', 5n]])], ORIGIN, WINDOWS);
    expect(out.recentMoves.map((m) => m.marketId)).toEqual(['b']);
  });

  it('is neutral ONLY when there is genuinely no history', () => {
    const out = summariseLastAction([], ORIGIN, WINDOWS);
    expect(out).toEqual({ timestampSeconds: null, turnoverWindowBase: 0n, recentMoves: [] });
  });
});

describe('signedMovesFor', () => {
  const markets = [
    { marketId: 'aave', positionBase: 1000n },
    { marketId: 'compound', positionBase: 500n },
    { marketId: 'moonwell', positionBase: 0n },
  ];

  it('signs a deploy positive and a divest negative', () => {
    const out = signedMovesFor(markets, new Map([['aave', 1500n], ['compound', 100n]]));
    expect(out).toEqual([
      { marketId: 'aave', deltaBase: 500n },
      { marketId: 'compound', deltaBase: -400n },
    ]);
  });

  it('treats a market absent from the target as a full divest', () => {
    const out = signedMovesFor(markets, new Map());
    expect(out).toEqual([
      { marketId: 'aave', deltaBase: -1000n },
      { marketId: 'compound', deltaBase: -500n },
    ]);
  });

  it('omits an unchanged venue', () => {
    const out = signedMovesFor(markets, new Map([['aave', 1000n], ['compound', 500n]]));
    expect(out).toEqual([]);
  });

  it('is sorted by market id, so the persisted blob is deterministic', () => {
    const out = signedMovesFor(markets, new Map([['moonwell', 7n], ['aave', 2000n]]));
    expect(out.map((m) => m.marketId)).toEqual(['aave', 'compound', 'moonwell']);
  });
});

describe('parseActionDecision', () => {
  it('reads a rebalance with a plan id as an action, with its moves', () => {
    const out = parseActionDecision(ORIGIN, {
      action: 'rebalance',
      planId: '0xabc',
      reasons: ['REBALANCE'],
      moves: [{ marketId: 'aave', deltaBase: '-1500' }],
    });
    expect(out).toEqual({
      timestampSeconds: ORIGIN,
      isAction: true,
      moves: [{ marketId: 'aave', deltaBase: -1500n }],
    });
  });

  it('reads a HOLD as a non-action', () => {
    const out = parseActionDecision(ORIGIN, { action: 'hold', planId: null, moves: [] });
    expect(out.isAction).toBe(false);
  });

  it('reads a rebalance with a null plan id as a non-action', () => {
    // decide() can report action==='rebalance' with plan===null only on a
    // path that emits no actions; that moved nothing and must not brake the
    // next cycle.
    const out = parseActionDecision(ORIGIN, { action: 'rebalance', planId: null });
    expect(out.isAction).toBe(false);
  });

  it('keeps a legacy row (no `moves` field) as an action with no recorded moves', () => {
    const out = parseActionDecision(ORIGIN, { action: 'rebalance', planId: '0xabc' });
    expect(out.isAction).toBe(true);
    expect(out.moves).toEqual([]);
  });

  it('drops a malformed move entry instead of coercing it to zero', () => {
    const out = parseActionDecision(ORIGIN, {
      action: 'rebalance',
      planId: '0xabc',
      moves: [
        { marketId: 'aave', deltaBase: 'not-a-number' },
        { marketId: 42, deltaBase: '10' },
        { marketId: 'compound', deltaBase: 900 },
        null,
        { marketId: 'moonwell', deltaBase: '7' },
      ],
    });
    expect(out.moves).toEqual([{ marketId: 'moonwell', deltaBase: 7n }]);
  });

  it('survives a non-object blob', () => {
    for (const blob of [null, undefined, 'rebalance', 7, []]) {
      expect(parseActionDecision(ORIGIN, blob).isAction).toBe(false);
    }
  });
});
