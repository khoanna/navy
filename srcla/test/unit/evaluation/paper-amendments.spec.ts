import { readFileSync } from 'fs';
import { join } from 'path';

const paper = readFileSync(
  join(process.cwd(), '../docs/research/output/srcla-paper.md'), 'utf8',
);

describe('paper v0.10', () => {
  it('declares version 0.10', () => {
    expect(paper).toMatch(/\*\*Research report version:\*\*\s*0\.10/);
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

describe('paper v0.8 -> v0.10 amendments', () => {
  it('carries amendment records for v0.6 -> v0.7 and v0.7 -> v0.8', () => {
    expect(paper).toContain('Amendment Record (v0.6 → v0.7)');
    expect(paper).toContain('Amendment Record (v0.7 → v0.8)');
    expect(paper).toContain('Amendment Record (v0.8 → v0.9)');
  });

  it('registers P13 through P32', () => {
    for (const id of [
      'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P20',
      'P21', 'P22', 'P23', 'P24', 'P25', 'P26', 'P27', 'P28',
      'P29', 'P30', 'P31', 'P32',
    ]) {
      expect(paper).toMatch(new RegExp('\\|\\s*' + id + '\\s*\\|'));
    }
  });

  it('declares the THIRD burned window', () => {
    expect(paper).toMatch(/Third burned-window declaration/);
  });

  it('requires demonstration rather than allowing a pass by inaction', () => {
    expect(paper).toMatch(/NOT DEMONSTRATED/);
  });

  it('states sustainability as the primary release criterion', () => {
    expect(paper).toMatch(/Sustainability is the primary release criterion/i);
  });

  it('states the yield criterion as non-inferiority, not superiority', () => {
    expect(paper).toMatch(/non-inferior/i);
  });

  it('carries the v0.9 -> v0.10 record and registers P36', () => {
    expect(paper).toContain('Amendment Record (v0.9 → v0.10)');
    expect(paper).toMatch(/\|\s*P36\s*\|/);
  });
});
