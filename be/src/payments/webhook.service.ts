import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyService } from '../merchant/api-key.service';

interface RetryOpts { attempts?: number; backoffMs?: number; }

@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    @Optional() private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async deliver(orderId: string, url: string, secret: string, payload: unknown, opts: RetryOpts = {}): Promise<boolean> {
    const attempts = opts.attempts ?? 5;
    const backoffMs = opts.backoffMs ?? 1000;
    const body = JSON.stringify(payload);
    const signature = this.apiKeys.sign(secret, body);
    const record = await this.prisma.webhookDelivery.create({ data: { orderId, url, status: 'pending' } });

    let lastError = '';
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this.fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Navy-Signature': signature },
          body,
        });
        if (res.ok) {
          await this.prisma.webhookDelivery.update({ where: { id: record.id }, data: { status: 'delivered', attempts: i + 1, deliveredAt: new Date() } });
          return true;
        }
        lastError = `HTTP ${res.status}`;
      } catch (e) {
        lastError = (e as Error).message;
      }
      if (backoffMs) await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
    }
    await this.prisma.webhookDelivery.update({ where: { id: record.id }, data: { status: 'failed', attempts, lastError } });
    return false;
  }
}
