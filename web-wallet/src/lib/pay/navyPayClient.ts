export interface OrderSummary { orderId: string; status: string; amount: string; reference: string; }
export interface Payment { orderId: string; reference: string; amount: string; status: string; paidAt: string | null; txSignature: string | null; merchant: string | null; }

export class NavyPayClient {
  constructor(private readonly baseUrl: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init });
    if (!res.ok) {
      // Surface the server's message (if any) so toasts show the real reason.
      let detail = '';
      try {
        const body = await res.json();
        detail = (body && (body.message || body.error)) ? `: ${body.message ?? body.error}` : '';
      } catch {
        try { const t = (await res.text()).trim(); if (t) detail = `: ${t}`; } catch { /* ignore */ }
      }
      throw new Error(`Navy API ${path} failed (HTTP ${res.status})${detail}`);
    }
    return (await res.json()) as T;
  }

  getOrder(id: string): Promise<OrderSummary> {
    return this.json(`/v1/orders/${encodeURIComponent(id)}`);
  }
  getPaymentTx(id: string, navyAccessToken: string): Promise<{ tx: string; invoice: unknown }> {
    // The backend derives the payer from the Navy user token (the `?payer=` param is ignored).
    return this.json(`/v1/orders/${encodeURIComponent(id)}/payment-tx`, {
      headers: { Authorization: `Bearer ${navyAccessToken}` },
    });
  }
  submitSignedTx(id: string, signedTx: string, navyAccessToken: string): Promise<{ txSignature: string; status: string }> {
    return this.json(`/v1/orders/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${navyAccessToken}` },
      body: JSON.stringify({ signedTx }),
    });
  }
  getUserPayments(navyAccessToken: string): Promise<Payment[]> {
    return this.json('/user/payments', { headers: { Authorization: `Bearer ${navyAccessToken}` } });
  }
}
