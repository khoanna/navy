/**
 * §10.3's chain-identity check: before submitting, the keeper must verify
 * "sender nonce, live configuration, and chain identity".
 *
 * UNWIRED, AND DELIBERATELY KEPT. `verifyDeployment` has no caller anywhere
 * in src/, scripts/ or test/. It is NOT a duplicate of anything live: the
 * only identity check on the live path is
 * `execution/keeper-executor.ts`'s `verifyChain` SubmissionDeps entry, which
 * compares the vault's `currentConfigurationDigest()` against the plan
 * header. That covers "live configuration" only — nothing in this service
 * ever asserts that the configured vault/adapter/USDC addresses actually
 * carry code, nor that the RPC's `eth_chainId` matches `CHAIN_ID`. Deleting
 * this file would leave that half of §10.3 with no implementation at all.
 *
 * WHAT IS MISSING TO WIRE IT: a call at boot (src/index.ts, after the
 * ChainClient is built) passing a `DeploymentIdentity` assembled from
 * `loadConfig()`'s vault/strategy/rewardExecutor/usdc addresses, and a
 * decision about what a failure should do — refuse to start, or degrade to
 * decide-and-persist with execution blocked, the way
 * `assertExecutionAllowed` already does for placeholder pricing. A chainId
 * assertion (`provider.getNetwork().chainId === config.chainId`) belongs
 * here too and is not implemented yet.
 */
import { ChainClient } from './client.js';

export interface DeploymentIdentity {
  vault: string;
  aaveStrategy: string;
  compoundStrategy: string;
  moonwellStrategy: string;
  rewardExecutor: string;
  usdc: string;
}

/**
 * Verify that contracts are deployed at expected addresses
 */
export async function verifyDeployment(
  client: ChainClient,
  identity: DeploymentIdentity
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  // Check vault
  const vaultCode = await client.getCode(identity.vault);
  if (vaultCode === '0x') {
    errors.push(`Vault at ${identity.vault} has no code`);
  }

  // Check strategies
  for (const [name, address] of [
    ['Aave', identity.aaveStrategy],
    ['Compound', identity.compoundStrategy],
    ['Moonwell', identity.moonwellStrategy],
  ] as const) {
    const code = await client.getCode(address);
    if (code === '0x') {
      errors.push(`${name} strategy at ${address} has no code`);
    }
  }

  // Check USDC
  const usdcCode = await client.getCode(identity.usdc);
  if (usdcCode === '0x') {
    errors.push(`USDC at ${identity.usdc} has no code`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
