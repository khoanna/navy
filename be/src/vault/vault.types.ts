export interface TransactionProposal {
  to: string;
  data: string;
  value: string;
  chainId: number;
  description: string;
}

export interface VaultPositionDto {
  sharesBase: string;
  assetsBase: string;
  maxWithdrawBase: string;
  maxRedeemBase: string;
}

export interface VaultLimitsDto {
  maxDeposit: string;
  maxWithdraw: string;
  maxRedeem: string;
}

/** Shape returned to the expo client via GET /vault/harvests */
export interface HarvestRecordDto {
  id: string;
  adapter: string;
  protocol: string; // human-readable name derived from adapter address
  harvestedAt: string; // ISO timestamp
  grossBase: string;
  netBase: string;
  recipients: Array<{ address: string; shares: string }>;
}

export interface HarvestsResponseDto {
  harvests: HarvestRecordDto[];
  next?: string;
}

/** Vault reserve state from on-chain view functions */
export interface VaultReserveState {
  requiredIdle: string;       // max(adminReserve, dynamicReserve, activePlanReserve)
  adminReserve: string;        // absolute floor set by admin
  dynamicReserve: string;      // locked in after plan completion
  activePlanReserve: string;   // committed by active plan
  minIdleBps: number;         // 0.5% default, in basis points
}

/** Current plan status from on-chain */
export interface PlanStatus {
  activePlanId: string | null;
  planExpiresAt: string | null;
}

/** Aggregated rebalance status combining SRCLA decision + vault state */
export interface RebalanceStatusDto {
  latestDecision: {
    decisionHash: string;
    timestamp: string;
    policyVersion: string;
    reserveBase: string;
    allocation: unknown;
    actionDecision: {
      action: string;
      amount: string;
      targetAdapter: string | null;
      reason: string;
    };
  } | null;
  vaultReserve: VaultReserveState;
  planStatus: PlanStatus;
}
