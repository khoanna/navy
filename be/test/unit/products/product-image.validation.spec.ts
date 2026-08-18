import {
  ALLOWED_IMAGE_MIMES,
  MAX_IMAGE_BYTES,
  validateProductImage,
} from '../../../src/products/product-image.validation';

describe('validateProductImage', () => {
  it('accepts a small jpeg', () => {
    expect(validateProductImage({ mimetype: 'image/jpeg', size: 1024 })).toEqual({ ok: true });
  });

  it('accepts png and webp', () => {
    expect(validateProductImage({ mimetype: 'image/png', size: 1 }).ok).toBe(true);
    expect(validateProductImage({ mimetype: 'image/webp', size: 1 }).ok).toBe(true);
  });

  it('rejects a disallowed mime type', () => {
    const r = validateProductImage({ mimetype: 'image/gif', size: 1024 });
    expect(r).toEqual({ ok: false, error: 'Image must be JPEG, PNG, or WebP' });
  });

  it('rejects a file over the size limit', () => {
    const r = validateProductImage({ mimetype: 'image/jpeg', size: MAX_IMAGE_BYTES + 1 });
    expect(r).toEqual({ ok: false, error: 'Image must be 5 MB or smaller' });
  });

  it('rejects an empty file', () => {
    const r = validateProductImage({ mimetype: 'image/jpeg', size: 0 });
    expect(r).toEqual({ ok: false, error: 'Image is empty' });
  });

  it('exposes the allowed mimes and max size constants', () => {
    expect(ALLOWED_IMAGE_MIMES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});
