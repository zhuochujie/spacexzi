import { CustomException } from 'src/common/custom.exception';

export type NodeValueGroup = {
  level: number;
  value: bigint;
  accountIds: number[];
};
export type NodeValueWeights = { groups: NodeValueGroup[]; totalValue: bigint };

export function buildNodeValueWeights(
  accounts: Array<{ id: number; nodeLevel: number }>,
  levelValues: readonly bigint[],
): NodeValueWeights {
  const groups = new Map<number, NodeValueGroup>();
  let totalValue = 0n;
  for (const account of accounts) {
    if (account.nodeLevel <= 0) continue;
    const value = levelValues[account.nodeLevel - 1];
    if (!value || value <= 0n)
      throw new CustomException('NODE_LEVEL_VALUE_NOT_FOUND', 500);
    const group = groups.get(account.nodeLevel) ?? {
      level: account.nodeLevel,
      value,
      accountIds: [],
    };
    group.accountIds.push(account.id);
    groups.set(account.nodeLevel, group);
    totalValue += value;
  }
  return {
    groups: [...groups.values()].sort((a, b) => a.level - b.level),
    totalValue,
  };
}
