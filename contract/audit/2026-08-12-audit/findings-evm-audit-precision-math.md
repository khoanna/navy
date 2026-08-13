# Precision and Math Re-audit Findings

> **Current reconciliation — 2026-08-13:** Historical descriptions below refer to the vulnerable 2026-08-12 audit baseline. The living release decision is in `../AUDIT-REPORT.md`.

| ID | Current status | Reconciliation |
|---|---|---|
| MATH-1 | Fixed | OpenZeppelin additive virtual accounting and six-decimal share offset replace conditional virtual values. |
| MATH-2 | Fixed | All ERC-4626 conversion paths honor their required rounding direction. |
| MATH-3 | Fixed | Realized reward tokens already in idle USDC are not added to NAV a second time. |
| MATH-4 | Fixed | Moonwell exchange-rate conversion uses its 1e18 mantissa and is checked against deployed market behavior. |
| MATH-5 | Fixed | Aave annualized ray is converted to WAD by dividing by 1e9. |
| MATH-6 | Partially fixed | Expected output, decimal normalization, route minimum, and actual impact are enforced; feed denomination is still governed configuration. |
| MATH-7 | Fixed | Daily cap uses enforced oracle-derived minimum before execution and actual output after execution. |
| MATH-8 | Fixed | Divest resynchronizes actual adapter assets and loss telemetry no longer adjusts NAV. |
| MATH-9 | Accepted risk pending owner sign-off | Fee flooring favors merchants by less than one USDC base unit per invoice. Keep only if documented business policy and backend reconciliation match. |

**Audit date**: 2026-08-12  
**Scope**: current working tree, including uncommitted changes, with emphasis on `NavyVaultSRCLA`, `VaultMath`, adapter accounting/rates/liquidity, `RewardExecutor`, and `NavyPayments`.  
**Severity model**: Critical = direct unprivileged theft or permanent loss; High = realistic fund loss/freeze or pool-wide liveness failure; Medium = conditional loss, silent accounting corruption, or a meaningful safety gap; Low = limited impact or unlikely conditions; Info = hygiene/documentation without direct security impact.

## [MATH-1] The conditional virtual offset leaves the vault open to first-depositor donation theft
**Severity**: Critical
**Category**: evm-audit-precision-math
**Location**: `VaultMath.convertToShares()`
**Description**: The purported virtual offset is applied only while a total is exactly zero: `adjustedTotalAssets = totalAssets == 0 ? 1e18 : totalAssets` and likewise for shares. After the first deposit both offsets disappear. This is not OpenZeppelin 5.0's additive construction, which always converts with `(totalSupply + 10 ** _decimalsOffset()) / (totalAssets + 1)`. The vault also has zero decimals offset, so both the USDC asset and shares use 6 decimals; the library's `1e18` constants do not create a persistent twelve-decimal share offset. A first depositor can therefore donate assets, make a victim's deposit round to zero shares, and redeem the donation plus the victim's assets.
**Proof of Concept**: Start empty. An attacker deposits `1` USDC base unit and receives `1` share because `1 * 1e18 / 1e18 = 1`. The attacker directly transfers `1,000,000` base units (1 USDC) to the vault. Totals are now `totalAssets = 1,000,001` and `totalSupply = 1`, so a victim depositing `500,000` base units receives `floor(500,000 * 1 / 1,000,001) = 0` shares. The attacker then redeems the sole share for all `1,500,001` base units, taking the victim's 0.5 USDC. `ERC4626._deposit()` does not reject a zero-share deposit.
**Recommendation**: Remove the custom conditional-offset conversions and use OpenZeppelin 5.0's `_convertToShares`/`_convertToAssets`, or reproduce its offsets exactly and preserve the `rounding` argument. If stronger donation resistance is desired for 6-decimal USDC, override `_decimalsOffset()` with a deliberate nonzero offset and test the resulting share decimals. Also reject deposits that would mint zero shares as defense in depth.

## [MATH-2] Ignoring ERC-4626 rounding directions permits asset withdrawals without burning shares
**Severity**: Critical
**Category**: evm-audit-precision-math
**Location**: `NavyVaultSRCLA._convertToShares()` and `NavyVaultSRCLA._convertToAssets()`
**Description**: Both overrides discard the `Math.Rounding` argument. `_convertToShares()` always floors, while `_convertToAssets()` always ceils. OpenZeppelin 5.0 requires `convertToShares`/`previewDeposit` to floor, `previewMint` to ceil, `previewWithdraw` to ceil, and `convertToAssets`/`previewRedeem` to floor. Consequently `withdraw()` can burn zero shares for a positive asset withdrawal whenever one asset base unit is worth less than one share base unit, and `redeem()` can pay one asset unit too much. The old report's HIGH-9/HIGH-10 diagnosis remains valid in the current working tree; changing the hardcoded modes without forwarding the caller's direction did not fix it.
**Proof of Concept**: Let the vault have `100` asset base units and `2` shares, held one each by Alice and Bob. For `withdraw(1, Alice, Alice)`, OpenZeppelin asks `_convertToShares(1, Ceil)`, so the correct burn is `ceil(1 * 2 / 100) = 1` share. Navy ignores `Ceil` and returns `floor(2 / 100) = 0`. Alice can repeat one-unit withdrawals while assets exceed two, taking `98` units without reducing her one-share balance; each call remains below her positive `maxWithdraw`. Separately, at `totalAssets = 3`, `totalSupply = 2`, `previewRedeem(1)` must return `floor(3 / 2) = 1`, but Navy returns `ceil(3 / 2) = 2`, giving the first redeemer the rounding remainder.
**Recommendation**: Accept and forward the requested rounding direction through `VaultMath`, preferably by using OpenZeppelin's `Math.mulDiv(x, y, denominator, rounding)`. Add conformance tests for all six conversions/previews and tests in which asset-per-share is both above and below one. In particular, assert that every positive successful `withdraw` burns a positive number of shares.

## [MATH-3] Harvested USDC is counted twice and can transfer later depositors' principal to existing holders
**Severity**: High
**Category**: evm-audit-precision-math
**Location**: `NavyVaultSRCLA._harvestCore()`
**Description**: `RewardExecutor.swap()` transfers its USDC output to the vault, which immediately increases the idle USDC included by `totalAssets()`. `_harvestCore()` then adds the same amount to `recognizedRewards`, and `totalAssets()` adds that accumulator again. `recognizedRewards` is cumulative and is never consumed or reconciled. NAV is therefore overstated by every harvested USDC unit, causing later depositors to receive too few shares and allowing older shareholders to redeem against the new deposits that make the fictitious NAV liquid.
**Proof of Concept**: Begin with 100 actual USDC and 100 shares. A harvest returns 10 USDC to the vault. Actual assets are 110, but reported assets are `110 idle + 10 recognizedRewards = 120`. A victim deposits 120 USDC and receives `120 * 100 / 120 = 100` shares; actual assets become 230 while reported NAV becomes 240. The original holder can redeem 100 shares for 120 USDC. They entered with a 100-USDC claim and harvested only 10 USDC, yet exit with 120 USDC: 10 USDC came from the victim. The victim's remaining 100 shares are reported as worth 120 USDC while only 110 USDC remains.
**Recommendation**: Do not add already-realized USDC to a separate NAV accumulator. Count realized rewards solely through the vault's asset balance. If `recognizedRewards` is needed for reporting, exclude it from `totalAssets()` or maintain it as a non-accounting cumulative metric. Add an invariant that `totalAssets()` equals idle USDC plus current recognized adapter positions minus unreconciled losses, with no asset represented twice.

## [MATH-4] Moonwell position conversion uses the wrong exchange-rate denominator and inflates NAV by 10 billion times
**Severity**: High
**Category**: evm-audit-precision-math
**Location**: `MoonwellAdapter.totalAssets()` and `MoonwellAdapter.maxWithdrawable()`
**Description**: Moonwell's `exchangeRateStored()` is a Compound-style exchange-rate mantissa scaled by `1e18`, even though mUSDC itself has 8 decimals. The adapter divides `mTokenBalance * exchangeRate` by `1e8`. The 8-decimal token precision is already present in `mTokenBalance`; using it again as the denominator overstates the USDC position by `1e10`. The deployed Base mUSDC constructor's initial exchange-rate mantissa is `200000000000000`, consistent with the `1e18` divisor and an initial 0.02 USDC per whole mUSDC.
**Proof of Concept**: A position of 50 whole mUSDC is `5,000,000,000` mUSDC base units. At exchange rate `2e14`, its underlying value is `5e9 * 2e14 / 1e18 = 1,000,000` USDC base units (1 USDC). The implementation returns `5e9 * 2e14 / 1e8 = 10,000,000,000,000,000` base units (10 billion USDC). Both `totalAssets()` and the position side of `maxWithdrawable()` use this erroneous value, so vault share pricing and liquidity reporting become unusable once Moonwell has a position.
**Recommendation**: Divide by `1e18`, preferably with `Math.mulDiv(mTokenBalance, exchangeRate, 1e18)`, and confirm the scale from the exact deployed market implementation during adapter construction/fork testing. Add a fork assertion comparing the adapter result with `balanceOfUnderlying` or a protocol-exact reference calculation across nonzero balances.

## [MATH-5] Aave's already-annualized ray rate is annualized a second time and scaled incorrectly
**Severity**: Medium
**Category**: evm-audit-precision-math
**Location**: `AaveV3Adapter.supplyRatePerYear()`
**Description**: Aave V3 `currentLiquidityRate` is an annual APR expressed in ray (`1e27`), not a per-second rate. The adapter labels it per-second, multiplies it by seconds per year, then divides by `1e27`. To return a WAD-scaled annual rate it should convert ray to WAD by dividing by `1e9`. The current result underreports a normal Aave APR by roughly 31.7 billion times and can make the allocator systematically reject Aave.
**Proof of Concept**: For a 5% Aave liquidity APR, `currentLiquidityRate = 5e25`. The required WAD return is `5e25 / 1e9 = 5e16`. Navy returns `5e25 * 31,536,000 / 1e27 = 1,576,800`, which interpreted as WAD is approximately `0.00000000015768%`, rather than 5%.
**Recommendation**: Return `uint256(currentLiquidityRate) / 1e9` for simple WAD APR. If the system truly requires APY, compound the annual APR using Aave's documented per-second convention in a sufficiently precise off-chain module and name the interface accordingly. Add fixed-vector tests such as ray 5% mapping to WAD 5%.

## [MATH-6] Reward price-impact and route slippage settings do not constrain execution value
**Severity**: High
**Category**: evm-audit-precision-math
**Location**: `RewardExecutor.swap()`
**Description**: `minOutBps` is validated and stored but never used. The only executable minimum is the allocator-supplied `minAmountOut`, which may be zero. The purported price-impact calculation compares the same Chainlink feed immediately before and after the swap. A Chainlink reference price generally does not change inside that transaction, so `impactBps` is zero regardless of the Uniswap execution price. The code never combines input amount, input/output token decimals, feed decimals, and oracle price into an expected output. Thus both configured route protections can pass a severely lossy swap.
**Proof of Concept**: Configure COMP/USDC with a 1% `maxPriceImpactBps`, any nonzero `minOutBps`, and a Chainlink price of 10 USDC/COMP. Call `swap` for 1 COMP with `minAmountOut = 0` against a manipulated pool that returns 1 USDC. The feed reads 10 before and 10 after, so Navy calculates `(10 - 10) * 10,000 / 10 = 0` bps and accepts a 90% execution loss. The stored `minOutBps` is not referenced and the router minimum is zero.
**Recommendation**: Compute oracle-expected output by normalizing input-token decimals, output-token decimals, and feed decimals/direction. Derive a protocol minimum and maximum impact from that expected output, and pass `max(callerMinOut, protocolMinOut)` to the router. Validate the feed denomination explicitly. Test 6-to-18 and 18-to-6 decimal routes, inverted feeds, and boundary rounding.

## [MATH-7] The daily-notional precheck can be bypassed with a zero caller minimum
**Severity**: Medium
**Category**: evm-audit-precision-math
**Location**: `RewardExecutor.swap()`
**Description**: The pre-swap daily-cap check treats `effectiveMinOut` (the caller's minimum) as expected notional instead of calculating the input's oracle value. A caller can set it to zero, so any individual swap passes regardless of size. Actual output is recorded only after execution, allowing the first oversized swap to exceed the route limit by an arbitrary amount. Using raw output units also assumes every route output has the same denomination and decimals as the cap.
**Proof of Concept**: Let `maxDailyNotional = 50,000e6` USDC units and current volume be `49,999e6`. A call with `minAmountOut = 0` and a swap that returns `100,000e6` passes the precheck because `49,999e6 + 0 <= 50,000e6`. State is then written as `149,999e6`, nearly three times the cap. The excess swap is not reverted.
**Recommendation**: Before transfer/execution, calculate a conservative oracle-denominated notional for `amountIn` with explicit decimal normalization and require `currentVolume + notional <= cap`. Record the same normalized unit after execution, and document that unit in `Route`. Do not use caller-provided slippage as volume accounting.

## [MATH-8] A later adapter sync recognizes a permitted divestment loss twice
**Severity**: Medium
**Category**: evm-audit-precision-math
**Location**: `NavyVaultSRCLA._divest()`
**Description**: When a requested divestment returns less than requested, the vault subtracts only `received` from `strategyAssets` and also increments `recognizedLosses` by `amount - received`. Immediately after the call these two entries happen to net to the correct NAV. If the adapter actually consumed the full position and realized the loss, a later `_syncStrategyAssets()` sets the stale residual strategy balance to zero while the loss accumulator remains, deducting the same loss a second time. There is no reconciliation or reduction of `recognizedLosses`.
**Proof of Concept**: Start with `strategyAssets = 100`, no idle, and zero losses. Divest 100; the adapter closes its position and returns 90. Navy records idle 90, strategy 10, losses 10, so NAV is temporarily `90 + 10 - 10 = 90`. A later harvest calls `_syncStrategyAssets()` and reads the adapter's actual zero balance. NAV becomes `90 + 0 - 10 = 80`, although the vault still owns 90. Deposits and redemptions are thereafter priced against an understated NAV.
**Recommendation**: After each divest, set strategy accounting from the adapter's post-call `totalAssets()` (or reduce it by the requested/actually debited position amount), and represent a realized loss exactly once. Define whether `recognizedLosses` is cumulative reporting or a live NAV adjustment; it cannot safely be both. Add state-machine tests covering partial liquidity, realized loss, later sync, and recovery.

## [MATH-9] Invoice fee rounding systematically favors merchants over the treasury
**Severity**: Low
**Category**: evm-audit-precision-math
**Location**: `NavyPayments.payInvoice()`
**Description**: The fee uses floor division. Where the configured fee is intended as a minimum protocol charge, this rounds in the wrong direction and assigns every remainder to the merchant. The loss is bounded to less than one USDC base unit per invoice, so impact is limited, but it accumulates with payment count. The split otherwise conserves value, and `feeBps <= 1000` guarantees `fee <= amount` for supported USDC amounts.
**Proof of Concept**: At `feeBps = 100` (1%), an invoice of `10,001` base units has an exact fee of `100.01` base units. The implementation transfers `100` to treasury and `9,901` to the merchant; a protocol-favoring integer fee would use ceiling and transfer `101` to treasury. Repeating remainder-bearing invoices repeatedly assigns the indivisible-unit rounding benefit to merchants.
**Recommendation**: If the fee is contractually a minimum 1%, compute it with `Math.mulDiv(amount, feeBps, 10_000, Math.Rounding.Ceil)` and document the rounding policy. If merchant-favoring floor rounding is intended product policy, retain it but state that policy explicitly in the fee specification and backend reconciliation.

## Historical coverage / no-findings (2026-08-12 baseline)

- Checked the complete precision checklist: division-before-multiplication, hidden scaling, zero rounding, all ERC-4626 directions, fee math, downcasts, signed/unsigned arithmetic, unchecked/assembly division, time scaling, accumulator ordering, and boundary comparisons.
- ERC-4626 semantics were checked against the bundled OpenZeppelin 5.0 implementation: `convertToShares` and `convertToAssets` floor; `previewDeposit` floors; `previewMint` ceils; `previewWithdraw` ceils; `previewRedeem` floors. MATH-2 is based on those exact call sites, not a generic “protocol-favoring” shortcut.
- Compound's `getSupplyRate()` value is per-second WAD, so multiplication by `365 days` in `CompoundAdapter.supplyRatePerYear()` has consistent units and no precision finding was identified.
- Moonwell's rate multiplication is dimensionally consistent if the configured model returns the deployed market's per-timestamp WAD rate. Its fallback reads for borrows/reserves now avoid the previous report's hardcoded-zero behavior; the remaining material Moonwell conversion error is MATH-4.
- Compound and Moonwell now cap `maxWithdrawable()` by protocol cash. No precision issue was found in their `min(position, cash)` selection. This does not validate broader adapter ABI/call correctness, which is outside this specialist report.
- Cap, idle, and allowed-loss calculations multiply before dividing and use OpenZeppelin `Math.mulDiv`; no division-before-multiplication issue was found in those expressions. Admin BPS setters lack upper-bound validation, but that is an access/configuration finding rather than an arithmetic exploit by an unprivileged caller.
- `NavyPayments` conserves every received token base unit between merchant and treasury. No fee overflow is reachable with Circle USDC's bounded supply and the 10% fee ceiling; the only supported precision issue is the limited rounding policy in MATH-9.
- No exploitable unsafe signed-to-unsigned conversion, unchecked arithmetic, assembly division-by-zero behavior, or calculation involving `type(uint256).max` as an arithmetic sentinel was found in the scoped paths.
- Revalidated the prior `AUDIT-REPORT-2026-08-12.md` only after independent source review. Its cancelled-plan, Merkle ordering, Chainlink round-validation, configurable fee-tier, and Compound/Moonwell cash-cap claims are changed in the current tree. Its claim that the vault rounding/inflation issues were fixed is disproved by MATH-1 and MATH-2. Its Moonwell fabricated-rate claim is partially superseded by live reads, while MATH-4 identifies the still-invalid position scaling.

## Historical verification notes (2026-08-12 baseline)

- `forge build --skip test --skip script` succeeds for production sources.
- Full `forge build` is currently blocked by two test struct literals in `test/reward/RewardExecutor.t.sol` that supply 9 fields after `IRewardExecutor.Route` was expanded to 10 fields. This pre-existing working-tree inconsistency prevented a clean full-suite execution and was not modified during this read-only audit.
