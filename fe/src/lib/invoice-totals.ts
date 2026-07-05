export type ChargeMode = 'percent' | 'fixed';
export interface TotalsItem { unitPrice: bigint; quantity: number; }
export interface TotalsCharge { name: string; mode: ChargeMode; value: number; }
export interface AppliedCharge { name: string; mode: ChargeMode; value: number; amount: bigint; }
export interface InvoiceTotals { subtotal: bigint; charges: AppliedCharge[]; total: bigint; }

/**
 * Live-preview mirror of the backend authoritative invoice math. Integer base
 * units (USDC 6dp). Percent charges compute on the subtotal (no compounding);
 * fixed charges add a flat base-unit amount. Backend recomputes on create — this
 * is cosmetic preview only.
 */
export function computeInvoiceTotals(items: TotalsItem[], charges: TotalsCharge[]): InvoiceTotals {
  const subtotal = items.reduce((s, it) => s + it.unitPrice * BigInt(it.quantity), 0n);
  const applied: AppliedCharge[] = charges.map((c) => ({
    name: c.name,
    mode: c.mode,
    value: c.value,
    amount: c.mode === 'percent' ? (subtotal * BigInt(c.value)) / 10000n : BigInt(c.value),
  }));
  const total = applied.reduce((s, c) => s + c.amount, subtotal);
  return { subtotal, charges: applied, total };
}
