import { readFileSync } from 'fs';
import { join } from 'path';

const paper = readFileSync(
  join(process.cwd(), '../docs/research/output/srcla-paper.md'), 'utf8',
);

describe('paper v0.6', () => {
  it('declares version 0.6', () => {
    expect(paper).toMatch(/\*\*Research report version:\*\*\s*0\.6/);
  });

  it('carries an amendment record for v0.5 -> v0.6', () => {
    expect(paper).toContain('Amendment Record (v0.5 → v0.6)');
  });

  it('registers P9 through P12', () => {
    for (const id of ['P9', 'P10', 'P11', 'P12']) {
      expect(paper).toMatch(new RegExp(`\\|\\s*${id}\\s*\\|`));
    }
  });

  it('declares the SECOND burned window and names heldout-c as less burned', () => {
    expect(paper).toContain('2025-06-01');
    expect(paper).toContain('2026-02-28');
    expect(paper).toMatch(/less burned, not pristine/i);
  });

  it('states that CAPACITY-INFEASIBLE does not pass', () => {
    // P12 must not read as gate-softening.
    expect(paper).toMatch(/CAPACITY-INFEASIBLE/);
    expect(paper).toMatch(/does not verify and does not pass/i);
  });

  it('keeps the v0.4 -> v0.5 record rather than replacing it', () => {
    expect(paper).toContain('Amendment Record (v0.4 → v0.5)');
    expect(paper).toMatch(/\|\s*P1\s*\|/);
  });
});
