import { IsString, IsUUID, Matches, IsOptional } from 'class-validator';

export class DepositAuthorizationDto {
  @IsString()
  @Matches(/^\d+$/, { message: 'amountBase must be a positive integer string (6-decimal USDC base units)' })
  amountBase!: string;
}

export class DepositSubmitDto {
  @IsUUID()
  id!: string;

  @IsString()
  @Matches(/^0x[0-9a-fA-F]{130}$/, { message: 'signature must be a 65-byte hex string (0x + 130 hex chars)' })
  signature!: string;
}

export class RedeemPermitDto {
  /** 6-decimal navUSDC share units, or "all" to redeem entire balance */
  @IsString()
  @Matches(/^(\d+|all)$/, { message: 'sharesBase must be a positive integer string or "all"' })
  sharesBase!: string;
}

export class RedeemSubmitDto {
  @IsUUID()
  id!: string;

  @IsString()
  @Matches(/^0x[0-9a-fA-F]{130}$/, { message: 'signature must be a 65-byte hex string (0x + 130 hex chars)' })
  signature!: string;
}
