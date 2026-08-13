import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Wallet } from 'ethers';

const envValue = (body: string, name: string) => {
  const match = body.match(new RegExp(`^${name}=(.+)$`, 'm'));
  if (!match) throw new Error(`Missing ${name}`);
  return match[1];
};

describe('generateWalletFiles', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'navy-deploy-wallets-'));
  const generatorUrl = pathToFileURL(join(process.cwd(), 'scripts/generate-deploy-wallets.mjs')).href;

  const runGenerator = () => spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `import { generateWalletFiles } from ${JSON.stringify(generatorUrl)}; await generateWalletFiles(${JSON.stringify(outputDir)});`],
    { encoding: 'utf8' },
  );

  afterAll(() => rmSync(outputDir, { recursive: true, force: true }));

  it('creates distinct, secret-safe deployment wallet files without console output', async () => {
    // This fails if generation uses duplicate/invalid keys, writes permissively,
    // overwrites an existing operator file, or logs either generated secret.
    const firstRun = runGenerator();
    expect(firstRun.status).toBe(0);

    const envPath = join(outputDir, 'base-wallets.env');
    const notePath = join(outputDir, 'README.private.md');
    const envBody = readFileSync(envPath, 'utf8');
    const adminKey = envValue(envBody, 'BASE_ADMIN_PRIVATE_KEY');
    const adminAddress = envValue(envBody, 'BASE_ADMIN_ADDRESS');
    const allocatorKey = envValue(envBody, 'BASE_ALLOCATOR_PRIVATE_KEY');
    const allocatorAddress = envValue(envBody, 'BASE_ALLOCATOR_ADDRESS');
    const output = `${firstRun.stdout}${firstRun.stderr}`;

    expect(adminAddress).not.toBe(allocatorAddress);
    expect(adminKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(allocatorKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(new Wallet(adminKey).address).toBe(adminAddress);
    expect(new Wallet(allocatorKey).address).toBe(allocatorAddress);
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(statSync(notePath).mode & 0o777).toBe(0o600);
    expect(readFileSync(notePath, 'utf8')).toContain(adminAddress);
    expect(readFileSync(notePath, 'utf8')).toContain(allocatorAddress);
    expect(output).not.toContain(adminKey);
    expect(output).not.toContain(allocatorKey);
    const secondRun = runGenerator();
    expect(secondRun.status).not.toBe(0);
    expect(secondRun.stderr).toMatch(/already exists|EEXIST/i);
    expect(readFileSync(envPath, 'utf8')).toBe(envBody);
  });
});
