import { PublicKey } from '@solana/web3.js';

export function configPda(programId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0];
}
export function merchantPda(programId: PublicKey, merchantId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from('merchant'), Buffer.from(merchantId)], programId)[0];
}
export function invoicePda(programId: PublicKey, merchantId: Uint8Array, invoiceId: Uint8Array): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('invoice'), Buffer.from(merchantId), Buffer.from(invoiceId)], programId)[0];
}
