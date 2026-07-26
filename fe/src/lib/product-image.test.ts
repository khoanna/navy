import { validateImageFile, MAX_IMAGE_BYTES, ALLOWED_IMAGE_MIMES } from './product-image';

const fakeFile = (type: string, size: number): File =>
  ({ type, size, name: 'x' } as unknown as File);

describe('validateImageFile', () => {
  it('accepts a small jpeg/png/webp', () => {
    expect(validateImageFile(fakeFile('image/jpeg', 1024))).toBeNull();
    expect(validateImageFile(fakeFile('image/png', 1024))).toBeNull();
    expect(validateImageFile(fakeFile('image/webp', 1024))).toBeNull();
  });

  it('rejects a disallowed type', () => {
    expect(validateImageFile(fakeFile('image/gif', 1024))).toBe('Image must be JPEG, PNG, or WebP');
  });

  it('rejects a file over 5 MB', () => {
    expect(validateImageFile(fakeFile('image/jpeg', MAX_IMAGE_BYTES + 1))).toBe('Image must be 5 MB or smaller');
  });

  it('rejects an empty file', () => {
    expect(validateImageFile(fakeFile('image/jpeg', 0))).toBe('Image is empty');
  });

  it('exposes constants matching the backend', () => {
    expect(ALLOWED_IMAGE_MIMES).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(MAX_IMAGE_BYTES).toBe(5 * 1024 * 1024);
  });
});
