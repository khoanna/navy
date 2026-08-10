export interface ActionDecisionConfig {
  movementCostBps: bigint;
  cooldownSeconds: number;
  minActionAmount: bigint;
  turnoverBudgetBps: bigint;
}

export type ActionKind = 'deploy' | 'divest' | 'hold' | 'harvest';

export interface ActionDecision {
  action: ActionKind;
  amount: bigint;
  targetAdapter: string | null;
  reason: string;
}

export class ActionDecisionEngine {
  private config: ActionDecisionConfig;

  constructor(config: ActionDecisionConfig) {
    this.config = config;
  }

  decide(params: {
    currentAllocation: Map<string, bigint>;
    optimalAllocation: Map<string, bigint>;
    totalAssets: bigint;
    forecast: { meanReturn: bigint; lowerReturn: bigint }[];
    lastActionTimestamp: Date;
    recentTurnover: bigint;
  }): ActionDecision {
    const { currentAllocation, optimalAllocation, totalAssets, lastActionTimestamp, recentTurnover } = params;

    const cooldownPassed = Date.now() - lastActionTimestamp.getTime() > this.config.cooldownSeconds * 1000;
    if (!cooldownPassed) {
      return { action: 'hold', amount: 0n, targetAdapter: null, reason: 'COOLDOWN_ACTIVE' };
    }

    const turnoverBudget = (totalAssets * this.config.turnoverBudgetBps) / 10000n;
    if (recentTurnover >= turnoverBudget) {
      return { action: 'hold', amount: 0n, targetAdapter: null, reason: 'TURNOVER_BUDGET_EXCEEDED' };
    }

    let maxDivergence = 0n;
    let targetAdapter: string | null = null;
    let targetAmount = 0n;
    let isDeploy = true;

    for (const [adapter, optimal] of optimalAllocation) {
      const current = currentAllocation.get(adapter) ?? 0n;
      const divergence = optimal - current;

      if (divergence > maxDivergence) {
        maxDivergence = divergence;
        targetAdapter = adapter;
        targetAmount = divergence;
        isDeploy = true;
      } else if (-divergence > maxDivergence) {
        maxDivergence = -divergence;
        targetAdapter = adapter;
        targetAmount = -divergence;
        isDeploy = false;
      }
    }

    if (targetAmount < this.config.minActionAmount) {
      return { action: 'hold', amount: 0n, targetAdapter: null, reason: 'AMOUNT_BELOW_MINIMUM' };
    }

    if (isDeploy) {
      return {
        action: 'deploy',
        amount: targetAmount,
        targetAdapter,
        reason: `DEPLOY_TO_${targetAdapter}`,
      };
    } else {
      return {
        action: 'divest',
        amount: targetAmount,
        targetAdapter,
        reason: `DIVEST_FROM_${targetAdapter}`,
      };
    }
  }
}
