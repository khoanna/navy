import { IsString, Matches } from 'class-validator';

export class DepositDto {
  @IsString()
  @Matches(/^\d+$/, { message: 'assetsBase must be a base-unit integer string' })
  assetsBase!: string;
}

export class RedeemDto {
  @IsString()
  @Matches(/^\d+$/, { message: 'sharesBase must be a base-unit integer string' })
  sharesBase!: string;
}

export class WithdrawDto {
  @IsString()
  @Matches(/^\d+$/, { message: 'assetsBase must be a base-unit integer string' })
  assetsBase!: string;
}
