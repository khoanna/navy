// Framework-free client-side image validation. Mirrors be's product-image.validation.ts.
// Returns an error string, or null when the file is acceptable.
export const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB

export function validateImageFile(file: File): string | null {
  if (!ALLOWED_IMAGE_MIMES.includes(file.type as (typeof ALLOWED_IMAGE_MIMES)[number])) {
    return 'Image must be JPEG, PNG, or WebP';
  }
  if (file.size <= 0) return 'Image is empty';
  if (file.size > MAX_IMAGE_BYTES) return 'Image must be 5 MB or smaller';
  return null;
}
