import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { MerchantChargesService } from './merchant-charges.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

class CreateChargeDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsIn(['percent', 'fixed']) mode!: 'percent' | 'fixed';
  @IsInt() @Min(0) value!: number;
  @IsInt() @IsOptional() sortOrder?: number;
}
class UpdateChargeDto {
  @IsString() @IsOptional() @IsNotEmpty() name?: string;
  @IsIn(['percent', 'fixed']) @IsOptional() mode?: 'percent' | 'fixed';
  @IsInt() @Min(0) @IsOptional() value?: number;
  @IsBoolean() @IsOptional() active?: boolean;
  @IsInt() @IsOptional() sortOrder?: number;
}

@Controller('merchant/charges')
@UseGuards(JwtGuard, RolesGuard)
@Roles('merchant')
export class MerchantChargesController {
  constructor(private readonly charges: MerchantChargesService) {}

  @Get()
  list(@Req() req: any) { return this.charges.listForMerchant(req.user.sub); }

  @Post()
  create(@Req() req: any, @Body() dto: CreateChargeDto) { return this.charges.create(req.user.sub, dto); }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateChargeDto) { return this.charges.update(req.user.sub, id, dto); }

  @Delete(':id')
  remove(@Req() req: any, @Param('id') id: string) { return this.charges.remove(req.user.sub, id); }
}
