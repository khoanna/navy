import { ChainClient } from './client.js';

describe('ChainClient', () => {
  it('should create provider with correct chain id', async () => {
    // Use a public RPC to verify the client works
    const client = new ChainClient({
      rpcUrl: 'https://mainnet.base.org',
      chainId: 8453,
    });
    expect(client.chainId).toBe(8453);
    await client.close();
  });

  it('should get block number from public RPC', async () => {
    const client = new ChainClient({
      rpcUrl: 'https://mainnet.base.org',
      chainId: 8453,
    });
    const blockNumber = await client.getBlockNumber();
    expect(typeof blockNumber).toBe('number');
    expect(blockNumber).toBeGreaterThan(0);
    await client.close();
  });

  it('should get code at known contract address', async () => {
    const client = new ChainClient({
      rpcUrl: 'https://mainnet.base.org',
      chainId: 8453,
    });
    // USDC on Base
    const code = await client.getCode('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(code).not.toBe('0x');
    await client.close();
  });

  it('should get balance of an address', async () => {
    const client = new ChainClient({
      rpcUrl: 'https://mainnet.base.org',
      chainId: 8453,
    });
    // Check balance is a valid bigint (zero address may have accumulated balance on Base)
    const balance = await client.getBalance('0x0000000000000000000000000000000000000000');
    expect(typeof balance).toBe('bigint');
    expect(balance).toBeGreaterThanOrEqual(0n);
    await client.close();
  });
});
