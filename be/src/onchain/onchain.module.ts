import { Global, Module } from '@nestjs/common';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';
import { NavyConfigService } from '../config/config.service';

// Use require to avoid moduleResolution:nodenext JSON-import assert requirements
// eslint-disable-next-line @typescript-eslint/no-var-requires
const idl = require('./navy_payments.json');

export const NAVY_ONCHAIN = Symbol('NAVY_ONCHAIN');

export interface NavyOnchain {
  connection: Connection;
  program: Program;
  relayer: Keypair;
  programId: PublicKey;
  usdcMint: PublicKey;
  treasury: PublicKey;
}

function parseSecret(raw: string): Keypair {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const bytes = Uint8Array.from(JSON.parse(trimmed) as number[]);
    // If the array is 32 bytes treat as seed; if 64 bytes use fromSecretKey
    // (web3.js validates that bytes[32..64] == nacl public-key derived from bytes[0..32])
    if (bytes.length === 32) {
      return Keypair.fromSeed(bytes);
    }
    // For 64-byte arrays: attempt fromSecretKey; fall back to fromSeed on the
    // first 32 bytes so that the all-zeros placeholder [0×64] still works.
    try {
      return Keypair.fromSecretKey(bytes);
    } catch {
      return Keypair.fromSeed(bytes.slice(0, 32));
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bs58 = require('bs58');
  return Keypair.fromSecretKey(bs58.decode(trimmed));
}

@Global()
@Module({
  providers: [{
    provide: NAVY_ONCHAIN,
    inject: [NavyConfigService],
    useFactory: (cfg: NavyConfigService): NavyOnchain => {
      const connection = new Connection(cfg.rpcUrl, 'confirmed');
      const relayer = parseSecret(process.env.NAVY_RELAYER_SECRET as string);
      const provider = new AnchorProvider(connection, new Wallet(relayer), { commitment: 'confirmed' });
      const program = new Program(idl, provider);
      return {
        connection, program, relayer,
        programId: new PublicKey(process.env.NAVY_PROGRAM_ID as string),
        usdcMint: new PublicKey(process.env.NAVY_USDC_MINT as string),
        treasury: new PublicKey(process.env.NAVY_TREASURY as string),
      };
    },
  }],
  exports: [NAVY_ONCHAIN],
})
export class OnchainModule {}
