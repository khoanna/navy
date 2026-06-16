import { Injectable, Inject } from '@nestjs/common';
import { PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { YieldAdapter, YieldPosition, computePositionValue } from './yield-adapter';

// Verified Save devnet addresses (on-chain confirmed, June 2026).
const SAVE_PROGRAM = new PublicKey('ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx');
const SAVE_MARKET = new PublicKey('GvjoVKNjBvQcFaSKUW1gTE7DxhSpjHbE69umVR5nPuQp');
const SAVE_SOL_RESERVE = new PublicKey('5VVLD7BQp8y3bTgyF5ezm1ResyMTR3PhYsT4iHFU8Sxz');
const TOKEN_PROGRAM = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM = new PublicKey('11111111111111111111111111111111');
const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

@Injectable()
export class SaveYieldAdapter implements YieldAdapter {
  constructor(@Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain) {}

  async buildDeposit(_subwallet: PublicKey, _amountLamports: bigint): Promise<Transaction> {
    // TASK 9: implement via @solendprotocol/solend-sdk SolendAction.buildDepositTxns(connection, amount, 'SOL', subwallet, 'devnet').
    throw new Error('SaveYieldAdapter.buildDeposit: implement against installed solend-sdk (Task 9)');
  }
  async buildWithdraw(_subwallet: PublicKey, _ownerMainWallet: PublicKey, _amount: bigint | 'all'): Promise<Transaction> {
    // TASK 9: SolendAction.buildWithdrawTxns(...) + append SystemProgram.transfer(subwallet -> ownerMainWallet).
    throw new Error('SaveYieldAdapter.buildWithdraw: implement against installed solend-sdk (Task 9)');
  }
  async getPosition(_subwallet: PublicKey): Promise<YieldPosition> {
    // TASK 9: read SOL reserve cToken exchange rate + subwallet collateral balance, then computePositionValue.
    const cTokenAmount = 0n; const exchangeRate = 1.0;
    return { principalLamports: 0n, currentValueLamports: computePositionValue(cTokenAmount, exchangeRate), cTokenAmount };
  }
  async policyAllowlist(subwallet: PublicKey, ownerMainWallet: PublicKey) {
    const wsolAta = getAssociatedTokenAddressSync(WSOL_MINT, subwallet, true);
    return {
      programIds: [SAVE_PROGRAM, TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM].map((p) => p.toBase58()),
      destinations: [wsolAta.toBase58(), SAVE_SOL_RESERVE.toBase58(), ownerMainWallet.toBase58()],
    };
  }
}
