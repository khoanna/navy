from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True)
class Market:
    market_id: str
    borrows: Decimal
    supply: Decimal
    rate_slope: Decimal
    rate_base: Decimal
    cap_fraction: Decimal
    eligible: bool = True

    def rate_after(self, deposit: Decimal) -> Decimal:
        return self.rate_base + self.rate_slope * post_deposit_utilization(self.borrows, self.supply, deposit)


def post_deposit_utilization(borrows: Decimal, supply: Decimal, deposit: Decimal) -> Decimal:
    denominator = supply + deposit
    if denominator <= 0:
        raise ValueError("supply plus deposit must be positive")
    return borrows / denominator


def capacity_aware_target(markets: list[Market], capital: Decimal, *, step: Decimal) -> dict[str, Decimal]:
    if capital < 0 or step <= 0:
        raise ValueError("capital must be nonnegative and step positive")
    target = {market.market_id: Decimal(0) for market in markets}
    remaining = capital
    while remaining >= step:
        candidates = [
            market
            for market in markets
            if market.eligible and target[market.market_id] + step <= capital * market.cap_fraction
        ]
        if not candidates:
            break
        def portfolio_yield_after(candidate: Market) -> Decimal:
            total = Decimal(0)
            for market in markets:
                amount = target[market.market_id] + (step if market == candidate else Decimal(0))
                total += amount * market.rate_after(amount)
            return total

        chosen = max(candidates, key=portfolio_yield_after)
        target[chosen.market_id] += step
        remaining -= step
    return target


def dynamic_reserve(
    total_assets: Decimal,
    minimum_fraction: Decimal,
    withdrawal_quantile: Decimal,
    stress_shortfall: Decimal,
) -> Decimal:
    return max(total_assets * minimum_fraction, withdrawal_quantile, stress_shortfall)


def should_rebalance(
    conservative_gain: Decimal,
    execution_cost: Decimal,
    reversal_penalty: Decimal,
    safety_margin: Decimal,
    *,
    safety: bool,
) -> bool:
    return safety or conservative_gain > execution_cost + reversal_penalty + safety_margin


def user_profit(
    shares: Decimal,
    share_price: Decimal,
    total_deposits: Decimal,
    prior_withdrawals: Decimal,
) -> Decimal:
    return shares * share_price + prior_withdrawals - total_deposits
