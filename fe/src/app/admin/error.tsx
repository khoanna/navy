'use client';
import { ErrorState } from '@/ui/ErrorState';
import { mapError } from '@/lib/mapError';

// Next 16 renamed the recovery prop `reset` → `unstable_retry` (see
// node_modules/next/dist/docs/.../error.md).
export default function SegmentError({ error, unstable_retry }: { error: Error; unstable_retry: () => void }) {
  return (
    <div style={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
      <ErrorState error={mapError(error)} onRetry={unstable_retry} />
    </div>
  );
}
