import { PublicKey } from '@solana/web3.js';

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
}
export function merchantPda(programId: PublicKey, merchantAuthority: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('merchant'), merchantAuthority.toBuffer()], programId)[0];
}
export function invoicePda(programId: PublicKey, merchantAuthority: PublicKey, invoiceId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('invoice'), merchantAuthority.toBuffer(), Buffer.from(invoiceId)], programId)[0];
}
