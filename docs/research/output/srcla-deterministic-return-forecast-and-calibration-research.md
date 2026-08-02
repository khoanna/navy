# Deterministic Return Forecasting and Lower-Bound Calibration for SRCLA

**Research note — 2 August 2026**

## Scope and status

This note investigates reproducible forecasting choices for the Safe, Robust, Cost-Aware Lending Allocator (SRCLA) described in [`srcla-paper.md`](./srcla-paper.md). It covers a fixed holding horizon, look-ahead-free estimation, uncertainty bounds, non-stationarity, incentives, capacity-aware rate simulation, walk-forward validation, minimum-data gates, and evaluation metrics for a standalone Node.js/TypeScript worker.

It compares candidate methods but **does not select the production method, horizon, confidence level, observation cadence, or parameter values**. Those remain design decisions to make after empirical replay.

## 1. What the paper says, and what it deliberately leaves open

The paper is already explicit about the controller's structure:

- Section 6.1 requires protocol-specific simulation of the rate *after* the vault's proposed deposit, rather than using displayed APY.
- Section 6.2 defines annualized usable return as base lending interest plus conservatively valued rewards minus a documented haircut.
- It proposes the auditable form

  \[
  \ell_i(x_i)=\mu_i(x_i)-z_\alpha\sigma_i(x_i),
  \]

  where the caution multiplier is fixed before evaluation.
- Section 9 compares conservative incremental dollars over a holding horizon \(H\) with all movement costs.
- Section 11 requires walk-forward tests, forecast calibration, equal information and execution delay across baselines, and auditable block-pinned decision records.
- Section 11.3 states that no historical walk-forward or forecast-calibration result has yet been produced.

The paper also says explicitly that the exact forecasting model and calibration procedure must be published before a performance claim. It does **not** specify:

| Unspecified item | Why it changes the result |
| --- | --- |
| Observation cadence and exact horizon \(H\) | Hourly observations and a seven-day outcome have different overlap, noise, and execution meaning from daily observations and a 30-day outcome. |
| Forecast target | A confidence bound on a conditional mean, a prediction bound for one future holding-period return, and a lower quantile of future return answer different questions. |
| Definition of \(\mu_i\) and \(\sigma_i\) | Standard deviation of realized returns, standard error of the estimated mean, and forecast-error standard deviation are not interchangeable. |
| Model/window/decay | These determine responsiveness to regime changes and sampling noise. |
| Distribution and \(z_\alpha\) | A Gaussian critical value is only justified by a model; an empirical residual quantile has different assumptions and finite-sample resolution. |
| Reward model | Emission continuity, dilution, token price, claimability, swap depth, slippage, and claim/swap gas all affect net reward return. |
| Counterfactual historical deposit treatment | The vault did not actually make every candidate deposit in history, so capacity-aware backtests need a published counterfactual convention. |
| Missing-data and warm-up policy | A deterministic controller must say when it refuses to forecast. |
| Refit and policy-version schedule | Continual refitting may be deterministic but still changes the live policy and its statistical behavior. |

Therefore, the paper supports the requested deterministic and auditable direction, but it does not yet provide the calculation needed to implement it.

## 2. Define the quantity before choosing a model

### 2.1 Fixed-horizon target

At decision origin \(t\), candidate market \(i\), and proposed position \(x\), define the **net holding-period return** over a pre-registered horizon \(H\):

\[
R_{i,t\rightarrow t+H}(x)
=R^{\text{base}}_{i,t\rightarrow t+H}(x)
+R^{\text{reward}}_{i,t\rightarrow t+H}(x)
-C^{\text{claim/swap}}_{i,t\rightarrow t+H}(x)/x.
\]

The economic move gate should use this unannualized return in dollars:

\[
G_H=\sum_i x_i\left(\underline R^{\text{target}}_{i,H}-\underline R^{\text{current}}_{i,H}\right).
\]

An annualized equivalent can be displayed and used in the portfolio objective, but annualization must not be used as though the annual amount will be earned during a short \(H\). Store both the raw horizon return and the exact annualization convention.

### 2.2 Confidence bound versus prediction bound

This is the most important ambiguity in the paper's current notation.

- A **lower confidence bound for the conditional mean** answers: “How low might the unknown expected return be?” Its uncertainty about the mean generally shrinks as the effective sample size grows.
- A **lower prediction bound/quantile** answers: “How low might the next realized \(H\)-horizon return be?” It includes both parameter uncertainty and the irreducible variability of the next outcome, so it is wider. NIST explicitly distinguishes a confidence interval for a regression function from a prediction interval for a new observation and notes that the latter includes both sources of uncertainty.[^nist-prediction]

For a controller whose claim is protection against the next holding-period downside, reporting only a confidence interval for the mean can materially understate uncertainty. This note therefore evaluates both semantics; it does not decide which SRCLA must use.

### 2.3 A reproducible observation record

For every grid timestamp, the worker needs one canonical, finalized Base block and a raw snapshot containing at least:

- block number/hash/timestamp, RPC source, finality rule, and ingestion timestamp;
- vault total assets, idle USDC, adapter balances, and pending/unclaimed rewards;
- protocol cash/available liquidity, supply, borrows, reserves, indices, caps, pause flags, rate-model address/code/configuration hash, and all rate parameters;
- reward token, emission rate, distribution end, supplier denominator, accrued/claimable amount, reward contract/configuration identity, and eligibility threshold;
- price observation, price source, freshness, decimals, market liquidity, executable swap quote/route, slippage assumption, and gas estimate;
- proposed \(x\), simulated post-deposit inputs, model/policy version, and every data-quality flag.

Store integer on-chain quantities as decimal strings or `bigint`, retain the original units, and convert only in pure deterministic calculation functions. A historical API's already-computed “APY” is useful as a cross-check, not as the canonical input.

## 3. Capacity-aware history: current curve versus future path

The protocols expose different rate and reward mechanics, so the common forecasting layer should consume normalized interval/horizon returns produced by protocol-specific data adapters.

- Compound III's supply rate is a governance-configured kinked function of utilization and accrues each second. Its contract exposes the rate parameters, and `getSupplyRate(utilization)` computes the curve.[^compound-rates] The contract separately tracks supplier rewards using `baseTrackingSupplySpeed`, subject to `baseMinForRewards`, and divides accrual by aggregate supplied principal.[^compound-comet] Claimed reward value is external to the base USDC index.[^compound-rewards]
- Moonwell documents that base supply APY is utilization-driven and auto-compounds, while incentive rewards are APR, may use multiple tokens, and must be claimed.[^moonwell-faq] Its official contracts include a multi-token reward distributor and a Compound-v2-style jump rate model.[^moonwell-source]
- Aave V3's rate strategy calculates liquidity rate from reserve state and liquidity additions/takings. Its incentives controller can expose reward emission per second and a distribution end, but an active Base campaign must be verified against the live controller/configuration rather than assumed from the interface.[^aave-rate][^aave-rewards]

Two different questions must not be collapsed:

1. **Immediate capacity effect:** given current borrows/supply/cash and \(x\), what rate does the exact live curve return immediately after deposit?
2. **Holding-period evolution:** how will external borrowing, supplying, rates, rewards, and token prices evolve during \(H\)?

A historical counterfactual can replay each archived state \(s_k\) through the pinned adapter curve as \(f_i(s_k,x)\), treating \(x\) as an additional persistent supply during the window. This is reproducible and includes first-order dilution. It does **not** estimate market participants' behavioral response to the counterfactual deposit. That limitation must be disclosed, especially for large vault tiers.

For piecewise observations \(k=1,\ldots,m\), integrate the simulated per-second rates across actual elapsed seconds rather than averaging dashboard APYs. Reward emissions should be integrated only until their known distribution end. Gaps, reorged blocks, contract upgrades, and parameter changes must split or invalidate a window according to a published rule.

## 4. Three simple deterministic candidate methods

All candidates below can be implemented with fixed-order loops and pure TypeScript functions. Decimal/rational arithmetic, explicit tie-breaking, versioned parameter JSON, and golden test vectors can make the same snapshot reproduce byte-for-byte decision values.

### Candidate A — rolling historical horizon distribution

For each origin, construct only *completed* historical \(H\)-horizon net returns available by that origin. Within a pre-registered trailing window \(W\):

\[
\hat\mu_t=\operatorname{mean}(R_{j,H}),\qquad
\hat\sigma_t=\operatorname{sd}(R_{j,H}).
\]

Possible lower bounds are:

- parametric: \(\hat\mu_t-z_\alpha\hat\sigma_t\), interpreted as a future-outcome bound only under the selected distributional model; or
- historical: the empirical lower \(\alpha\)-quantile of completed \(R_{j,H}\), equivalently represented as \(\hat\mu_t-z_{\alpha,t}\hat\sigma_t\) where \(z_{\alpha,t}=(\hat\mu_t-q_\alpha)/\hat\sigma_t\).

**Advantages:** smallest model surface; easy audit; captures the observed combined base/reward/price/cost distribution; no recursive forecast.

**Assumptions/failures:** a fixed rolling window assumes recent history is relevant; it reacts slowly after abrupt governance, incentive, utilization, or market regime changes; the empirical tail is coarse with little data; overlapping \(H\)-horizon samples are strongly dependent; and a historical minimum can be driven by one bad-data point.

### Candidate B — exponentially weighted level plus calibrated horizon residuals

At the base cadence, update a level and variance with a fixed, published decay \(\lambda\):

\[
m_t=\lambda m_{t-1}+(1-\lambda)y_t,
\]

\[
v_t=\lambda v_{t-1}+(1-\lambda)(y_t-m_{t-1})^2.
\]

The point forecast integrates the current exponentially weighted level over \(H\), after applying the current post-deposit curve. Rather than multiplying one-step volatility by \(\sqrt{H}\)—which silently assumes independent increments—calibrate the lower bound from genuine walk-forward \(H\)-horizon forecast residuals.

NIST describes single exponential smoothing as weighting past observations with exponentially decreasing weights and shows that initialization and the smoothing constant materially affect the result.[^nist-ewma]

**Advantages:** deterministic, constant-memory, and more responsive to recent observations than a flat window; decay has an intuitive effective-memory interpretation.

**Assumptions/failures:** results can be very sensitive to \(\lambda\); a fast decay chases temporary incentive/rate spikes and a slow decay misses breaks; the variance recursion alone does not handle serial correlation; initialization materially affects short histories; one shared decay may not suit base interest and reward-token price.

### Candidate C — fixed-specification direct-horizon linear ARX model

Fit a small linear model directly to the \(H\)-horizon outcome using only features known at the origin, for example:

\[
R_{i,t\rightarrow t+H}(x)=a_i+b_1r^{\text{post}}_{i,t}(x)
+b_2u^{\text{post}}_{i,t}(x)
+b_3d^{\text{kink}}_{i,t}(x)
+b_4r^{\text{reward,known}}_{i,t}(x)+\varepsilon_{i,t,H}.
\]

Alternatively, an AR(1) uses the prior observed rate as its only dynamic feature. NIST defines autoregression as regression of the current series on prior values and notes its straightforward interpretation.[^nist-ar] Fix the feature list, transformations, regularization (if any), rolling/expanding window, and coefficient solver before evaluation. Estimate the lower tail from strictly out-of-sample walk-forward residuals.

**Advantages:** still inspectable; explicitly conditions on utilization, kink distance, and scheduled rewards; direct-horizon fitting avoids an opaque recursive multi-step chain.

**Assumptions/failures:** linear stability is questionable around kinks and governance changes; correlated features can destabilize coefficients; market-specific fitting needs more data; extrapolation outside the training support can be nonsensical; changing feature selection after seeing test results creates look-ahead bias.

### Comparison without a decision

| Property | A: rolling distribution | B: EW level | C: direct ARX |
| --- | --- | --- | --- |
| Audit complexity | Lowest | Low | Moderate |
| Responsiveness | Window-dependent | Explicitly controlled by \(\lambda\) | Window and coefficient dependent |
| Data need | Lowest for point estimate; tail still data-hungry | Low after burn-in; residual calibration still data-hungry | Highest |
| Handles current explanatory state | Only through stratification/current curve | Partly | Explicitly |
| Main risk | stale regime/tail sparsity | overreaction or lag | unstable/extrapolating fit |
| Natural uncertainty method | empirical horizon quantile | walk-forward residual quantile | walk-forward residual quantile or model prediction interval |

Candidate A is the cleanest baseline. That is a comparison statement, not a recommendation to deploy it.

## 5. Estimating \(\mu\) and uncertainty without look-ahead

### 5.1 Rolling-origin construction

At an origin \(t\), training and calibration may use only data whose outcomes are fully known by \(t\). If an observation begins at \(s\), its label is unavailable until \(s+H\), plus the declared ingestion/finality delay. Time-series cross-validation follows this rule: each training set contains only observations before its test observation, and multi-step errors are evaluated at the desired horizon.[^tscv]

A reproducible walk-forward replay should:

1. ingest snapshots in `(blockNumber, marketId)` order with a deterministic same-block tie-break;
2. at origin \(t\), materialize only labels with `endTimestamp <= t - availabilityLag`;
3. fit/update the model under the versioned policy;
4. forecast \(t\rightarrow t+H\) from the snapshot actually available at \(t\);
5. apply the same decision latency, transaction costs, constraints, and failed-transaction rules as production;
6. reveal the outcome only after \(t+H\), append its error, and move to the next origin.

Random train/test shuffling is invalid for this task. Fitting standardization, winsorization thresholds, decay, features, quantiles, or missing-value imputers on the full history is also leakage.

### 5.2 Overlapping horizons and serial dependence

If the origin advances daily but \(H=7\) days, adjacent outcome windows share six days. Treating them as independent exaggerates effective sample size. Three auditable treatments can be compared:

- use non-overlapping origins for formal calibration tests;
- keep all origins for operational realism but report dependence-robust uncertainty/tests;
- separate point-forecast fitting from a sparser calibration stream.

Newey and West provide a positive semi-definite covariance estimator consistent under heteroskedasticity and autocorrelation.[^newey-west] HAC can correct inference on a mean or regression coefficient; it does **not** by itself produce a reliable lower prediction tail under regime change.

### 5.3 Standard deviation, standard error, and forecast error

The implementation record should name the quantity, not store a generic `sigma`:

- `outcomeStd`: dispersion of historical \(H\)-horizon realized outcomes;
- `meanStdError`: uncertainty in the estimated conditional mean (possibly HAC-adjusted);
- `forecastErrorStd`: dispersion of genuinely out-of-sample \(H\)-horizon residuals;
- `lowerResidualQuantile`: empirical/calibrated lower residual tail.

Using `meanStdError` in a formula intended to bound the next outcome is the key category error to prevent.

## 6. Choosing and interpreting \(z_\alpha\)

### 6.1 Parametric one-sided multiplier

Under a correctly specified Gaussian forecast-error model, standard one-sided values are approximately:

| Target lower coverage | Tail probability \(\alpha\) | \(z_{1-\alpha}\) |
| --- | ---: | ---: |
| 90% | 0.10 | 1.2816 |
| 95% | 0.05 | 1.6449 |
| 99% | 0.01 | 2.3263 |

For small independent samples under the classical assumptions, a Student-\(t\) critical value accounts for estimated variance and approaches the normal distribution as degrees of freedom grow.[^nist-t] This does not cure skew, serial dependence, changing regimes, or a misspecified point model.

### 6.2 Empirically calibrated multiplier

Generate strictly walk-forward standardized errors

\[
e_t=\frac{R_{t\rightarrow t+H}-\hat\mu_t}{\hat\sigma_t}.
\]

The lower empirical quantile \(q_\alpha(e)\) yields \(z=-q_\alpha(e)\). A fixed \(z\) can be chosen using a pre-evaluation calibration period and then frozen for the held-out experiment, satisfying the paper's “selected before evaluation” requirement. A live rolling recalibration rule could also be deterministic, but it would be a different policy and must be versioned and evaluated as such.

Conformal methods can wrap any point or quantile predictor. Standard conformal validity depends on exchangeability; Barber et al. develop weighted methods for non-exchangeable data and explicitly discuss downweighting older observations under distribution drift.[^weighted-conformal] Gibbs and Candès develop an online update that targets long-run coverage under arbitrary distribution shift.[^adaptive-conformal] These are useful comparator/calibration mechanisms, not automatic guarantees for SRCLA: time dependence, conditional market-specific coverage, delayed labels, and adaptive allocation all require careful empirical evaluation.

### 6.3 Selection across markets

A pointwise 95% lower bound for each market is not automatically a 95% lower bound for the return of whichever market an optimizer selects. Selection favors positive estimation errors. The evaluation should therefore compare:

- per-market pointwise calibration;
- a simultaneous adjustment across the admitted candidate set; and
- calibration of the final policy-level portfolio return after selection and costs.

This matters even with only Aave, Compound, and Moonwell.

### 6.4 Choosing \(\alpha\) is a policy choice

No paper or protocol source can determine the correct caution level for this vault. Pre-register a small candidate grid, measure coverage/shortfall/return/turnover on a calibration era, select using a written loss function, then freeze it for untouched evaluation. Choosing \(\alpha\) after inspecting held-out performance invalidates the claimed coverage.

## 7. Non-stationarity and volatility

Many time-series methods assume stable mean, variance, and autocorrelation. NIST defines stationarity in precisely those terms and notes that trends, changing variance, and seasonality violate it.[^nist-stationarity] Lending returns can break when governance changes curves, reward programs start/end, total liquidity moves, or token prices gap.

Deterministic safeguards/candidates to compare include:

- rolling instead of unlimited expanding windows;
- fixed exponential decay;
- separate pre/post-configuration regimes keyed by code/configuration hash;
- a hard invalidation/warm-up after material rate-model, reward-controller, oracle, or market changes;
- robust scale such as median absolute deviation, plus an explicit floor so a calm period cannot produce zero uncertainty;
- a documented jump/staleness rule that makes data ineligible rather than silently winsorizing it;
- a kink-distance volatility surcharge already contemplated by the paper;
- coverage monitored both globally and in subgroups: protocol, utilization band, rewards-on/off, kink proximity, and market regime.

Adaptive conformal inference aims at long-run coverage under shift, but long-run marginal coverage can still hide poor coverage precisely in the adverse regime relevant to a vault. Subgroup and worst-window coverage remain necessary.

## 8. Reward APR must be modeled separately before aggregation

For each reward token \(q\), a transparent first-order interval reward estimate is:

\[
R^{\text{reward}}_{i,q,H}(x)=
\frac{\int_t^{t+H}\!E_{i,q}(s)\,a_i(x,s)\,ds}
{x}\times P^{\text{USDC}}_{q,H}
-\frac{C^{\text{claim}}+C^{\text{swap}}+C^{\text{slippage}}}{x},
\]

where \(E\) is emitted tokens per second and \(a_i\) is the vault's eligible share of the supplier reward denominator after adding \(x\). Known campaign end timestamps truncate the integral. Compound rewards have a minimum aggregate base principal condition and external claim contract; Moonwell can distribute multiple reward tokens and requires claims; Aave's incentives configuration includes emission and distribution-end fields.[^compound-rewards][^moonwell-faq][^aave-rewards]

Uncertainty components should remain visible:

- **schedule/configuration:** emissions can end or be changed; use zero beyond a known end and do not extrapolate an expired campaign;
- **dilution:** other suppliers and the vault's own \(x\) change its fraction;
- **claimability:** an indicated reward is not USDC until the adapter can claim it;
- **price:** volatile reward token/USDC conversion;
- **execution:** executable DEX output, depth, route, fees, slippage, MEV exposure, and claim/swap gas;
- **timing:** small rewards may be uneconomic to harvest within \(H\).

Three auditable approaches can be evaluated: (1) give uncontracted/externally administered rewards zero forecast value; (2) use scheduled emissions but a conservative lower price and upper execution-cost estimate; or (3) forecast the combined realized net return so historical reward failures enter the residual tail. Adding a separate reward haircut *and* calibrating on already-net residuals can double-count the same uncertainty, so the decomposition must be explicit.

## 9. Minimum data and cold-start behavior

There is no universal sample count that makes a non-stationary DeFi forecast reliable. Minimum-data policy must be presented as a pre-registered engineering gate, then validated.

Necessary constraints are:

- no outcome can enter training until a complete \(H\) plus availability lag has elapsed;
- empirical \(\alpha\)-tails have resolution of roughly one order statistic per \(1/\alpha\) observations—at 5%, 20 completed errors place only about one observation in the nominal tail;
- overlapping windows do not create the same information as independent completed horizons;
- each configuration regime and rewards-on/off state needs coverage evidence if bounds are claimed for it;
- ARX needs materially more completed origins than its number of fitted parameters and enough variation in each feature.

Reasonable values to *test*, not accept as facts, are at least 100 completed calibration errors for a 5% bound (only about five nominal exceptions) and preferably 250–500 before relying on formal tail tests. Kupiec showed that verifying increasingly small tail probabilities becomes substantially harder.[^kupiec] A production policy also needs an explicit cold-start outcome: market ineligible, base-rate-only with maximum haircut, or capped allocation. This note does not choose among them.

## 10. Walk-forward tests and metrics

### 10.1 Forecast and bound quality

For every method, market, vault-size tier, and regime, report:

- mean error (bias), MAE, RMSE, and MASE versus a persistence forecast; Hyndman and Koehler introduce MASE as a scale-free measure suitable for comparing series.[^mase]
- lower-bound exception indicator \(1[R_t<L_t]\), observed exception rate, target \(\alpha\), and binomial confidence interval;
- Kupiec unconditional-coverage test and Christoffersen conditional-coverage/independence test, with the warning that overlapping horizons violate simple independence assumptions;[^kupiec][^christoffersen]
- quantile/pinball loss when the forecast target is a lower quantile; Gneiting shows that quantiles correspond to asymmetric piecewise-linear scoring functions.[^gneiting-quantile]
- mean and maximum shortfall conditional on an exception, not only exception count;
- bound sharpness/conservatism: average \(\hat\mu-L\), plus the return sacrificed when overly low bounds reject profitable moves;
- coverage by protocol, utilization/kink band, reward state, volatility state, and rolling time window;
- residual autocorrelation and drift diagnostics.

### 10.2 Controller outcomes

The paper's existing metrics remain required: realized net APY and ERC-4626 share-price growth; user-cohort return; gas, claim, and swap cost; turnover and turnover-budget use; rebalances, reversals, and cooldown blocks; allocation regret versus the diagnostic hindsight policy; drawdown and expected shortfall; withdrawal success and stressed liquid coverage; unavailable assets, dependency concentration, and policy violations.

For the uncertainty hypothesis specifically, compare capacity-aware allocation with and without the bound while holding all other constraints, information, execution latency, and costs constant. Report both downside reduction and return/turnover penalty.

### 10.3 Software and reproducibility tests

The TypeScript implementation should include:

- golden vectors for each protocol's exact post-deposit rate at below-kink, kink, above-kink, zero-supply, cap, and integer-rounding boundaries;
- interval integration tests with irregular block times and a reward campaign ending inside \(H\);
- proofs/tests that a training row's label end and availability time precede its forecast origin;
- fixtures for missing blocks, stale prices, reorg replacement, proxy/configuration change, paused markets, zero/negative price, expired rewards, illiquid swaps, and insufficient history;
- deterministic replay under shuffled database retrieval order;
- identical result hashes across repeated runs from the same snapshot, data version, policy version, and code commit;
- property tests that increasing \(x\) uses the exact protocol post-deposit curve, never exceeds caps, and cannot turn missing data into a positive reward;
- reconciliation of predicted versus realized adapter balance/index growth and claimed/sold reward proceeds.

## 11. Practical implications for the upcoming design discussion

The evidence narrows the questions but does not answer them on the user's behalf:

1. What fixed \(H\) should match the expected holding/rebalance interval, and at what snapshot cadence?
2. Is \(\ell\) intended to bound the conditional mean or the next realized horizon return?
3. Should the initial comparator set include all A/B/C, or only A/B with C deferred until sufficient data?
4. Should \(z_\alpha\) be a frozen Gaussian/Student multiplier, a frozen empirical standardized-residual quantile, or a versioned rolling conformal rule?
5. What cold-start behavior is acceptable for a newly enabled market or changed configuration?
6. Which reward sources count as sufficiently on-chain and claimable, and what price/DEX source and liquidation rule will value them?
7. Should coverage be enforced pointwise per market, simultaneously across markets, or at the final policy portfolio level?

These decisions should be made only after the same historical dataset runs through the candidate walk-forward replays.

## Primary sources

[^aave-rate]: Aave, [`DefaultReserveInterestRateStrategy.sol`](https://github.com/aave/aave-v3-core/blob/master/contracts/protocol/pool/DefaultReserveInterestRateStrategy.sol), official source.
[^aave-rewards]: Aave DAO, [`RewardsDistributor.sol`](https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/rewards/RewardsDistributor.sol), official Aave V3 Origin source; its reward data include emission rate, distribution end, and indexes. The deployed Base controller and implementation must still be pinned independently.
[^compound-rates]: Compound Finance, [Compound III Interest Rates](https://docs.compound.finance/interest-rates/), official documentation.
[^compound-comet]: Compound Finance, [`Comet.sol`](https://github.com/compound-finance/comet/blob/main/contracts/Comet.sol), official source; see supply/borrow curve parameters, `getSupplyRate`, tracking speeds, `baseMinForRewards`, and `accrueInternal`.
[^compound-rewards]: Compound Finance, [Compound III Protocol Rewards](https://docs.compound.finance/protocol-rewards/), official documentation.
[^moonwell-faq]: Moonwell, [Lend FAQ: base APY and rewards](https://docs.moonwell.fi/moonwell/moonwell-overview/lend/lend-faq), official documentation.
[^moonwell-source]: Moonwell, [Moonwell Protocol V2 contracts](https://github.com/moonwell-fi/moonwell-contracts-v2), official source repository; see `JumpRateModel` and `MultiRewardDistributor`.
[^nist-prediction]: NIST/SEMATECH, [Engineering Statistics Handbook §4.1.3.2, Prediction](https://www.itl.nist.gov/div898/handbook/pmd/section1/pmd132.htm).
[^nist-ar]: NIST/SEMATECH, [Engineering Statistics Handbook §6.4.4.4, Common Approaches to Univariate Time Series](https://www.itl.nist.gov/div898/handbook/pmc/section4/pmc444.htm).
[^nist-ewma]: NIST/SEMATECH, [Engineering Statistics Handbook §6.4.3.1, Single Exponential Smoothing](https://www.itl.nist.gov/div898/handbook/pmc/section4/pmc431.htm).
[^nist-t]: NIST/SEMATECH, [Engineering Statistics Handbook §1.3.6.6.4, Student's t Distribution](https://www.itl.nist.gov/div898/handbook/eda/section3/eda3664.htm) and [one-sided critical values](https://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm).
[^nist-stationarity]: NIST/SEMATECH, [Engineering Statistics Handbook §6.4.4.2, Stationarity](https://www.itl.nist.gov/div898/handbook/pmc/section4/pmc442.htm).
[^tscv]: R. J. Hyndman and G. Athanasopoulos, [*Forecasting: Principles and Practice*, 3rd ed., §5.10, Time-Series Cross-Validation](https://otexts.com/fpp3/tscv.html), author-hosted textbook.
[^newey-west]: W. K. Newey and K. D. West, [“A Simple, Positive Semi-Definite, Heteroskedasticity and Autocorrelation Consistent Covariance Matrix,”](https://www.jstor.org/stable/1913610) *Econometrica*, vol. 55, no. 3, 1987, doi: 10.2307/1913610.
[^weighted-conformal]: R. F. Barber, E. J. Candès, A. Ramdas, and R. J. Tibshirani, [“Conformal Prediction Beyond Exchangeability,”](https://doi.org/10.1214/23-AOS2276) *Annals of Statistics*, vol. 51, no. 2, 2023.
[^adaptive-conformal]: I. Gibbs and E. J. Candès, [“Adaptive Conformal Inference Under Distribution Shift,”](https://papers.neurips.cc/paper_files/paper/2021/hash/0d441de75945e5acbc865406fc9a2559-Abstract.html) *NeurIPS 2021*.
[^kupiec]: P. H. Kupiec, [“Techniques for Verifying the Accuracy of Risk Measurement Models,”](https://www.fedinprint.org/item/fedgfe/34596/original) Federal Reserve Finance and Economics Discussion Series 95-24, 1995.
[^christoffersen]: P. F. Christoffersen, [“Evaluating Interval Forecasts,”](https://doi.org/10.2307/2527341) *International Economic Review*, vol. 39, no. 4, 1998.
[^mase]: R. J. Hyndman and A. B. Koehler, [“Another Look at Measures of Forecast Accuracy,”](https://robjhyndman.com/papers/mase.pdf) *International Journal of Forecasting*, vol. 22, no. 4, 2006, doi: 10.1016/j.ijforecast.2006.03.001.
[^gneiting-quantile]: T. Gneiting, [“Making and Evaluating Point Forecasts,”](https://doi.org/10.1198/jasa.2011.r10138) *Journal of the American Statistical Association*, vol. 106, no. 494, 2011.
