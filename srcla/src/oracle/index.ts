/**
 * Oracle module.
 *
 * `reward-valuation.ts` was deleted: it duplicated
 * `policy/steps/reward-admission.ts#recognizedRewardValueBase` (price a
 * reward amount into USDC through a feed) more weakly — it returned a value
 * carrying an `isStale` flag, where §9.2 requires that "a stale or invalid
 * source cannot increase NAV", i.e. that the recognised value be exactly
 * zero. Its caching layer is not §9.2's lazy refresh either: that clause
 * ("share-changing and allocator transactions refresh material reward values
 * lazily") is explicitly on-chain, in the RewardAccountant.
 *
 * `twap-oracle.ts` is kept. See its header.
 */
export * from './twap-oracle.js';
