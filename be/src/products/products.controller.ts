import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ProductsService } from './products.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { parsePositiveAmount } from '../common/amount.util';

class CreateProductDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsOptional() sku?: string;
  @IsString() @Matches(/^\d+$/, { message: 'unitPrice must be a base-unit integer string' }) unitPrice!: string;
}
class UpdateProductDto {
  @IsString() @IsOptional() @IsNotEmpty() name?: string;
  @IsString() @IsOptional() sku?: string;
  @IsString() @IsOptional() @Matches(/^\d+$/, { message: 'unitPrice must be a base-unit integer string' }) unitPrice?: string;
  @IsBoolean() @IsOptional() active?: boolean;
}

@Controller('merchant/products')
@UseGuards(JwtGuard, RolesGuard)
@Roles('merchant')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  list(@Req() req: any) { return this.products.listForMerchant(req.user.sub); }

  @Post()
  create(@Req() req: any, @Body() dto: CreateProductDto) {
    return this.products.create(req.user.sub, { name: dto.name, sku: dto.sku ?? null, unitPrice: parsePositiveAmount(dto.unitPrice, 'unitPrice') });
  }

  @Patch(':id')
  update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(req.user.sub, id, {
      name: dto.name, sku: dto.sku,
      unitPrice: dto.unitPrice !== undefined ? parsePositiveAmount(dto.unitPrice, 'unitPrice') : undefined,
      active: dto.active,
    });
  }

  @Delete(':id')
  archive(@Req() req: any, @Param('id') id: string) { return this.products.archive(req.user.sub, id); }
}
