import { Global, Module } from '@nestjs/common';
import { ethers } from 'ethers';
import { NavyConfigService } from '../config/config.service';
import type { UsdcDomain } from './payment-authorization';

// require avoids nodenext JSON-import assertions (same pattern as the Solana IDL).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const artifact = require('./navy-payments-abi.json');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const usdcArtifact = require('./usdc-abi.json');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const vaultArtifact = (require('./navy-vault-abi.json') as { abi: unknown }).abi as ethers.InterfaceAbi;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const adapterArtifact = require('./yield-adapter-abi.json'); // BARE ARRAY

export const NAVY_EVM = Symbol('NAVY_EVM');

export interface NavyEvm {
  provider: ethers.JsonRpcProvider;
  payments: ethers.Contract;      // connected to the relayer wallet (payInvoice submitter)
  paymentsAsOwner: ethers.Contract; // connected to the owner wallet (admin ops)
  relayer: ethers.Wallet;
  owner: ethers.Wallet;
  usdc: ethers.Contract;          // connected to the relayer wallet (transferWithAuthorization submitter)
  usdcAddress: string;
  treasury: string;
  paymentsAddress: string;
  usdcDomain: UsdcDomain;
  // Read-only vault handle. Paper §10.2: be "does not relay farming transactions,
  // possess the allocator key, or execute rebalances" — srcla owns keeper execution,
  // so there is deliberately no keeper wallet or allocator-connected contract here.
  vault: ethers.Contract;
  vaultShareDomain: UsdcDomain;
  yieldAdapterAbi: any;           // bare ABI array, for constructing adapter contracts on the fly
}

@Global()
@Module({
  providers: [{
    provide: NAVY_EVM,
    inject: [NavyConfigService],
    useFactory: (cfg: NavyConfigService): NavyEvm => {
      const provider = new ethers.JsonRpcProvider(cfg.evmRpcUrl, cfg.evmChainId);
      const relayer = new ethers.Wallet(cfg.relayerPrivateKey, provider);
      const owner = new ethers.Wallet(cfg.ownerPrivateKey, provider);
      const payments = new ethers.Contract(cfg.paymentsAddress, artifact.abi, relayer);
      const paymentsAsOwner = new ethers.Contract(cfg.paymentsAddress, artifact.abi, owner);
      const usdc = new ethers.Contract(cfg.usdcAddress, usdcArtifact.abi, relayer);
      const usdcDomain: UsdcDomain = {
        name: cfg.usdcEip712Name,
        version: cfg.usdcEip712Version,
        chainId: cfg.evmChainId,
        verifyingContract: cfg.usdcAddress,
      };
      const vault = new ethers.Contract(cfg.vaultAddress, vaultArtifact, provider);
      const vaultShareDomain: UsdcDomain = {
        name: cfg.vaultShareEip712Name,
        version: cfg.vaultShareEip712Version,
        chainId: cfg.evmChainId,
        verifyingContract: cfg.vaultAddress,
      };
      return {
        provider, payments, paymentsAsOwner, relayer, owner, usdc,
        usdcAddress: cfg.usdcAddress, treasury: cfg.treasuryAddress,
        paymentsAddress: cfg.paymentsAddress, usdcDomain,
        vault, vaultShareDomain, yieldAdapterAbi: adapterArtifact,
      };
    },
  }],
  exports: [NAVY_EVM],
})
export class EvmModule {}
