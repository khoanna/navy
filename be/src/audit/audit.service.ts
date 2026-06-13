import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  async record(e: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: { actor: e.actor, action: e.action, target: e.target ?? null, metadata: e.metadata ?? null } as any,
    });
  }
}
