export interface SealedSecret {
  encryptedPrivkey: string; // base64 iv:tag:ciphertext
  dataKeyWrapped: string;   // base64 iv:tag:wrappedDataKey
}

export interface Cipher {
  /** Encrypt plaintext under a fresh per-secret data key, wrapped by the master key. */
  seal(plaintext: Buffer): Promise<SealedSecret>;
  /** Reverse of seal(). */
  open(sealed: SealedSecret): Promise<Buffer>;
}

export const CIPHER = Symbol('CIPHER');
