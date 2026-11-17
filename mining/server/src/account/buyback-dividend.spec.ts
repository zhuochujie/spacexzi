import { AccountService } from './account.service';
import { Account } from './entities/account.entity';
import {
  AccountBalanceLog,
  AccountBalanceLogType,
} from './entities/account-balance-log.entity';
import { DividendRuleCategory } from 'src/config/entities/dividend-rule.entity';
import { shanghaiWeekStart, WEEK_SECONDS } from 'src/common/week.util';
jest.mock('src/web3/web3.service', () => ({ Web3Service: class {} }));
jest.mock('src/market/market.service', () => ({ MarketService: class {} }));

function fixture(count: number) {
  const accounts = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    address: `0x${String(i + 1).padStart(40, '0')}`,
    usdtBalance: '10',
  }));
  const logs: Array<{
    type: AccountBalanceLogType;
    amount: string;
    accountId: number;
  }> = [];
  const stats: Array<{
    category: DividendRuleCategory;
    level: number;
    totalAmount: string;
  }> = [];
  const accountRepo = {
    findOneBy: jest.fn((q: { address: string }) =>
      Promise.resolve(accounts.find((a) => a.address === q.address) ?? null),
    ),
    findOne: jest.fn((q: { where: { id: number } }) =>
      Promise.resolve(accounts.find((a) => a.id === q.where.id)),
    ),
    save: jest.fn((value: unknown) => Promise.resolve(value)),
  };
  const otherRepo = (values: unknown[]) => ({
    create: (v: unknown) => v,
    save: jest.fn((v: unknown) => {
      values.push(v);
      return Promise.resolve(v);
    }),
  });
  const manager = {
    getRepository: (entity: unknown) =>
      entity === Account
        ? accountRepo
        : entity === AccountBalanceLog
          ? otherRepo(logs)
          : otherRepo(stats),
  };
  const db = {
    getRepository: manager.getRepository,
    query: jest.fn().mockResolvedValue([]),
    transaction: jest.fn((fn: (m: typeof manager) => Promise<unknown>) =>
      fn(manager),
    ),
  };
  const web3 = {
    getBuybackDividendBalance: jest.fn().mockResolvedValue(5000n),
    dividend: jest.fn().mockResolvedValue({
      vipFeeVaultSpaceBalance: 0n,
      nodeFeeVaultSpaceBalance: 0n,
      nodeFeeVaultUsdtBalance: 0n,
    }),
  };
  const rules = [7000n, 1800n, 800n, 300n, 100n].map((bp, index) => ({
    level: index + 1,
    bp,
  }));
  const config = {
    getDividendRules: jest.fn((category: DividendRuleCategory) =>
      Promise.resolve(category === DividendRuleCategory.Buyback ? rules : []),
    ),
  };
  const buyback = {
    getBuybackRanking: jest.fn().mockResolvedValue({
      items: accounts.map((a, i) => ({
        address: a.address,
        rank: i + 1,
        spaceAmount: '100',
      })),
    }),
  };
  const service = new AccountService(
    db as never,
    web3 as never,
    config as never,
    buyback as never,
  );
  jest
    .spyOn(service, 'recomputeVipLevelsSnapshot')
    .mockResolvedValue(undefined);
  const internals = service as unknown as {
    distributeDividendByVipLevel: () => Promise<void>;
    distributeDividendByNodeValue: () => Promise<void>;
  };
  jest
    .spyOn(internals, 'distributeDividendByVipLevel')
    .mockResolvedValue(undefined);
  jest
    .spyOn(internals, 'distributeDividendByNodeValue')
    .mockResolvedValue(undefined);
  return {
    service,
    accounts,
    logs,
    stats,
    web3,
    buyback,
    config,
    db,
    rules,
    accountRepo,
  };
}
describe('Weekly buyback dividend using existing dividend flow', () => {
  it('allocates all five ranks to the existing USDT balance and writes normal logs/stats', async () => {
    const f = fixture(5);
    await f.service.dividendTask();
    expect(f.web3.dividend).toHaveBeenCalledWith(5000n, false);
    expect(f.accounts.map((a) => a.usdtBalance)).toEqual([
      '3510',
      '910',
      '410',
      '160',
      '60',
    ]);
    expect(f.logs.map((l) => l.amount)).toEqual([
      '3500',
      '900',
      '400',
      '150',
      '50',
    ]);
    expect(
      f.logs.every((l) => l.type === AccountBalanceLogType.BuybackDividend),
    ).toBe(true);
    expect(f.stats.map((s) => s.level)).toEqual([1, 2, 3, 4, 5]);
    expect(f.buyback.getBuybackRanking).toHaveBeenCalledWith(
      shanghaiWeekStart() - WEEK_SECONDS,
      shanghaiWeekStart(),
      1,
      5,
    );
  });
  it('collects only 88% when two traders exist, leaving the missing 12% in the vault', async () => {
    const f = fixture(2);
    await f.service.dividendTask();
    expect(f.web3.dividend).toHaveBeenCalledWith(4400n, false);
    expect(f.logs).toHaveLength(2);
    expect(f.stats).toHaveLength(2);
  });
  it('keeps the complete budget in the vault for an empty week and never uses fallback recipients', async () => {
    const f = fixture(0);
    await f.service.dividendTask();
    expect(f.web3.dividend).toHaveBeenCalledWith(0n, false);
    expect(f.logs).toHaveLength(0);
    expect(f.stats).toHaveLength(0);
  });
  it('leaves integer rounding remainders in the vault', async () => {
    const f = fixture(5);
    f.web3.getBuybackDividendBalance.mockResolvedValue(101n);
    await f.service.dividendTask();
    expect(f.web3.dividend).toHaveBeenCalledWith(100n, false);
  });
  it('does not move funds if the indexer is unavailable', async () => {
    const f = fixture(2);
    f.buyback.getBuybackRanking.mockRejectedValue(
      new Error('indexer unavailable'),
    );
    await expect(f.service.dividendTask()).rejects.toThrow(
      'indexer unavailable',
    );
    expect(f.web3.dividend).not.toHaveBeenCalled();
  });
  it('does not move funds if a ranked account is missing', async () => {
    const f = fixture(2);
    f.accountRepo.findOneBy.mockResolvedValue(null);
    await expect(f.service.dividendTask()).rejects.toThrow();
    expect(f.web3.dividend).not.toHaveBeenCalled();
  });
});
