/**
 * B0: Idle baseline — hold USDC without deploying
 */
import type { BaselinePolicy } from './types.js';

import { assertQuarantineOptIn } from '../guard.js';
assertQuarantineOptIn('evaluation/quarantined/baselines/policies.ts');

export const b0Policy: BaselinePolicy = () => {
  // B0 never deploys
  return [];
};
