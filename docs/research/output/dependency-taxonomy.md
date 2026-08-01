# Dependency Taxonomy for Base USDC Lending

## Purpose

Market count is not diversification. The allocator maps every destination to dependency groups and enforces group-level caps in addition to market and protocol caps.

## Groups

| Group | Examples | Treatment |
|---|---|---|
| `chain:base` | sequencer, L2 state derivation, bridge settlement | Accepted common-mode risk; cannot diversify within scope |
| `asset:usdc` | Circle issuer, blacklist/upgrade authority, USD backing | Accepted common-mode risk with emergency policy |
| `protocol:<name>` | Aave, Compound, Moonwell, Morpho core code | Protocol cap |
| `upgrade:<authority>` | timelock, multisig, governor | Shared-authority cap and change monitoring |
| `oracle:<feed>` | Chainlink/custom oracle address and dependencies | Oracle/feed cap |
| `collateral:<family>` | WETH, cbBTC, USDe and correlated wrappers | Collateral-family cap |
| `liquidation:<venue>` | DEX/aggregator used for collateral disposal | Liquidation-route cap |
| `reward:<token>` | WELL, COMP, MORPHO | Reward concentration and haircut |
| `keeper:<path>` | RPC, data indexer, signer, relayer | Operational redundancy requirement |

## Exposure matrix

For market $i$ and dependency $g$, $D_{ig}$ is the fraction of market exposure attributable to the dependency. Initial implementation may use binary values, but severity-weighted and nonlinear contagion are sensitivity analyses.

$$
\sum_i D_{ig}w_i \le C_g
$$

## Governance

A dependency record has an evidence URL, valid-from block, valid-to block, reviewer, and rationale. Cap changes are versioned and cannot be justified by yield alone.

## Limits

This taxonomy is transparent but not a calibrated failure-probability model. Base and USDC risks remain undiversified; multiple Morpho markets may share core code, oracle providers, collateral families, and liquidation venues.
