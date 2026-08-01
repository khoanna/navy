# Systematic Review Protocol: Direct-Lending Allocation and Rebalancing

**Registered:** 2026-08-01
**Scope:** Unleveraged USDC allocation by a pooled ERC-4626 vault across direct lending markets on Base.
**Reporting standard:** IEEE numbered citations with a machine-readable BibTeX bibliography.

## Review question

Which publicly disclosed production systems and original research methods specify an objective, state transformation, constraint, rebalance trigger, execution rule, or emergency policy that materially overlaps a direct-market lending allocator maximizing realized net yield under hard safety constraints?

## PICOC definition

- **Population:** Direct, overcollateralized DeFi lending markets accepting a common supplied stablecoin.
- **Intervention:** Portfolio allocation, pool selection, reserve sizing, reward treatment, or capital rebalancing.
- **Comparators:** Hold/fixed weight, highest current APR, capacity-aware allocation, cost-threshold routing, robust-static allocation, and disclosed production controllers.
- **Outcomes:** Realized net yield, turnover, reversal frequency, withdrawal success, drawdown/expected shortfall, policy violations, and reproducibility.
- **Context:** Unleveraged USDC on Base, with broader protocols and mathematical finance retained only when mechanisms transfer to this setting.

## Inclusion criteria

Include a source when all conditions hold:

1. It is an original paper, official specification/documentation, official repository, verified deployed contract, or executed governance record.
2. It discloses at least one algorithm-relevant element: objective, decision variable, state input, transformation, hard constraint, trigger, cost model, allocation/execution rule, or emergency rule.
3. The method concerns lending allocation directly or supplies a transferable formal mechanism for uncertainty, transaction costs, liquidity, or dependency risk.
4. The full text, code, or on-chain evidence is accessible enough to extract and cite the relevant claim.
5. Mutable sources can be versioned by date, commit, address, proposal, transaction, or block.

## Exclusion criteria

- Secondary summaries when the owning primary source is available.
- Pure APY listings, aggregators, or dashboards with no disclosed decision policy.
- Custody or wallet descriptions with no allocation/rebalance rule.
- CLMM, hedging, or leveraged strategies except for a clearly transferable control mechanism.
- Generic AI claims without inputs, constraints, tools, or execution boundaries.
- Duplicate versions superseded by a later source, while preserving the version relationship.
- Performance claims without a reproducible method are retained only as first-party claims, not evidence of superiority.

## Source priority

1. Peer-reviewed original publication.
2. Authoritative author preprint.
3. Official technical paper or specification.
4. Official repository pinned to a commit or release.
5. Verified deployed contract or governance execution.
6. Official documentation with update and access dates.

## Search sources

- IEEE Xplore
- ACM Digital Library
- SpringerLink
- ScienceDirect
- SSRN
- arXiv
- Google Scholar for discovery only
- Official protocol documentation and repositories
- Official governance forums and executed proposals
- Backward and forward citation chaining from included papers

## Query families

1. `("decentralized finance" OR DeFi) AND lending AND (allocation OR portfolio) AND (rebalance OR optimization)`
2. `DeFi lending AND (endogenous utilization OR interest-rate curve) AND allocation`
3. `DeFi lending AND (robust optimization OR distributionally robust OR uncertainty)`
4. `portfolio rebalancing AND (fixed cost OR proportional cost OR switching cost OR no-trade region OR impulse control)`
5. `lending liquidity AND (withdrawal stress OR bank run OR liquidity constraint)`
6. `DeFi AND (oracle dependency OR collateral dependency OR systemic risk network)`
7. Protocol-specific searches combining project name with `allocator`, `strategy`, `rebalance`, `keeper`, `vault`, and `source code`.

Exact executed queries and filters are recorded in `search-log.csv`.

## Screening workflow

1. Deduplicate by DOI, persistent identifier, repository/commit, or canonical URL.
2. Title/abstract screen.
3. Full-text or code screen.
4. Extract claims only from primary evidence.
5. Assign one status:
   - `include`
   - `exclude-out-of-scope`
   - `exclude-secondary`
   - `exclude-no-policy`
   - `exclude-duplicate`
   - `awaiting-full-text`
6. Record one explicit exclusion reason.
7. Resolve closest-paper and closest-production overlap for every proposed component.

## Extraction schema

The evidence matrix records citation key, source type/review status, objective, variables, inputs, allocation-induced rate impact, uncertainty, constraints, trigger, costs, liquidity, dependencies, execution, emergency policy, parameters, code/data availability, reproducibility, limitations, and primary URL.

## Quality and reproducibility assessment

- **High:** objective/policy, transformations, constraints, triggers, and parameters are sufficient to implement the relevant method.
- **Medium:** mechanism is implementable, but one or more decision-policy elements or live parameters are missing.
- **Low:** only qualitative factors or architecture are public.

Product liveness, documentation availability, code availability, and algorithm reproducibility are assessed separately.

## Synthesis and claim discipline

The synthesis distinguishes identical prior methods, adaptations, integrations, and gaps not found in the bounded review. Absence from this search is not proof of novelty. Superiority requires common-data out-of-sample experiments under identical costs and safety constraints.

## Update policy

Record every search with its execution date. Repeat the systematic search before paper submission and update mutable protocol evidence to pinned contracts, commits, proposals, and blocks.
