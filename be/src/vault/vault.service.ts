/**
 * VaultService — Deep module providing vault position queries, ERC-4626 limits,
 * unsigned calldata builders for local wallet signing, and SRCLA strategy integration.
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { ethers } from 'ethers';
import { NavyConfigService } from '../config/config.service';
import { SrclaClient, StrategyAllocation } from './srcla-client';
import { TransactionProposal, VaultPositionDto, VaultLimitsDto, HarvestRecordDto, HarvestsResponseDto, RebalanceStatusDto } from './vault.types';
import {
  checkDepositBalance,
  checkRedeemLiquidity,
  parseBaseAmount,
  preconditionBody,
} from './vault-preconditions';

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
] as const;

/** Known adapter addresses → human-readable protocol names (lowercase keys for case-insensitive lookup) */
const ADAPTER_NAMES: Record<string, string> = {
  '0x5b53a25ff5ec56a852cb4c0d193754308c6e99a0': 'Compound III',
  '0xfdcac27247ecb3452f88c8ea10caceabc19348eb': 'Aave V3',
  '0x5bb77832ba9cbe335fccddf8ef5520ae041326598': 'Moonwell',
};

const VAULT_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function maxWithdraw(address owner) view returns (uint256)',
  'function maxRedeem(address owner) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function maxDeposit(address) view returns (uint256)',
  'function previewDeposit(uint256 assets) view returns (uint256)',
  'function previewRedeem(uint256 shares) view returns (uint256)',
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
] as const;

/** Extended ABI for reserve/plan state view functions */
const VAULT_STATE_ABI = [
  'function requiredIdle() view returns (uint256)',
  'function adminReserve() view returns (uint256)',
  'function dynamicReserve() view returns (uint256)',
  'function activePlanReserve() view returns (uint256)',
  'function minIdleBps() view returns (uint256)',
  'function activePlanId() view returns (bytes32)',
  'function activePlanExpiresAt() view returns (uint64)',
] as const;

@Injectable()
export class VaultService {
  readonly provider: ethers.JsonRpcProvider;
  readonly chainId: number;
  readonly usdcAddress: string;
  readonly vaultAddress: string;
  readonly usdc: ethers.Contract;
  readonly vault: ethers.Contract;
  readonly vaultState: ethers.Contract; // read-only contract for reserve/plan state

  constructor(
    private readonly config: NavyConfigService,
    private readonly srclaClient: SrclaClient,
  ) {
    // Canonical EVM config — the vault runs on the same chain as payments.
    // (The old FARMING_BASE_* / FARMING_VAULT_ADDRESS duplicates existed only while
    // payments were on Sepolia and farming was on Base; both are Base now.)
    const rpcUrl = config.evmRpcUrl;
    this.chainId = config.evmChainId;
    this.usdcAddress = config.usdcAddress;
    this.vaultAddress = config.vaultAddress;

    this.provider = new ethers.JsonRpcProvider(rpcUrl, this.chainId);
    this.usdc = new ethers.Contract(this.usdcAddress, ERC20_ABI, this.provider);
    this.vault = new ethers.Contract(this.vaultAddress, VAULT_ABI, this.provider);
    this.vaultState = new ethers.Contract(this.vaultAddress, VAULT_STATE_ABI, this.provider);
  }

  /**
   * Get user's vault position
   */
  async getPosition(walletAddress: string): Promise<VaultPositionDto> {
    const [sharesBase, maxWithdrawBase, maxRedeemBase] = await Promise.all([
      this.vault.balanceOf(walletAddress),
      this.vault.maxWithdraw(walletAddress),
      this.vault.maxRedeem(walletAddress),
    ]);
    const assetsBase = await this.vault.convertToAssets(sharesBase);

    return {
      sharesBase: sharesBase.toString(),
      assetsBase: assetsBase.toString(),
      maxWithdrawBase: maxWithdrawBase.toString(),
      maxRedeemBase: maxRedeemBase.toString(),
    };
  }

  /**
   * Get vault limits for user
   */
  async getLimits(walletAddress: string): Promise<VaultLimitsDto> {
    const [maxDeposit, maxWithdraw, maxRedeem] = await Promise.all([
      this.vault.maxDeposit(walletAddress),
      this.vault.maxWithdraw(walletAddress),
      this.vault.maxRedeem(walletAddress),
    ]);

    return {
      maxDeposit: maxDeposit.toString(),
      maxWithdraw: maxWithdraw.toString(),
      maxRedeem: maxRedeem.toString(),
    };
  }

  /**
   * Get USDC allowance granted by a wallet to the vault
   */
  async getAllowance(walletAddress: string): Promise<bigint> {
    return this.usdc.allowance(walletAddress, this.vaultAddress) as Promise<bigint>;
  }

  /**
   * Build the standalone ERC-20 `approve` transaction for the vault as spender.
   *
   * Paper §2.1 makes the farming entry path "USDC approval followed by `deposit`
   * or `mint`", signed and paid for by the user — there is no relayer. This is
   * the approval half, exposed on its own so a client can drive the two steps
   * independently (and re-approve without re-deriving a deposit).
   *
   * @throws BadRequestException if amountBase is not a non-negative integer string
   */
  buildApproveTransactions(amountBase: string): TransactionProposal[] {
    let amount: bigint;
    try {
      amount = BigInt(amountBase);
    } catch {
      throw new BadRequestException('amountBase must be a valid integer string (6-decimal USDC base units)');
    }
    if (amount < 0n) {
      throw new BadRequestException('amountBase must not be negative');
    }

    const approveData = this.usdc.interface.encodeFunctionData('approve', [
      this.vaultAddress,
      amount,
    ]);

    return [
      {
        to: this.usdcAddress,
        data: approveData,
        value: '0',
        chainId: this.chainId,
        description: `Approve vault to spend ${amount.toString()} USDC`,
      },
    ];
  }

  /**
   * Build deposit transaction calldata for wallet signing.
   *
   * The user now pays their own gas (paper §2.1), so an unfundable deposit must
   * be refused *here* rather than reverting on-chain after they have paid for
   * it. Both refusals carry a structured `reason` the client branches on — see
   * `vault-preconditions.ts`.
   *
   * @throws BadRequestException INVALID_AMOUNT / INSUFFICIENT_USDC_BALANCE
   */
  async buildDepositTransactions(
    walletAddress: string,
    assetsBase: string,
  ): Promise<TransactionProposal[]> {
    const parsed = parseBaseAmount(assetsBase, 'assetsBase', 'usdc-6dp');
    if (!parsed.ok) throw new BadRequestException(preconditionBody(parsed.failure));
    const assets = parsed.value; // USDC base units, 6 dp
    const proposals: TransactionProposal[] = [];

    // Restored guard: the wallet must actually hold the USDC it is depositing.
    const balance = (await this.usdc.balanceOf(walletAddress)) as bigint;
    const shortfall = checkDepositBalance(balance, assets);
    if (shortfall) throw new BadRequestException(preconditionBody(shortfall));

    const allowance = await this.getAllowance(walletAddress);

    if (allowance < assets) {
      const approveData = this.usdc.interface.encodeFunctionData('approve', [
        this.vaultAddress,
        assets,
      ]);
      proposals.push({
        to: this.usdcAddress,
        data: approveData,
        value: '0',
        chainId: this.chainId,
        description: `Approve vault to spend ${assetsBase} USDC`,
      });
    }

    const depositData = this.vault.interface.encodeFunctionData('deposit', [assets, walletAddress]);
    proposals.push({
      to: this.vaultAddress,
      data: depositData,
      value: '0',
      chainId: this.chainId,
      description: `Deposit ${assetsBase} USDC into vault`,
    });

    return proposals;
  }

  /**
   * Build redeem transaction calldata for wallet signing.
   *
   * Restored guard: `maxRedeem(owner)` is this vault's *synchronous* exit
   * capacity, so a request above it reverts on-chain. Refuse it here instead,
   * before the user pays gas.
   *
   * @throws BadRequestException INVALID_AMOUNT / EXCEEDS_MAX_REDEEM
   */
  async buildRedeemTransactions(
    walletAddress: string,
    sharesBase: string,
  ): Promise<TransactionProposal[]> {
    const parsed = parseBaseAmount(sharesBase, 'sharesBase', 'shares-12dp');
    if (!parsed.ok) throw new BadRequestException(preconditionBody(parsed.failure));
    const shares = parsed.value; // navUSDC share units, 12 dp

    const maxRedeem = (await this.vault.maxRedeem(walletAddress)) as bigint;
    const overLimit = checkRedeemLiquidity(maxRedeem, shares);
    if (overLimit) throw new BadRequestException(preconditionBody(overLimit));

    const redeemData = this.vault.interface.encodeFunctionData('redeem', [
      shares,
      walletAddress,
      walletAddress,
    ]);

    return [
      {
        to: this.vaultAddress,
        data: redeemData,
        value: '0',
        chainId: this.chainId,
        description: `Redeem ${sharesBase} shares from vault`,
      },
    ];
  }

  /**
   * Build withdraw transaction calldata for wallet signing
   */
  async buildWithdrawTransactions(
    walletAddress: string,
    assetsBase: string,
  ): Promise<TransactionProposal[]> {
    const assets = BigInt(assetsBase);
    const withdrawData = this.vault.interface.encodeFunctionData('withdraw', [
      assets,
      walletAddress,
      walletAddress,
    ]);

    return [
      {
        to: this.vaultAddress,
        data: withdrawData,
        value: '0',
        chainId: this.chainId,
        description: `Withdraw ${assetsBase} USDC from vault`,
      },
    ];
  }

  /**
   * Get current strategy allocation from SRCLA
   */
  async getStrategy(): Promise<StrategyAllocation> {
    return this.srclaClient.getCurrentAllocation();
  }

  /**
   * Get aggregated rebalance status: latest SRCLA decision + vault reserve state.
   * Combines on-chain vault data with SRCLA decision data for the admin dashboard.
   */
  async getRebalanceStatus(): Promise<RebalanceStatusDto> {
    // Fetch vault state and latest decision in parallel
    const [decision, adminReserve, dynamicReserve, activePlanReserve, minIdleBps, activePlanId, activePlanExpiresAt] =
      await Promise.all([
        this.srclaClient.getLatestDecision(),
        this.vaultState.adminReserve() as Promise<bigint>,
        this.vaultState.dynamicReserve() as Promise<bigint>,
        this.vaultState.activePlanReserve() as Promise<bigint>,
        this.vaultState.minIdleBps() as Promise<bigint>,
        this.vaultState.activePlanId() as Promise<string>,
        this.vaultState.activePlanExpiresAt() as Promise<bigint>,
      ]);

    // requiredIdle = max(adminReserve, dynamicReserve, activePlanReserve)
    const requiredIdle = [adminReserve, dynamicReserve, activePlanReserve].reduce(
      (max, val) => (val > max ? val : max),
      0n,
    );

    return {
      latestDecision: decision
        ? {
            decisionHash: decision.decisionHash,
            timestamp: decision.timestamp,
            policyVersion: decision.policyVersion,
            reserveBase: decision.reserveBase,
            allocation: decision.allocation,
            actionDecision: decision.actionDecision,
          }
        : null,
      vaultReserve: {
        requiredIdle: requiredIdle.toString(),
        adminReserve: adminReserve.toString(),
        dynamicReserve: dynamicReserve.toString(),
        activePlanReserve: activePlanReserve.toString(),
        minIdleBps: Number(minIdleBps),
      },
      planStatus: {
        activePlanId: activePlanId === ethers.ZeroHash ? null : activePlanId,
        planExpiresAt: activePlanExpiresAt > 0n ? new Date(Number(activePlanExpiresAt) * 1000).toISOString() : null,
      },
    };
  }

  /**
   * Get recent decisions from SRCLA
   */
  async getDecisions(params?: { cursor?: string; limit?: string }) {
    return this.srclaClient.getDecisions(params);
  }

  /**
   * Get recent harvests from SRCLA.
   * Transforms the SRCLA PaginatedResponse { data, meta } into the flat
   * client-friendly shape { harvests, next } so the expo client stays simple.
   */
  async getHarvests(params?: { adapter?: string; cursor?: string; limit?: string }): Promise<HarvestsResponseDto> {
    const res = await this.srclaClient.getHarvests(params);
    const harvests: HarvestRecordDto[] = res.data.map((r) => ({
      id: r.id,
      adapter: r.adapter,
      protocol: ADAPTER_NAMES[r.adapter.toLowerCase()] ?? r.adapter,
      harvestedAt: r.timestamp,
      grossBase: r.amountOutBase, // no fee deducted at harvest — same as amountOut
      netBase: r.amountOutBase,
      recipients: [{ address: this.vaultAddress, shares: r.amountOutBase }],
    }));
    return { harvests, next: res.meta.nextCursor };
  }
}
