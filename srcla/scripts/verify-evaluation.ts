#!/usr/bin/env tsx
/**
 * `pnpm run evaluation:verify <run.json>` — paper §2.2, §11.1, Appendix C.
 *
 * Appendix C documents this command; it did not exist. `package.json` had
 * `evaluation:run`, `evaluation:synthetic` and `evaluation:full`, and the
 * repo computed no result hash at all, so there was nothing for a verify
 * command to re-derive even if it had been written.
 *
 * It re-derives, from the emitted run record:
 *   - the RESULT hash, over every reported number;
 *   - the MANIFEST content hash;
 *   - the code commit, against `git rev-parse HEAD` in this tree;
 *   - the DATASET hash, against the observation series reloaded from
 *     Postgres — but only when `DATABASE_URL` is set.
 *
 * A leg that could not be checked is reported NOT CHECKED and the exit code
 * is non-zero. "I could not verify this" must never print like "this is
 * fine": that conflation is the same defect as the empty manifest hash that
 * verified clean.
 *
 * Exit codes: 0 fully verified, 1 a check FAILED, 2 some check was not run.
 *
 * Usage:
 *   pnpm run evaluation:verify evaluation-run.json
 *   DATABASE_URL=... pnpm run evaluation:verify evaluation-run.json   # all legs
 */
import { readFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { loadDataset } from '../src/evaluation/dataset.js';
import {
  verifyRunRecord,
  type EvaluationRunRecord,
} from '../src/evaluation/kernel/provenance.js';
import type { DatasetObservations } from '../src/evaluation/manifest/generator.js';

function currentCommit(): string | undefined {
  const fromEnv = process.env.GIT_COMMIT_HASH;
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim();
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Pull the run record out of whatever the run script wrote. The summary file
 * nests it under `record`; a bare record is accepted too.
 */
function readRecord(path: string): EvaluationRunRecord {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  const record = (parsed.record ?? parsed) as EvaluationRunRecord;
  if (record.recordVersion === undefined || record.results === undefined) {
    throw new Error(
      `${path} does not contain an evaluation run record. Produce one with ` +
        '`pnpm run evaluation:run --start ... --end ... --out <file>`.',
    );
  }
  return record;
}

async function loadObservations(
  record: EvaluationRunRecord,
): Promise<DatasetObservations | undefined> {
  if (process.env.DATABASE_URL === undefined || process.env.DATABASE_URL === '') return undefined;

  const prisma = new PrismaClient();
  try {
    const dataset = await loadDataset(
      prisma,
      record.manifest.id,
      new Date(record.manifest.dataset.startDate),
      new Date(record.manifest.dataset.endDate),
    );
    return { snapshots: dataset.snapshots, withdrawals: dataset.withdrawals ?? [] };
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<void> {
  const path = process.argv[2];
  if (path === undefined) {
    throw new Error('usage: evaluation:verify <run.json>');
  }

  const record = readRecord(path);
  const observations = await loadObservations(record);
  const commit = currentCommit();

  const report = await verifyRunRecord(record, {
    ...(observations !== undefined ? { observations } : {}),
    ...(commit !== undefined ? { currentCommit: commit } : {}),
  });

  console.log(`Run record: ${path}`);
  console.log(`  produced at ${record.runAt} from commit ${record.codeCommit}`);
  console.log('');
  for (const c of report.checks) {
    const mark = c.passed === true ? 'OK        ' : c.passed === false ? 'FAILED    ' : 'NOT CHECKED';
    console.log(`  [${mark}] ${c.name}: ${c.detail}`);
  }
  console.log('');

  if (report.verified) {
    console.log('VERIFIED: every hash re-derives from the record and the pinned dataset.');
    return;
  }

  const failed = report.checks.filter((c) => c.passed === false);
  if (failed.length > 0) {
    console.error(`NOT VERIFIED: ${failed.map((c) => c.name).join(', ')} failed.`);
    process.exitCode = 1;
    return;
  }

  console.error(
    'NOT VERIFIED: some checks could not be run. This is not a pass. ' +
      'Set DATABASE_URL to verify the dataset hash against the series the manifest pins.',
  );
  process.exitCode = 2;
}

main().catch((err: unknown) => {
  console.error('[evaluation:verify] FAILED:', err);
  process.exit(1);
});
