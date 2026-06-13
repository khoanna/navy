import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
}
