/**
 * Implements paper §11.4: Pinned Base-fork jobs validate exact adapter math.
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
  
  async startFork(config: ForkConfig): Promise<string> {
    const url = `http://localhost:${this.port}`;
    this.anvilProcess = spawn('anvil', [
      '--fork-url', config.rpcUrl,
      '--fork-block-number', config.forkBlock.toString(),
      '--port', this.port.toString(),
      '--host', '0.0.0.0'
    ]);

    this.anvilProcess.stdout?.on('data', (data) => {
      // process.stdout.write(data);
    });
    this.anvilProcess.stderr?.on('data', (data) => {
      // process.stderr.write(data);
    });

    let attempts = 0;
    while (attempts < 30) {
      try {
        this.provider = new JsonRpcProvider(url);
        await this.provider.getBlockNumber();
        return url;
      } catch (e) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    throw new Error('Failed to start Anvil fork');
  }

  async takeSnapshot(config: ForkConfig): Promise<ForkSnapshot> {
    if (!this.provider) throw new Error('Provider not initialized');
    
    const vault = new Contract(config.vaultAddress, VAULT_ABI, this.provider);
    
    const block = await this.provider.getBlock('latest');
    const blockNumber = block?.number || 0;
    
    const totalAssets = await vault.totalAssets();
    const idleBase = await vault.idle();
    const sharePrice = await vault.convertToAssets(ethers.parseUnits('1', 18));
    
    const adapterBalances = new Map<string, bigint>();
    for (const addr of config.adapterAddresses) {
      const balance = await vault.adapterBalances(addr);
      adapterBalances.set(addr, balance);
    }
    
    return {
      blockNumber,
      totalAssets,
      idleBase,
      adapterBalances,
      sharePrice,
      timestamp: new Date()
    };
  }

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

  private calculateNetApy(snapshots: ForkSnapshot[], costs: bigint): number {
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
