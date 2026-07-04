import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminMerchantsService } from './admin-merchants.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsOptional, IsString } from 'class-validator';

class RejectDto {
  @IsOptional() @IsString() reason?: string;
}

@Controller('admin/merchants')
@UseGuards(JwtGuard, RolesGuard)
@Roles('admin')
export class AdminMerchantsController {
  constructor(private readonly merchants: AdminMerchantsService) {}

  @Get()
  list(@Query('status') status = 'pending', @Query('take') take = '50', @Query('skip') skip = '0') {
    return this.merchants.list(status, parseInt(take, 10), parseInt(skip, 10));
  }

  @Get(':id')
  get(@Param('id') id: string) { return this.merchants.get(id); }

  @Post(':id/approve')
  approve(@Param('id') id: string) { return this.merchants.approve(id); }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectDto) { return this.merchants.reject(id, dto.reason); }
}
