import type { SceneCopyItem } from '@/lib/landing/copy';
import { WalletCard } from './WalletCard';
import { CheckoutSheet } from './CheckoutSheet';
import { SettlementReceipt } from './SettlementReceipt';
import { YieldWidget } from './YieldWidget';

/** Maps a story-beat id to its product mock. Returns null for the ecosystem /
 *  finale beats, which keep their existing (mock-free) treatment. */
export function ProductMock({ id }: { id: SceneCopyItem['id'] }) {
  switch (id) {
    case 'sail':
      return <WalletCard />;
    case 'port':
      return <CheckoutSheet />;
    case 'sea':
      return <SettlementReceipt />;
    case 'treasure':
      return <YieldWidget />;
    default:
      return null;
  }
}
