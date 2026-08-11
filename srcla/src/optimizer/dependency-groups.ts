/**
 * Dependency Groups - manages allocation caps for groups of adapters
 *
 * Groups represent constraints where multiple adapters share a combined cap.
 * For example, Aave and Compound might share a "blue-chip" group cap of 50%.
 */

export interface DependencyGroup {
  id: string;
  capBps: bigint;
  adapters: string[];
}

export class DependencyGroups {
  private groups: Map<string, DependencyGroup> = new Map();
  private adapterGroups: Map<string, Set<string>> = new Map();

  constructor(groups: DependencyGroup[]) {
    for (const group of groups) {
      this.groups.set(group.id, group);

      for (const adapter of group.adapters) {
        if (!this.adapterGroups.has(adapter)) {
          this.adapterGroups.set(adapter, new Set());
        }
        this.adapterGroups.get(adapter)!.add(group.id);
      }
    }
  }

  /**
   * Get group caps applicable for a specific adapter
   * @param adapter - The adapter address to query
   * @returns Map of groupId -> capBps for all groups this adapter belongs to
   */
  getGroupCapsForAdapter(adapter: string): Map<string, bigint> {
    const groupIds = this.adapterGroups.get(adapter);
    const caps = new Map<string, bigint>();

    if (!groupIds) return caps;

    for (const id of groupIds) {
      const group = this.groups.get(id);
      if (group) {
        caps.set(id, group.capBps);
      }
    }

    return caps;
  }

  /**
   * Get all groups
   */
  getGroups(): Map<string, DependencyGroup> {
    return new Map(this.groups);
  }

  /**
   * Get adapters belonging to a specific group
   */
  getAdaptersInGroup(groupId: string): string[] {
    const group = this.groups.get(groupId);
    return group ? [...group.adapters] : [];
  }

  /**
   * Validate that allocations don't exceed group caps
   * @param allocations - Map of adapter address -> allocation bps
   * @returns Array of violation messages (empty if valid)
   */
  validateAllocation(allocations: Map<string, bigint>): string[] {
    const violations: string[] = [];

    for (const [groupId, group] of this.groups) {
      let total = 0n;
      for (const adapter of group.adapters) {
        total += allocations.get(adapter) ?? 0n;
      }
      if (total > group.capBps) {
        violations.push(
          `Group ${groupId} cap exceeded: ${total} > ${group.capBps} bps`
        );
      }
    }

    return violations;
  }

  /**
   * Check if a specific allocation would violate any group cap
   */
  wouldViolateGroupCap(
    groupId: string,
    currentTotal: bigint,
    proposedAllocation: bigint
  ): boolean {
    const group = this.groups.get(groupId);
    if (!group) return false;
    return currentTotal + proposedAllocation > group.capBps;
  }

  /**
   * Get the maximum additional allocation an adapter can receive from a group
   */
  getGroupHeadroom(groupId: string, currentTotal: bigint): bigint {
    const group = this.groups.get(groupId);
    if (!group) return 0n;
    return group.capBps > currentTotal ? group.capBps - currentTotal : 0n;
  }
}
