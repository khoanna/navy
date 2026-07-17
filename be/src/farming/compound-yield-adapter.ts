import { Injectable, Inject } from '@nestjs/common';
import { ethers } from 'ethers';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import type { EvmCall } from '../wallet/tx-summary';
import type { YieldAdapter, YieldPosition, PolicyAllowlist } from './yield-adapter';

// ─── Verified Compound III (Comet) Sepolia address (checked on-chain) ────────
// The USDC market Comet; its baseToken() IS Circle USDC (cfg.usdcAddress). Supplying
// the base asset = lending/earning; the supplier balance is Comet.balanceOf(account).
export const COMET = '0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e';

const erc20Iface = new ethers.Interface([
  'function approve(address spender, uint256 value)',
]);
const cometIface = new ethers.Interface([
  'function supply(address asset, uint256 amount)',
  'function withdraw(address asset, uint256 amount)',
  'function withdrawTo(address to, address asset, uint256 amount)',
  'function balanceOf(address account) view returns (uint256)',
]);

/**
 * Compound v3 (Comet, Sepolia) yield adapter — the EVM yield backend, unified onto
 * Circle USDC (`cfg.usdcAddress`, the same token payments use).
 *
 * All build* methods return raw EVM calls the subwallet will send as msg.sender.
 * The subwallet must own the USDC (Comet credits the supplier = msg.sender), so a
 * deposit is two calls (approve → supply) and a withdraw redeems straight to the
 * owner via `withdrawTo`.
 */
@Injectable()
export class CompoundYieldAdapter implements YieldAdapter {
  private readonly usdcAddress: string;
  private readonly comet: ethers.Contract;

  constructor(@Inject(NAVY_EVM) private readonly evm: NavyEvm) {
    // Circle USDC (the payment token). Comet's baseToken() equals this on-chain.
    this.usdcAddress = this.evm.usdcAddress;
    this.comet = new ethers.Contract(COMET, cometIface, this.evm.provider);
  }

  /** approve(Comet, amount) then supply(USDC, amount) — supply credits msg.sender (the subwallet). */
  async buildDeposit(_subwallet: string, amountBase: bigint): Promise<EvmCall[]> {
    return [
      { to: this.usdcAddress, data: erc20Iface.encodeFunctionData('approve', [COMET, amountBase]) },
      { to: COMET, data: cometIface.encodeFunctionData('supply', [this.usdcAddress, amountBase]) },
    ];
  }

  /**
   * withdrawTo(ownerMainWallet, USDC, amount). Comet sends the redeemed base straight
   * to `to`, so the funds land on the owner's main wallet in one call. For 'all', use
   * the subwallet's present supplier balance (balanceOf incl. accrued interest).
   */
  async buildWithdraw(subwallet: string, ownerMainWallet: string, amount: bigint | 'all'): Promise<EvmCall[]> {
    const amt = amount === 'all' ? ((await this.comet.balanceOf(subwallet)) as bigint) : amount;
    return [
      { to: COMET, data: cometIface.encodeFunctionData('withdrawTo', [ownerMainWallet, this.usdcAddress, amt]) },
    ];
  }

  /** The supplier's present base balance (principal + accrued interest) IS the current value. */
  async getPosition(subwallet: string): Promise<YieldPosition> {
    const bal: bigint = await this.comet.balanceOf(subwallet);
    // v1: no on-chain cost basis; principal == current value (farming_event holds
    // the deposit amounts for a richer view if desired).
    return { principalLamports: bal, currentValueLamports: bal, cTokenAmount: bal };
  }

  async policyAllowlist(subwallet: string, ownerMainWallet: string): Promise<PolicyAllowlist> {
    return {
      programIds: [this.usdcAddress, COMET],
      destinations: [subwallet, COMET, ownerMainWallet],
    };
  }
}
