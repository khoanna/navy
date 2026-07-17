export interface OrderItem { name: string; unitPrice: string; quantity: number; }
export interface OrderCharge { name: string; mode?: string; value?: number; amount: string; }
export interface OrderSummary {
  orderId: string;
  status: string;
  amount: string;
  reference: string;
  subtotal?: string | null;
  description?: string | null;
  items?: OrderItem[];
  charges?: OrderCharge[];
}
// The `user/payments` list keeps the DB column name `txSignature` (it now holds the EVM tx hash).
export interface Payment { orderId: string; reference: string; amount: string; status: string; paidAt: string | null; txSignature: string | null; merchant: string | null; }

/** EIP-712 typed-data payload as returned by the backend for a payment authorization. */
export interface Eip712TypedData {
  domain: {
    name?: string;
    version?: string;
    chainId?: number;
    verifyingContract?: string;
    salt?: string;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
}

export interface PaymentAuthorization {
  typedData: Eip712TypedData;
  invoice: {
    merchant?: string | null;
    amount?: string;
    reference?: string;
    expiresAt?: string | null;
  };
}

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
  /**
   * Fetch the EIP-712 typed data (ReceiveWithAuthorization) the user must sign.
   * The backend derives the payer (`message.from`) from the Navy user token.
   */
  getPaymentAuthorization(id: string, navyAccessToken: string): Promise<PaymentAuthorization> {
    return this.json(`/v1/orders/${encodeURIComponent(id)}/payment-authorization`, {
      headers: { Authorization: `Bearer ${navyAccessToken}` },
    });
  }
  /** Submit the 65-byte (0x…) EIP-712 signature; the relayer broadcasts the tx. */
  submitSignature(id: string, signature: string, navyAccessToken: string): Promise<{ txHash: string; status: string }> {
    return this.json(`/v1/orders/${encodeURIComponent(id)}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${navyAccessToken}` },
      body: JSON.stringify({ signature }),
    });
  }
  getUserPayments(navyAccessToken: string): Promise<Payment[]> {
    return this.json('/user/payments', { headers: { Authorization: `Bearer ${navyAccessToken}` } });
  }
}
