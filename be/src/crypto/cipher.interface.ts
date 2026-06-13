export interface SealedSecret {
  encryptedPrivkey: string; // base64(iv(12) || tag(16) || ciphertext)
  dataKeyWrapped: string;   // base64(iv(12) || tag(16) || ciphertext)
}

export interface Cipher {
  /** Encrypt plaintext under a fresh per-secret data key, wrapped by the master key. */
  seal(plaintext: Buffer): Promise<SealedSecret>;
  /** Reverse of seal(). */
  open(sealed: SealedSecret): Promise<Buffer>;
}

export const CIPHER = Symbol('CIPHER');
