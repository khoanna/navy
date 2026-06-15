import * as anchor from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { configPda, merchantPda } from '../client/pdas';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function main() {
  const cmd = process.argv[2];

  if (!cmd || !['init-config', 'update-config', 'register-merchant', 'set-active'].includes(cmd)) {
    console.error('commands: init-config | update-config | register-merchant <auth> <payout> | set-active <auth> <true|false>');
    process.exit(1);
  }

  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.NavyPayments as anchor.Program;
  const pid = program.programId;
  const admin = (provider.wallet as anchor.Wallet).payer;

  if (cmd === 'init-config') {
    const feeBps = parseInt(env('NAVY_FEE_BPS'), 10);
    const treasury = new PublicKey(env('NAVY_TREASURY'));
    const usdcMint = new PublicKey(env('NAVY_USDC_MINT'));
    await program.methods.initializeConfig(feeBps, usdcMint)
      .accounts({ config: configPda(pid), treasury, admin: admin.publicKey }).rpc();
    console.log('config initialized', { feeBps, treasury: treasury.toBase58(), usdcMint: usdcMint.toBase58() });
  } else if (cmd === 'update-config') {
    const feeBps = process.env.NAVY_FEE_BPS ? parseInt(process.env.NAVY_FEE_BPS, 10) : null;
    const treasury = process.env.NAVY_TREASURY ? new PublicKey(process.env.NAVY_TREASURY) : null;
    const usdcMint = process.env.NAVY_USDC_MINT ? new PublicKey(process.env.NAVY_USDC_MINT) : null;
    await program.methods.updateConfig(feeBps, treasury, usdcMint)
      .accounts({ config: configPda(pid), admin: admin.publicKey }).rpc();
    console.log('config updated');
  } else if (cmd === 'register-merchant') {
    const merchantAuthority = new PublicKey(process.argv[3]);
    const payout = new PublicKey(process.argv[4]);
    await program.methods.registerMerchant(payout)
      .accounts({ config: configPda(pid), merchant: merchantPda(pid, merchantAuthority), merchantAuthority, admin: admin.publicKey }).rpc();
    console.log('merchant registered', merchantAuthority.toBase58());
  } else if (cmd === 'set-active') {
    const merchantAuthority = new PublicKey(process.argv[3]);
    const active = process.argv[4] === 'true';
    await program.methods.setMerchantActive(active)
      .accounts({ config: configPda(pid), merchant: merchantPda(pid, merchantAuthority), admin: admin.publicKey }).rpc();
    console.log('merchant active =', active);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
