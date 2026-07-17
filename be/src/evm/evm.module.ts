import { Global, Module } from '@nestjs/common';
import { ethers } from 'ethers';
import { NavyConfigService } from '../config/config.service';
import type { UsdcDomain } from './payment-authorization';

// require avoids nodenext JSON-import assertions (same pattern as the Solana IDL).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const artifact = require('./navy-payments-abi.json');

export const NAVY_EVM = Symbol('NAVY_EVM');

export interface NavyEvm {
  provider: ethers.JsonRpcProvider;
  payments: ethers.Contract;      // connected to the relayer wallet (payInvoice submitter)
  paymentsAsOwner: ethers.Contract; // connected to the owner wallet (admin ops)
  relayer: ethers.Wallet;
  owner: ethers.Wallet;
  usdc: ethers.Contract;          // read-only USDC handle for EIP-2612 nonce reads
  usdcAddress: string;
  treasury: string;
  paymentsAddress: string;
  usdcDomain: UsdcDomain;
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
      const usdc = new ethers.Contract(cfg.usdcAddress, ['function nonces(address) view returns (uint256)'], provider);
      const usdcDomain: UsdcDomain = {
        name: cfg.usdcEip712Name,
        version: cfg.usdcEip712Version,
        chainId: cfg.evmChainId,
        verifyingContract: cfg.usdcAddress,
      };
      return {
        provider, payments, paymentsAsOwner, relayer, owner, usdc,
        usdcAddress: cfg.usdcAddress, treasury: cfg.treasuryAddress,
        paymentsAddress: cfg.paymentsAddress, usdcDomain,
      };
    },
  }],
  exports: [NAVY_EVM],
})
export class EvmModule {}
