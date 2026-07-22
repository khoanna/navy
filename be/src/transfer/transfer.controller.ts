import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { TransferService } from './transfer.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { parsePositiveAmount } from '../common/amount.util';

class BuildDto {
  @IsString() @IsNotEmpty() recipient!: string;
  @IsString() @Matches(/^\d+$/, { message: 'amountBase must be a base-unit integer string' }) amountBase!: string;
}
class SubmitDto {
  @IsString() @IsNotEmpty() transferId!: string;
  @IsString() @Matches(/^0x[0-9a-fA-F]{130}$/, { message: 'signature must be 65-byte hex' }) signature!: string;
}
class EthRecordDto {
  @IsString() @Matches(/^0x[0-9a-fA-F]{40}$/, { message: 'to must be a 0x address' }) to!: string;
  @IsString() @Matches(/^\d+$/, { message: 'amountWei must be an integer string' }) amountWei!: string;
  @IsString() @Matches(/^0x[0-9a-fA-F]{64}$/, { message: 'txHash must be a 0x 32-byte hash' }) txHash!: string;
}

@Controller('transfer')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class TransferController {
  constructor(private readonly transfers: TransferService) {}

  @Post('authorization')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  build(@Req() req: any, @Body() dto: BuildDto) {
    return this.transfers.buildAuthorization(req.user.sub, req.user.walletAddress, dto.recipient, parsePositiveAmount(dto.amountBase, 'amountBase'));
  }

  @Post('submit')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  submit(@Req() req: any, @Body() dto: SubmitDto) {
    return this.transfers.submit(req.user.sub, dto.transferId, dto.signature, req.user.walletAddress);
  }

  @Post('eth/record')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  recordEth(@Req() req: any, @Body() dto: EthRecordDto) {
    return this.transfers.recordEthSend(req.user.sub, req.user.walletAddress, dto.to, BigInt(dto.amountWei), dto.txHash);
  }

  @Get('resolve')
  @Throttle({ default: { ttl: 60000, limit: 40 } })
  resolve(@Query('recipient') recipient: string) {
    return this.transfers.resolve(recipient ?? '');
  }

  @Get('history')
  history(@Req() req: any) { return this.transfers.history(req.user.sub); }
}
