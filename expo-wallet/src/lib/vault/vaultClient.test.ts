/**
 * VaultClient — the user-signed proposal flow.
 *
 * Paper §2.1 removed the relayer, so the deposit/redeem endpoints these tests
 * used to drive (`/vault/deposit/*`, `/vault/redeem/*`) no longer exist. What
 * matters now is that the client asks the right proposal route, returns the
 * legs untouched, and carries the backend's structured refusal `reason`
 * through to the caller — that reason is the whole reason the user does not
 * pay gas for a doomed transaction.
 */
import { VaultClient, VaultRequestError } from './vaultClient';

describe('VaultClient', () => {
  const BASE_URL = 'https://api.navy.exchange';

  /** Records every request and replies from a path→response map. */
  function mockAuthedFetch(
    responses: Map<string, { ok: boolean; status: number; json: () => unknown }>,
  ) {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const fn = async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        method: init?.method,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
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
    return Object.assign(fn, { calls });
  }

  const APPROVE_LEG = {
    to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    data: '0x095ea7b3deadbeef',
    value: '0',
    chainId: 8453,
    description: 'Approve vault to spend 1000000 USDC',
  };
  const DEPOSIT_LEG = {
    to: '0x55E728b08FdB9432520FB3Fd1b9D7777320f8ED3',
    data: '0x6e553f65deadbeef',
    value: '0',
    chainId: 8453,
    description: 'Deposit 1000000 USDC into vault',
  };

  // -------------------------------------------------------------------------
  // Proposal routes
  // -------------------------------------------------------------------------

  describe('buildDeposit()', () => {
    it('POSTs assetsBase to /vault/transactions/deposit and returns the legs in order', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([
          ['/vault/transactions/deposit', {
            ok: true, status: 200,
            json: () => ({ transactions: [APPROVE_LEG, DEPOSIT_LEG] }),
          }],
        ]),
      );

      const client = new VaultClient(BASE_URL, authedFetch as any);
      const legs = await client.buildDeposit('1000000');

      expect(legs).toEqual([APPROVE_LEG, DEPOSIT_LEG]);
      expect(authedFetch.calls).toHaveLength(1);
      expect(authedFetch.calls[0]!.url).toBe(`${BASE_URL}/vault/transactions/deposit`);
      expect(authedFetch.calls[0]!.method).toBe('POST');
      expect(authedFetch.calls[0]!.body).toEqual({ assetsBase: '1000000' });
    });

    it('never touches the removed relayed endpoints', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/transactions/deposit', {
          ok: true, status: 200, json: () => ({ transactions: [DEPOSIT_LEG] }),
        }]]),
      );
      await new VaultClient(BASE_URL, authedFetch as any).buildDeposit('1');

      const urls = authedFetch.calls.map((c) => c.url).join(' ');
      expect(urls).not.toContain('/vault/deposit/');
      expect(urls).not.toContain('/vault/redeem/');
    });

    it('returns an empty list rather than undefined when the backend omits transactions', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/transactions/deposit', { ok: true, status: 200, json: () => ({}) }]]),
      );
      await expect(new VaultClient(BASE_URL, authedFetch as any).buildDeposit('1')).resolves.toEqual([]);
    });

    it('surfaces the INSUFFICIENT_USDC_BALANCE reason, not just the status text', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/transactions/deposit', {
          ok: false, status: 400,
          json: () => ({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Insufficient USDC balance: have 400000, need 1000000 base units',
            reason: {
              code: 'INSUFFICIENT_USDC_BALANCE',
              unit: 'usdc-6dp',
              requiredBase: '1000000',
              availableBase: '400000',
              shortfallBase: '600000',
              message: 'Insufficient USDC balance: have 400000, need 1000000 base units',
            },
          }),
        }]]),
      );

      const err = await new VaultClient(BASE_URL, authedFetch as any)
        .buildDeposit('1000000')
        .catch((e) => e);

      expect(err).toBeInstanceOf(VaultRequestError);
      expect(err.status).toBe(400);
      expect(err.reason.code).toBe('INSUFFICIENT_USDC_BALANCE');
      expect(err.reason.shortfallBase).toBe('600000');
      expect(err.message).toContain('Insufficient USDC balance');
    });
  });

  describe('buildRedeem()', () => {
    it('POSTs sharesBase to /vault/transactions/redeem', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/transactions/redeem', {
          ok: true, status: 200,
          json: () => ({ transactions: [{ ...DEPOSIT_LEG, description: 'Redeem 500000 shares from vault' }] }),
        }]]),
      );

      const client = new VaultClient(BASE_URL, authedFetch as any);
      const legs = await client.buildRedeem('500000');

      expect(legs).toHaveLength(1);
      expect(authedFetch.calls[0]!.url).toBe(`${BASE_URL}/vault/transactions/redeem`);
      expect(authedFetch.calls[0]!.body).toEqual({ sharesBase: '500000' });
    });

    it('surfaces the EXCEEDS_MAX_REDEEM reason', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/transactions/redeem', {
          ok: false, status: 400,
          json: () => ({
            statusCode: 400,
            error: 'Bad Request',
            message: 'Insufficient synchronous liquidity: can redeem up to 750 shares, requested 1000',
            reason: {
              code: 'EXCEEDS_MAX_REDEEM',
              unit: 'shares-12dp',
              requiredBase: '1000',
              availableBase: '750',
              shortfallBase: '250',
              message: 'Insufficient synchronous liquidity: can redeem up to 750 shares, requested 1000',
            },
          }),
        }]]),
      );

      const err = await new VaultClient(BASE_URL, authedFetch as any)
        .buildRedeem('1000')
        .catch((e) => e);

      expect(err.reason.code).toBe('EXCEEDS_MAX_REDEEM');
      expect(err.reason.availableBase).toBe('750');
    });
  });

  describe('buildWithdraw() / buildApprove()', () => {
    it('POSTs assetsBase to the withdraw route', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/transactions/withdraw', {
          ok: true, status: 200, json: () => ({ transactions: [DEPOSIT_LEG] }),
        }]]),
      );
      await new VaultClient(BASE_URL, authedFetch as any).buildWithdraw('250000');
      expect(authedFetch.calls[0]!.body).toEqual({ assetsBase: '250000' });
    });

    it('POSTs amountBase to the approve route', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/transactions/approve', {
          ok: true, status: 200, json: () => ({ transactions: [APPROVE_LEG] }),
        }]]),
      );
      await new VaultClient(BASE_URL, authedFetch as any).buildApprove('250000');
      expect(authedFetch.calls[0]!.url).toBe(`${BASE_URL}/vault/transactions/approve`);
      expect(authedFetch.calls[0]!.body).toEqual({ amountBase: '250000' });
    });
  });

  // -------------------------------------------------------------------------
  // Error handling for bodies with no structured reason
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('leaves reason null for an ordinary error body', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/position', {
          ok: false, status: 503, json: () => ({ message: 'temporarily unavailable' }),
        }]]),
      );

      const err = await new VaultClient(BASE_URL, authedFetch as any).getPosition().catch((e) => e);
      expect(err).toBeInstanceOf(VaultRequestError);
      expect(err.status).toBe(503);
      expect(err.reason).toBeNull();
      expect(err.message).toContain('temporarily unavailable');
    });

    it('falls back to the response text when the body is not JSON', async () => {
      const authedFetch = async () =>
        ({
          ok: false,
          status: 502,
          json: async () => {
            throw new Error('not json');
          },
          text: async () => 'Bad Gateway',
        }) as unknown as Response;

      const err = await new VaultClient(BASE_URL, authedFetch as any).getPosition().catch((e) => e);
      expect(err.message).toContain('502');
      expect(err.message).toContain('Bad Gateway');
      expect(err.reason).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Read routes (unchanged by the paper conformance work)
  // -------------------------------------------------------------------------

  describe('read routes', () => {
    it('returns the vault position', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/position', {
          ok: true, status: 200,
          json: () => ({
            sharesBase: '1000000',
            assetsBase: '2000000',
            maxWithdrawBase: '2000000',
            maxRedeemBase: '1000000',
          }),
        }]]),
      );
      const result = await new VaultClient(BASE_URL, authedFetch as any).getPosition();
      expect(result.sharesBase).toBe('1000000');
      expect(result.maxRedeemBase).toBe('1000000');
    });

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
      const result = await new VaultClient(BASE_URL, authedFetch as any).getApys();
      expect(result.adapters).toHaveLength(2);
      expect(result.aggregateApyBps).toBe(642);
    });

    it('returns the strategy allocation', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/strategy', {
          ok: true, status: 200,
          json: () => ({
            totalAssets: '7000000000000',
            allocations: [
              { adapter: '0x5b53a25fF5Ec56a852CB4c0D193754308C6e99A0', name: 'Compound III', assets: '5000000000000', percentage: 71.4 },
            ],
          }),
        }]]),
      );
      const result = await new VaultClient(BASE_URL, authedFetch as any).getStrategy();
      expect(result.totalAssets).toBe('7000000000000');
    });

    it('returns harvest history', async () => {
      const authedFetch = mockAuthedFetch(
        new Map([['/vault/harvests', {
          ok: true, status: 200,
          json: () => ({
            harvests: [{
              adapter: '0x5b53a25fF5Ec56a852CB4c0D193754308C6e99A0',
              protocol: 'compound',
              harvestedAt: '2026-08-01T12:00:00Z',
              grossBase: '1000000',
              netBase: '995000',
              recipients: [{ address: '0xtreasure', shares: '1000000' }],
            }],
          }),
        }]]),
      );
      const result = await new VaultClient(BASE_URL, authedFetch as any).getHarvests();
      expect(result.harvests).toHaveLength(1);
    });

    it('passes query params for adapter and pagination', async () => {
      let capturedUrl = '';
      const authedFetch = async (url: string) => {
        capturedUrl = url;
        return { ok: true, status: 200, json: async () => ({ harvests: [] }) } as Response;
      };
      await new VaultClient(BASE_URL, authedFetch as any).getHarvests({
        adapter: '0xCompound', cursor: 'page2', limit: '10',
      });
      expect(capturedUrl).toContain('/vault/harvests?adapter=0xCompound&cursor=page2&limit=10');
    });
  });
});
