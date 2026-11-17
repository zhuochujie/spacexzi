export function withdrawableSpace(account: {
  balance: string;
  nonWithdrawableBalance?: string;
}) {
  const total = BigInt(account.balance);
  const restricted = BigInt(account.nonWithdrawableBalance ?? '0');
  if (restricted < 0n || total < restricted)
    throw new Error('INVALID_SPACE_BALANCE');
  return total - restricted;
}

export function splitSpaceSpend(
  account: { balance: string; nonWithdrawableBalance?: string },
  amount: bigint,
) {
  withdrawableSpace(account);
  if (amount < 0n || amount > BigInt(account.balance))
    throw new Error('INSUFFICIENT_BALANCE');
  const restricted = BigInt(account.nonWithdrawableBalance ?? '0');
  return { restricted: restricted < amount ? restricted : amount };
}
