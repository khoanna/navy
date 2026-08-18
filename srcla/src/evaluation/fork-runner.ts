/**
 * Implements paper §11.4: Pinned Base-fork jobs validate exact adapter math.
 *
 * ForkRunner spawns a local Anvil process with a mainnet fork,
 * takes vault state snapshots, and cleans up when done.
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
