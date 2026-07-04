import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ApiKeyService } from '../merchant/api-key.service';

interface RetryOpts {
  attempts?: number;
  // Per-attempt backoff delays (ms). Kept short + injectable so tests don't hang.
  backoffs?: number[];
  // Legacy single-delay knob (delay grows linearly): backoffMs * (i + 1).
  backoffMs?: number;
}

@Injectable()
export class WebhookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeys: ApiKeyService,
    @Optional() private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async deliver(orderId: string, url: string, secret: string, payload: unknown, opts: RetryOpts = {}): Promise<boolean> {
    const attempts = opts.attempts ?? 3;
    // Default backoff: fast, so tests don't hang. Real re-delivery of a persistently
    // failing endpoint (beyond these attempts) is future work — a scheduled requeue
    // of `failed` WebhookDelivery rows.
    const backoffs = opts.backoffs ?? [200, 800];
    const delayFor = (i: number): number =>
      opts.backoffMs != null ? opts.backoffMs * (i + 1) : (backoffs[i] ?? backoffs[backoffs.length - 1] ?? 0);

    const timestamp = Date.now();
    const body = JSON.stringify(payload);
    // Fold the timestamp into the signed material so a receiver can reject replays:
    // sign `${timestamp}.${body}`. The raw body is still what's POSTed; the receiver
    // reconstructs the signed string from X-Navy-Timestamp + the body.
    const signed = `${timestamp}.${body}`;
    const signature = this.apiKeys.sign(secret, signed);

    // Ledger row: create pending, then mark delivered/failed as we learn the outcome.
    const record = await this.prisma.webhookDelivery.create({ data: { orderId, url, status: 'pending' } });
    // Idempotency id lets receivers dedupe retries of the same logical delivery.
    const idempotency = `${orderId}.${record.id}`;

    const headers = {
      'Content-Type': 'application/json',
      'X-Navy-Signature': signature,
      'X-Navy-Timestamp': String(timestamp),
      'X-Navy-Idempotency': idempotency,
    };

    let lastError = '';
    for (let i = 0; i < attempts; i++) {
      try {
        const res = await this.fetchImpl(url, { method: 'POST', headers, body });
        if (res.ok) {
          await this.prisma.webhookDelivery.update({
            where: { id: record.id },
            data: { status: 'delivered', attempts: i + 1, deliveredAt: new Date() },
          });
          return true;
        }
        lastError = `HTTP ${res.status}`;
      } catch (e) {
        lastError = (e as Error).message;
      }
      const isLast = i === attempts - 1;
      if (!isLast) {
        const d = delayFor(i);
        if (d) await new Promise((r) => setTimeout(r, d));
      }
    }
    await this.prisma.webhookDelivery.update({
      where: { id: record.id },
      data: { status: 'failed', attempts, lastError },
    });
    return false;
  }
}
