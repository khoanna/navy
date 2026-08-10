/**
 * B5: Hindsight (Diagnostic Only) baseline
 *
 * Perfect foresight — uses future rates.
 * NON-DEPLOYABLE — for diagnostic comparison only.
 */
import type { BaselinePolicy } from './types.js';

export const b5Policy: BaselinePolicy = () => {
  // B5 never actually deploys — it's diagnostic only
  return [];
};
