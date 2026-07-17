import { Inject, Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ethers } from 'ethers';
import { PrismaService } from '../prisma/prisma.service';
import { CIPHER } from '../crypto/cipher.interface';
import type { Cipher } from '../crypto/cipher.interface';
import { AuditService } from '../audit/audit.service';
import { PolicyValidator } from './policy.validator';
import type { SubwalletPolicy } from './policy.validator';
import { deriveTxSummary, type EvmCall } from './tx-summary';
import { NAVY_EVM, type NavyEvm } from '../evm/evm.module';

@Injectable()
export class SigningService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CIPHER) private readonly cipher: Cipher,
    private readonly policy: PolicyValidator,
    private readonly audit: AuditService,
    @Inject(NAVY_EVM) private readonly evm: NavyEvm,
  ) {}

  /**
   * Send ONE policy-checked EVM call from a farming subwallet.
   *
   * The subwallet is the msg.sender (Aave requires the caller to own the USDC), so it
   * broadcasts its own tx and pays gas from its Sepolia-ETH float. Security discipline
   * (unchanged from the Solana model): the summary is derived from the ACTUAL call
   * (never trusts the caller) → PolicyValidator (deny-by-default) → decrypt the key
   * transiently → sign+send → WIPE the key in `finally` → audit.
   *
   * Returns the broadcast transaction hash.
   */
  async signAndSend(subwalletId: string, call: EvmCall): Promise<string> {
    const row = await this.prisma.farmingSubwallet.findUnique({ where: { id: subwalletId } });
    if (!row || row.status !== 'active') throw new NotFoundException('Subwallet not available');

    const summary = deriveTxSummary([call]);
    const verdict = this.policy.check(row.policyJson as unknown as SubwalletPolicy, summary, { subwallet: row.pubkey });
    if (!verdict.ok) {
      await this.audit.record({ actor: `subwallet:${row.pubkey}`, action: 'subwallet.sign.denied', metadata: { reason: verdict.reason } });
      throw new ForbiddenException(`Policy denied: ${verdict.reason}`);
    }

    const secret = await this.cipher.open({ encryptedPrivkey: row.encryptedPrivkey, dataKeyWrapped: row.dataKeyWrapped });
    let signer: ethers.Wallet | undefined;
    try {
      // Reconstruct the signer transiently from the decrypted key (0x-prefixed hex).
      signer = new ethers.Wallet('0x' + Buffer.from(secret).toString('hex'), this.evm.provider);
      const sent = await signer.sendTransaction({
        to: call.to,
        data: call.data ?? '0x',
        value: call.value !== undefined ? BigInt(call.value) : 0n,
      });
      await sent.wait();
      await this.audit.record({ actor: `subwallet:${row.pubkey}`, action: 'subwallet.sign', metadata: { txHash: sent.hash } });
      return sent.hash;
    } finally {
      secret.fill(0);
      // Drop the reference to the transiently-held key material.
      signer = undefined;
      void signer;
    }
  }
}
