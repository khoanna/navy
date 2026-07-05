// be/src/admin-merchants/admin-stats.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminStatsService } from './admin-stats.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('admin/stats')
@UseGuards(JwtGuard, RolesGuard)
@Roles('admin')
export class AdminStatsController {
  constructor(private readonly stats: AdminStatsService) {}

  @Get()
  platform() {
    return this.stats.platform();
  }
}
