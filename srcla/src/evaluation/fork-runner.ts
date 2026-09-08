/**
 * Scaffold for paper §11.1's per-policy PINNED-PRESTATE FORK REPLAY, and for
 * §11.4's pinned Base-fork validation of exact adapter math.
 *
 * ForkRunner spawns a local Anvil process with a mainnet fork, takes vault
 * state snapshots, and cleans up when done.
 *
 * ---------------------------------------------------------------------------
 * STATUS: NOT WIRED. Nothing in `src/`, `scripts/` or `test/` calls this.
 *
 * DO NOT DELETE IT AS DEAD CODE. §11.1 requires each policy's decisions to be
 * replayed against a pinned chain prestate so the reported allocation is one
 * the chain would actually have accepted; that requirement is currently
 * UNMET, and this file is the only thing in the repo that could meet it.
 * Removing it would silently drop the requirement instead of cleaning
 * anything up. The harness that produced SRCLA-REPORT.md hand-fed constants
 * from `fork-measurements.txt` in place of doing this.
 *
 * The gap is VISIBLE rather than silent: `evaluation/kernel/gates.ts`
 * declares a `§11.1 pinned-prestate fork replay` check that reports
 * NOT PRODUCED (and therefore BLOCKS the release gate) whenever no
 * `ForkReplayResult[]` is supplied — which, until this runner is wired, is
 * always.
 *
 * To wire it: drive `ForkRunner` once per (policy, tier) at the manifest's
 * pinned block, execute the decision sequence `kernel/harness.ts` recorded
 * (`PolicyRunResult.decisionHashes` identifies it), and map each outcome to a
 * `ForkReplayResult` for `evaluateRegisteredRelease({ forkResults })`. Note
 * that doing so requires starting an Anvil process, which is why it is not
 * exercised by the unit suite.
 * ---------------------------------------------------------------------------
 */

import { spawn, ChildProcess } from 'child_process';
import { JsonRpcProvider, Contract, ethers } from 'ethers';

export interface ForkConfig {
  rpcUrl: string;
  forkBlock: number;
  vaultAddress: string;
  adapterAddresses: string[];
  keeperPrivateKey?: string;
}

export interface ForkSnapshot {
  blockNumber: number;
  totalAssets: bigint;
  idleBase: bigint;
  adapterBalances: Map<string, bigint>;
  sharePrice: bigint;
  timestamp: Date;
}

export interface ForkResult {
  policyId: string;
  tier: bigint;
  snapshots: ForkSnapshot[];
  realizedNetApy: number;
  totalTurnover: bigint;
  withdrawalSuccessRate: number;
  totalCosts: bigint;
}

const VAULT_ABI = [
  'function totalAssets() view returns (uint256)',
  'function idle() view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function adapterBalances(address) view returns (uint256)',
];

export class ForkRunner {
  private anvilProcess: ChildProcess | null = null;
  private provider: JsonRpcProvider | null = null;
  private port = 8545;

  /**
   * Start Anvil with a forked chain at a specific block.
   * Polls until the RPC is responsive (up to 30 attempts × 500 ms).
   * @returns The local RPC URL (e.g. http://localhost:8545)
   */
  async startFork(config: ForkConfig): Promise<string> {
    const url = `http://localhost:${this.port}`;
    this.anvilProcess = spawn('anvil', [
      '--fork-url', config.rpcUrl,
      '--fork-block-number', config.forkBlock.toString(),
      '--port', this.port.toString(),
      '--host', '0.0.0.0',
    ]);

    // Silently consume stdout/stderr to prevent blocking
    this.anvilProcess.stdout?.resume();
    this.anvilProcess.stderr?.resume();

    let attempts = 0;
    while (attempts < 30) {
      try {
        const probe = new JsonRpcProvider(url);
        await probe.getBlockNumber();
        probe.destroy();
        this.provider = new JsonRpcProvider(url);
        return url;
      } catch {
        attempts++;
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
    }
    throw new Error('Failed to start Anvil fork after 30 attempts');
  }

  /**
   * Take a snapshot of current vault state on the fork.
   */
  async takeSnapshot(config: ForkConfig): Promise<ForkSnapshot> {
    if (!this.provider) throw new Error('Fork not started — call startFork() first');

    const vault = new Contract(config.vaultAddress, VAULT_ABI, this.provider);

    const block = await this.provider.getBlock('latest');
    const blockNumber = block?.number ?? 0;

    // ethers v6 Contract: dynamic function access returns ContractFunction.
    // Cast to () => Promise<bigint> for type safety.
    const totalAssets = BigInt(await (vault['totalAssets'] as () => Promise<bigint>)());
    const idleBase = BigInt(await (vault['idle'] as () => Promise<bigint>)());
    const sharePrice = BigInt(
      await (vault['convertToAssets'] as (arg: bigint) => Promise<bigint>)(
        ethers.parseUnits('1', 18),
      ),
    );

    const adapterBalances = new Map<string, bigint>();
    for (const addr of config.adapterAddresses) {
      const balance = BigInt(
        await (vault['adapterBalances'] as (arg: string) => Promise<bigint>)(addr),
      );
      adapterBalances.set(addr, balance);
    }

    return {
      blockNumber,
      totalAssets,
      idleBase,
      adapterBalances,
      sharePrice,
      timestamp: new Date(),
    };
  }

  /**
   * Stop the Anvil process and release the provider.
   */
  async stopFork(): Promise<void> {
    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }
    if (this.anvilProcess) {
      this.anvilProcess.kill('SIGTERM');
      this.anvilProcess = null;
    }
  }

  /**
   * Compute annualised net APY from a sequence of snapshots after cost deduction.
   * Assumes one snapshot per day for the years calculation.
   */
  netApy(snapshots: ForkSnapshot[], costs: bigint): number {
    if (snapshots.length < 2) return 0;
    const start = snapshots[0]!;
    const end = snapshots[snapshots.length - 1]!;
    const startValue = Number(start.totalAssets);
    const endValue = Number(end.totalAssets) - Number(costs);
    if (startValue === 0) return 0;
    const totalReturn = (endValue - startValue) / startValue;
    const years = snapshots.length / 365;
    if (years <= 0) return 0;
    return Math.pow(1 + totalReturn, 1 / years) - 1;
  }
}
