/**
 * §7.2 label persistence: recording the realized return for a forecast once
 * its horizon has elapsed, so calibration has a held-out target.
 *
 * UNWIRED, AND DELIBERATELY KEPT. `persistForecastLabel`,
 * `persistForecastLabels`, `getAvailableLabels` and `createLabelFromForecast`
 * have no caller anywhere in src/, scripts/ or test/, and this is the ONLY
 * code in the repo that writes a `ForecastLabel` row (verified by grep for
 * `forecastLabel.create`/`createMany`). It duplicates nothing: the live
 * READER, `runtime/decision-driver.ts#buildRawOriginFromCollector`, only
 * reads those rows.
 *
 * This gap is already recorded from the reader's side — see
 * `policy/artifact.ts`'s "Whole-branch review, MEDIUM 7" note, which lists
 * it as one of three independent reasons the kernel admits nothing end to
 * end in production.
 *
 * WHAT IS MISSING TO WIRE IT, and it is more than a caller:
 *   1. A caller. Nothing schedules label creation when a horizon elapses;
 *      the natural home is the weekly walk-forward step in
 *      `runtime/scheduler.ts`.
 *   2. The §10.2 provenance columns. These writers set only the legacy
 *      `originTimestamp`/`horizonSeconds`/`realizedReturnE18`/`availableAt`
 *      fields. The live reader filters on `where: { horizonEndsAt: { not:
 *      null } }` and orders by `horizonEndsAt`, and the policy needs
 *      `realizedReturnWad` and `realizedMinCashBase` (prisma/schema.prisma
 *      ForecastLabel). A row written by this file as it stands would be
 *      invisible to the reader.
 *   3. `createLabelFromForecast` stamps `originTimestamp: new Date()` —
 *      the time the label is CREATED, not the origin the forecast was made
 *      at. That is a look-ahead bug and must be fixed, not carried forward,
 *      when a caller supplies the real origin.
 */
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
