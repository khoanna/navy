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
