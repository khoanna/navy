/**
 * B0: Idle baseline — hold USDC without deploying
 */
import type { BaselinePolicy } from './types.js';

export const b0Policy: BaselinePolicy = () => {
  // B0 never deploys
  return [];
};
