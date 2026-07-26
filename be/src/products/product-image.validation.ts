// Framework-free image validation shared by the multipart fileFilter and the
// controller guard. No NestJS/multer imports so it stays unit-testable.
export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export type ImageValidation = { ok: true } | { ok: false; error: string };

/** Validate an uploaded image's mime type and byte size. */
export function validateProductImage(file: { mimetype: string; size: number }): ImageValidation {
  if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype as (typeof ALLOWED_IMAGE_MIMES)[number])) {
    return { ok: false, error: 'Image must be JPEG, PNG, or WebP' };
  }
  if (file.size <= 0) return { ok: false, error: 'Image is empty' };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: 'Image must be 5 MB or smaller' };
  return { ok: true };
}
