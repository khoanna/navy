// fe/src/lib/dashboard/status.ts
export type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';

const MAP: Record<string, { tone: PillTone; label: string }> = {
  paid: { tone: 'success', label: 'Paid' },
  approved: { tone: 'success', label: 'Approved' },
  awaiting_payment: { tone: 'warning', label: 'Awaiting payment' },
  pending: { tone: 'warning', label: 'Pending' },
  expired: { tone: 'danger', label: 'Expired' },
  rejected: { tone: 'danger', label: 'Rejected' },
  failed: { tone: 'danger', label: 'Failed' },
};

function titleCase(s: string): string {
  const words = s.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function statusTone(status: string): { tone: PillTone; label: string } {
  return MAP[status] ?? { tone: 'neutral', label: titleCase(status) };
}
