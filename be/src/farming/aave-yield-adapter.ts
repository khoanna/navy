import { Injectable, Inject } from '@nestjs/common';
import { ethers } from 'ethers';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import type { EvmCall } from '../wallet/tx-summary';
import type { YieldAdapter, YieldPosition, PolicyAllowlist } from './yield-adapter';

// ─── Verified Aave v3 Sepolia addresses (checked on-chain) ───────────────────
export const AAVE_POOL = '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951';
// Aave test USDC (6 dec) — the farming asset, NOT the Circle payment USDC.
export const FARM_USDC = '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8';
export const AAVE_AUSDC = '0x16dA4541aD1807f4443d92D26044C1147406EB80';

const erc20Iface = new ethers.Interface([
  'function approve(address spender, uint256 value)',
  'function balanceOf(address owner) view returns (uint256)',
]);
const poolIface = new ethers.Interface([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
]);

/**
 * Aave v3 (Sepolia) yield adapter — the EVM replacement for the Save/Solend adapter.
 *
 * All build* methods return raw EVM calls the subwallet will send as msg.sender. The
 * subwallet must own the USDC (Aave credits the aToken to msg.sender/onBehalfOf), so
 * deposit is two calls (approve → supply) and withdraw redeems straight to the owner.
 */
@Injectable()
export class AaveYieldAdapter implements YieldAdapter {
  private readonly aToken: ethers.Contract;

  constructor(@Inject(NAVY_EVM) private readonly evm: NavyEvm) {
    this.aToken = new ethers.Contract(AAVE_AUSDC, erc20Iface, this.evm.provider);
  }

  /** approve(Pool, amount) then supply(USDC, amount, subwallet, 0). */
  async buildDeposit(subwallet: string, amountBase: bigint): Promise<EvmCall[]> {
    return [
      { to: FARM_USDC, data: erc20Iface.encodeFunctionData('approve', [AAVE_POOL, amountBase]) },
      { to: AAVE_POOL, data: poolIface.encodeFunctionData('supply', [FARM_USDC, amountBase, subwallet, 0]) },
    ];
  }

  /**
   * withdraw(USDC, amount|MaxUint256, ownerMainWallet). Aave sends the redeemed USDC
   * directly to `to`, so the funds land on the owner's main wallet in one call.
   */
  async buildWithdraw(_subwallet: string, ownerMainWallet: string, amount: bigint | 'all'): Promise<EvmCall[]> {
    const amt = amount === 'all' ? ethers.MaxUint256 : amount;
    return [
      { to: AAVE_POOL, data: poolIface.encodeFunctionData('withdraw', [FARM_USDC, amt, ownerMainWallet]) },
    ];
  }

  /** aToken balance rebases 1:1 with the underlying, so it IS the current value. */
  async getPosition(subwallet: string): Promise<YieldPosition> {
    const bal: bigint = await this.aToken.balanceOf(subwallet);
    // v1: no on-chain cost basis; principal == current value (farming_event holds
    // the deposit amounts for a richer view if desired).
    return { principalLamports: bal, currentValueLamports: bal, cTokenAmount: bal };
  }

  async policyAllowlist(subwallet: string, ownerMainWallet: string): Promise<PolicyAllowlist> {
    return {
      programIds: [FARM_USDC, AAVE_POOL, AAVE_AUSDC],
      destinations: [subwallet, AAVE_POOL, ownerMainWallet],
    };
  }
}
