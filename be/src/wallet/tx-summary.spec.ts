import { Interface, getAddress } from 'ethers';
import { deriveTxSummary } from './tx-summary';

const erc20 = new Interface([
  'function approve(address spender, uint256 value)',
  'function transfer(address to, uint256 value)',
]);
const aavePool = new Interface([
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to)',
]);

const USDC = getAddress('0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8');
const POOL = getAddress('0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951');
const ATOKEN = getAddress('0x16dA4541aD1807f4443d92D26044C1147406EB80');
const SUB = getAddress('0x00000000000000000000000000000000000000A1');
const OWNER = getAddress('0x00000000000000000000000000000000000000B2');

describe('deriveTxSummary (EVM calldata)', () => {
  it('decodes ERC-20 approve(spender, amount)', () => {
    const data = erc20.encodeFunctionData('approve', [POOL, 5000n]);
    const { instructions } = deriveTxSummary([{ to: USDC, data }]);
    expect(instructions).toHaveLength(1);
    expect(instructions[0].kind).toBe('erc20-approve');
    expect(instructions[0].to).toBe(USDC);
    expect(instructions[0].spender).toBe(POOL);
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

  it('decodes Aave supply(asset, amount, onBehalfOf, referralCode)', () => {
    const data = aavePool.encodeFunctionData('supply', [USDC, 7000n, SUB, 0]);
    const { instructions } = deriveTxSummary([{ to: POOL, data }]);
    expect(instructions[0].kind).toBe('aave-supply');
    expect(instructions[0].to).toBe(POOL);
    expect(instructions[0].onBehalfOf).toBe(SUB);
    expect(instructions[0].amount).toBe(7000n);
  });

  it('decodes Aave withdraw(asset, amount, to)', () => {
    const data = aavePool.encodeFunctionData('withdraw', [USDC, 4000n, OWNER]);
    const { instructions } = deriveTxSummary([{ to: POOL, data }]);
    expect(instructions[0].kind).toBe('aave-withdraw');
    expect(instructions[0].recipient).toBe(OWNER);
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
    const { instructions } = deriveTxSummary([{ to: ATOKEN, data: '0x' }]);
    expect(instructions[0].kind).toBe('unknown');
  });

  it('decodes a multi-call deposit flow (approve + supply)', () => {
    const approve = erc20.encodeFunctionData('approve', [POOL, 9000n]);
    const supply = aavePool.encodeFunctionData('supply', [USDC, 9000n, SUB, 0]);
    const { instructions } = deriveTxSummary([
      { to: USDC, data: approve },
      { to: POOL, data: supply },
    ]);
    expect(instructions.map((i) => i.kind)).toEqual(['erc20-approve', 'aave-supply']);
  });

  it('normalizes addresses to checksummed form regardless of input case', () => {
    const data = erc20.encodeFunctionData('approve', [POOL, 1n]);
    const { instructions } = deriveTxSummary([{ to: USDC.toLowerCase(), data }]);
    expect(instructions[0].to).toBe(USDC);
    expect(instructions[0].spender).toBe(POOL);
  });

  it('treats a selector-matched call with malformed args as unknown', () => {
    // approve selector but truncated / garbage payload
    const { instructions } = deriveTxSummary([{ to: USDC, data: '0x095ea7b300' }]);
    expect(instructions[0].kind).toBe('unknown');
  });
});
