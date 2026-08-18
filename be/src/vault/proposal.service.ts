/**
 * ProposalService — manages SRCLA rebalance proposals.
 *
 * Two-phase proposal lifecycle:
 * 1. Backend creates an unsigned proposal (PENDING)
 * 2. SRCLA reviews and approves/rejects (APPROVED/REJECTED)
 * 3. If approved, SRCLA signs it (signature added)
 * 4. Keeper executes on-chain (EXECUTED)
 *
 * Proposals are linked to SRCLA Decision records via decisionHash.
 */
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma, ProposalStatus } from '@prisma/client';

export interface CreateProposalInput {
  actions: Prisma.InputJsonValue;
  targetReserve: bigint;
  estimatedCost: bigint;
  decisionHash?: string;
}

export interface ApproveProposalInput {
  valid: boolean;
  reasons: string[];
  policyChecks: {
    admissionPassed: boolean;
    costGatePassed: boolean;
    reservePassed: boolean;
    capsPassed: boolean;
  };
}

export interface ProposalDto {
  id: string;
  status: string;
  actions: Prisma.JsonValue;
  targetReserve: string;
  estimatedCost: string;
  evaluation: Prisma.JsonValue | null;
  signature: string | null;
  decisionHash: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ProposalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new proposal with PENDING status
   */
  async createProposal(
    actions: Prisma.InputJsonValue,
    targetReserve: bigint,
    decisionHash?: string,
  ): Promise<ProposalDto> {
    const proposal = await this.prisma.proposal.create({
      data: {
        actions,
        targetReserve,
        estimatedCost: 0n,
        decisionHash,
        status: 'PENDING',
      },
    });

    return this.toDto(proposal);
  }

  /**
   * Get proposal by ID
   */
  async getProposal(id: string): Promise<ProposalDto> {
    const proposal = await this.prisma.proposal.findUniqueOrThrow({
      where: { id },
    });

    return this.toDto(proposal);
  }

  /**
   * Approve or reject a proposal
   */
  async approveProposal(
    id: string,
    evaluation: ApproveProposalInput,
  ): Promise<ProposalDto> {
    const proposal = await this.prisma.proposal.findUniqueOrThrow({
      where: { id },
    });

    if (proposal.status !== 'PENDING') {
      throw new BadRequestException(
        `Proposal ${id} is not pending (current: ${proposal.status})`,
      );
    }

    const newStatus = evaluation.valid ? 'APPROVED' : 'REJECTED';

    const updated = await this.prisma.proposal.update({
      where: { id },
      data: {
        status: newStatus,
        evaluation: evaluation as unknown as Prisma.InputJsonValue,
      },
    });

    return this.toDto(updated);
  }

  /**
   * Add SRCLA keeper signature to an approved proposal
   */
  async signProposal(id: string, signature: string): Promise<ProposalDto> {
    const proposal = await this.prisma.proposal.findUniqueOrThrow({
      where: { id },
    });

    if (proposal.status !== 'APPROVED') {
      throw new BadRequestException(
        `Proposal ${id} is not approved (current: ${proposal.status})`,
      );
    }

    const updated = await this.prisma.proposal.update({
      where: { id },
      data: { signature },
    });

    return this.toDto(updated);
  }

  /**
   * Mark proposal as executed
   */
  async executeProposal(id: string): Promise<ProposalDto> {
    const proposal = await this.prisma.proposal.findUniqueOrThrow({
      where: { id },
    });

    if (proposal.status !== 'APPROVED') {
      throw new BadRequestException(
        `Proposal ${id} is not approved (current: ${proposal.status})`,
      );
    }

    if (!proposal.signature) {
      throw new BadRequestException(
        `Proposal ${id} has no SRCLA signature`,
      );
    }

    const updated = await this.prisma.proposal.update({
      where: { id },
      data: {
        status: 'EXECUTED',
        executedAt: new Date(),
      },
    });

    return this.toDto(updated);
  }

  /**
   * Mark proposal as expired
   */
  async expireProposal(id: string): Promise<ProposalDto> {
    const proposal = await this.prisma.proposal.findUniqueOrThrow({
      where: { id },
    });

    if (proposal.status !== 'PENDING' && proposal.status !== 'APPROVED') {
      throw new BadRequestException(
        `Proposal ${id} cannot be expired (current: ${proposal.status})`,
      );
    }

    const updated = await this.prisma.proposal.update({
      where: { id },
      data: { status: 'EXPIRED' },
    });

    return this.toDto(updated);
  }

  /**
   * Get proposals by status
   */
  async getProposalsByStatus(status: ProposalStatus): Promise<ProposalDto[]> {
    const proposals = await this.prisma.proposal.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
    });

    return proposals.map(this.toDto);
  }

  /**
   * Get pending proposals ready for SRCLA review
   */
  async getPendingProposals(): Promise<ProposalDto[]> {
    return this.getProposalsByStatus('PENDING');
  }

  /**
   * Get approved proposals awaiting execution
   */
  async getApprovedProposals(): Promise<ProposalDto[]> {
    return this.getProposalsByStatus('APPROVED');
  }

  /**
   * Link a proposal to a decision record
   */
  async linkToDecision(
    proposalId: string,
    decisionHash: string,
  ): Promise<ProposalDto> {
    const proposal = await this.prisma.proposal.findUniqueOrThrow({
      where: { id: proposalId },
    });

    if (proposal.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot link proposal ${proposalId} to decision (status: ${proposal.status})`,
      );
    }

    const updated = await this.prisma.proposal.update({
      where: { id: proposalId },
      data: { decisionHash },
    });

    return this.toDto(updated);
  }

  /**
   * Convert Prisma model to DTO with BigInt serialization
   */
  private toDto(proposal: {
    id: string;
    status: ProposalStatus;
    actions: Prisma.JsonValue;
    targetReserve: bigint;
    estimatedCost: bigint;
    evaluation: Prisma.JsonValue | null;
    signature: string | null;
    decisionHash: string | null;
    executedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): ProposalDto {
    return {
      id: proposal.id,
      status: proposal.status,
      actions: proposal.actions,
      targetReserve: proposal.targetReserve.toString(),
      estimatedCost: proposal.estimatedCost.toString(),
      evaluation: proposal.evaluation,
      signature: proposal.signature,
      decisionHash: proposal.decisionHash,
      executedAt: proposal.executedAt?.toISOString() ?? null,
      createdAt: proposal.createdAt.toISOString(),
      updatedAt: proposal.updatedAt.toISOString(),
    };
  }
}
