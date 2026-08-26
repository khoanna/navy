import { VaultClient } from './vaultClient';

describe('VaultClient', () => {
  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** Mock authedFetch that returns configured responses or records calls. */
  function mockAuthedFetch(responses: Map<string, { ok: boolean; status: number; json: () => unknown }>) {
    return async (url: string) => {
      const entry = [...responses.entries()].find(([pattern]) => url.includes(pattern));
      if (!entry) throw new Error(`No mock for URL: ${url}`);
      const res = entry[1];
      return {
        ok: res.ok,
        status: res.status,
        json: async () => res.json(),
        text: async () => JSON.stringify(res.json()),
      } as Response;
    };
  }

  const mockSignTypedData = async () => '0xfakesignature123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123';

  const BASE_URL = 'https://api.navy.exchange';
  const sampleTypedData = {
    domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' },
    types: { ReceiveWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] },
    primaryType: 'ReceiveWithAuthorization' as const,
    message: { from: '0x123', to: '0x456', value: '1000000', validAfter: '0', validBefore: '9999999999', nonce: '0x789' },
  };

  // -------------------------------------------------------------------------
  // deposit()
  // -------------------------------------------------------------------------

  describe('deposit()', () => {
    it('calls authorization → signs typed data → submits in sequence', async () => {
      const calls: string[] = [];
      const authedFetch = mockAuthedFetch(
        new Map([
          ['/vault/deposit/authorization', {
            ok: true, status: 200,
            json: () => {
              calls.push('deposit/authorization');
              return { id: 'uuid-1', typedData: sampleTypedData, amountBase: '1000000', expiresAt: '2099-01-01T00:00:00Z' };
            },
          }],
          ['/vault/deposit/submit', {
            ok: true, status: 200,
            json: () => {
              calls.push('deposit/submit');
              return { txHash: '0xtxhash', status: 'confirming', sharesBase: '999000' };
            },
          }],
        ]),
      );

      const client = new VaultClient(BASE_URL, authedFetch as any, mockSignTypedData);
      const result = await client.deposit('1000000');

      expect(calls).toEqual(['deposit/authorization', 'deposit/submit']);
      expect(result).toEqual({ txHash: '0xtxhash', status: 'confirming', sharesBase: '999000' });
    });

    it('throws when authorization returns an error', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/deposit/authorization', {
          ok: false, status: 400,
          json: () => ({ message: 'amount too small' }),
        }]]),
      );

      const client = new VaultClient(BASE_URL, authedFetch as any, mockSignTypedData);
      await expect(client.deposit('100')).rejects.toThrow('vault /vault/deposit/authorization failed (400): amount too small');
    });

    it('throws when submit returns an error', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([
          ['/vault/deposit/authorization', {
            ok: true, status: 200,
            json: () => ({ id: 'uuid-1', typedData: sampleTypedData, amountBase: '1000000', expiresAt: '2099-01-01T00:00:00Z' }),
          }],
          ['/vault/deposit/submit', {
            ok: false, status: 409,
            json: () => ({ error: 'nonce already consumed' }),
          }],
        ]),
      );

      const client = new VaultClient(BASE_URL, authedFetch as any, mockSignTypedData);
      await expect(client.deposit('1000000')).rejects.toThrow('vault /vault/deposit/submit failed (409): nonce already consumed');
    });
  });

  // -------------------------------------------------------------------------
  // redeemShares()
  // -------------------------------------------------------------------------

  describe('redeemShares()', () => {
    const samplePermitTypedData = {
      domain: { name: 'NavyVaultSRCLA', version: '1', chainId: 8453, verifyingContract: '0x55E728b08FdB9432520FB3fd1b9D7777320f8ED3' },
      types: { Permit: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' }, { name: 'deadline', type: 'uint256' }] },
      primaryType: 'Permit' as const,
      message: { owner: '0x123', spender: '0x456', value: '500000', nonce: '5', deadline: '9999999999' },
    };

    it('calls permit → signs typed data → submits in sequence', async () => {
      const calls: string[] = [];
      const authedFetch = mockAuthedFetch(
        new Map([
          ['/vault/redeem/permit', {
            ok: true, status: 200,
            json: () => {
              calls.push('redeem/permit');
              return { id: 'uuid-2', typedData: samplePermitTypedData, sharesBase: '500000', expiresAt: '2099-01-01T00:00:00Z' };
            },
          }],
          ['/vault/redeem/submit', {
            ok: true, status: 200,
            json: () => {
              calls.push('redeem/submit');
              return { txHash: '0xtxhash2', status: 'confirming', assetsBase: '1000000' };
            },
          }],
        ]),
      );

      const client = new VaultClient(BASE_URL, authedFetch as any, mockSignTypedData);
      const result = await client.redeemShares('500000');

      expect(calls).toEqual(['redeem/permit', 'redeem/submit']);
      expect(result).toEqual({ txHash: '0xtxhash2', status: 'confirming', assetsBase: '1000000' });
    });

    it('throws when permit returns an error', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/redeem/permit', {
          ok: false, status: 400,
          json: () => ({ message: 'invalid shares amount' }),
        }]]),
      );

      const client = new VaultClient(BASE_URL, authedFetch as any, mockSignTypedData);
      await expect(client.redeemShares('0')).rejects.toThrow('vault /vault/redeem/permit failed (400): invalid shares amount');
    });
  });

  // -------------------------------------------------------------------------
  // getPosition()
  // -------------------------------------------------------------------------

  describe('getPosition()', () => {
    it('returns the vault position', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/position', {
          ok: true, status: 200,
          json: () => ({ sharesBase: '1000000', assetsBase: '2000000' }),
        }]]),
      );

      const client = new VaultClient(BASE_URL, authedFetch as any, mockSignTypedData);
      const result = await client.getPosition();
      expect(result).toEqual({ sharesBase: '1000000', assetsBase: '2000000' });
    });
  });

  // -------------------------------------------------------------------------
  // getApys()
  // -------------------------------------------------------------------------

  describe('getApys()', () => {
    it('returns APY data per adapter', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/apys', {
          ok: true, status: 200,
          json: () => ({
            adapters: [
              { address: '0x5b53a25fF5Ec56a852CB4c0D193754308C6e99A0', name: 'Compound III', apyBps: 798, tvlBase: '5000000000000' },
              { address: '0xfDCaC27247ecb3452f88c8ea10CACeabc19348eb', name: 'Aave V3', apyBps: 315, tvlBase: '2000000000000' },
            ],
            aggregateApyBps: 642,
            blockNumber: 12345678,
          }),
        }]]),
      );

      const client = new VaultClient(BASE_URL, authedFetch as any, mockSignTypedData);
      const result = await client.getApys();
      expect(result.adapters).toHaveLength(2);
      expect(result.aggregateApyBps).toBe(642);
    });
  });

  // -------------------------------------------------------------------------
  // getStrategy()
  // -------------------------------------------------------------------------

  describe('getStrategy()', () => {
    it('returns the strategy allocation', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/strategy', {
          ok: true, status: 200,
          json: () => ({
            totalAssets: '7000000000000',
            allocations: [
              { adapter: '0x5b53a25fF5Ec56a852CB4c0D193754308C6e99A0', name: 'Compound III', assets: '5000000000000', percentage: 71.4 },
              { adapter: '0xfDCaC27247ecb3452f88c8ea10CACeabc19348eb', name: 'Aave V3', assets: '2000000000000', percentage: 28.6 },
            ],
          }),
        }]]),
      );

      const client = new VaultClient(BASE_URL, authedFetch as any, mockSignTypedData);
      const result = await client.getStrategy();
      expect(result.totalAssets).toBe('7000000000000');
      expect(result.allocations).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // getHarvests()
  // -------------------------------------------------------------------------

  describe('getHarvests()', () => {
    it('returns harvest history', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/harvests', {
          ok: true, status: 200,
          json: () => ({
            harvests: [
              {
                adapter: '0x5b53a25fF5Ec56a852CB4c0D193754308C6e99A0',
                protocol: 'compound',
                harvestedAt: '2026-08-01T12:00:00Z',
                grossBase: '1000000',
                netBase: '995000',
                recipients: [{ address: '0xtreasure', shares: '1000000' }],
              },
            ],
          }),
        }]]),
      );

      const client = new VaultClient(BASE_URL, authedFetch as any, mockSignTypedData);
      const result = await client.getHarvests();
      expect(result.harvests).toHaveLength(1);
    });

    it('passes query params for adapter and pagination', async () => {
      let capturedUrl = '';
      const authedFetch = async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, json: async () => ({ harvests: [] }) } as Response;
      };

      const client = new VaultClient(BASE_URL, authedFetch as any, mockSignTypedData);
      await client.getHarvests({ adapter: '0xCompound', cursor: 'page2', limit: '10' });
      expect(capturedUrl).toContain('/vault/harvests?adapter=0xCompound&cursor=page2&limit=10');
    });
  });
});
