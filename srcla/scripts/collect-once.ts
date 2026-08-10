import { loadConfig } from '../src/config.js';
import { ChainClient } from '../src/chain/client.js';
import { SnapshotCollector } from '../src/collector/snapshot-collector.js';
import { PrismaClient } from '@prisma/client';

async function main(): Promise<void> {
  const config = loadConfig();

  const chainClient = new ChainClient({
    rpcUrl: config.baseRpcUrl,
    chainId: config.chainId,
  });

  const prisma = new PrismaClient();

  const collector = new SnapshotCollector(chainClient, {
    vaultAddress: config.vaultAddress,
    strategyAddresses: {
      aave: config.aaveStrategyAddress,
      compound: config.compoundStrategyAddress,
      moonwell: config.moonwellStrategyAddress,
    },
    usdcAddress: config.usdcAddress,
  });

  console.log('Collecting snapshot...');
  const snapshot = await collector.collect();

  if (snapshot) {
    console.log(JSON.stringify(snapshot, null, 2));
    console.log(`\nBlock: ${snapshot.blockNumber}`);
    console.log(`Hash: ${snapshot.blockHash}`);
    console.log(`Timestamp: ${snapshot.timestamp.toISOString()}`);
    console.log(`Vault total assets: ${snapshot.vault.totalAssets}`);
  } else {
    console.log('No snapshot collected');
  }

  await prisma.$disconnect();
  chainClient.close();
}

main();
