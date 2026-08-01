# Base USDC Dataset Dictionary

**Registry observation block:** 49,397,275
**Chain:** Base (8453)
**Underlying:** native Circle USDC at `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

## Identity fields

- `market_id`: stable research identifier; Morpho uses its canonical bytes32 ID.
- `protocol`: deployed protocol family.
- `market_address`: pooled market/core contract.
- `observation_block`: block at which registry identity was checked.
- `eligibility_status`: `candidate`, `candidate-not-approved`, `eligible`, or `excluded`.

## Time-series primary key

Each normalized row is uniquely identified by `(chain_id, market_id, block_number)`.

## State fields

| Field | Type/unit | Meaning |
|---|---|---|
| `block_number` | uint64 | Base block sampled |
| `timestamp` | UTC seconds | Block timestamp |
| `supply_assets` | uint256 USDC base units | Accrued total supplied claim |
| `borrow_assets` | uint256 USDC base units | Accrued borrows |
| `available_liquidity` | uint256 USDC base units | Immediately withdrawable cash under exact protocol state |
| `utilization_wad` | uint256 1e18 | Protocol-exact utilization |
| `supply_rate_ray` | uint256 1e27 annualized | Base supplier rate before incentives |
| `incentive_rate_ray` | uint256 1e27 annualized | Claimable supplier incentive converted only in evaluation |
| `gas_price_wei` | uint256 | Base execution gas price input |
| `paused_supply` / `paused_withdraw` | bool | Action availability |
| `parameter_version` | string | Hash/version of deployed rate and risk parameters |
| `source_block_hash` | bytes32 | Reorg/integrity anchor |

## Flow fields

Supply, withdrawal, borrow, repay, liquidation, reward, pause, upgrade, cap, oracle, and governance events retain transaction hash, log index, sender when public, assets, shares, and decoded parameters.

## Forecast features

Features are computed only from blocks at or before the decision timestamp. Rolling windows are left-closed at the decision block. Governance events become features only after on-chain execution or the declared public-information rule.

## Rewards

Reward quantity, claimability, vesting, token price, market depth, haircut, and swap cost remain separate. Headline incentive APY is never treated as realized USDC yield.

## Missingness

Missing state is explicit. Forward filling is allowed only for immutable/configuration values with a recorded validity interval. Missing market state makes the market ineligible for that decision.
