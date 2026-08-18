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
