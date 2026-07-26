import { EvmRegistrarService } from '../../../src/evm/evm-registrar.service';
import { merchantIdHex } from '../../../src/evm/payment-authorization';

const MERCHANT_UUID = '11111111-2222-3333-4444-555555555555';
const PAYOUT = '0x4444444444444444444444444444444444444444';

function makeChain(exists = false) {
  const wait = jest.fn().mockResolvedValue({ status: 1 });
  const registerMerchant = jest.fn().mockResolvedValue({ hash: '0xreg', wait });
  const setMerchantActive = jest.fn().mockResolvedValue({ hash: '0xact', wait });
  const setMerchantPayout = jest.fn().mockResolvedValue({ hash: '0xpay', wait });
  const merchants = jest.fn().mockResolvedValue(exists ? { payout: PAYOUT, active: true, exists: true } : { payout: '0x0000000000000000000000000000000000000000', active: false, exists: false });
  return { paymentsAsOwner: { registerMerchant, setMerchantActive, setMerchantPayout, merchants } } as any;
}

describe('EvmRegistrarService', () => {
  it('registers a new merchant (payout = the merchant EVM address) when it does not exist', async () => {
    const chain = makeChain(false);
    const svc = new EvmRegistrarService(chain);
    const hash = await svc.ensureRegisteredActive({ id: MERCHANT_UUID, payoutAddress: PAYOUT });
    expect(chain.paymentsAsOwner.registerMerchant).toHaveBeenCalledWith(merchantIdHex(MERCHANT_UUID), PAYOUT);
    expect(hash).toBe('0xreg');
  });

  it('reactivates an existing merchant instead of re-registering', async () => {
    const chain = makeChain(true);
    const svc = new EvmRegistrarService(chain);
    const hash = await svc.ensureRegisteredActive({ id: MERCHANT_UUID, payoutAddress: PAYOUT });
    expect(chain.paymentsAsOwner.registerMerchant).not.toHaveBeenCalled();
    expect(chain.paymentsAsOwner.setMerchantActive).toHaveBeenCalledWith(merchantIdHex(MERCHANT_UUID), true);
    expect(hash).toBe('0xact');
  });

  it('deactivate calls setMerchantActive(false)', async () => {
    const chain = makeChain(true);
    const svc = new EvmRegistrarService(chain);
    await svc.deactivate({ id: MERCHANT_UUID, payoutAddress: PAYOUT });
    expect(chain.paymentsAsOwner.setMerchantActive).toHaveBeenCalledWith(merchantIdHex(MERCHANT_UUID), false);
  });

  it('setPayout calls setMerchantPayout with the EVM address', async () => {
    const chain = makeChain(true);
    const svc = new EvmRegistrarService(chain);
    await svc.setPayout({ id: MERCHANT_UUID, payoutAddress: PAYOUT });
    expect(chain.paymentsAsOwner.setMerchantPayout).toHaveBeenCalledWith(merchantIdHex(MERCHANT_UUID), PAYOUT);
  });
});
