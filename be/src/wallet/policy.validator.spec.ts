import { PolicyValidator, SubwalletPolicy, PolicyContext } from './policy.validator';
import { TxSummary } from './tx-summary';

const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SAVE = 'ALend7Ketfx5bxh6ghsCDXAoDrhvEmsXT3cynB6aPLgx';

const subwallet = '2Zv5juN5vrqe4ErGnLrHE5pGsGHNJbboXMHsBbMw7n1i';
const owner = '3ZKp6EjWv4FV7eZumeSyfPQkFeiGC678D9hzN56EQcsK';
const wsolAta = 'AWSjTbbtJTNnovVwqemiVssNmLifnBrimaqpYzE9EX9H';
const saveReserve = '8PBZgtwfstw5BDkam8X2tpcDounPX1miLWDDwyWtT6Yj';
const attacker = 'Du8meZx9WrscB2T5MfQ5NgYwaGt3uM1NuWiqwiSRdZ5T';
const randomProgram = 'FZeyLfHyTdFKZai6CbLdWXpiQaj6qnm5FzifUp8ht2FK';

const policy: SubwalletPolicy = {
  allowedProgramIds: [SYSTEM, TOKEN, ATA, SAVE],
  allowedDestinations: [wsolAta, saveReserve, owner],
};
const ctx: PolicyContext = { subwallet };

describe('PolicyValidator', () => {
  const v = new PolicyValidator();

  it('allows a Save-deposit-like flow (create/init/sync/transfer/save/close-to-subwallet)', () => {
    const tx: TxSummary = {
      instructions: [
        { programId: SYSTEM, kind: 'system-create' },
        { programId: TOKEN, kind: 'token-init' },
        { programId: TOKEN, kind: 'token-sync' },
        { programId: TOKEN, kind: 'token-transfer', destination: wsolAta },
        { programId: SAVE, kind: 'save' },
        { programId: TOKEN, kind: 'token-close', destination: subwallet },
      ],
    };
    expect(v.check(policy, tx, ctx)).toEqual({ ok: true });
  });

  it('allows a withdraw flow ending in a system-transfer to the owner', () => {
    const tx: TxSummary = {
      instructions: [
        { programId: SAVE, kind: 'save' },
        { programId: TOKEN, kind: 'token-close', destination: subwallet },
        { programId: SYSTEM, kind: 'system-transfer', destination: owner },
      ],
    };
    expect(v.check(policy, tx, ctx)).toEqual({ ok: true });
  });

  it('rejects a dangerous token instruction (Approve opcode 4)', () => {
    const tx: TxSummary = {
      instructions: [{ programId: TOKEN, kind: 'token-dangerous', rawOpcode: 4 }],
    };
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/not permitted/);
  });

  it('rejects a token-transfer to a non-allowlisted destination', () => {
    const tx: TxSummary = {
      instructions: [{ programId: TOKEN, kind: 'token-transfer', destination: attacker }],
    };
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/destination not allowed/);
  });

  it('rejects a token-close to an attacker (neither subwallet nor allowlisted)', () => {
    const tx: TxSummary = {
      instructions: [{ programId: TOKEN, kind: 'token-close', destination: attacker }],
    };
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/destination not allowed/);
  });

  it('rejects an unknown instruction / non-allowlisted program', () => {
    const tx: TxSummary = {
      instructions: [{ programId: randomProgram, kind: 'unknown' }],
    };
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
  });

  it('rejects a system-transfer to an attacker', () => {
    const tx: TxSummary = {
      instructions: [{ programId: SYSTEM, kind: 'system-transfer', destination: attacker }],
    };
    const r = v.check(policy, tx, ctx);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/destination not allowed/);
  });
});
