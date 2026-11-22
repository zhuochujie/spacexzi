import { withdrawableSpace } from './space-balance.util';
const unit = 10n ** 18n;

describe('fixed free-miner withdrawal reserve', () => {
  it.each([
    [0n, 0n],
    [8n, 0n],
    [10n, 0n],
    [15n, 5n],
    [30n, 20n],
  ])('retains ten tokens from a total of %s', (balance, expected) => {
    expect(withdrawableSpace({ balance: String(balance * unit) }, true)).toBe(
      expected * unit,
    );
  });
  it('does not retain funds without a free miner', () => {
    expect(withdrawableSpace({ balance: String(15n * unit) }, false)).toBe(
      15n * unit,
    );
  });
  it('preserves exact wei precision at the reserve boundary', () => {
    expect(withdrawableSpace({ balance: String(10n * unit + 1n) }, true)).toBe(
      1n,
    );
  });
  it('rejects corrupt negative balances', () => {
    expect(() => withdrawableSpace({ balance: '-1' }, true)).toThrow(
      'INVALID_SPACE_BALANCE',
    );
  });
});
