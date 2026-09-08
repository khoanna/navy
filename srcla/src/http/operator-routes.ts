import { createHash } from 'node:crypto';
import { FastifyInstance } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { ProposalEvaluator, RebalanceProposal } from '../evaluation/proposal-evaluator.js';
import { loadConfig } from '../config.js';
import { getSharedPrisma } from './prisma.js';
import type { Scheduler } from '../runtime/scheduler.js';

/**
 * The OPERATOR surface: everything that mutates.
 *
 * Paper §10.2 states the read API *"has no mutation or transaction endpoint."*
 * These three routes used to sit on the same listener as the reads. They are
 * not deleted — `POST /v1/internal/trigger` in particular is a first-class
 * feature — they are moved onto a separate Fastify instance that
 * `startOperatorServer` binds to `OPERATOR_HTTP_HOST` (127.0.0.1) only, so the
 * public listener carries reads and nothing else.
 */
export async function registerOperatorRoutes(
  server: FastifyInstance,
  scheduler?: Scheduler,
  prisma: PrismaClient = getSharedPrisma()
): Promise<void> {
  // POST /v1/manifests - Create a new manifest (§11)
  server.post('/v1/manifests', async (request, reply) => {
    const body = request.body as {
      datasetStart: string;
      datasetEnd: string;
      calibrationEnd: string;
      heldOutStart: string;
      markets: Array<{ marketId: string; protocol: string; adapterAddress: string }>;
    };

    // Validate required fields
    if (!body || !body.datasetStart || !body.datasetEnd || !body.calibrationEnd || !body.heldOutStart) {
      return reply.status(400).send({
        error: { code: 'INVALID_INPUT', message: 'Missing required date fields' },
      });
    }

    // Create manifest hash from content.
    // NOTE: this was `require('crypto')` before the split. This package is ESM
    // ("type": "module" + NodeNext), so `require` is not defined at runtime and
    // every call to this route threw ReferenceError. Fixed with a real import.
    const contentHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');

    const run = await prisma.evaluationRun.create({
      data: {
        manifestHash: contentHash,
        status: 'running',
        results: body,
      },
    });

    return reply.status(201).send({
      data: {
        id: run.id,
        manifestHash: run.manifestHash,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
      },
      meta: { timestamp: new Date().toISOString() },
    });
  });

  // POST /v1/proposals/review - Evaluate backend rebalance proposal (§4)
  server.post('/v1/proposals/review', async (request, reply) => {
    const body = request.body as {
      proposalId: string;
      actions: Array<{
        index: number;
        kind: 'deploy' | 'divest' | 'harvest' | 'emergency';
        adapter: string;
        amount: string;
        minOut: string;
      }>;
      targetReserve: string;
    };

    if (!body || !body.proposalId || !Array.isArray(body.actions) || body.targetReserve === undefined) {
      return reply.status(400).send({
        error: { code: 'INVALID_INPUT', message: 'Invalid proposal review payload' },
      });
    }

    try {
      const config = loadConfig();
      const evaluator = new ProposalEvaluator(config);

      const proposal: RebalanceProposal = {
        id: body.proposalId,
        actions: body.actions.map((a) => ({
          index: a.index,
          kind: a.kind,
          adapter: a.adapter,
          amount: BigInt(a.amount),
          minOut: BigInt(a.minOut),
        })),
        targetReserve: BigInt(body.targetReserve),
      };

      const result = await evaluator.reviewProposal(proposal);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Proposal review failed';
      return reply.status(500).send({
        error: { code: 'EVALUATION_FAILED', message },
      });
    }
  });

  // POST /v1/internal/trigger - Trigger manual decision cycle (§4)
  server.post('/v1/internal/trigger', async (request, reply) => {
    const { force = false } = (request.body as { force?: boolean }) ?? {};

    if (!scheduler) {
      return reply.status(503).send({
        error: { code: 'SCHEDULER_NOT_INITIALIZED', message: 'Scheduler not available' },
      });
    }

    try {
      const result = await scheduler.trigger(force);
      if (result.triggered) {
        return { triggered: true, message: result.message };
      } else {
        return reply.status(429).send({ triggered: false, message: result.message });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return reply.status(500).send({
        error: { code: 'TRIGGER_FAILED', message },
      });
    }
  });
}
