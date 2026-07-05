"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { usdcInputToBaseUnits } from "@/lib/money";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { colors, space, radius } from "@/ui/theme";

const inputStyle: React.CSSProperties = {
  background: colors.bgElevated,
  border: `1px solid ${colors.borderStrong}`,
  borderRadius: radius.md,
  color: colors.text,
  padding: "12px 14px",
  outline: "none",
  width: "100%",
};

/**
 * The invoice-creation form + success (QR) state, decoupled from any page
 * chrome so it can render inside the orders Modal or a standalone page.
 * `onCreated` fires after a successful create so callers can refresh lists.
 */
export function NewInvoiceForm({ onCreated }: { onCreated?: () => void }) {
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [expiresInSec, setExpiresInSec] = useState("900");
  const [result, setResult] = useState<{ orderId: string; qr: string; payUrl: string } | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      setError("");
      setResult(null);
      let baseUnits: string;
      try {
        baseUnits = usdcInputToBaseUnits(amount);
      } catch (err) {
        setError((err as Error).message);
        return;
      }
      if (baseUnits === "0") {
        setError("Enter an amount greater than 0");
        return;
      }
      const ttl = parseInt(expiresInSec, 10);
      if (!Number.isFinite(ttl) || ttl <= 0) {
        setError("Enter a valid expiry in seconds");
        return;
      }
      setSubmitting(true);
      const res = await fetch("/api/merchant/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: baseUnits, reference, expiresInSec: ttl }),
      });
      const body = await res.json();
      setSubmitting(false);
      if (res.ok) {
        setResult({ orderId: body.orderId, qr: body.qr, payUrl: body.payUrl });
        onCreated?.();
      } else setError(body.error ?? (res.status === 409 ? "Your account is not approved yet" : `Failed (${res.status})`));
    } finally {
      submittingRef.current = false;
    }
  }

  if (result) {
    return (
      <div style={{ display: "grid", gap: space.md, justifyItems: "start" }}>
        <Text variant="body" dim>
          Invoice{" "}
          <Text variant="mono" color={colors.textHi}>
            {result.orderId}
          </Text>{" "}
          created. Show this QR to your customer:
        </Text>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={result.qr} alt="payment QR" width={220} height={220} style={{ borderRadius: radius.md, background: "#fff", padding: space.sm }} />
        <div style={{ wordBreak: "break-all" }}>
          <Text variant="mono" color={colors.text}>
            {result.payUrl}
          </Text>
        </div>
        <Link href={`/merchant/orders/${result.orderId}`}>
          <Text variant="bodyStrong" color={colors.accent}>
            Track this order →
          </Text>
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: space.md }}>
      <div style={{ display: "grid", gap: space.xs }}>
        <Text variant="label" muted upper>
          Amount (USDC)
        </Text>
        <input placeholder="0.00" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ display: "grid", gap: space.xs }}>
        <Text variant="label" muted upper>
          Reference
        </Text>
        <input placeholder="e.g. INV-1024" value={reference} onChange={(e) => setReference(e.target.value)} style={inputStyle} />
        <Text variant="caption" dim>
          Your own order/invoice number
        </Text>
      </div>
      <div style={{ display: "grid", gap: space.xs }}>
        <Text variant="label" muted upper>
          Expires in seconds
        </Text>
        <input placeholder="900" value={expiresInSec} onChange={(e) => setExpiresInSec(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ marginTop: space.sm }}>
        <Button label="Create invoice" loading={submitting} />
      </div>
      {error && (
        <Text variant="caption" color={colors.danger}>
          {error}
        </Text>
      )}
    </form>
  );
}
