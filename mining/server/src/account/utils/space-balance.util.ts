export const FREE_MINER_RESERVE_WEI = 10n * 10n ** 18n;

export function withdrawableSpace(
  account: { balance: string },
  hasFreeMiner: boolean,
) {
  const total = BigInt(account.balance);
  if (total < 0n) throw new Error('INVALID_SPACE_BALANCE');
  if (!hasFreeMiner) return total;
  return total > FREE_MINER_RESERVE_WEI ? total - FREE_MINER_RESERVE_WEI : 0n;
}
