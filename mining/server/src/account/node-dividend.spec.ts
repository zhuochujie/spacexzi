import { AccountService } from './account.service';
import { Account } from './entities/account.entity';
import {
  AccountBalanceLog,
  AccountBalanceLogType,
} from './entities/account-balance-log.entity';
import { DividendRuleCategory } from 'src/config/entities/dividend-rule.entity';
import { buildNodeValueWeights } from './utils/node-dividend.util';
jest.mock('src/web3/web3.service', () => ({ Web3Service: class {} }));
jest.mock('src/market/market.service', () => ({ MarketService: class {} }));

function fixture(
  levels: number[],
  values = [100n, 500n, 1000n, 5000n],
  space = 600n,
  usdt = 1200n,
) {
  const accounts = levels.map((nodeLevel, index) => ({
    id: index + 1,
    nodeLevel,
    balance: '0',
    usdtBalance: '0',
  }));
  const logs: Array<{
    accountId: number;
    amount: string;
    type: AccountBalanceLogType;
    token: string;
  }> = [];
  const stats: Array<{
    category: DividendRuleCategory;
    level: number;
    bp: number;
    recipientCount: number;
    perUserAmount: string;
    totalAmount: string;
    fallbackUsed: boolean;
  }> = [];
  const accountRepo = {
    findOne: jest.fn((q: { where: { id: number } }) =>
      Promise.resolve(accounts.find((a) => a.id === q.where.id)),
    ),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
  };
  const repo = (values: unknown[]) => ({
    create: (v: unknown) => v,
    save: (v: unknown) => {
      values.push(v);
      return Promise.resolve(v);
    },
  });
  const manager = {
    getRepository: (type: unknown) =>
      type === Account
        ? accountRepo
        : type === AccountBalanceLog
          ? repo(logs)
          : repo(stats),
  };
  const db = {
    query: jest.fn().mockResolvedValue(accounts.filter((a) => a.nodeLevel > 0)),
    getRepository: manager.getRepository,
    transaction: (fn: (m: typeof manager) => Promise<unknown>) => fn(manager),
  };
  const web3 = {
    getBuybackDividendBalance: jest.fn().mockResolvedValue(0n),
    getNodeLevelValues: jest.fn().mockResolvedValue(values),
    dividend: jest.fn().mockResolvedValue({
      vipFeeVaultSpaceBalance: 0n,
      nodeFeeVaultSpaceBalance: space,
      nodeFeeVaultUsdtBalance: usdt,
    }),
  };
  const config = {
    getDividendRules: jest.fn((category: DividendRuleCategory) =>
      Promise.resolve(
        category === DividendRuleCategory.Buyback
          ? [7000n, 1800n, 800n, 300n, 100n].map((bp, i) => ({
              level: i + 1,
              bp,
            }))
          : [],
      ),
    ),
  };
  const market = {
    getBuybackRanking: jest.fn().mockResolvedValue({ items: [] }),
  };
  const service = new AccountService(
    db as never,
    web3 as never,
    config as never,
    market as never,
  );
  jest
    .spyOn(service, 'recomputeVipLevelsSnapshot')
    .mockResolvedValue(undefined);
  const internals = service as unknown as {
    distributeDividendByVipLevel: () => Promise<void>;
  };
  jest
    .spyOn(internals, 'distributeDividendByVipLevel')
    .mockResolvedValue(undefined);
  return { service, accounts, logs, stats, web3, config, accountRepo };
}

describe('Node dividends proportional to node value', () => {
  it('allocates both SPACE and USDT by current level price', async () => {
    const f = fixture([1, 2]);
    await f.service.dividendTask();
    expect(f.accounts.map((a) => a.balance)).toEqual(['100', '500']);
    expect(f.accounts.map((a) => a.usdtBalance)).toEqual(['200', '1000']);
    expect(f.web3.dividend).toHaveBeenCalledWith(0n, true);
    expect(
      f.logs.every((l) => l.type === AccountBalanceLogType.NodeDividend),
    ).toBe(true);
    expect(
      f.config.getDividendRules.mock.calls.some(
        ([category]) => category === DividendRuleCategory.Node,
      ),
    ).toBe(false);
  });
  it('uses total participant value including every member, not a fixed share per level', async () => {
    const f = fixture([1, 1, 2], undefined, 700n, 1400n);
    await f.service.dividendTask();
    expect(f.accounts.map((a) => a.balance)).toEqual(['100', '100', '500']);
    expect(f.accounts.map((a) => a.usdtBalance)).toEqual([
      '200',
      '200',
      '1000',
    ]);
    expect(
      f.stats.filter((s) => s.level === 1).every((s) => s.recipientCount === 2),
    ).toBe(true);
  });
  it('distributes the full pool equally when everyone has the same node value', async () => {
    const f = fixture([2, 2], undefined, 1000n, 2000n);
    await f.service.dividendTask();
    expect(f.accounts.map((a) => a.balance)).toEqual(['500', '500']);
    expect(f.stats.every((s) => s.bp === 10000 && !s.fallbackUsed)).toBe(true);
  });
  it('only counts eligible nodes and never uses a fallback account', async () => {
    const f = fixture([0, 2], undefined, 1000n, 2000n);
    await f.service.dividendTask();
    expect(f.accounts.map((a) => a.balance)).toEqual(['0', '1000']);
    expect(f.logs.every((l) => l.accountId === 2)).toBe(true);
  });
  it('leaves node funds in the source vault when there are no participants', async () => {
    const f = fixture([]);
    await f.service.dividendTask();
    expect(f.web3.dividend).toHaveBeenCalledWith(0n, false);
    expect(f.web3.getNodeLevelValues).not.toHaveBeenCalled();
    expect(f.logs).toHaveLength(0);
  });
  it('rejects an unmapped level before collecting any funds', async () => {
    const f = fixture([5]);
    await expect(f.service.dividendTask()).rejects.toThrow(
      'NODE_LEVEL_VALUE_NOT_FOUND',
    );
    expect(f.web3.dividend).not.toHaveBeenCalled();
  });
  it('rounds per user without distributing more than the pool', async () => {
    const f = fixture([1, 2], undefined, 101n, 0n);
    await f.service.dividendTask();
    expect(f.accounts.map((a) => a.balance)).toEqual(['16', '84']);
    expect(f.logs.reduce((sum, l) => sum + BigInt(l.amount), 0n)).toBe(100n);
  });
  it('handles 18-decimal node values without Number precision loss', () => {
    const unit = 10n ** 18n;
    const weights = buildNodeValueWeights(
      [
        { id: 1, nodeLevel: 1 },
        { id: 2, nodeLevel: 2 },
      ],
      [100n * unit, 500n * unit],
    );
    expect(weights.totalValue).toBe(600n * unit);
    expect(weights.groups[1]?.value).toBe(500n * unit);
  });
});
