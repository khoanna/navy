/**
 * VaultAdminController — cohort-level accounting endpoints (admin-only).
 * Exposes read-only views of vault event history and profit tracking.
 */
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { VaultEventWatcher, DEFAULT_COHORT_ADDRESS } from './vault-event-watcher';
import { VaultService } from './vault.service';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ProposalService } from './proposal.service';

@Controller('vault/admin')
@UseGuards(RolesGuard)
@Roles('admin')
export class VaultController {
  constructor(
    private readonly vaultWatcher: VaultEventWatcher,
    private readonly vaultService: VaultService,
    private readonly proposalService: ProposalService,
  ) {}

  /**
   * POST /vault/admin/events/poll
   * Trigger a manual poll for new vault events.
   * Returns the number of events processed.
   */
  @Get('events/poll')
  async pollEvents(): Promise<{ processed: number }> {
    const processed = await this.vaultWatcher.pollEvents();
    return { processed };
  }

  /**
   * GET /vault/admin/cohorts
   * List all cohorts with their current balances.
   */
  @Get('cohorts')
  async getAllCohorts() {
    return this.vaultWatcher.getAllCohorts();
  }

  /**
   * GET /vault/admin/cohorts/:address
   * Get profit summary for a specific cohort (defaults to global cohort).
   */
  @Get('cohorts/:address')
  async getCohortProfit(@Param('address') address: string) {
    const cohortAddress = address === 'default' ? DEFAULT_COHORT_ADDRESS : address;
    const profit = await this.vaultWatcher.calculateCohortProfit(cohortAddress);
    if (!profit) {
      return { error: 'Cohort not found', cohortAddress };
    }
    return profit;
  }

  /**
   * GET /vault/admin/cohorts/:address/history
   * Get transaction history for a cohort.
   */
  @Get('cohorts/:address/history')
  async getCohortHistory(
    @Param('address') address: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    const cohortAddress = address === 'default' ? DEFAULT_COHORT_ADDRESS : address;
    return this.vaultWatcher.getCohortHistory(cohortAddress, {
      type,
      limit: limit ? parseInt(limit, 10) : undefined,
      cursor,
    });
  }

  /**
   * GET /vault/admin/strategy
   * Get current SRCLA strategy allocation (proxied from VaultService).
   */
  @Get('strategy')
  async getStrategy() {
    return this.vaultService.getStrategy();
  }

  /**
   * GET /vault/admin/decisions
   * Get SRCLA decision history.
   */
  @Get('decisions')
  async getDecisions(
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.vaultService.getDecisions({ cursor, limit });
  }

  /**
   * GET /vault/admin/rebalance/status
   * Get aggregated rebalance status: latest SRCLA decision + vault reserve state.
   * Combines on-chain vault data (requiredIdle, reserves, plan status) with
   * SRCLA decision data for the admin dashboard.
   */
  @Get('rebalance/status')
  async getRebalanceStatus() {
    return this.vaultService.getRebalanceStatus();
  }

  /**
   * GET /vault/admin/rebalance/proposals
   * Get vault rebalance proposal history.
   */
  @Get('rebalance/proposals')
  async getRebalanceProposals(@Query('status') status?: string) {
    return this.proposalService.getProposalsByStatus(
      status as any,
    );
  }

  /**
   * GET /vault/admin/harvests
   * Get harvest history from SRCLA.
   */
  @Get('harvests')
  async getHarvests(
    @Query('adapter') adapter?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.vaultService.getHarvests({ adapter, cursor, limit });
  }

  /**
   * POST /vault/admin/rebalance/trigger
   * Trigger a manual rebalance decision cycle in SRCLA.
   * Calls the SRCLA internal trigger endpoint to force a decision evaluation.
   */
  @Post('rebalance/trigger')
  async triggerRebalance(@Body() body: { force?: boolean }) {
    const force = body.force ?? false;
    return this.vaultService.triggerRebalance(force);
  }
}
