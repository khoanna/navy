import type { User } from '@privy-io/react-auth';
import { describeLinkedAccounts, linkableProviders, canUnlink } from './linkedAccounts';

// Minimal User fixtures — only the fields our functions read.
function user(linkedAccounts: any[], extra: Partial<User> = {}): User {
  return { id: 'did', createdAt: new Date(0), linkedAccounts, ...extra } as unknown as User;
}

describe('describeLinkedAccounts', () => {
  it('returns [] for a null user', () => {
    expect(describeLinkedAccounts(null)).toEqual([]);
  });

  it('maps email, google, apple, passkey to display rows', () => {
    const u = user([
      { type: 'email', address: 'me@x.com' },
      { type: 'google_oauth', subject: 'g-sub', email: 'me@gmail.com' },
      { type: 'apple_oauth', subject: 'a-sub', email: 'me@icloud.com' },
      { type: 'passkey', credentialId: 'cred-1', authenticatorName: 'iCloud Keychain' },
    ]);
    expect(describeLinkedAccounts(u)).toEqual([
      { key: 'email:me@x.com', provider: 'email', icon: 'mail', label: 'Email', subtitle: 'me@x.com', unlinkId: 'me@x.com' },
      { key: 'google:g-sub', provider: 'google', icon: 'shield', label: 'Google', subtitle: 'me@gmail.com', unlinkId: 'g-sub' },
      { key: 'apple:a-sub', provider: 'apple', icon: 'shield', label: 'Apple', subtitle: 'me@icloud.com', unlinkId: 'a-sub' },
      { key: 'passkey:cred-1', provider: 'passkey', icon: 'key', label: 'Passkey', subtitle: 'iCloud Keychain', unlinkId: 'cred-1' },
    ]);
  });

  it('ignores wallet and other account types', () => {
    const u = user([
      { type: 'wallet', address: 'So1...' },
      { type: 'email', address: 'me@x.com' },
    ]);
    expect(describeLinkedAccounts(u).map((r) => r.provider)).toEqual(['email']);
  });

  it('falls back when a passkey has no authenticator name', () => {
    const u = user([{ type: 'passkey', credentialId: 'c' }]);
    expect(describeLinkedAccounts(u)[0].subtitle).toBe('Passkey');
  });
});

describe('linkableProviders', () => {
  it('offers all three when nothing is linked', () => {
    expect(linkableProviders(user([]))).toEqual(['email', 'google', 'apple']);
  });
  it('omits already-linked providers (passkey handled separately)', () => {
    const u = user([
      { type: 'email', address: 'me@x.com' },
      { type: 'passkey', credentialId: 'c' },
    ]);
    expect(linkableProviders(u)).toEqual(['google', 'apple']);
  });
});

describe('canUnlink', () => {
  it('is false for null or a single account', () => {
    expect(canUnlink(null)).toBe(false);
    expect(canUnlink(user([{ type: 'email', address: 'me@x.com' }]))).toBe(false);
  });
  it('is true with more than one linked account', () => {
    expect(canUnlink(user([{ type: 'email', address: 'a' }, { type: 'wallet', address: 'b' }]))).toBe(true);
  });
});
