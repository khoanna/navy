import { Injectable, Logger, BadGatewayException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { NavyConfigService } from '../config/config.service';

export interface UploadedImage { url: string; publicId: string; }

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor(private readonly config: NavyConfigService) {
    cloudinary.config({
      cloud_name: this.config.cloudinaryCloudName,
      api_key: this.config.cloudinaryApiKey,
      api_secret: this.config.cloudinaryApiSecret,
      secure: true,
    });
  }

  /** Upload an image buffer to the navy/products folder. Throws 502 on failure. */
  async uploadImage(buffer: Buffer): Promise<UploadedImage> {
    try {
      const res = await new Promise<{ secure_url: string; public_id: string }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: 'navy/products', resource_type: 'image' },
          (err, result) => {
            if (err || !result) return reject(err ?? new Error('empty Cloudinary result'));
            resolve(result as { secure_url: string; public_id: string });
          },
        );
        stream.end(buffer);
      });
      return { url: res.secure_url, publicId: res.public_id };
    } catch (err) {
      this.logger.error(`Cloudinary upload failed: ${(err as Error).message}`);
      throw new BadGatewayException('Image upload failed');
    }
  }

  /** Best-effort delete of a previously uploaded asset. Never throws. */
  async deleteImage(publicId: string): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: 'image' });
    } catch (err) {
      this.logger.warn(`Cloudinary delete failed for ${publicId}: ${(err as Error).message}`);
    }
  }
}
