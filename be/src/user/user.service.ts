import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeUsername, isValidUsername } from '../common/username';

@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  upsertByDid(privyDid: string, primaryWallet?: string) {
    return this.prisma.user.upsert({
      where: { privyDid },
      create: { privyDid, primaryWallet: primaryWallet ?? null },
      update: { primaryWallet: primaryWallet ?? undefined },
    });
  }

  /** Public profile for the authenticated user (id, wallet, username). */
  async me(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new BadRequestException('User not found');
    return { id: u.id, walletAddress: u.primaryWallet, username: u.username ?? null };
  }

  /** True when the normalized handle is free (or already owned by this user). */
  async isUsernameAvailable(raw: string, forUserId?: string): Promise<boolean> {
    const username = normalizeUsername(raw);
    if (!isValidUsername(username)) return false;
    const existing = await this.prisma.user.findUnique({ where: { username } });
    return !existing || existing.id === forUserId;
  }

  /** Claim/replace this user's handle. Throws on invalid or taken. */
  async setUsername(userId: string, raw: string) {
    const username = normalizeUsername(raw);
    if (!isValidUsername(username)) throw new BadRequestException('invalid username');
    const existing = await this.prisma.user.findUnique({ where: { username } });
    if (existing && existing.id !== userId) throw new ConflictException('username taken');
    return this.prisma.user.update({ where: { id: userId }, data: { username } });
  }

  async clearUsername(userId: string) {
    return this.prisma.user.update({ where: { id: userId }, data: { username: null } });
  }

  /** Resolve a handle to an active user's wallet address, or null. Returns only address + handle. */
  async resolveUsername(raw: string): Promise<{ username: string; address: string } | null> {
    const username = normalizeUsername(raw);
    if (!isValidUsername(username)) return null;
    const u = await this.prisma.user.findUnique({ where: { username } });
    if (!u || u.status !== 'active' || !u.primaryWallet) return null;
    return { username, address: u.primaryWallet };
  }
}
