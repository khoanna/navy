import { ethers } from 'ethers';
import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import { PrismaService } from '../prisma/prisma.service';
import { NavyConfigService } from '../config/config.service';
import { UserService } from '../user/user.service';
import {
  buildTransferTypedData, transferDigest, randomNonce, type TransferTypedData,
} from './transfer-authorization';
import { parseRecipient, assertNotSelfTransfer, assertSufficientBalance } from './transfer-guards';

/** Authorizations are valid for this long (seconds). */
const TRANSFER_TTL_SECONDS = 15 * 60;

export interface TransferAuthResult {
  transferId: string;
  typedData: TransferTypedData;
  recipient: { address: string; username: string | null };
  amount: string;
}

@Injectable()
export class TransferService {
  constructor(
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
    private readonly prisma: PrismaService,
    private readonly users: UserService,
    private readonly cfg: NavyConfigService,
  ) {}

  async buildAuthorization(userId: string, fromAddress: string, recipient: string, amount: bigint): Promise<TransferAuthResult> {
    if (amount <= 0n) throw new BadRequestException('amount must be positive');

    const relBal = await this.chain.provider.getBalance(this.chain.relayer.address);
    if (relBal < this.cfg.relayerMinBalanceWei) throw new ServiceUnavailableException('Transfer relayer temporarily unavailable');

    const parsed = parseRecipient(recipient);
    if (!parsed) throw new BadRequestException('Invalid recipient');

    let toAddress: string;
    let toUsername: string | null = null;
    if (parsed.kind === 'address') {
      toAddress = parsed.value;
    } else {
      const resolved = await this.users.resolveUsername(parsed.value);
      if (!resolved) throw new BadRequestException(`User @${parsed.value} not found`);
      toAddress = resolved.address;
      toUsername = resolved.username;
    }

    try {
      assertNotSelfTransfer(fromAddress, toAddress);
      const balance: bigint = await this.chain.usdc.balanceOf(fromAddress);
      assertSufficientBalance(balance, amount);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    const nonce = randomNonce();
    const validBeforeSec = Math.floor(Date.now() / 1000) + TRANSFER_TTL_SECONDS;
    const typedData = buildTransferTypedData({
      domain: this.chain.usdcDomain, from: fromAddress, to: toAddress,
      amount, validAfter: 0, validBefore: validBeforeSec, nonce,
    });
    const digest = transferDigest(typedData);

    const row = await this.prisma.transfer.create({
      data: {
        fromUserId: userId, fromAddress, toAddress, toUsername, amount, asset: 'USDC',
        nonce, digest, validBefore: new Date(validBeforeSec * 1000), status: 'awaiting_signature',
      },
    });

    return { transferId: row.id, typedData, recipient: { address: toAddress, username: toUsername }, amount: amount.toString() };
  }

  /** Recover signer, CAS-consume, relay transferWithAuthorization, persist confirming + txHash. */
  async submit(userId: string, transferId: string, signature: string, expectedPayer: string): Promise<{ txHash: string; status: string }> {
    const t = await this.prisma.transfer.findUnique({ where: { id: transferId } });
    if (!t || t.fromUserId !== userId) throw new BadRequestException('Transfer not found');
    if (!t.nonce || !t.digest || !t.validBefore) throw new BadRequestException('Transfer is not signable');
    if (t.consumedAt) throw new BadRequestException('Transfer already submitted');
    if (t.validBefore < new Date()) throw new BadRequestException('Transfer authorization expired');

    let signer: string;
    try { signer = ethers.recoverAddress(t.digest, signature); }
    catch { throw new BadRequestException('Invalid signature'); }
    if (signer.toLowerCase() !== expectedPayer.toLowerCase()) throw new BadRequestException('Signature does not match the authenticated user');

    const consumed = await this.prisma.transfer.updateMany({
      where: { id: transferId, consumedAt: null }, data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException('Transfer already submitted');

    const validBefore = Math.floor(t.validBefore.getTime() / 1000);
    const sig = ethers.Signature.from(signature);
    const tx = await this.chain.usdc.transferWithAuthorization(
      t.fromAddress, t.toAddress, t.amount, 0, validBefore, t.nonce, sig.v, sig.r, sig.s,
    );
    await this.prisma.transfer.update({ where: { id: transferId }, data: { status: 'confirming', txHash: tx.hash } });
    const receipt = await tx.wait();
    const ok = receipt && receipt.status === 1;
    const status = ok ? 'confirmed' : 'failed';
    await this.prisma.transfer.update({
      where: { id: transferId },
      data: ok ? { status } : { status, consumedAt: null },
    });
    return { txHash: tx.hash, status };
  }

  /** Record an ETH send the client already broadcast. Idempotent on txHash; the watcher reconciles it. */
  async recordEthSend(userId: string, fromAddress: string, to: string, amountWei: bigint, txHash: string): Promise<{ id: string; status: string }> {
    const existing = await this.prisma.transfer.findFirst({ where: { txHash, fromUserId: userId } });
    if (existing) return { id: existing.id, status: existing.status };
    if (!ethers.isAddress(to)) throw new BadRequestException('invalid recipient address');
    if (amountWei <= 0n) throw new BadRequestException('amount must be positive');
    // Self-reported history: to/amount are the client's claim; the watcher reconciles only status (not to/amount).
    const row = await this.prisma.transfer.create({
      data: {
        fromUserId: userId, fromAddress, toAddress: ethers.getAddress(to), toUsername: null,
        amount: amountWei, asset: 'ETH', status: 'confirming', txHash, consumedAt: new Date(),
      },
    });
    return { id: row.id, status: row.status };
  }

  /** Resolve a @username or 0x address to a wallet address (for the Send UI / ETH broadcast). */
  async resolve(recipient: string): Promise<{ address: string; username: string | null }> {
    const parsed = parseRecipient(recipient);
    if (!parsed) throw new BadRequestException('Invalid recipient');
    if (parsed.kind === 'address') return { address: parsed.value, username: null };
    const r = await this.users.resolveUsername(parsed.value);
    if (!r) throw new BadRequestException(`User @${parsed.value} not found`);
    return { address: r.address, username: r.username };
  }

  async history(userId: string, take = 20) {
    const rows = await this.prisma.transfer.findMany({
      where: { fromUserId: userId }, orderBy: { createdAt: 'desc' }, take,
    });
    return rows.map((r) => ({
      id: r.id, toAddress: r.toAddress, toUsername: r.toUsername,
      amount: r.amount.toString(), asset: r.asset, status: r.status, txHash: r.txHash, createdAt: r.createdAt,
    }));
  }
}
