export interface AdapterState {
  address: string;
  targetBps: number;
  aprE18: bigint;
  assetsBase: bigint;
}

export interface RebalanceConfig {
  driftBandBps: number;
  minIdleBps: number;
  gasCostBase: bigint;
  safetyFactor: number;
  horizonSeconds: number;
}

export type Move =
  | { kind: 'deploy'; toAdapter: string; amountBase: bigint; aprToE18: bigint }
  | { kind: 'reallocate'; fromAdapter: string; toAdapter: string; amountBase: bigint; aprFromE18: bigint; aprToE18: bigint };

const YEAR = 31_536_000n;
const WAD = 10n ** 18n;

function expectedGain(amountBase: bigint, aprDeltaE18: bigint, horizonSeconds: number): bigint {
  if (aprDeltaE18 <= 0n || amountBase <= 0n) return 0n;
  return (amountBase * aprDeltaE18 * BigInt(horizonSeconds)) / (WAD * YEAR);
}

function clearsBreakeven(amountBase: bigint, aprDeltaE18: bigint, c: RebalanceConfig): boolean {
  const gain = expectedGain(amountBase, aprDeltaE18, c.horizonSeconds);
  return gain > c.gasCostBase * BigInt(c.safetyFactor);
}

export function decideRebalance(input: {
  adapters: AdapterState[];
  idleBase: bigint;
  totalBase: bigint;
  config: RebalanceConfig;
}): Move[] {
  const { adapters, config } = input;
  const total = input.totalBase;
  if (total === 0n || adapters.length === 0) return [];

  const minIdle = (total * BigInt(config.minIdleBps)) / 10000n;
  const band = (total * BigInt(config.driftBandBps)) / 10000n;
  const target = (a: AdapterState) => (total * BigInt(a.targetBps)) / 10000n;

  const moves: Move[] = [];
  const idle = input.idleBase;
  let deployable = idle > minIdle ? idle - minIdle : 0n;

  const under = adapters
    .map((a) => ({ a, deficit: target(a) > a.assetsBase ? target(a) - a.assetsBase : 0n }))
    .filter((x) => x.deficit > 0n)
    .sort((x, y) => (y.a.aprE18 > x.a.aprE18 ? 1 : y.a.aprE18 < x.a.aprE18 ? -1 : 0));

  for (const { a, deficit } of under) {
    if (deployable === 0n) break;
    const amount = deficit < deployable ? deficit : deployable;
    if (amount <= 0n) continue;
    if (!clearsBreakeven(amount, a.aprE18, config)) continue;
    moves.push({ kind: 'deploy', toAdapter: a.address, amountBase: amount, aprToE18: a.aprE18 });
    deployable -= amount;
  }

  const over = adapters
    .map((a) => ({ a, surplus: a.assetsBase > target(a) ? a.assetsBase - target(a) : 0n }))
    .filter((x) => x.surplus > band)
    .sort((x, y) => (y.surplus > x.surplus ? 1 : -1));

  const need = adapters
    .map((a) => ({ a, deficit: target(a) > a.assetsBase ? target(a) - a.assetsBase : 0n }))
    .filter((x) => x.deficit > band)
    .sort((x, y) => (y.a.aprE18 > x.a.aprE18 ? 1 : y.a.aprE18 < x.a.aprE18 ? -1 : 0));

  for (const src of over) {
    let surplus = src.surplus;
    for (const dst of need) {
      if (surplus === 0n) break;
      const amount = dst.deficit < surplus ? dst.deficit : surplus;
      if (amount <= 0n) continue;
      const aprDelta = dst.a.aprE18 - src.a.aprE18;
      if (!clearsBreakeven(amount, aprDelta > 0n ? aprDelta : 0n, config)) continue;
      moves.push({
        kind: 'reallocate',
        fromAdapter: src.a.address,
        toAdapter: dst.a.address,
        amountBase: amount,
        aprFromE18: src.a.aprE18,
        aprToE18: dst.a.aprE18,
      });
      surplus -= amount;
      dst.deficit -= amount;
    }
  }

  return moves;
}
