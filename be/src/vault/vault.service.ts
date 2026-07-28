import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';
import {
  buildDepositAuthorizationTypedData, depositAuthorizationDigest, randomNonce,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  buildRedeemPermitTypedData, redeemPermitDigest, recoverRedeemSigner,
} from './vault-authorization';

@Injectable()
export class VaultService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(NAVY_EVM) private readonly chain: NavyEvm,
  ) {}

  async buildDepositAuthorization(userId: string, userAddress: string, amountBase: bigint) {
    if (amountBase <= 0n) throw new BadRequestException('amountBase must be positive');
    const validBefore = Math.floor(Date.now() / 1000) + 3600;
    const nonce = randomNonce();
    const to = await this.chain.vault.getAddress();
    const td = buildDepositAuthorizationTypedData({
      domain: this.chain.usdcDomain, from: userAddress, to, amount: amountBase,
      validAfter: 0, validBefore, nonce,
    });
    const digest = depositAuthorizationDigest(td);
    const row = await this.prisma.vaultDeposit.create({
      data: {
        userId, userAddress, assetsBase: amountBase, nonce, digest,
        validBefore: new Date(validBefore * 1000), status: 'awaiting_signature',
      },
    });
    return { typedData: td, deposit: { id: row.id } };
  }

  async submitDeposit(id: string, signature: string, expectedUser: string) {
    const d = await this.prisma.vaultDeposit.findUnique({ where: { id } });
    if (!d) throw new BadRequestException('Unknown deposit');
    const to = await this.chain.vault.getAddress();
    const validBefore = Math.floor((d.validBefore as Date).getTime() / 1000);
    const signer = ethers.verifyTypedData(
      this.chain.usdcDomain, RECEIVE_WITH_AUTHORIZATION_TYPES,
      { from: d.userAddress, to, value: d.assetsBase.toString(), validAfter: 0, validBefore, nonce: d.nonce },
      signature,
    );
    if (signer.toLowerCase() !== expectedUser.toLowerCase()) throw new BadRequestException('Signature does not match caller');

    const consumed = await this.prisma.vaultDeposit.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new BadRequestException('Authorization already submitted');

    const sig = ethers.Signature.from(signature);
    try {
      const tx = await this.chain.vault.depositWithAuthorization(
        d.userAddress, d.assetsBase, 0, validBefore, d.nonce, sig.v, sig.r, sig.s,
      );
      await this.prisma.vaultDeposit.update({ where: { id }, data: { status: 'confirming', txHash: tx.hash } });
      return { status: 'confirming', txHash: tx.hash };
    } catch (e) {
      await this.prisma.vaultDeposit.update({ where: { id }, data: { consumedAt: null, status: 'failed' } });
      throw new ServiceUnavailableException('Relay failed: ' + (e as Error).message);
    }
  }

  async buildRedeemPermit(userId: string, userAddress: string, sharesBase: bigint) {
    if (sharesBase <= 0n) throw new BadRequestException('sharesBase must be positive');
    const bal: bigint = await this.chain.vault.balanceOf(userAddress);
    if (sharesBase > bal) throw new BadRequestException('Insufficient shares');
    const nonce: bigint = await this.chain.vault.nonces(userAddress);
    const deadline = Math.floor(Date.now() / 1000) + 3600;
    const spender = await this.chain.relayer.getAddress();
    const td = buildRedeemPermitTypedData({
      domain: this.chain.vaultShareDomain, owner: userAddress, spender, value: sharesBase, nonce, deadline,
    });
    const digest = redeemPermitDigest(td);
    const row = await this.prisma.vaultRedeem.create({
      data: { userId, userAddress, sharesBase, digest, deadline: new Date(deadline * 1000), status: 'awaiting_signature' },
    });
    return { typedData: td, redeem: { id: row.id } };
  }

  async submitRedeem(id: string, signature: string, expectedUser: string) {
    const r = await this.prisma.vaultRedeem.findUnique({ where: { id } });
    if (!r) throw new BadRequestException('Unknown redeem');
    const spender = await this.chain.relayer.getAddress();
    const nonce: bigint = await this.chain.vault.nonces(r.userAddress);
    const deadline = Math.floor((r.deadline as Date).getTime() / 1000);
    const td = buildRedeemPermitTypedData({
      domain: this.chain.vaultShareDomain, owner: r.userAddress, spender, value: r.sharesBase, nonce, deadline,
    });
    const signer = recoverRedeemSigner(td, signature);
    if (signer.toLowerCase() !== expectedUser.toLowerCase()) throw new BadRequestException('Signature does not match caller');

    const consumed = await this.prisma.vaultRedeem.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new BadRequestException('Permit already submitted');

    const sig = ethers.Signature.from(signature);
    try {
      const permitTx = await this.chain.vault.permit(r.userAddress, spender, r.sharesBase, deadline, sig.v, sig.r, sig.s);
      await permitTx.wait();
      const tx = await this.chain.vault.redeem(r.sharesBase, r.userAddress, r.userAddress);
      await this.prisma.vaultRedeem.update({ where: { id }, data: { status: 'confirming', txHash: tx.hash } });
      return { status: 'confirming', txHash: tx.hash };
    } catch (e) {
      await this.prisma.vaultRedeem.update({ where: { id }, data: { consumedAt: null, status: 'failed' } });
      throw new ServiceUnavailableException('Relay failed: ' + (e as Error).message);
    }
  }

  async getPosition(userAddress: string) {
    const shares: bigint = await this.chain.vault.balanceOf(userAddress);
    const assets: bigint = shares === 0n ? 0n : await this.chain.vault.convertToAssets(shares);
    return { sharesBase: shares.toString(), assetsBase: assets.toString() };
  }

  async getApys() {
    const count: bigint = await this.chain.vault.adapterCount();
    const out: { adapter: string; aprE18: string; assetsBase: string }[] = [];
    for (let i = 0n; i < count; i++) {
      const addr: string = await this.chain.vault.adapters(i);
      const adapter = new ethers.Contract(addr, this.chain.yieldAdapterAbi, this.chain.provider);
      const [apr, assets] = (await Promise.all([adapter.supplyRatePerYear(), adapter.totalAssets()])) as [bigint, bigint];
      out.push({ adapter: addr, aprE18: apr.toString(), assetsBase: assets.toString() });
    }
    return out;
  }
}
