import type { MarketSnapshot, Decision, ExecutionPlan, HarvestRecord, PlanAction } from '@prisma/client';

export function serializeMarket(snapshot: MarketSnapshot) {
  return {
    marketId: snapshot.marketId,
    blockHash: snapshot.blockHash,
    timestamp: snapshot.timestamp.toISOString(),
    totalAssetsBase: snapshot.totalAssetsBase,
    idleBase: snapshot.idleBase,
    supplyRateE18: snapshot.supplyRateE18,
    utilizationE18: snapshot.utilizationE18,
    cashBase: snapshot.cashBase,
    borrowsBase: snapshot.borrowsBase,
    reservesBase: snapshot.reservesBase,
    capBps: snapshot.capBps,
    paused: snapshot.paused,
    configDigest: snapshot.configDigest,
  };
}

export function serializeDecision(decision: Decision) {
  return {
    decisionHash: decision.decisionHash,
    policyVersion: decision.policyVersion,
    snapshotHash: decision.snapshotHash,
    blockNumber: decision.blockNumber.toString(),
    timestamp: decision.timestamp.toISOString(),
    admissions: decision.admissions,
    forecasts: decision.forecasts,
    reserveBase: decision.reserveBase,
    allocation: decision.allocation,
    actionDecision: decision.actionDecision,
  };
}

export function serializePlan(plan: ExecutionPlan & { actions: PlanAction[] }) {
  return {
    planId: plan.planId,
    decisionHash: plan.decisionHash,
    status: plan.status,
    createdAt: plan.createdAt.toISOString(),
    expiresAt: plan.expiresAt.toISOString(),
    actions: plan.actions.map((action) => {
      return {
        actionIndex: action.actionIndex,
        kind: action.kind,
        adapter: action.adapter,
        amountBase: action.amountBase,
        status: action.status,
        txHash: action.txHash,
      };
    }),
  };
}

export function serializeHarvest(harvest: HarvestRecord) {
  return {
    id: harvest.id,
    timestamp: harvest.timestamp.toISOString(),
    adapter: harvest.adapter,
    rewardToken: harvest.rewardToken,
    routeId: harvest.routeId,
    amountIn: harvest.amountIn,
    amountOutBase: harvest.amountOutBase,
    decisionHash: harvest.decisionHash,
  };
}
