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
  /**
   * @param baseUrl       - Navy API base URL.
   * @param fetchImpl     - Underlying fetch (injected in tests; defaults to global fetch).
   * @param authedFetchFn - Optional pre-wired authed fetch returned by `makeAuthedFetch`.
   *                        When provided, authenticated endpoints route through it so the
   *                        Navy access token is auto-refreshed on 401.  When omitted the
   *                        caller-supplied bearer token is used as-is (legacy / test path).
   */
  constructor(
    private readonly baseUrl: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly authedFetchFn?: (url: string, init?: RequestInit) => Promise<Response>,
  ) {}

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

  /**
   * Perform an authenticated request, using the auto-refresh helper when available.
   * The `navyAccessToken` arg is the *current* token — it is passed to the non-wired
   * path so existing callers and tests continue to work without change.
   */
  private async authedJson<T>(path: string, navyAccessToken: string, init?: RequestInit): Promise<T> {
    if (this.authedFetchFn) {
      // The authedFetchFn injects the Authorization header itself; strip any stale one.
      const { Authorization: _a, authorization: _b, ...restHeaders } =
        (init?.headers as Record<string, string> | undefined) ?? {};
      const res = await this.authedFetchFn(`${this.baseUrl}${path}`, { ...init, headers: restHeaders });
      if (!res.ok) {
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
    // Legacy path (no authedFetchFn): forward the token as a header directly.
    return this.json<T>(path, {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${navyAccessToken}` },
    });
  }

  getOrder(id: string): Promise<OrderSummary> {
    // Public endpoint — no auth required.
    return this.json(`/v1/orders/${encodeURIComponent(id)}`);
  }
  /**
   * Fetch the EIP-712 typed data (ReceiveWithAuthorization) the user must sign.
   * The backend derives the payer (`message.from`) from the Navy user token.
   */
  getPaymentAuthorization(id: string, navyAccessToken: string): Promise<PaymentAuthorization> {
    return this.authedJson(`/v1/orders/${encodeURIComponent(id)}/payment-authorization`, navyAccessToken);
  }
  /** Submit the 65-byte (0x…) EIP-712 signature; the relayer broadcasts the tx. */
  submitSignature(id: string, signature: string, navyAccessToken: string): Promise<{ txHash: string; status: string }> {
    return this.authedJson(`/v1/orders/${encodeURIComponent(id)}/submit`, navyAccessToken, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature }),
    });
  }
  getUserPayments(navyAccessToken: string): Promise<Payment[]> {
    return this.authedJson('/user/payments', navyAccessToken);
  }
}
