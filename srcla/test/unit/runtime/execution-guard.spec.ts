/**
 * Task 13, Finding 1: assertExecutionAllowed is the sanctioned gate any
 * future executor-calling code (Task 14's KeeperExecutor wiring included)
 * must pass through before handing a produced plan to an executor.
 */
import { assertExecutionAllowed, ExecutionBlockedError } from '../../../src/runtime/decision-driver.js';

describe('assertExecutionAllowed', () => {
  it('throws ExecutionBlockedError naming the placeholder fields when placeholderPricesInUse is true', () => {
    expect(() =>
      assertExecutionAllowed({ placeholderPricesInUse: true, placeholderPriceFields: ['ethUsdE8', 'l1BaseFeeWei'] })
    ).toThrow(ExecutionBlockedError);

    try {
      assertExecutionAllowed({ placeholderPricesInUse: true, placeholderPriceFields: ['ethUsdE8', 'l1BaseFeeWei'] });
      throw new Error('expected assertExecutionAllowed to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionBlockedError);
      const blocked = error as ExecutionBlockedError;
      expect(blocked.placeholderPriceFields).toEqual(['ethUsdE8', 'l1BaseFeeWei']);
      expect(blocked.message).toContain('ethUsdE8');
      expect(blocked.message).toContain('l1BaseFeeWei');
      expect(blocked.message.toLowerCase()).toContain('execution blocked');
    }
  });

  it('does not throw when placeholderPricesInUse is false', () => {
    expect(() =>
      assertExecutionAllowed({ placeholderPricesInUse: false, placeholderPriceFields: [] })
    ).not.toThrow();
  });
});
