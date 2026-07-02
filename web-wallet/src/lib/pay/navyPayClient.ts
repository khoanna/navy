export interface OrderSummary { orderId: string; status: string; amount: string; reference: string; }
export interface Payment { orderId: string; reference: string; amount: string; status: string; paidAt: string | null; txSignature: string | null; merchant: string | null; }

export class NavyPayClient {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init });
    if (!res.ok) throw new Error(`Navy API ${path} failed (HTTP ${res.status})`);
    return (await res.json()) as T;
  }

  getOrder(id: string): Promise<OrderSummary> { return this.json(`/v1/orders/${id}`); }
  getPaymentTx(id: string, payer: string): Promise<{ tx: string; invoice: unknown }> {
    return this.json(`/v1/orders/${id}/payment-tx?payer=${payer}`);
  }
  submitSignedTx(id: string, signedTx: string): Promise<{ txSignature: string; status: string }> {
    return this.json(`/v1/orders/${id}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signedTx }) });
  }
  getUserPayments(navyAccessToken: string): Promise<Payment[]> {
    return this.json(`/user/payments`, { headers: { Authorization: `Bearer ${navyAccessToken}` } });
  }
}
