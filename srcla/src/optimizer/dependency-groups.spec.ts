import { describe, it, expect } from '@jest/globals';
import {
  DependencyGroups,
  DependencyGroup,
} from './dependency-groups';

const AAVE_ADDR = '0x0000000000000000000000000000000000000A11';
const COMPOUND_ADDR = '0x0000000000000000000000000000000000000C01';
const MOONWELL_ADDR = '0x0000000000000000000000000000000000000M01';

describe('DependencyGroups', () => {
  describe('getGroupCapsForAdapter', () => {
    it('should return group caps for adapter in one group', () => {
      const groups: DependencyGroup[] = [
        {
          id: 'blue-chip',
          capBps: 5000n,
          adapters: [AAVE_ADDR, COMPOUND_ADDR],
        },
      ];
      const dg = new DependencyGroups(groups);

      const caps = dg.getGroupCapsForAdapter(AAVE_ADDR);

      expect(caps.get('blue-chip')).toBe(5000n);
    });

    it('should return group caps for adapter in multiple groups', () => {
      const groups: DependencyGroup[] = [
        {
          id: 'blue-chip',
          capBps: 5000n,
          adapters: [AAVE_ADDR, COMPOUND_ADDR],
        },
        {
          id: 'compound-ecosystem',
          capBps: 6000n,
          adapters: [COMPOUND_ADDR, MOONWELL_ADDR],
        },
      ];
      const dg = new DependencyGroups(groups);

      const caps = dg.getGroupCapsForAdapter(COMPOUND_ADDR);

      expect(caps.get('blue-chip')).toBe(5000n);
      expect(caps.get('compound-ecosystem')).toBe(6000n);
    });

    it('should return empty map for adapter not in any group', () => {
      const groups: DependencyGroup[] = [
        {
          id: 'blue-chip',
          capBps: 5000n,
          adapters: [AAVE_ADDR, COMPOUND_ADDR],
        },
      ];
      const dg = new DependencyGroups(groups);

      const caps = dg.getGroupCapsForAdapter('0x0000000000000000000000000000000000000000');

      expect(caps.size).toBe(0);
    });

    it('should handle empty groups array', () => {
      const dg = new DependencyGroups([]);

      const caps = dg.getGroupCapsForAdapter(AAVE_ADDR);

      expect(caps.size).toBe(0);
    });
  });

  describe('getGroups', () => {
    it('should return all groups', () => {
      const groups: DependencyGroup[] = [
        { id: 'group1', capBps: 1000n, adapters: [AAVE_ADDR] },
        { id: 'group2', capBps: 2000n, adapters: [COMPOUND_ADDR] },
      ];
      const dg = new DependencyGroups(groups);

      const allGroups = dg.getGroups();

      expect(allGroups.size).toBe(2);
      expect(allGroups.get('group1')?.capBps).toBe(1000n);
      expect(allGroups.get('group2')?.capBps).toBe(2000n);
    });
  });

  describe('getAdaptersInGroup', () => {
    it('should return adapters in a group', () => {
      const groups: DependencyGroup[] = [
        {
          id: 'blue-chip',
          capBps: 5000n,
          adapters: [AAVE_ADDR, COMPOUND_ADDR],
        },
      ];
      const dg = new DependencyGroups(groups);

      const adapters = dg.getAdaptersInGroup('blue-chip');

      expect(adapters).toContain(AAVE_ADDR);
      expect(adapters).toContain(COMPOUND_ADDR);
      expect(adapters.length).toBe(2);
    });

    it('should return empty array for non-existent group', () => {
      const dg = new DependencyGroups([]);

      const adapters = dg.getAdaptersInGroup('non-existent');

      expect(adapters.length).toBe(0);
    });
  });

  describe('validateAllocation', () => {
    it('should return no violations for valid allocations', () => {
      const groups: DependencyGroup[] = [
        {
          id: 'blue-chip',
          capBps: 5000n,
          adapters: [AAVE_ADDR, COMPOUND_ADDR],
        },
      ];
      const dg = new DependencyGroups(groups);

      const allocations = new Map<string, bigint>([
        [AAVE_ADDR, 3000n],
        [COMPOUND_ADDR, 2000n],
      ]);

      const violations = dg.validateAllocation(allocations);

      expect(violations.length).toBe(0);
    });

    it('should detect violations when group cap exceeded', () => {
      const groups: DependencyGroup[] = [
        {
          id: 'blue-chip',
          capBps: 5000n,
          adapters: [AAVE_ADDR, COMPOUND_ADDR],
        },
      ];
      const dg = new DependencyGroups(groups);

      const allocations = new Map<string, bigint>([
        [AAVE_ADDR, 3000n],
        [COMPOUND_ADDR, 3000n],
      ]);

      const violations = dg.validateAllocation(allocations);

      expect(violations.length).toBe(1);
      expect(violations[0]).toContain('blue-chip');
      expect(violations[0]).toContain('6000');
      expect(violations[0]).toContain('5000');
    });

    it('should detect violations across multiple groups', () => {
      const groups: DependencyGroup[] = [
        {
          id: 'blue-chip',
          capBps: 5000n,
          adapters: [AAVE_ADDR, COMPOUND_ADDR],
        },
        {
          id: 'compound-ecosystem',
          capBps: 4000n,
          adapters: [COMPOUND_ADDR, MOONWELL_ADDR],
        },
      ];
      const dg = new DependencyGroups(groups);

      const allocations = new Map<string, bigint>([
        [AAVE_ADDR, 3000n],
        [COMPOUND_ADDR, 3000n],
        [MOONWELL_ADDR, 2000n],
      ]);

      const violations = dg.validateAllocation(allocations);

      expect(violations.length).toBe(2);
    });

    it('should handle missing adapters in allocations', () => {
      const groups: DependencyGroup[] = [
        {
          id: 'blue-chip',
          capBps: 5000n,
          adapters: [AAVE_ADDR, COMPOUND_ADDR],
        },
      ];
      const dg = new DependencyGroups(groups);

      const allocations = new Map<string, bigint>([
        [AAVE_ADDR, 2000n],
        // COMPOUND_ADDR not in allocations
      ]);

      const violations = dg.validateAllocation(allocations);

      expect(violations.length).toBe(0);
    });
  });

  describe('wouldViolateGroupCap', () => {
    it('should return false when allocation would not violate', () => {
      const groups: DependencyGroup[] = [
        { id: 'group1', capBps: 5000n, adapters: [AAVE_ADDR] },
      ];
      const dg = new DependencyGroups(groups);

      const wouldViolate = dg.wouldViolateGroupCap('group1', 3000n, 1000n);

      expect(wouldViolate).toBe(false);
    });

    it('should return true when allocation would violate', () => {
      const groups: DependencyGroup[] = [
        { id: 'group1', capBps: 5000n, adapters: [AAVE_ADDR] },
      ];
      const dg = new DependencyGroups(groups);

      const wouldViolate = dg.wouldViolateGroupCap('group1', 3000n, 3000n);

      expect(wouldViolate).toBe(true);
    });

    it('should return false for non-existent group', () => {
      const dg = new DependencyGroups([]);

      const wouldViolate = dg.wouldViolateGroupCap('non-existent', 0n, 1000n);

      expect(wouldViolate).toBe(false);
    });
  });

  describe('getGroupHeadroom', () => {
    it('should return remaining headroom', () => {
      const groups: DependencyGroup[] = [
        { id: 'group1', capBps: 5000n, adapters: [AAVE_ADDR] },
      ];
      const dg = new DependencyGroups(groups);

      const headroom = dg.getGroupHeadroom('group1', 3000n);

      expect(headroom).toBe(2000n);
    });

    it('should return 0 when at or above cap', () => {
      const groups: DependencyGroup[] = [
        { id: 'group1', capBps: 5000n, adapters: [AAVE_ADDR] },
      ];
      const dg = new DependencyGroups(groups);

      const headroom = dg.getGroupHeadroom('group1', 5000n);

      expect(headroom).toBe(0n);
    });

    it('should return 0 for non-existent group', () => {
      const dg = new DependencyGroups([]);

      const headroom = dg.getGroupHeadroom('non-existent', 0n);

      expect(headroom).toBe(0n);
    });
  });
});
