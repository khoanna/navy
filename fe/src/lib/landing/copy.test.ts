import { mediaAlignFor, PRODUCT_MOCKS } from './copy';

describe('mediaAlignFor', () => {
  it('places media on the edge opposite the copy', () => {
    expect(mediaAlignFor('sail')).toBe('right'); // copy left
    expect(mediaAlignFor('port')).toBe('left'); // copy right
    expect(mediaAlignFor('sea')).toBe('right');
    expect(mediaAlignFor('treasure')).toBe('left');
  });
});

describe('PRODUCT_MOCKS', () => {
  it('has an entry for each of the four story beats', () => {
    expect(Object.keys(PRODUCT_MOCKS).sort()).toEqual(['port', 'sail', 'sea', 'treasure']);
  });
});
