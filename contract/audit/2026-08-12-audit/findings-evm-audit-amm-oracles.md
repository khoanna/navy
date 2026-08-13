# AMM and Oracle Re-audit Findings

> **Current reconciliation — 2026-08-13:** Historical descriptions below refer to the vulnerable 2026-08-12 audit baseline. The living release decision is in `../AUDIT-REPORT.md`. Reward routes remain disabled.

| ID | Current status | Reconciliation |
|---|---|---|
| AMMORACLE-1 | Fixed | `RewardExecutor` grants initial administration to deployer and vault; the Base script transfers executor roles to governance. On-chain role handoff remains a deployment gate. |
| AMMORACLE-2 | Fixed | Router structs now match Base SwapRouter02 and direct-route tests pass. A pinned Base fork is still required for release evidence. |
| AMMORACLE-3 | Partially fixed | Oracle-normalized expected output, protocol minimum output, actual execution impact, mandatory feed, and decimal normalization were added. Exact feed pair/direction remains a governance assertion. |
| AMMORACLE-4 | Fixed | Conservative pre-swap and actual-output post-swap daily-cap checks are enforced. |
| AMMORACLE-5 | Fixed by restriction | Endpoints must match and paths must contain exactly two tokens; unsupported multi-hop routes are rejected. |
| AMMORACLE-6 | Fixed | Only the rotatable updater may advance the baseline, and the supplied value must equal the current validated feed value. |
| AMMORACLE-7 | Open | No Base sequencer uptime/recovery grace check and no governed upper bound on route heartbeat/max age. |
| AMMORACLE-8 | Open | Positive/fresh/complete rounds are checked, but governed economic lower/upper answer bounds are absent. |

**Release rule:** AMMORACLE-3, AMMORACLE-7, and AMMORACLE-8 prohibit enabling reward routes. Disabled route configuration is mitigation, not closure.

**Audit date**: 2026-08-12  
**Scope**: current first-party contract working tree, including uncommitted changes, focusing on `RewardExecutor`, its vault call sites and route configuration, and `ChainlinkPriceFeed`.  
**Severity model**: Critical = direct unprivileged theft or permanent loss; High = realistic fund loss/freeze or pool-wide liveness failure; Medium = conditional loss, silent accounting corruption, or a meaningful safety gap; Low = limited impact or unlikely conditions; Info = hygiene/documentation without direct security impact.

## [AMMORACLE-1] No production caller can administer RewardExecutor routes
**Severity**: High
**Category**: evm-audit-defi-amm / evm-audit-oracles
**Location**: `RewardExecutor.constructor()`
**Description**: The constructor grants both `DEFAULT_ADMIN_ROLE` and `ADMIN_ROLE` exclusively to the vault address. In production that address is the `NavyVaultSRCLA` contract, not the external vault administrator. `NavyVaultSRCLA` exposes no function that calls `approveRoute`, `revokeRoute`, `setDailyVolume`, `grantRole`, or `renounceRole` on the executor. `RewardExecutor` has no initial-route constructor path. Consequently no route can be approved after a normal deployment, `routes[routeId].inputToken` remains zero, and every nonzero reward swap reverts `RouteNotFound`. Tests mask this by using `vm.prank(vault)` to impersonate what is a contract in production and then granting an EOA a role.
**Proof of Concept**: Deploy a real `NavyVaultSRCLA` at address `V`, then deploy `new RewardExecutor(V, router)`. The deployment EOA has neither admin role. Its `approveRoute(...)` call reverts AccessControl. `V` owns the roles, but none of `NavyVaultSRCLA`'s selectors forward that call. Calling `harvest` with any positive non-USDC reward reaches `RewardExecutor.swap`, reads an empty route, and reverts `RouteNotFound`.
**Recommendation**: Accept a distinct administration address in the constructor and grant it the administrative roles, or add narrowly scoped route-management forwarding functions to the vault guarded by `ADMIN_ROLE`. Add an integration test using an actual vault contract (not `vm.prank(address(vault))`) that approves, executes, updates, and revokes a route.

## [AMMORACLE-2] The declared router ABI is incompatible with the documented Base SwapRouter02
**Severity**: High
**Category**: evm-audit-defi-amm / evm-audit-oracles
**Location**: `ISwapRouter.ExactInputSingleParams` and `ISwapRouter.ExactInputParams`
**Description**: The contract says it integrates Uniswap `SwapRouter02`, and the repository's deployment plan selects Base router `0x2626664c2603336E57B271c5C0b26F421741e481`. Official SwapRouter02's `IV3SwapRouter` structs do not contain a `deadline`; Navy declares and encodes a deadline in both structs. Struct layout is part of the external function signature, so Navy calls selectors implemented by legacy V3 `SwapRouter`, not SwapRouter02. Against the documented Base address, all single-hop and multi-hop swaps revert before execution.
**Proof of Concept**: Navy's single-hop signature `exactInputSingle((address,address,uint24,address,uint256,uint256,uint256,uint160))` has selector `0x414bf389`; SwapRouter02 implements `exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))`, selector `0x04e45aaf`. Navy's multi-hop selector is `0xc04b8d59`, while SwapRouter02's no-deadline form is `0xb858183f`. Sending either Navy selector to the documented SwapRouter02 reaches no matching function and reverts.
**Recommendation**: Import the official `IV3SwapRouter` interface matching the exact deployed router and remove the in-file imitation. If transaction expiry is required with SwapRouter02, use its supported multicall deadline mechanism or enforce a caller-supplied deadline before the router call. Add a Base fork test against the exact deployment address for both path lengths.

## [AMMORACLE-3] Route slippage, oracle denomination, and price-impact controls do not constrain execution price
**Severity**: High
**Category**: evm-audit-defi-amm / evm-audit-oracles
**Location**: `RewardExecutor.swap()`
**Description**: `minOutBps` is checked at route approval and stored but is never used. The only router minimum is allocator-supplied `minAmountOut`, and reachable vault calls permit it to be zero. The alleged feed-denomination validation merely reads `description()` and returns without comparing anything; it accepts an empty description, the wrong pair, or an inverted feed. Feed decimals are not exposed or normalized. Finally, `maxPriceImpactBps` compares the same Chainlink reference feed immediately before and after the Uniswap swap rather than comparing actual output with oracle-expected output. A normal Chainlink feed will not update mid-transaction, making calculated impact zero regardless of execution loss. A route can also omit the feed entirely, disabling this check.
**Proof of Concept**: Approve COMP/USDC with `minOutBps = 9900`, `maxPriceImpactBps = 100`, and a Chainlink price of 10 USDC per COMP. Swap 1 COMP with `minAmountOut = 0` against a manipulated pool returning 1 USDC. The router minimum is zero. The feed reads 10 before and 10 after, so `impactBps = abs(10 - 10) * 10,000 / 10 = 0`; a 90% loss passes a configured 1% maximum. Substituting an unrelated BTC/USD feed produces the same zero result because `_validateFeedTokenDenomination` does not inspect its arguments.
**Recommendation**: Store explicit feed direction and query feed decimals. Normalize input amount, input/output token decimals, and feed decimals to compute oracle-expected output. Derive a route floor from that output and enforce `amountOutMinimum = max(callerMinimum, routeMinimum)`, then compute reported impact from actual balance-delta output versus oracle expectation. Reject routes without the required feed and validate the pair/direction using governed address configuration rather than free-form descriptions.

## [AMMORACLE-4] Caller-controlled minimum output bypasses the daily notional cap
**Severity**: Medium
**Category**: evm-audit-defi-amm / evm-audit-oracles
**Location**: `RewardExecutor.swap()`
**Description**: The pre-swap cap uses `effectiveMinOut`, which is exactly the caller's slippage minimum, as `expectedNotional`. It is neither expected output nor oracle notional. Passing zero makes the precheck add zero, so the first oversized swap can exceed the cap by an arbitrary amount. The actual output is recorded only after execution and is not checked against the cap. Raw output units also make cap semantics depend on the configured output token's decimals.
**Proof of Concept**: Set a 50,000e6-USDC cap and existing daily volume to 49,999e6. Call with `minAmountOut = 0`; let the router return 100,000e6. The precheck evaluates `49,999e6 + 0 <= 50,000e6` and passes. State is then set to 149,999e6, almost three times the limit, without reverting the swap.
**Recommendation**: Before token transfer, derive normalized oracle notional from `amountIn` and enforce `routeDailyVolume + inputNotional <= maxDailyNotional`. Define one cap denomination (for example USDC base units) and require the route output to match it. Recheck and record a consistently normalized actual output after execution.

## [AMMORACLE-5] Route identity does not bind token endpoints to the executed path
**Severity**: Medium
**Category**: evm-audit-defi-amm / evm-audit-oracles
**Location**: `RewardExecutor.approveRoute()`
**Description**: Route approval does not require `path[0] == inputToken` or `path[path.length - 1] == outputToken`. `swap()` pulls and approves `inputToken`, but sends `path` endpoints to the router and later transfers `outputToken` by the router-reported `amountOut`. A mismatched first endpoint reliably DoSes execution. A mismatched last endpoint can debit a pre-existing balance of the configured output while leaving the actual router output trapped in the executor. In addition, `routeDigest` is computed from the caller-supplied struct including its unused `routeDigest` field, is not related to `routeId`, and is never rechecked during execution, so it provides no route-identity guarantee.
**Proof of Concept**: Approve `inputToken = COMP`, `outputToken = USDC`, but `path = [COMP, WETH]`. If the executor already holds 5 USDC and the swap returns 5 WETH units, it transfers 5 USDC units to the vault based on the return value while retaining the WETH. With `path[0] = WELL`, execution instead pulls and approves COMP but the router tries to collect WELL, causing every harvest through the route to revert. Both malformed routes pass `approveRoute()`.
**Recommendation**: Require exact endpoint equality, require the output token to equal the vault's immutable accounting asset, reject repeated/zero path tokens, and validate that every configured fee-tier pool exists at the trusted factory. Define `routeId = keccak256(canonical route fields)` or verify a committed digest at execution; do not hash a caller-supplied digest into itself.

## [AMMORACLE-6] The Chainlink deviation baseline can be permissionlessly reset to bypass the deviation check
**Severity**: Low
**Category**: evm-audit-defi-amm / evm-audit-oracles
**Location**: `ChainlinkPriceFeed.updateLastPrice()`
**Description**: Anyone may set `_lastPrice` to the feed's current answer. Requiring equality prevents arbitrary price injection, so the previous report's claim of an arbitrary-value Critical issue is no longer true. However, permissionless resetting still defeats the stated temporal deviation guard: after a large legitimate or anomalous move, an attacker can set the baseline to that new answer immediately before a consumer checks it, making deviation zero. `_lastUpdateTime` is recorded but never used to constrain baseline age or update cadence. No current first-party production contract consumes `getPriceWithDeviation`, limiting present impact to the wrapper's safety guarantee and future integrations.
**Proof of Concept**: Store a baseline of 100 and use `maxDeviationBps = 1,000` (10%). When Chainlink moves to 150, an ordinary `getPriceWithDeviation` calculates 50% and reverts. Any account calls `updateLastPrice(150)`, which succeeds because it equals the current feed. The next check compares 150 to 150, calculates zero, and accepts the same 50% move.
**Recommendation**: Restrict baseline advancement to a defined trusted consumer/keeper and specify when a new baseline becomes accepted, or make the consuming operation atomically compare with and update the last accepted value. Apply a minimum interval/cooldown where appropriate. Do not describe equality-to-current-feed as access control.

## [AMMORACLE-7] Oracle freshness configuration lacks Base sequencer recovery and bounded-heartbeat safeguards
**Severity**: Low
**Category**: evm-audit-defi-amm / evm-audit-oracles
**Location**: `RewardExecutor._validateChainlinkPrice()` and `ChainlinkPriceFeed._getValidatedPrice()`
**Description**: Both validators correctly reject nonpositive answers, incomplete/unstarted rounds, and caller-configured stale timestamps. However, route approval permits any `maxFeedAge`, including `type(uint256).max` (effectively no freshness) or values unrelated to the selected feed's heartbeat. `ChainlinkPriceFeed.latestAnswer()` deliberately passes `type(uint256).max`, despite documenting a fully validated price. The system targets Base, which currently operates a single active sequencer, but neither component checks a sequencer-availability signal nor imposes a recovery grace period before accepting prices after an outage. No current valuation is actually derived from these prices because AMMORACLE-3 renders the oracle price economically unused; severity is therefore limited until that is fixed.
**Proof of Concept**: Approve a route with `maxFeedAge = type(uint256).max`. A positive, completed round remains acceptable regardless of age. Separately, `ChainlinkPriceFeed.latestAnswer()` makes the same call internally, so a week-old positive round is returned. After a Base sequencing interruption, a price satisfying only the chosen age can be accepted in the first recovery block; no one-hour recovery grace is enforced.
**Recommendation**: Store a governance-reviewed, feed-specific maximum age bounded to its documented heartbeat; prohibit max-uint/no-freshness values on value-sensitive paths. Make every safety-labelled entry point enforce freshness. Where a supported sequencer uptime signal is available for the deployment, require sequencer-up status plus a recovery grace period; otherwise explicitly pause swaps through a documented Base liveness mechanism during and immediately after outages.

## [AMMORACLE-8] Chainlink answer bounds are not checked
**Severity**: Low
**Category**: evm-audit-defi-amm / evm-audit-oracles
**Location**: `RewardExecutor._validateChainlinkPrice()` and `ChainlinkPriceFeed._getValidatedPrice()`
**Description**: Both integrations validate only that an answer is positive; neither supports governed lower/upper economic bounds or detects a feed pinned at an aggregator circuit-breaker bound. During an extreme market move, a bounded feed may continue returning its minimum or maximum while the true market is outside that range. In this tree the answer is not yet used to calculate execution value, so this omission does not independently expose funds today, but it must be addressed together with AMMORACLE-3 before relying on the feed for minimum output or price impact.
**Proof of Concept**: Suppose an approved reward feed has an operational minimum answer of $1 while the token crashes to $0.10. A completed, freshly updated answer of $1 is positive and passes every current check. Any future oracle-derived expected output would be ten times the realizable market value, potentially freezing all harvests or misclassifying execution unless explicit bounds/fallback behavior is defined.
**Recommendation**: Record reviewed economic bounds per feed/route, monitor feed deprecation, and define fail-closed or fallback behavior when an answer reaches a bound. Do not assume every proxy exposes `minAnswer`/`maxAnswer` uniformly; source and govern the bounds for the exact deployed feed.

## Historical coverage / no-findings (2026-08-12 baseline)

- Read both complete requested checklists and checked general AMM integration, slippage, deadlines, path/pool identity, fee tiers, callbacks, token behavior, oracle staleness/round validity/decimals/denomination/bounds, L2 sequencer behavior, TWAP/spot use, and oracle liveness.
- Trace reachability: `ALLOCATOR_ROLE -> NavyVaultSRCLA.harvest()` or plan `Harvest -> _harvestCore() -> RewardExecutor.swap() -> exactInputSingle/exactInput -> output transfer to vault`. Today the trace is blocked independently by (1) adapters reporting zero claimable rewards, (2) no implemented reward-claim transfer into the vault, (3) unreachable route administration (AMMORACLE-1), and (4) the documented router ABI mismatch (AMMORACLE-2). AMMORACLE-3 through AMMORACLE-5 become directly reachable once those intended reward-flow blockers are repaired; they are not premised on an untrusted public caller because the allocator itself may validly supply zero `minOut` and tests exercise that value.
- `swap()` is restricted to the immutable vault. No public arbitrary-call, user-controlled pool callback, direct `IUniswapV3Pool.swap`, V2 reserve/spot-price read, V3 `slot0` price read, flash-swap callback, Uniswap V4 hook, LP valuation, or TWAMM logic exists in first-party scope.
- The executor uses exact-input swaps, so an exact-output refund path is not required. Its per-swap router allowance is set to exactly `amountIn`, not unlimited, and an ordinary official exact-input router consumes it. No stale mutable-router approval issue exists because the router is immutable.
- Configurable fee tiers replace the prior hardcoded-3000 behavior for supported tiers. The implementation nevertheless rejects Uniswap's valid 100 tier and applies one tier to every hop; this is a limited route-availability/configuration constraint rather than a standalone fund-loss finding.
- `amountOutMinimum` is enforced by the router and checked again after return. The defect is not absence of the field but failure to derive a nonzero protocol floor from the stored route/oracle configuration (AMMORACLE-3).
- Output is transferred only to the immutable vault, and SafeERC20 is used. For intended canonical COMP/WELL inputs and USDC output, fee-on-transfer/rebasing accounting is not expected. The unrestricted route endpoints are addressed in AMMORACLE-5; balance-delta accounting should be added if arbitrary tokens are intentionally supported.
- Chainlink runtime checks correctly cover `startedAt != 0`, `answeredInRound >= roundId`, positive answers, and `updatedAt` age where a finite `maxAge` is supplied. There is no Pyth, VRF, multi-hop derived oracle, LP oracle, or TWAP implementation in scope.
- `ChainlinkPriceFeed` currently has no first-party production consumer; only its tests reference `getPrice`/`getPriceWithDeviation`. `RewardExecutor` talks directly to aggregator-shaped addresses and does not use the wrapper. This reachability fact is reflected in AMMORACLE-6 through AMMORACLE-8 severities.
- Full `forge build` remains blocked by two existing `IRewardExecutor.Route` test literals that omit the newly added `feeTier` field. Production-only `forge build --skip test --skip script` succeeds; no source or test file was modified during this audit.
