/**
 * Baseline types
 */
import type { VaultState } from '../replay/state.js';
import type { TimeOrderedSnapshot } from '../dataset.js';
import type { BaselineAction } from '../replay/replay.js';

export type BaselinePolicy = (
  state: VaultState,
  snapshot: TimeOrderedSnapshot,
  context?: unknown,
) => BaselineAction[];

export interface BaselineResult {
  id: string;
  name: string;
  description: string;
  deployable: boolean;
  realizedNetApy: number;
  totalTurnover: bigint;
  withdrawalSuccessRate: number;
}

export interface BaselineInfo {
  name: string;
  description: string;
  deployable: boolean;
}

export const BASELINE_INFO: Record<'b0' | 'b1' | 'b2' | 'b3' | 'b4' | 'b5', BaselineInfo> = {
  b0: { name: 'Idle', description: 'Hold USDC idle — no deployments', deployable: false },
  b1: { name: 'Highest Rate', description: 'Always deploy to highest displayed rate', deployable: true },
  b2: { name: 'Capacity-Aware', description: 'Deploy with capacity constraints, no uncertainty', deployable: true },
  b3: { name: 'Capacity + Cost', description: 'B2 with movement cost threshold', deployable: true },
  b4: { name: 'Fixed Robust', description: 'Frozen 40/40/20 allocation', deployable: true },
  b5: { name: 'Hindsight', description: 'Perfect foresight — non-deployable diagnostic', deployable: false },
};
