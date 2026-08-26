/**
 * VaultDepositService — Gasless vault deposit (EIP-3009 USDC) and redeem (EIP-2612 permit).
 *
 * Deposit flow (gasless — relayer pays gas):
 *   1. buildDepositAuthorization → returns EIP-3009 ReceiveWithAuthorization typed data
 *      Nonce = keccak256(vaultAddress || userAddress || amountBase || id)
 *   2. Client wallet signs the typed data
 *   3. submitDeposit → relayer calls USDC.receiveWithAuthorization + vault.deposit(assets, user)
 *
 * Redeem flow (gasless — relayer pays gas):
 *   1. buildRedeemPermit → returns EIP-2612 Permit typed data for navUSDC shares
 *   2. Client wallet signs the typed data
 *   3. submitRedeem → relayer calls vault.redeem(shares, user, user) using the EIP-2612 permit
 *
 * Both flows use CAS-consume pattern: DB record consumed BEFORE on-chain submit (crash-safe).
 */
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ethers } from 'ethers';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { PrismaService } from '../prisma/prisma.service';
import { assertRelayerBalance } from '../evm/eip3009-relay.util';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DepositAuthorizationResponse {
  id: string;
  typedData: Eip3009TypedData;
  amountBase: string;
  expiresAt: string; // ISO date string
}

export interface DepositSubmitResponse {
  txHash: string;
  status: 'confirming';
  sharesBase: string;
}

export interface RedeemPermitResponse {
  id: string;
  typedData: Eip2612TypedData;
  sharesBase: string;
  expiresAt: string; // ISO date string
}

export interface RedeemSubmitResponse {
  txHash: string;
  status: 'confirming';
  assetsBase: string;
}

// ---------------------------------------------------------------------------
// EIP-3009 types (USDC ReceiveWithAuthorization)
// ---------------------------------------------------------------------------

interface Eip3009Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

interface Eip3009Message {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface Eip3009TypedData {
  domain: Eip3009Domain;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: 'ReceiveWithAuthorization';
  message: Eip3009Message;
}

// ---------------------------------------------------------------------------
// EIP-2612 types (navUSDC Permit)
// ---------------------------------------------------------------------------

interface Eip2612Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
}

interface Eip2612Message {
  owner: string;
  spender: string;
  value: string;
  nonce: string;
  deadline: string;
}

export interface Eip2612TypedData {
  domain: Eip2612Domain;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: 'Permit';
  message: Eip2612Message;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AUTHORIZATION_TTL_SECONDS = 3600; // 1 hour max validity

const EIP3009_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  ReceiveWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

const EIP2612_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class VaultDepositService {
  constructor(
    @Inject(NAVY_EVM) private readonly evm: NavyEvm,
    private readonly prisma: PrismaService,
  ) {}

  // -------------------------------------------------------------------------
  // Deposit authorization
  // -------------------------------------------------------------------------

  /**
   * Build EIP-3009 ReceiveWithAuthorization typed data for a vault deposit.
   *
   * The nonce is `keccak256(vaultAddress || userAddress || amountBase || id)` — unique per
   * submission. The relayer submits `receiveWithAuthorization` then `vault.deposit`.
   *
   * @throws BadRequestException if amountBase <= 0 or user has insufficient USDC balance
   * @throws ServiceUnavailableException if relayer ETH is low
   */
  async buildDepositAuthorization(
    userId: string,
    walletAddress: string,
    amountBase: string,
  ): Promise<DepositAuthorizationResponse> {
    let amount: bigint;
    try { amount = BigInt(amountBase); } catch {
      throw new BadRequestException('amountBase must be a valid positive integer string');
    }
    if (amount <= 0n) throw new BadRequestException('amountBase must be greater than 0');

    // Relayer balance check (fail-fast so order stays awaiting_signature on failure)
    await assertRelayerBalance(
      this.evm.provider,
      this.evm.relayer.address,
      20_000_000_000_000_00n, // 0.02 ETH
    );

    // Insufficient balance guard
    const balance: bigint = await this.evm.usdc.balanceOf(walletAddress) as bigint;
    if (balance < amount) {
      throw new BadRequestException(
        `Insufficient USDC balance: have ${balance}, need ${amount} base units`,
      );
    }

    const id = randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const validAfter = nowSec;
    const validBefore = nowSec + AUTHORIZATION_TTL_SECONDS;
    const expiresAt = new Date(validBefore * 1000);

    // Unique EIP-3009 nonce per submission
    const vaultAddress = this.evm.vault.target as string;
    const idHex = Buffer.from(id.replace(/-/g, ''), 'hex'); // 16 bytes (32 hex chars)
    const nonceDigest = ethers.solidityPackedKeccak256(
      ['address', 'address', 'uint256', 'bytes16'],
      [vaultAddress, walletAddress, amount, idHex],
    );

    const typedData: Eip3009TypedData = {
      domain: this.evm.usdcDomain,
      types: EIP3009_TYPES,
      primaryType: 'ReceiveWithAuthorization',
      message: {
        from: walletAddress,
        to: vaultAddress,
        value: amountBase,
        validAfter: validAfter.toString(),
        validBefore: validBefore.toString(),
        nonce: nonceDigest,
      },
    };

    // Persist the authorization record (consumed on submit)
    await this.prisma.vaultDeposit.create({
      data: {
        id,
        userId,
        userAddress: walletAddress.toLowerCase(),
        assetsBase: amount,
        nonce: nonceDigest,
        digest: this.eip3009Digest(typedData),
        validBefore: expiresAt,
        status: 'awaiting_signature',
      },
    });

    return {
      id,
      typedData,
      amountBase,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Submit a vault deposit: verify signature, CAS-consume the record, relay USDC + vault calls.
   *
   * @throws BadRequestException on missing record, wrong wallet, already consumed, signer mismatch
   */
  async submitDeposit(
    userId: string,
    walletAddress: string,
    id: string,
    signature: string,
  ): Promise<DepositSubmitResponse> {
    const record = await this.prisma.vaultDeposit.findUnique({ where: { id } });

    if (!record) throw new BadRequestException('No deposit authorization found for this id');
    if (record.consumedAt) throw new BadRequestException('Authorization already submitted');
    if (record.status !== 'awaiting_signature') {
      throw new BadRequestException('Authorization is not awaiting a signature');
    }

    // Verify the record belongs to this user/wallet
    if (record.userId !== userId || record.userAddress !== walletAddress.toLowerCase()) {
      throw new BadRequestException('Authorization does not belong to this user');
    }

    // Reconstruct typed data for signature recovery
    const typedData = this.reconstructDepositTypedData(record, id);

    // Verify expiry
    if (record.validBefore && new Date() > record.validBefore) {
      throw new BadRequestException('Authorization has expired');
    }

    // Recover signer and verify
    const recovered = this.recoverEip3009Signer(typedData, signature);
    if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new BadRequestException('Signature does not match the authenticated wallet');
    }

    // CAS-consume BEFORE submitting (crash-safe: no tx hash persisted yet)
    const consumed = await this.prisma.vaultDeposit.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date(), status: 'confirming' },
    });
    if (consumed.count !== 1) throw new BadRequestException('Authorization already submitted');

    const sig = ethers.Signature.from(signature);
    const assetsBase = record.assetsBase.toString();

    try {
      // Step 1: Relayer calls USDC.receiveWithAuthorization (moves USDC from wallet → vault)
      const receiveTx = await this.evm.usdc.receiveWithAuthorization(
        walletAddress,
        this.evm.vault.target,
        record.assetsBase,
        0,
        Math.floor((record.validBefore!.getTime()) / 1000),
        record.nonce,
        sig.v,
        sig.r,
        sig.s,
      );

      // Persist tx hash BEFORE awaiting mine (crash-safety)
      await this.prisma.vaultDeposit.update({
        where: { id },
        data: { txHash: receiveTx.hash, status: 'confirming' },
      });

      // Step 2: Relayer calls vault.deposit(assets, walletAddress) to mint navUSDC shares
      // Uses explicit gas limit (public RPCs can spuriously fail on complex vault calls)
      const depositTx = await this.evm.vault.deposit(record.assetsBase, walletAddress, { gasLimit: 500_000n });

      // Wait for confirmation
      const receipt = await depositTx.wait();

      // Estimate shares from the Deposit event
      const sharesBase = this.extractDepositShares(receipt, walletAddress, record.assetsBase);

      await this.prisma.vaultDeposit.update({
        where: { id },
        data: { status: 'confirmed' },
      });

      return {
        txHash: depositTx.hash,
        status: 'confirming',
        sharesBase,
      };
    } catch (err) {
      // On revert, reset to awaiting_signature so user can retry
      await this.prisma.vaultDeposit.update({
        where: { id },
        data: { status: 'awaiting_signature', consumedAt: null, txHash: null },
      });
      throw new BadRequestException('Transaction failed on-chain — please try again');
    }
  }

  // -------------------------------------------------------------------------
  // Redeem permit
  // -------------------------------------------------------------------------

  /**
   * Build EIP-2612 Permit typed data for redeeming vault shares.
   *
   * @throws BadRequestException if sharesBase <= 0 or insufficient synchronous liquidity
   * @throws ServiceUnavailableException if relayer ETH is low
   */
  async buildRedeemPermit(
    userId: string,
    walletAddress: string,
    sharesBase: string,
  ): Promise<RedeemPermitResponse> {
    // Handle "all" — resolve to current vault share balance
    let shares: bigint;
    if (sharesBase.toLowerCase() === 'all') {
      shares = (await this.evm.vault.balanceOf(walletAddress)) as bigint;
      if (shares === 0n) throw new BadRequestException('No shares to redeem');
    } else {
      shares = BigInt(sharesBase);
      if (shares <= 0n) throw new BadRequestException('sharesBase must be greater than 0');
    }

    const sharesBaseStr = shares.toString();

    // Relayer balance check
    await assertRelayerBalance(
      this.evm.provider,
      this.evm.relayer.address,
      20_000_000_000_000_00n,
    );

    // Check synchronous liquidity (maxRedeem caps at synchronous exit capacity)
    const maxRedeem: bigint = await this.evm.vault.maxRedeem(walletAddress) as bigint;
    if (shares > maxRedeem) {
      throw new BadRequestException(
        `Insufficient synchronous liquidity: can redeem up to ${maxRedeem} shares, requested ${shares}`,
      );
    }

    // Read current permit nonce from vault (navUSDC is the vault's ERC20)
    const nonceBN: bigint = await this.evm.vault.nonces(walletAddress) as bigint;
    const nonce = nonceBN.toString();

    const id = randomUUID();
    const nowSec = Math.floor(Date.now() / 1000);
    const deadline = nowSec + AUTHORIZATION_TTL_SECONDS;
    const expiresAt = new Date(deadline * 1000);

    const typedData: Eip2612TypedData = {
      domain: this.evm.vaultShareDomain,
      types: EIP2612_TYPES,
      primaryType: 'Permit',
      message: {
        owner: walletAddress,
        spender: this.evm.relayer.address,
        value: sharesBaseStr,
        nonce,
        deadline: deadline.toString(),
      },
    };

    // Persist the permit record
    await this.prisma.vaultRedeem.create({
      data: {
        id,
        userId,
        userAddress: walletAddress.toLowerCase(),
        sharesBase: shares,
        digest: this.eip2612Digest(typedData),
        deadline: expiresAt,
        status: 'awaiting_signature',
      },
    });

    return {
      id,
      typedData,
      sharesBase: sharesBaseStr,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Submit a vault redeem: verify EIP-2612 permit, CAS-consume, relay vault.redeem.
   *
   * @throws BadRequestException on missing record, wrong wallet, already consumed, signer mismatch
   */
  async submitRedeem(
    userId: string,
    walletAddress: string,
    id: string,
    signature: string,
  ): Promise<RedeemSubmitResponse> {
    const record = await this.prisma.vaultRedeem.findUnique({ where: { id } });

    if (!record) throw new BadRequestException('No redeem permit found for this id');
    if (record.consumedAt) throw new BadRequestException('Permit already submitted');
    if (record.status !== 'awaiting_signature') {
      throw new BadRequestException('Permit is not awaiting a signature');
    }

    // Verify the record belongs to this user/wallet
    if (record.userId !== userId || record.userAddress !== walletAddress.toLowerCase()) {
      throw new BadRequestException('Permit does not belong to this user');
    }

    // Reconstruct typed data (nonce re-read from chain for exact EIP-2612 match)
    const typedData = await this.reconstructRedeemTypedData(record, id);

    // Verify expiry
    if (record.deadline && new Date() > record.deadline) {
      throw new BadRequestException('Permit has expired');
    }

    // Recover signer and verify
    const recovered = this.recoverEip2612Signer(typedData, signature);
    if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
      throw new BadRequestException('Signature does not match the authenticated wallet');
    }

    // CAS-consume BEFORE submitting
    const consumed = await this.prisma.vaultRedeem.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: new Date(), status: 'confirming' },
    });
    if (consumed.count !== 1) throw new BadRequestException('Permit already submitted');

    const sharesBase = record.sharesBase.toString();

    try {
      // Relayer calls vault.redeem(shares, receiver, owner) — assets go to walletAddress
      const redeemTx = await this.evm.vault.redeem(
        record.sharesBase,
        walletAddress,
        walletAddress,
        { gasLimit: 500_000n },
      );

      // Persist tx hash BEFORE awaiting mine
      await this.prisma.vaultRedeem.update({
        where: { id },
        data: { txHash: redeemTx.hash, status: 'confirming' },
      });

      const receipt = await redeemTx.wait();

      // Extract assets from the Withdraw event
      const assetsBase = this.extractWithdrawAssets(receipt, walletAddress, record.sharesBase);

      await this.prisma.vaultRedeem.update({
        where: { id },
        data: { status: 'confirmed' },
      });

      return {
        txHash: redeemTx.hash,
        status: 'confirming',
        assetsBase,
      };
    } catch (err) {
      // On revert, reset so user can retry
      await this.prisma.vaultRedeem.update({
        where: { id },
        data: { status: 'awaiting_signature', consumedAt: null, txHash: null },
      });
      throw new BadRequestException('Transaction failed on-chain — please try again');
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private eip3009Digest(td: Eip3009TypedData): string {
    return ethers.TypedDataEncoder.hash(td.domain as any, td.types as any, td.message as any);
  }

  private eip2612Digest(td: Eip2612TypedData): string {
    return ethers.TypedDataEncoder.hash(td.domain as any, td.types as any, td.message as any);
  }

  private recoverEip3009Signer(td: Eip3009TypedData, signature: string): string {
    try {
      return ethers.verifyTypedData(
        td.domain as any,
        td.types as any,
        td.message as any,
        signature,
      );
    } catch {
      throw new BadRequestException('Invalid EIP-3009 signature');
    }
  }

  private recoverEip2612Signer(td: Eip2612TypedData, signature: string): string {
    try {
      return ethers.verifyTypedData(
        td.domain as any,
        td.types as any,
        td.message as any,
        signature,
      );
    } catch {
      throw new BadRequestException('Invalid EIP-2612 permit signature');
    }
  }

  private reconstructDepositTypedData(
    record: { assetsBase: bigint; userAddress: string; nonce: string; validBefore: Date | null },
    id: string,
  ): Eip3009TypedData {
    const validBefore = record.validBefore
      ? Math.floor(record.validBefore.getTime() / 1000)
      : 0;
    const vaultAddr = this.evm.vault.target as string;
    return {
      domain: this.evm.usdcDomain,
      types: EIP3009_TYPES,
      primaryType: 'ReceiveWithAuthorization',
      message: {
        from: record.userAddress,
        to: vaultAddr,
        value: record.assetsBase.toString(),
        validAfter: '0',
        validBefore: validBefore.toString(),
        nonce: record.nonce,
      },
    };
  }

  private async reconstructRedeemTypedData(
    record: { sharesBase: bigint; userAddress: string; digest: string; deadline: Date | null },
    id: string,
  ): Promise<Eip2612TypedData> {
    // Re-read current permit nonce from chain (EIP-2612 requires exact nonce match)
    const nonceBN: bigint = await this.evm.vault.nonces(record.userAddress) as bigint;
    const deadline = record.deadline
      ? Math.floor(record.deadline.getTime() / 1000)
      : 0;
    return {
      domain: this.evm.vaultShareDomain,
      types: EIP2612_TYPES,
      primaryType: 'Permit',
      message: {
        owner: record.userAddress,
        spender: this.evm.relayer.address,
        value: record.sharesBase.toString(),
        nonce: nonceBN.toString(),
        deadline: deadline.toString(),
      },
    };
  }

  private extractDepositShares(
    receipt: ethers.TransactionReceipt,
    receiver: string,
    _assets: bigint,
  ): string {
    const depositIface = new ethers.Interface([
      'event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)',
    ]);
    for (const log of receipt.logs) {
      try {
        const parsed = depositIface.parseLog({ data: log.data, topics: log.topics });
        if (parsed?.name === 'Deposit' && parsed.args[1]?.toLowerCase() === receiver.toLowerCase()) {
          return parsed.args[3].toString();
        }
      } catch {
        // Not a matching log, skip
      }
    }
    return '0'; // caller should use vault.balanceOf(receiver) to confirm
  }

  private extractWithdrawAssets(
    receipt: ethers.TransactionReceipt,
    receiver: string,
    _shares: bigint,
  ): string {
    const withdrawIface = new ethers.Interface([
      'event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)',
    ]);
    for (const log of receipt.logs) {
      try {
        const parsed = withdrawIface.parseLog({ data: log.data, topics: log.topics });
        if (parsed?.name === 'Withdraw' && parsed.args[1]?.toLowerCase() === receiver.toLowerCase()) {
          return parsed.args[3].toString();
        }
      } catch {
        // Not a matching log, skip
      }
    }
    return '0';
  }
}
