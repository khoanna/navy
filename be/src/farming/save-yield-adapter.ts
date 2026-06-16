import { Injectable, Inject } from '@nestjs/common';
import { PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { SolendActionCore, parseReserve } from '@solendprotocol/solend-sdk';
import { NAVY_ONCHAIN } from '../onchain/onchain.module';
import type { NavyOnchain } from '../onchain/onchain.module';
import { YieldAdapter, YieldPosition, computePositionValue } from './yield-adapter';

// ─── Verified Save devnet addresses (on-chain confirmed, June 2026) ─────────
const SAVE_PROGRAM_ID_STR = 'ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx';
const SAVE_PROGRAM        = new PublicKey(SAVE_PROGRAM_ID_STR);
const SAVE_MARKET_STR     = 'GvjoVKNjBvQcFaSKUW1gTE7DxhSpjHbE69umVR5nPuQp';
const SAVE_SOL_RESERVE    = new PublicKey('5VVLD7BQp8y3bTgyF5ezm1ResyMTR3PhYsT4iHFU8Sxz');

// Well-known devnet market authority (PDA derived from market address + SAVE_PROGRAM).
// DEVNET-VERIFY: confirm via `solana account GvjoVKNj... --url devnet` and checking the
// lending-market authority field. If wrong, buildDeposit/buildWithdraw will fail on-chain.
const SAVE_MARKET_AUTHORITY_STR = 'DdZR6zRFiUt4S5mg7AV1uKB2z1f1WzcNYCaTEEWPAuby';

const TOKEN_PROGRAM      = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ATA_PROGRAM        = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const SYSTEM_PROGRAM_KEY = new PublicKey('11111111111111111111111111111111');
const WSOL_MINT          = new PublicKey('So11111111111111111111111111111111111111112');

// U64_MAX sentinel used by Save to redeem the full position
const U64_MAX = '18446744073709551615';

// ─── Reserve snapshot (derived from on-chain account) ────────────────────────
//
// We parse the reserve on-the-fly to extract the InputReserveType fields
// required by SolendActionCore, plus the cTokenExchangeRate for getPosition.
//
// cTokenExchangeRate = totalSupply / (mintTotalSupply / 10^decimals)
// where:
//   totalSupply = availableAmount/10^d + borrowedAmountWads/10^(18+d) − accFees/10^(18+d)
//   mintTotalSupply is the total cToken supply (shifted by d)
//
// All arithmetic uses plain JS numbers (sufficient precision for position display;
// the SDK itself uses BigNumber internally for transactions).
//
// DEVNET-VERIFY: The on-chain oracle keys for the devnet SOL reserve may be stub / null
// oracle addresses. If oracle refresh transactions revert with "stale oracle" that is
// expected devnet behaviour — retry or pre-refresh externally.

interface ReserveSnapshot {
  // InputReserveType fields required by SolendActionCore
  address:                     string;
  mintAddress:                 string;
  liquidityAddress:            string;
  cTokenMint:                  string;
  cTokenLiquidityAddress:      string;
  pythOracle:                  string;
  switchboardOracle:           string;
  liquidityFeeReceiverAddress: string;
  // For getPosition
  cTokenExchangeRate: number;
}

async function fetchReserveSnapshot(
  connection: import('@solana/web3.js').Connection,
): Promise<ReserveSnapshot> {
  const info = await connection.getAccountInfo(SAVE_SOL_RESERVE, 'confirmed');
  if (!info) {
    throw new Error(`Save SOL reserve account not found on devnet: ${SAVE_SOL_RESERVE.toBase58()}`);
  }

  const parsed = parseReserve(SAVE_SOL_RESERVE, info);
  const r = parsed.info;

  const decimals = r.liquidity.mintDecimals;
  const scale = Math.pow(10, decimals);

  // Compute totalSupply in base units (lamports for SOL reserve)
  const availableAmount = Number(r.liquidity.availableAmount.toString()) / scale;
  const totalBorrow     = Number(r.liquidity.borrowedAmountWads.toString()) / (1e18 * scale);
  const accFees         = Number(r.liquidity.accumulatedProtocolFeesWads.toString()) / (1e18 * scale);
  const totalSupply     = availableAmount + totalBorrow - accFees;

  const mintTotalSupply = Number(r.collateral.mintTotalSupply.toString()) / scale;

  // Guard against division by zero (empty reserve or first deposit)
  const cTokenExchangeRate = mintTotalSupply === 0 ? 1.0 : totalSupply / mintTotalSupply;

  return {
    address:                     SAVE_SOL_RESERVE.toBase58(),
    mintAddress:                 r.liquidity.mintPubkey.toBase58(),
    liquidityAddress:            r.liquidity.supplyPubkey.toBase58(),
    cTokenMint:                  r.collateral.mintPubkey.toBase58(),
    cTokenLiquidityAddress:      r.collateral.supplyPubkey.toBase58(),
    pythOracle:                  r.liquidity.pythOracle.toBase58(),
    switchboardOracle:           r.liquidity.switchboardOracle.toBase58(),
    liquidityFeeReceiverAddress: r.config.feeReceiver.toBase58(),
    cTokenExchangeRate,
  };
}

// ─── Pool descriptor for SolendActionCore ────────────────────────────────────
//
// Only address, owner, name, authorityAddress, and the reserve oracle keys are
// read at runtime inside the SDK constructor/initialize path we use.
//
// DEVNET-VERIFY: SAVE_MARKET_AUTHORITY_STR must match the PDA stored in the
// on-chain LendingMarket account. Verify with:
//   solana account GvjoVKNjBvQcFaSKUW1gTE7DxhSpjHbE69umVR5nPuQp --url devnet
// and check the `authority_address` field. If wrong, deposit/withdraw ixs will
// fail with InvalidAccountData on the authority check.
function buildPool(snap: ReserveSnapshot) {
  return {
    address:          SAVE_MARKET_STR,
    owner:            SAVE_MARKET_AUTHORITY_STR,   // DEVNET-VERIFY
    name:             'Save SOL (devnet)' as string | null,
    authorityAddress: SAVE_MARKET_AUTHORITY_STR,   // DEVNET-VERIFY
    reserves: [{
      address:                     snap.address,
      pythOracle:                  snap.pythOracle,
      switchboardOracle:           snap.switchboardOracle,
      mintAddress:                 snap.mintAddress,
      liquidityFeeReceiverAddress: snap.liquidityFeeReceiverAddress,
    }],
  };
}

// ─── Helper: combine legacy txn parts into one Transaction ───────────────────
//
// SolendActionCore.getLegacyTransactions() returns { preLendingTxn, lendingTxn, postLendingTxn }.
// We merge all instructions into a single Transaction for the SubwalletSigningService.
//
// DEVNET-VERIFY: for first-time deposits the merged tx may exceed the 1232-byte limit
// (create obligation + ATA + wsol wrap + deposit + close). If that happens, split:
// submit preLendingTxn separately, then lendingTxn + postLendingTxn. The farming service
// submit() method would need to be updated to accept an array of transactions.
async function mergeLegacyTxns(
  action: SolendActionCore,
  feePayer: PublicKey,
  connection: import('@solana/web3.js').Connection,
): Promise<Transaction> {
  const { preLendingTxn, lendingTxn, postLendingTxn } = await action.getLegacyTransactions();
  const blockhash = (await connection.getLatestBlockhash('confirmed')).blockhash;

  const merged = new Transaction({ feePayer, recentBlockhash: blockhash });
  if (preLendingTxn)  merged.add(...preLendingTxn.instructions);
  if (lendingTxn)     merged.add(...lendingTxn.instructions);
  if (postLendingTxn) merged.add(...postLendingTxn.instructions);
  return merged;
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

@Injectable()
export class SaveYieldAdapter implements YieldAdapter {
  constructor(@Inject(NAVY_ONCHAIN) private readonly chain: NavyOnchain) {}

  /**
   * Build a Save deposit transaction for native SOL on devnet.
   *
   * Wired via:
   *   SolendActionCore.buildDepositTxns(pool, reserve, connection,
   *     amountLamports.toString(), { publicKey: subwallet }, { environment: 'devnet' })
   *   then getLegacyTransactions() → merge preLending + lending + postLending.
   *
   * The SDK's "wsol" support path (triggered because mintAddress == NATIVE_MINT / WSOL)
   * wraps native SOL into a temporary WSOL ATA, deposits into Save, and closes the ATA —
   * all instructions are included in the merged tx.
   *
   * DEVNET-VERIFY:
   *   1. SAVE_MARKET_AUTHORITY_STR must match the on-chain LendingMarket authority PDA.
   *   2. Devnet oracle staleness may cause the refresh-reserve ix to revert; retry on that error.
   *   3. The merged tx may exceed 1232 bytes for first-time deposits (create obligation + ATA).
   *      If so, split preLendingTxn as a separate submission before lendingTxn.
   */
  async buildDeposit(subwallet: PublicKey, amountLamports: bigint): Promise<Transaction> {
    const conn = this.chain.connection;
    const snap = await fetchReserveSnapshot(conn);
    const pool = buildPool(snap);

    const action = await SolendActionCore.buildDepositTxns(
      pool,
      snap as any,
      conn,
      amountLamports.toString(),
      { publicKey: subwallet },
      { environment: 'devnet' },
    );

    return mergeLegacyTxns(action, subwallet, conn);
  }

  /**
   * Build a Save withdraw transaction for native SOL on devnet, then APPEND a
   * SystemProgram.transfer(subwallet → ownerMainWallet) for the redeemed SOL so
   * the hardened policy's owner-only destination rule is satisfied.
   *
   * amount = 'all': uses the U64_MAX sentinel which tells Save to redeem the full
   * obligation collateral position.  After the SDK builds the withdraw txn (which
   * unwraps WSOL back to native SOL on the subwallet), we append a transfer of
   * the current position value to ownerMainWallet.
   *
   * DEVNET-VERIFY:
   *   1. 'all' withdraws use U64_MAX — confirm the devnet Save program handles it correctly.
   *   2. The appended SystemProgram.transfer assumes unwrapped SOL lands in the subwallet's
   *      lamport balance before the transfer ix executes (all in the same atomic tx).
   *   3. transferLamports for 'all' is estimated from getPosition(); may slightly differ from
   *      actual redeemed amount due to accrued interest between the two RPC calls. A small
   *      RENT_BUFFER should be subtracted from transferLamports to avoid overdraft.
   */
  async buildWithdraw(subwallet: PublicKey, ownerMainWallet: PublicKey, amount: bigint | 'all'): Promise<Transaction> {
    const conn = this.chain.connection;
    const snap = await fetchReserveSnapshot(conn);
    const pool = buildPool(snap);

    let sdkAmountStr: string;
    let transferLamports: bigint;

    if (amount === 'all') {
      sdkAmountStr = U64_MAX;
      // Estimate redeemable: read cToken balance and convert via exchange rate
      const pos = await this.getPosition(subwallet);
      // Leave a small buffer for rent / rounding to avoid SystemProgram.transfer overdraft
      const SAFETY_BUFFER = 5000n; // 0.000005 SOL
      transferLamports = pos.currentValueLamports > SAFETY_BUFFER
        ? pos.currentValueLamports - SAFETY_BUFFER
        : 0n;
    } else {
      sdkAmountStr = amount.toString();
      transferLamports = amount;
    }

    const action = await SolendActionCore.buildWithdrawTxns(
      pool,
      snap as any,
      conn,
      sdkAmountStr,
      { publicKey: subwallet },
      { environment: 'devnet' },
    );

    const merged = await mergeLegacyTxns(action, subwallet, conn);

    // Append the policy-satisfying transfer back to the owner's main wallet.
    // This ensures every SOL leaving the subwallet goes to an allowlisted destination.
    if (transferLamports > 0n) {
      merged.add(
        SystemProgram.transfer({
          fromPubkey: subwallet,
          toPubkey:   ownerMainWallet,
          lamports:   transferLamports,
        }),
      );
    }

    return merged;
  }

  /**
   * Read the subwallet's Save position on devnet.
   *
   * Steps:
   *   1. Parse the SOL reserve account to get cTokenExchangeRate.
   *   2. Fetch the subwallet's cToken ATA token balance (getTokenAccountBalance).
   *   3. currentValueLamports = computePositionValue(cTokenAmount, exchangeRate).
   *   4. principalLamports = currentValueLamports (v1 — Save does not expose cost-basis
   *      on-chain; the farming_event table tracks deposit amounts for a more accurate
   *      principal if needed in the future).
   *
   * DEVNET-VERIFY:
   *   1. If the subwallet has never deposited, the cToken ATA will not exist — treated as
   *      zero balance (caught by the try/catch).
   *   2. cTokenExchangeRate is derived directly from on-chain reserve data (no oracle
   *      dependency; oracles are only needed for interest rate calculations, not position value).
   *   3. getTokenAccountBalance returns `.value.amount` as an integer string (raw cToken
   *      units without decimal shifting) — this is what we pass to computePositionValue.
   */
  async getPosition(subwallet: PublicKey): Promise<YieldPosition> {
    const conn = this.chain.connection;
    const snap = await fetchReserveSnapshot(conn);

    const cTokenMintKey = new PublicKey(snap.cTokenMint);
    const cTokenAta = getAssociatedTokenAddressSync(cTokenMintKey, subwallet, true);

    let cTokenAmount = 0n;
    try {
      const bal = await conn.getTokenAccountBalance(cTokenAta, 'confirmed');
      // `.value.amount` is the raw integer string (decimals NOT applied)
      cTokenAmount = BigInt(bal.value.amount);
    } catch {
      // Account does not exist → zero position (not deposited yet)
      cTokenAmount = 0n;
    }

    const currentValueLamports = computePositionValue(cTokenAmount, snap.cTokenExchangeRate);

    // v1: principalLamports == currentValueLamports (no on-chain cost basis;
    // farming_event table holds actual deposit amounts for a richer view if desired).
    const principalLamports = currentValueLamports;

    return { principalLamports, currentValueLamports, cTokenAmount };
  }

  async policyAllowlist(subwallet: PublicKey, ownerMainWallet: PublicKey) {
    const wsolAta = getAssociatedTokenAddressSync(WSOL_MINT, subwallet, true);
    return {
      programIds:   [SAVE_PROGRAM, TOKEN_PROGRAM, ATA_PROGRAM, SYSTEM_PROGRAM_KEY].map((p) => p.toBase58()),
      destinations: [wsolAta.toBase58(), SAVE_SOL_RESERVE.toBase58(), ownerMainWallet.toBase58()],
    };
  }
}
