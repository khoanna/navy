import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class DepositAuthorizationDto {
  @IsString() @Matches(/^\d+$/, { message: 'amountBase must be a base-unit integer string' }) amountBase!: string;
}
export class SubmitDto {
  @IsString() @IsNotEmpty() id!: string;
  @IsString() @Matches(/^0x[0-9a-fA-F]{130}$/, { message: 'signature must be 65-byte hex' }) signature!: string;
}
export class RedeemPermitDto {
  @IsString() @Matches(/^\d+$/, { message: 'sharesBase must be a base-unit integer string' }) sharesBase!: string;
}
