import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminMerchantsService } from './admin-merchants.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsOptional, IsString } from 'class-validator';
import { toMerchantDto } from '../common/serialize';
import { parsePageSize, parseOffset } from '../common/amount.util';

class RejectDto {
  @IsOptional() @IsString() reason?: string;
}

@Controller('admin/merchants')
@UseGuards(JwtGuard, RolesGuard)
@Roles('admin')
export class AdminMerchantsController {
  constructor(private readonly merchants: AdminMerchantsService) {}

  @Get()
  async list(@Query('status') status = 'pending', @Query('take') take?: string, @Query('skip') skip?: string) {
    const merchants = await this.merchants.list(status, parsePageSize(take), parseOffset(skip));
    return toMerchantDto(merchants);
  }

  @Get(':id')
  async get(@Param('id') id: string) { return toMerchantDto(await this.merchants.get(id)); }

  @Post(':id/approve')
  async approve(@Param('id') id: string) { return toMerchantDto(await this.merchants.approve(id)); }

  @Post(':id/reject')
  async reject(@Param('id') id: string, @Body() dto: RejectDto) { return toMerchantDto(await this.merchants.reject(id, dto.reason)); }
}
