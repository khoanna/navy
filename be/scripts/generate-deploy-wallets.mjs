import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Wallet } from 'ethers';

const ENV_FILE = 'base-wallets.env';
const PRIVATE_NOTE = 'README.private.md';
const scriptDirectory = dirname(fileURLToPath(import.meta.url));

export function defaultOutputDir() {
  return resolve(scriptDirectory, '../../deploy');
}

export function generateWalletFiles(outputDir) {
  const directory = resolve(outputDir);
  const envPath = resolve(directory, ENV_FILE);
  const notePath = resolve(directory, PRIVATE_NOTE);

  mkdirSync(directory, { recursive: true, mode: 0o700 });

  if (existsSync(envPath) || existsSync(notePath)) {
    throw new Error(`A deployment wallet file already exists in ${directory}`);
  }

  const admin = Wallet.createRandom();
  const allocator = Wallet.createRandom();
  const envBody = [
    '# Keep this file local. It contains Base deployment private keys.',
    `BASE_ADMIN_PRIVATE_KEY=${admin.privateKey}`,
    `BASE_ADMIN_ADDRESS=${admin.address}`,
    `BASE_ALLOCATOR_PRIVATE_KEY=${allocator.privateKey}`,
    `BASE_ALLOCATOR_ADDRESS=${allocator.address}`,
    '',
  ].join('\n');
  const noteBody = [
    '# Private Base deployment operator note',
    '',
    `- Base admin/deployer/guardian address: ${admin.address}. This identity owns deployment and administrative contract actions.`,
    `- Base allocator address: ${allocator.address}. This identity performs only constrained allocator and keeper actions.`,
    '',
    '## Funding',
    '',
    'Fund the admin for deployment and administrative transaction gas. Fund the allocator separately for scheduled keeper transactions; do not reuse either identity for user funds.',
    '',
    '## Rotation',
    '',
    'Rotate an identity by creating a new local directory with this generator, funding the replacement, updating the authorized on-chain role, verifying the change, then securely retiring the prior key material.',
    '',
  ].join('\n');

  writeFileSync(envPath, envBody, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  writeFileSync(notePath, noteBody, { encoding: 'utf8', flag: 'wx', mode: 0o600 });

  return {
    envPath,
    notePath,
    adminAddress: admin.address,
    allocatorAddress: allocator.address,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { envPath, notePath, adminAddress, allocatorAddress } = generateWalletFiles(process.argv[2] ?? defaultOutputDir());
    console.log(`BASE_ADMIN_ADDRESS=${adminAddress}`);
    console.log(`BASE_ALLOCATOR_ADDRESS=${allocatorAddress}`);
    console.log(envPath);
    console.log(notePath);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
