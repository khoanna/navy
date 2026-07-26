import { Interface, getAddress } from 'ethers';
import { deriveTxSummary } from '../../../src/wallet/tx-summary';

const erc20 = new Interface([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const comet = new Interface([
  'function supply(address asset, uint256 amount)',
  'function withdraw(address asset, uint256 amount)',
  'function withdrawTo(address to, address asset, uint256 amount)',
]);

// Circle USDC + Compound III (Comet) USDC market, Sepolia.
const USDC = getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
const COMET = getAddress('0xAec1F48e02Cfb822Be958B68C7957156EB3F0b6e');
const SUB = getAddress('0x00000000000000000000000000000000000000A1');
const OWNER = getAddress('0x00000000000000000000000000000000000000B2');

describe('deriveTxSummary (EVM calldata)', () => {
  it('decodes ERC-20 approve(spender, amount)', () => {
    const data = erc20.encodeFunctionData('approve', [COMET, 5000n]);
    const { instructions } = deriveTxSummary([{ to: USDC, data }]);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].kind).toBe('erc20-approve');
    expect(instructions[0].to).toBe(USDC);
    expect(instructions[0].spender).toBe(COMET);
    expect(instructions[0].amount).toBe(5000n);
    expect(instructions[0].selector).toBe('0x095ea7b3');
  });

  it('decodes ERC-20 transfer(to, amount)', () => {
    const data = erc20.encodeFunctionData('transfer', [SUB, 12345n]);
    const { instructions } = deriveTxSummary([{ to: USDC, data }]);
    expect(instructions[0].kind).toBe('erc20-transfer');
    expect(instructions[0].recipient).toBe(SUB);
    expect(instructions[0].amount).toBe(12345n);
  });

  it('decodes Comet supply(asset, amount) — credits the implicit msg.sender, exposes asset', () => {
    const data = comet.encodeFunctionData('supply', [USDC, 7000n]);
    const { instructions } = deriveTxSummary([{ to: COMET, data }]);
    expect(instructions[0].kind).toBe('compound-supply');
    expect(instructions[0].to).toBe(COMET);
    expect(instructions[0].asset).toBe(USDC);
    expect(instructions[0].amount).toBe(7000n);
    // No recipient: supply credits msg.sender.
    expect(instructions[0].recipient).toBeUndefined();
  });

  it('decodes Comet withdraw(asset, amount) — to the implicit msg.sender (no recipient), exposes asset', () => {
    const data = comet.encodeFunctionData('withdraw', [USDC, 4000n]);
    const { instructions } = deriveTxSummary([{ to: COMET, data }]);
    expect(instructions[0].kind).toBe('compound-withdraw');
    expect(instructions[0].asset).toBe(USDC);
    expect(instructions[0].amount).toBe(4000n);
    expect(instructions[0].recipient).toBeUndefined();
  });

  it('decodes Comet withdrawTo(to, asset, amount) — exposes the recipient + asset', () => {
    const data = comet.encodeFunctionData('withdrawTo', [OWNER, USDC, 4000n]);
    const { instructions } = deriveTxSummary([{ to: COMET, data }]);
    expect(instructions[0].kind).toBe('compound-withdraw');
    expect(instructions[0].recipient).toBe(OWNER);
    expect(instructions[0].asset).toBe(USDC);
    expect(instructions[0].amount).toBe(4000n);
  });

  it('decodes a bare native value transfer', () => {
    const { instructions } = deriveTxSummary([{ to: SUB, data: '0x', value: 5000n }]);
    expect(instructions[0].kind).toBe('native-transfer');
    expect(instructions[0].recipient).toBe(SUB);
    expect(instructions[0].amount).toBe(5000n);
    expect(instructions[0].selector).toBe('0x');
  });

  it('classifies an unknown selector as unknown', () => {
    // random 4-byte selector, no matching function
    const { instructions } = deriveTxSummary([{ to: USDC, data: '0xdeadbeef' }]);
    expect(instructions[0].kind).toBe('unknown');
    expect(instructions[0].selector).toBe('0xdeadbeef');
  });

  it('classifies empty calldata with no value as unknown', () => {
    const { instructions } = deriveTxSummary([{ to: COMET, data: '0x' }]);
    expect(instructions[0].kind).toBe('unknown');
  });

  it('decodes a multi-call deposit flow (approve + supply)', () => {
    const approve = erc20.encodeFunctionData('approve', [COMET, 9000n]);
    const supply = comet.encodeFunctionData('supply', [USDC, 9000n]);
    const { instructions } = deriveTxSummary([
      { to: USDC, data: approve },
      { to: COMET, data: supply },
    ]);
    expect(instructions.map((i) => i.kind)).toEqual(['erc20-approve', 'compound-supply']);
  });

  it('normalizes addresses to checksummed form regardless of input case', () => {
    const data = erc20.encodeFunctionData('approve', [COMET, 1n]);
    const { instructions } = deriveTxSummary([{ to: USDC.toLowerCase(), data }]);
    expect(instructions[0].to).toBe(USDC);
    expect(instructions[0].spender).toBe(COMET);
  });

  it('treats a selector-matched call with malformed args as unknown', () => {
    // approve selector but truncated / garbage payload
    const { instructions } = deriveTxSummary([{ to: USDC, data: '0x095ea7b300' }]);
    expect(instructions[0].kind).toBe('unknown');
  });
});
