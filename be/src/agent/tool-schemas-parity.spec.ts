import { TOOLS } from './tool-schemas';
import { TOOLS_LEGACY } from './tool-schemas-legacy';

describe('tool-schemas refactor parity', () => {
  it('assembles byte-for-byte identical tool schemas', () => {
    expect(JSON.stringify(TOOLS)).toBe(JSON.stringify(TOOLS_LEGACY));
  });
});
