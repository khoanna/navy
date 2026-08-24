/**
 * Evaluation Repository
 *
 * Provides CRUD operations for evaluation runs and calibration results.
 */
import { PrismaClient } from '@prisma/client';

export interface EvaluationRunRecord {
  id: string;
  manifestHash: string;
  status: string;
  results: unknown | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface CalibrationRecord {
  id: string;
  method: string;
  config: unknown;
  lossMetrics: unknown;
  artifactHash: string | null;
  selected: boolean;
  createdAt: Date;
}

export class EvaluationRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new evaluation run
   */
  async createRun(manifestHash: string): Promise<EvaluationRunRecord> {
    return this.prisma.evaluationRun.create({
      data: {
        manifestHash,
        status: 'running',
        startedAt: new Date(),
      },
    });
  }

  /**
   * Update evaluation run with results
   */
  async completeRun(
    manifestHash: string,
    status: 'passed' | 'failed',
    results: unknown
  ): Promise<EvaluationRunRecord> {
    return this.prisma.evaluationRun.update({
      where: { manifestHash },
      data: {
        status,
        results: results as any,
        completedAt: new Date(),
      },
    });
  }

  /**
   * Get evaluation run by manifest hash
   */
  async getRun(manifestHash: string): Promise<EvaluationRunRecord | null> {
    return this.prisma.evaluationRun.findUnique({
      where: { manifestHash },
    });
  }

  /**
   * Get all evaluation runs
   */
  async getAllRuns(limit: number = 100): Promise<EvaluationRunRecord[]> {
    return this.prisma.evaluationRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Store calibration result
   */
  async createCalibration(data: {
    method: string;
    config: unknown;
    lossMetrics: unknown;
    artifactHash?: string;
    selected?: boolean;
  }): Promise<CalibrationRecord> {
    return this.prisma.forecastCalibration.create({
      data: {
        method: data.method,
        config: data.config as any,
        lossMetrics: data.lossMetrics as any,
        artifactHash: data.artifactHash ?? null,
        selected: data.selected ?? false,
      },
    });
  }

  /**
   * Get selected calibration for a method
   */
  async getSelectedCalibration(
    method: string
  ): Promise<CalibrationRecord | null> {
    return this.prisma.forecastCalibration.findFirst({
      where: { method, selected: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get all calibrations for a method
   */
  async getCalibrations(
    method: string,
    limit: number = 50
  ): Promise<CalibrationRecord[]> {
    return this.prisma.forecastCalibration.findMany({
      where: { method },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Mark a calibration as selected (and unselect others)
   */
  async selectCalibration(id: string): Promise<void> {
    const calibration = await this.prisma.forecastCalibration.findUnique({
      where: { id },
    });
    if (!calibration) return;

    await this.prisma.$transaction([
      // Unselect all for this method
      this.prisma.forecastCalibration.updateMany({
        where: { method: calibration.method, selected: true },
        data: { selected: false },
      }),
      // Select this one
      this.prisma.forecastCalibration.update({
        where: { id },
        data: { selected: true },
      }),
    ]);
  }
}
