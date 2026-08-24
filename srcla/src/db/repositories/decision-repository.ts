/**
 * Decision Repository
 *
 * Provides CRUD operations for decisions and execution plans.
 * Uses Prisma's any type to avoid complex JSON type issues.
 */
import type { PrismaClient } from '@prisma/client';

export interface DecisionRecord {
  id: string;
  decisionHash: string;
  policyVersion: string;
  snapshotHash: string;
  blockNumber: string;
  timestamp: Date;
  admissions: unknown;
  forecasts: unknown;
  reserveBase: string;
  allocation: unknown;
  actionDecision: unknown;
}

export interface PlanActionRecord {
  id: string;
  planId: string;
  actionIndex: number;
  kind: string;
  adapter: string;
  amountBase: string;
  status: string;
  txHash: string | null;
  error: string | null;
}

export interface ExecutionPlanRecord {
  id: string;
  planId: string;
  decisionHash: string;
  status: string;
  createdAt: Date;
  expiresAt: Date;
  actions: PlanActionRecord[];
}

export class DecisionRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Store a decision
   */
  async createDecision(data: {
    decisionHash: string;
    policyVersion: string;
    snapshotHash: string;
    blockNumber: bigint;
    timestamp: Date;
    admissions: unknown;
    forecasts: unknown;
    reserveBase: bigint;
    allocation: unknown;
    actionDecision: unknown;
  }): Promise<DecisionRecord> {
    return this.prisma.decision.create({
      data: {
        decisionHash: data.decisionHash,
        policyVersion: data.policyVersion,
        snapshotHash: data.snapshotHash,
        blockNumber: Number(data.blockNumber),
        timestamp: data.timestamp,
        admissions: data.admissions as any,
        forecasts: data.forecasts as any,
        reserveBase: data.reserveBase.toString(),
        allocation: data.allocation as any,
        actionDecision: data.actionDecision as any,
      },
    }) as unknown as Promise<DecisionRecord>;
  }

  /**
   * Get decision by hash
   */
  async getByHash(decisionHash: string): Promise<DecisionRecord | null> {
    return this.prisma.decision.findUnique({
      where: { decisionHash },
    }) as unknown as Promise<DecisionRecord | null>;
  }

  /**
   * Get decisions within a time range
   */
  async getDecisionsInRange(
    startDate: Date,
    endDate: Date
  ): Promise<DecisionRecord[]> {
    return this.prisma.decision.findMany({
      where: {
        timestamp: { gte: startDate, lte: endDate },
      },
      orderBy: { timestamp: 'asc' },
    }) as unknown as Promise<DecisionRecord[]>;
  }

  /**
   * Create an execution plan
   */
  async createPlan(data: {
    planId: string;
    decisionHash: string;
    expiresAt: Date;
    actions: Array<{
      actionIndex: number;
      kind: string;
      adapter: string;
      amountBase: bigint;
    }>;
  }): Promise<ExecutionPlanRecord> {
    return this.prisma.executionPlan.create({
      data: {
        planId: data.planId,
        decisionHash: data.decisionHash,
        status: 'pending',
        createdAt: new Date(),
        expiresAt: data.expiresAt,
        actions: {
          create: data.actions.map((a) => ({
            actionIndex: a.actionIndex,
            kind: a.kind,
            adapter: a.adapter,
            amountBase: a.amountBase.toString(),
            status: 'pending',
          })),
        },
      },
      include: { actions: true },
    }) as unknown as Promise<ExecutionPlanRecord>;
  }

  /**
   * Update plan status
   */
  async updatePlanStatus(
    planId: string,
    status: string
  ): Promise<ExecutionPlanRecord> {
    return this.prisma.executionPlan.update({
      where: { planId },
      data: { status },
      include: { actions: true },
    }) as unknown as Promise<ExecutionPlanRecord>;
  }

  /**
   * Update action status
   */
  async updateActionStatus(
    planId: string,
    actionIndex: number,
    data: {
      status?: string;
      txHash?: string;
      error?: string;
    }
  ): Promise<PlanActionRecord> {
    return this.prisma.planAction.update({
      where: {
        planId_actionIndex: { planId, actionIndex },
      },
      data,
    }) as unknown as Promise<PlanActionRecord>;
  }

  /**
   * Get plan by ID
   */
  async getPlan(planId: string): Promise<ExecutionPlanRecord | null> {
    return this.prisma.executionPlan.findUnique({
      where: { planId },
      include: { actions: { orderBy: { actionIndex: 'asc' } } },
    }) as unknown as Promise<ExecutionPlanRecord | null>;
  }

  /**
   * Get pending plans
   */
  async getPendingPlans(): Promise<ExecutionPlanRecord[]> {
    const now = new Date();
    return this.prisma.executionPlan.findMany({
      where: {
        status: 'pending',
        expiresAt: { gt: now },
      },
      include: { actions: { orderBy: { actionIndex: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }) as unknown as Promise<ExecutionPlanRecord[]>;
  }

  /**
   * Get expired plans
   */
  async getExpiredPlans(): Promise<ExecutionPlanRecord[]> {
    const now = new Date();
    return this.prisma.executionPlan.findMany({
      where: {
        status: 'pending',
        expiresAt: { lt: now },
      },
    }) as unknown as Promise<ExecutionPlanRecord[]>;
  }
}
