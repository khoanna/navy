import type { Eip712TypedData } from '@/lib/pay/navyPayClient';

export interface TransferBuildResult {
  transferId: string;
  typedData: Eip712TypedData;
  recipient: { address: string; username: string | null };
  amount: string;
}

export class TransferClient {
  constructor(
    private readonly baseUrl: string,
    private readonly authedFetch: (url: string, init?: RequestInit) => Promise<Response>,
  ) {}
  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.authedFetch(`${this.baseUrl}${path}`, {
      ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
    if (!res.ok) throw new Error(`transfer ${path} failed (${res.status})`);
    return (await res.json()) as T;
  }
  build(recipient: string, amountBase: string) {
    return this.json<TransferBuildResult>('/transfer/authorization', { method: 'POST', body: JSON.stringify({ recipient, amountBase }) });
  }
  submit(transferId: string, signature: string) {
    return this.json<{ txHash: string; status: string }>('/transfer/submit', { method: 'POST', body: JSON.stringify({ transferId, signature }) });
  }
  resolve(recipient: string) {
    return this.json<{ address: string; username: string | null }>(`/transfer/resolve?recipient=${encodeURIComponent(recipient)}`);
  }
  recordEth(to: string, amountWei: string, txHash: string) {
    return this.json<{ id: string; status: string }>('/transfer/eth/record', { method: 'POST', body: JSON.stringify({ to, amountWei, txHash }) });
  }
}
