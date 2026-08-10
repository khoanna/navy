import { ethers, BlockTag, Filter, Log } from 'ethers';

export interface ChainClientConfig {
  rpcUrl: string;
  chainId: number;
}

export class ChainClient {
  readonly provider: ethers.JsonRpcProvider;
  readonly chainId: number;

  constructor(config: ChainClientConfig) {
    this.provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.chainId = config.chainId;
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    return this.provider.getBlockNumber();
  }

  /**
   * Get block by number or tag
   */
  async getBlock(blockTag: BlockTag = 'latest'): Promise<ethers.Block | null> {
    return this.provider.getBlock(blockTag);
  }

  /**
   * Get finalized block (with certainty)
   */
  async getFinalizedBlock(): Promise<ethers.Block> {
    const block = await this.provider.getBlock('finalized');
    if (!block) {
      throw new Error('No finalized block available');
    }
    return block;
  }

  /**
   * Get logs matching filter
   */
  async getLogs(filter: Filter): Promise<Log[]> {
    return this.provider.getLogs(filter);
  }

  /**
   * Get balance for address
   */
  async getBalance(address: string): Promise<bigint> {
    return this.provider.getBalance(address);
  }

  /**
   * Get code at address (to verify contract exists)
   */
  async getCode(address: string): Promise<string> {
    return this.provider.getCode(address);
  }

  /**
   * Make a raw call to a contract
   */
  async call(to: string, data: string, blockTag: BlockTag = 'latest'): Promise<string> {
    return this.provider.call({ to, data, blockTag });
  }

  /**
   * Get current gas price
   */
  async getGasPrice(): Promise<bigint> {
    const feeData = await this.provider.getFeeData();
    return feeData.gasPrice ?? 0n;
  }

  /**
   * Estimate gas for a transaction
   */
  async estimateGas(tx: ethers.TransactionRequest): Promise<bigint> {
    return this.provider.estimateGas(tx);
  }

  /**
   * Close the provider (cleanup)
   */
  close(): void {
    this.provider.removeAllListeners();
  }
}
