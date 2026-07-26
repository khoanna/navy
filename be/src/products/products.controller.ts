import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req,
  UploadedFile, UseFilters, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { MulterExceptionFilter } from './multer-exception.filter';
import { FileInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { parsePositiveAmount } from '../common/amount.util';
import { validateProductImage, MAX_IMAGE_BYTES } from './product-image.validation';

class CreateProductDto {
  @IsString() @IsNotEmpty() name!: string;
  @IsString() @IsOptional() sku?: string;
  @IsString() @Matches(/^\d+$/, { message: 'unitPrice must be a base-unit integer string' }) unitPrice!: string;
}
class UpdateProductDto {
  @IsString() @IsOptional() @IsNotEmpty() name?: string;
  @IsString() @IsOptional() sku?: string;
  @IsString() @IsOptional() @Matches(/^\d+$/, { message: 'unitPrice must be a base-unit integer string' }) unitPrice?: string;
  // NOTE: `active` is not settable via this multipart endpoint — archive/activate goes through DELETE.
  @IsBoolean() @IsOptional() active?: boolean;
}

// Reject unsupported types early at the multer layer; size is capped via limits below.
const fileInterceptor = FileInterceptor('image', {
  limits: { fileSize: MAX_IMAGE_BYTES },
  fileFilter: (_req, file, cb) => {
    const r = validateProductImage({ mimetype: file.mimetype, size: 1 /* real size unknown at filter time; limits.fileSize enforces the cap */ });
    cb(r.ok ? null : new BadRequestException(r.error), r.ok);
  },
});

@Controller('merchant/products')
@UseGuards(JwtGuard, RolesGuard)
@Roles('merchant')
@UseFilters(MulterExceptionFilter)
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  @Get()
  list(@Req() req: any) { return this.products.listForMerchant(req.user.sub); }

  @Post()
  @UseInterceptors(fileInterceptor)
  async create(@Req() req: any, @Body() dto: CreateProductDto, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Product image is required');
    const check = validateProductImage({ mimetype: file.mimetype, size: file.size });
    if (!check.ok) throw new BadRequestException(check.error);
    const { url, publicId } = await this.cloudinary.uploadImage(file.buffer);
    return this.products.create(req.user.sub, {
      name: dto.name, sku: dto.sku ?? null, unitPrice: parsePositiveAmount(dto.unitPrice, 'unitPrice'),
      imageUrl: url, imagePublicId: publicId,
    });
  }

  @Patch(':id')
  @UseInterceptors(fileInterceptor)
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdateProductDto, @UploadedFile() file?: Express.Multer.File) {
    let imageUrl: string | undefined;
    let imagePublicId: string | undefined;
    let uploadedPublicId: string | undefined;
    if (file) {
      const check = validateProductImage({ mimetype: file.mimetype, size: file.size });
      if (!check.ok) throw new BadRequestException(check.error);
      const uploaded = await this.cloudinary.uploadImage(file.buffer);
      imageUrl = uploaded.url;
      imagePublicId = uploaded.publicId;
      uploadedPublicId = uploaded.publicId;
    }
    let product: any;
    let replacedPublicId: string | null;
    try {
      ({ product, replacedPublicId } = await this.products.update(req.user.sub, id, {
        name: dto.name, sku: dto.sku,
        unitPrice: dto.unitPrice !== undefined ? parsePositiveAmount(dto.unitPrice, 'unitPrice') : undefined,
        active: dto.active, imageUrl, imagePublicId,
      }));
    } catch (err) {
      if (uploadedPublicId) await this.cloudinary.deleteImage(uploadedPublicId);
      throw err;
    }
    if (replacedPublicId) await this.cloudinary.deleteImage(replacedPublicId);
    return product;
  }

  @Delete(':id')
  archive(@Req() req: any, @Param('id') id: string) { return this.products.archive(req.user.sub, id); }
}
