import { PrismaClient, ForecastLabel } from '@prisma/client';
import type { ForecastResult } from './types.js';

const prisma = new PrismaClient();

export interface LabelInput {
  marketId: string;
  originTimestamp: Date;
  horizonSeconds: number;
  realizedReturnE18: bigint;
}

/**
 * Persist a forecast label when the realized return becomes available.
 * Called during walk-forward calibration or when a forecast horizon expires.
 */
export async function persistForecastLabel(input: LabelInput): Promise<ForecastLabel> {
  return prisma.forecastLabel.create({
    data: {
      marketId: input.marketId,
      originTimestamp: input.originTimestamp,
      horizonSeconds: input.horizonSeconds,
      realizedReturnE18: input.realizedReturnE18.toString(),
      availableAt: new Date(),
    },
  });
}

/**
 * Persist multiple forecast labels in a batch.
 * Useful for walk-forward calibration where multiple labels become available at once.
 * Returns the count of labels created.
 */
export async function persistForecastLabels(inputs: LabelInput[]): Promise<number> {
  if (inputs.length === 0) return 0;

  const result = await prisma.forecastLabel.createMany({
    data: inputs.map((input) => ({
      marketId: input.marketId,
      originTimestamp: input.originTimestamp,
      horizonSeconds: input.horizonSeconds,
      realizedReturnE18: input.realizedReturnE18.toString(),
      availableAt: new Date(),
    })),
  });

  return result.count;
}

/**
 * Get forecast labels for a market that are available as of a given date.
 * Used during calibration to get realized returns for evaluation.
 */
export async function getAvailableLabels(
  marketId: string,
  asOfDate: Date = new Date()
): Promise<ForecastLabel[]> {
  return prisma.forecastLabel.findMany({
    where: {
      marketId,
      availableAt: { lte: asOfDate },
    },
    orderBy: { availableAt: 'asc' },
  });
}

/**
 * Create label input from a ForecastResult by computing the realized return.
 * This is called after the horizon period has passed to record what actually happened.
 */
export function createLabelFromForecast(
  forecast: ForecastResult,
  realizedReturn: bigint
): LabelInput {
  return {
    marketId: forecast.marketId,
    originTimestamp: new Date(), // or pass in the forecast's origin timestamp
    horizonSeconds: forecast.horizon,
    realizedReturnE18: realizedReturn,
  };
}
