/**
 * §11.1's pinned-prestate fork replay, exercised against a REAL chain.
 *
 * GATED on `NAVY_FORK_E2E=1` (the repo's existing pattern for tests that need
 * a live chain — see `NAVY_E2E` / `NAVY_VAULT_E2E` in be/). Unset, the whole
 * suite is skipped and reports nothing; it never fabricates a pass.
 *
 * It needs:
 *   - an Anvil fork of Base mainnet, started with `--code-size-limit 100000`
 *     (the vault is 32,378 bytes — over EIP-170);
 *   - `NavyVaultSRCLA` deployed on it, in `NAVY_FORK_VAULT_ADDRESS`;
 *   - an admin key for that vault in `NAVY_FORK_ADMIN_KEY` (the deployer),
 *     funded with ETH. It is used to deploy the adapters, register them,
 *     fund the vault and grant itself ALLOCATOR_ROLE.
 *
 * The setup deploys the three real `IYieldAdapter`s from the compiled
 * artifacts in `contract/out` rather than through `forge script`, for two
 * reasons found the hard way:
 *   - `forge script` enforces EIP-170 in its OWN simulation even against an
 *     Anvil started with `--code-size-limit 100000`, so a vault deploy needs
 *     `--disable-code-size-limit --non-interactive` on top;
 *   - `contract/script/DeployAndFund.s.sol` reverts `InvalidConfiguration()`
 *     because its `MOONWELL_IRM` constant (0x76e1…7f3C) is stale: the live
 *     mUSDC's `interestRateModel()` is now 0xcD6b…96FC, and
 *     `MoonwellAdapter`'s constructor asserts they match. This test reads the
 *     IRM (and the comptroller) FROM CHAIN instead of hardcoding either.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ethers, JsonRpcProvider, Contract, ContractFactory, Wallet } from 'ethers';
import { runForkReplays, type ForkReplayPlan } from '../../src/evaluation/fork-runner.js';

const ENABLED = process.env['NAVY_FORK_E2E'] === '1';
const describeFork = ENABLED ? describe : describe.skip;

const RPC_URL = process.env['NAVY_FORK_RPC_URL'] ?? 'http://127.0.0.1:8545';
const VAULT_ADDRESS = process.env['NAVY_FORK_VAULT_ADDRESS'] ?? '';
// Anvil's default account 0 — the deployer in the documented local bring-up.
const ADMIN_KEY =
  process.env['NAVY_FORK_ADMIN_KEY'] ??
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

/** Base mainnet constants; the fork inherits them. */
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const COMET = '0xb125E6687d4313864e53df431d5425969c15Eb2F';
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const A_USDC = '0x4e65fE4DbA92790696d040ac24Aa414708F5c0AB';
const M_USDC = '0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22';
/**
 * Impersonated to fund the vault. Aave's aUSDC holds the pool's underlying
 * USDC (~20M on Base) — Comet, the other obvious candidate, holds far less
 * free USDC than the vault needs here because most of its base asset is lent
 * out.
 */
const USDC_WHALE = A_USDC;

const ARTIFACT_ROOT = resolve(process.cwd(), '../contract/out');

const VAULT_ABI = [
  'function asset() view returns (address)',
  'function totalAssets() view returns (uint256)',
  'function registerAdapter(address adapter, uint16 capBps, uint16 maxLossBps, string name)',
  'function registeredAdapters(address) view returns (bool)',
  'function strategyAssets(address) view returns (uint256)',
  'function grantRole(bytes32,address)',
  'function hasRole(bytes32,address) view returns (bool)',
  'function ALLOCATOR_ROLE() view returns (bytes32)',
];
const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
];
const MTOKEN_ABI = [
  'function comptroller() view returns (address)',
  'function interestRateModel() view returns (address)',
];

function artifact(file: string, name: string): { abi: unknown[]; bytecode: string } {
  const json = JSON.parse(readFileSync(resolve(ARTIFACT_ROOT, file, `${name}.json`), 'utf8')) as {
    abi: unknown[];
    bytecode: { object: string };
  };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

async function deployAdapter(
  wallet: ethers.Signer,
  file: string,
  name: string,
  args: unknown[],
): Promise<string> {
  const { abi, bytecode } = artifact(file, name);
  const factory = new ContractFactory(abi as ethers.InterfaceAbi, bytecode, wallet);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  return await contract.getAddress();
}

describeFork('§11.1 pinned-prestate fork replay', () => {
  let provider: JsonRpcProvider;
  let admin: Wallet;
  let vault: Contract;
  let adapterByMarketId: Record<string, string>;
  let prestateBlock: number;

  beforeAll(async () => {
    if (VAULT_ADDRESS === '') {
      throw new Error('NAVY_FORK_VAULT_ADDRESS must name the deployed NavyVaultSRCLA on the fork');
    }
    // cacheTimeout: -1 — see fork-runner.ts on stale `latest` and nonces.
    provider = new JsonRpcProvider(RPC_URL, undefined, { cacheTimeout: -1 });
    provider.pollingInterval = 100;
    admin = new Wallet(ADMIN_KEY, provider);
    // See fork-runner.ts: ethers' brief nonce cache re-uses a nonce when two
    // transactions land inside it, which an automining Anvil does routinely.
    const adminSigner = new ethers.NonceManager(admin);
    vault = new Contract(VAULT_ADDRESS, VAULT_ABI, adminSigner);

    expect((await vault.asset!()) as string).toBe(USDC);

    // Moonwell's comptroller and IRM are READ FROM CHAIN — see the header.
    const mToken = new Contract(M_USDC, MTOKEN_ABI, provider);
    const comptroller = (await mToken.comptroller!()) as string;
    const irm = (await mToken.interestRateModel!()) as string;

    const compound = await deployAdapter(adminSigner, 'CompoundAdapter.sol', 'CompoundAdapter', [
      VAULT_ADDRESS,
      USDC,
      COMET,
    ]);
    const aave = await deployAdapter(adminSigner, 'AaveV3Adapter.sol', 'AaveV3Adapter', [
      VAULT_ADDRESS,
      USDC,
      AAVE_POOL,
      A_USDC,
    ]);
    const moonwell = await deployAdapter(adminSigner, 'MoonwellAdapter.sol', 'MoonwellAdapter', [
      VAULT_ADDRESS,
      USDC,
      M_USDC,
      comptroller,
      irm,
    ]);
    adapterByMarketId = { compound, aave, moonwell };

    for (const [marketId, address] of Object.entries(adapterByMarketId)) {
      if (!((await vault.registeredAdapters!(address)) as boolean)) {
        const tx = await vault.registerAdapter!(address, 8_000, 100, marketId);
        await tx.wait();
      }
    }

    // Fund the vault so a deploy action has idle to move. A direct transfer
    // (rather than `deposit`) is deliberate: this replay exercises the
    // ALLOCATOR path, not share accounting.
    await provider.send('anvil_impersonateAccount', [USDC_WHALE]);
    await provider.send('anvil_setBalance', [USDC_WHALE, '0xde0b6b3a7640000']);
    const whale = await provider.getSigner(USDC_WHALE);
    const usdc = new Contract(USDC, ERC20_ABI, whale);
    const fundTx = await usdc.transfer!(VAULT_ADDRESS, 1_000_000_000_000n); // 1,000,000 USDC
    await fundTx.wait();
    await provider.send('anvil_stopImpersonatingAccount', [USDC_WHALE]);

    const allocatorRole = (await vault.ALLOCATOR_ROLE!()) as string;
    if (!((await vault.hasRole!(allocatorRole, admin.address)) as boolean)) {
      const grant = await vault.grantRole!(allocatorRole, admin.address);
      await grant.wait();
    }

    prestateBlock = await provider.getBlockNumber();
  }, 600_000);

  afterAll(() => {
    provider?.destroy();
  });

  it('replays a policy\'s proposed actions from the pinned prestate and executes them', async () => {
    const tier = 1_000_000_000_000n;
    // One policy's proposal at one origin: a three-venue deployment.
    const srcla: ForkReplayPlan = {
      policyId: 'srcla',
      tier,
      originIndex: 0,
      decisionHash: ethers.keccak256(ethers.toUtf8Bytes('fork-replay-test|srcla')),
      actions: [
        { kind: 'deploy', marketId: 'compound', amountBase: 200_000_000_000n },
        { kind: 'deploy', marketId: 'aave', amountBase: 150_000_000_000n },
        { kind: 'deploy', marketId: 'moonwell', amountBase: 100_000_000_000n },
      ],
    };
    // A SECOND candidate policy, so the "same pinned prestate before each
    // candidate" clause is actually exercised rather than asserted: b2 runs
    // against the prestate srcla already moved 450,000 USDC out of, and can
    // only succeed if that prestate was restored.
    const b2: ForkReplayPlan = {
      policyId: 'b2',
      tier,
      originIndex: 0,
      decisionHash: ethers.keccak256(ethers.toUtf8Bytes('fork-replay-test|b2')),
      // 700,000 USDC: more than the ~550,000 idle srcla's run would have
      // left, and inside the adapter's 80%-of-NAV cap.
      actions: [{ kind: 'deploy', marketId: 'compound', amountBase: 700_000_000_000n }],
    };

    const results = await runForkReplays([srcla, b2], {
      rpcUrl: RPC_URL,
      prestateBlock,
      vaultAddress: VAULT_ADDRESS,
      allocatorPrivateKey: ADMIN_KEY,
      adapterByMarketId,
    });

    expect(results).toHaveLength(2);
    for (const r of results) {
      // The detail carries the revert reason when this fails; surfacing it
      // beats an anonymous `false`.
      expect({ policyId: r.policyId, executed: r.executed, detail: r.detail }).toEqual({
        policyId: r.policyId,
        executed: true,
        detail: r.detail,
      });
      expect(r.executed).toBe(true);
      expect(r.prestateBlock).toBe(prestateBlock);
    }
    // b2's 700,000 USDC deploy is larger than the idle srcla's run would have
    // left behind, so it executing at all is the evidence the prestate was
    // restored between the two candidates.
    expect(results[1]!.detail).toContain('executed on the fork from pinned prestate');

    // And the chain is left on the pin, not on the last policy's outcome.
    const after = (await vault.strategyAssets!(adapterByMarketId['compound']!)) as bigint;
    expect(after).toBe(0n);
  }, 600_000);

  it('reports a plan the chain refuses as not executed, rather than throwing', async () => {
    const results = await runForkReplays(
      [
        {
          policyId: 'impossible',
          tier: 10_000_000_000n,
          originIndex: 0,
          decisionHash: ethers.keccak256(ethers.toUtf8Bytes('fork-replay-test|impossible')),
          // Far more than the vault holds: `_deploy` reverts InsufficientIdle.
          actions: [{ kind: 'deploy', marketId: 'compound', amountBase: 10_000_000_000_000n }],
        },
      ],
      {
        rpcUrl: RPC_URL,
        prestateBlock,
        vaultAddress: VAULT_ADDRESS,
        allocatorPrivateKey: ADMIN_KEY,
        adapterByMarketId,
      },
    );
    expect(results).toHaveLength(1);
    expect(results[0]!.executed).toBe(false);
    expect(results[0]!.detail).toContain('reverted on the fork');
  }, 600_000);
});
