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
