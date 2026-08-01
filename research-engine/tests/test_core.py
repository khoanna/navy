from decimal import Decimal

from srcla.core import (
    Market,
    capacity_aware_target,
    dynamic_reserve,
    post_deposit_utilization,
    should_rebalance,
    user_profit,
)


def test_post_deposit_utilization_accounts_for_vault_size():
    assert post_deposit_utilization(Decimal(90), Decimal(100), Decimal(20)) == Decimal("0.75")


def test_capacity_aware_target_splits_when_deposit_depresses_rate():
    markets = [
        Market("a", Decimal(90), Decimal(100), Decimal("0.20"), Decimal("0.02"), Decimal(1)),
        Market("b", Decimal(50), Decimal(100), Decimal("0.12"), Decimal("0.04"), Decimal(1)),
    ]
    target = capacity_aware_target(markets, Decimal(100), step=Decimal(10))
    assert sum(target.values()) == Decimal(100)
    assert target["a"] < Decimal(100)
    assert target["b"] > Decimal(0)


def test_capacity_target_respects_hard_caps_and_ineligible_markets():
    markets = [
        Market("safe", Decimal(80), Decimal(100), Decimal("0.15"), Decimal("0.03"), Decimal("0.4")),
        Market("blocked", Decimal(99), Decimal(100), Decimal(1), Decimal("0.01"), Decimal(1), eligible=False),
    ]
    target = capacity_aware_target(markets, Decimal(100), step=Decimal(10))
    assert target == {"safe": Decimal(40), "blocked": Decimal(0)}


def test_dynamic_reserve_uses_largest_hard_requirement():
    assert dynamic_reserve(Decimal(100000), Decimal("0.05"), Decimal(9000), Decimal(12000)) == Decimal(12000)


def test_no_trade_gate_uses_conservative_gain_and_safety_override():
    assert not should_rebalance(Decimal(7), Decimal(5), Decimal(1), Decimal(2), safety=False)
    assert should_rebalance(Decimal(9), Decimal(5), Decimal(1), Decimal(2), safety=False)
    assert should_rebalance(Decimal(-10), Decimal(100), Decimal(1), Decimal(2), safety=True)


def test_late_depositor_does_not_receive_earlier_profit():
    # A deposited 10k at share price 1.00; B deposited 11k at 1.10 and received 10k shares.
    final_share_price = Decimal("1.21")
    assert user_profit(Decimal(10000), final_share_price, Decimal(10000), Decimal(0)) == Decimal(2100)
    assert user_profit(Decimal(10000), final_share_price, Decimal(11000), Decimal(0)) == Decimal(1100)
