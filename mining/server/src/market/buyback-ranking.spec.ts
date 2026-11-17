import { DataSource } from 'typeorm';
import { MarketService } from './market.service';
import {
  DividendRule,
  DividendRuleCategory,
} from 'src/config/entities/dividend-rule.entity';
import { AccountBalanceLogToken } from 'src/account/entities/account-balance-log.entity';

jest.mock('src/web3/constants', () => ({ buybackPool: { address: '0xpool' } }));
jest.mock('src/common/env.util', () => ({
  requiredEnv: () => 'http://indexer',
}));

function fixture(ranks: number[], weights = [7000, 1800, 800, 300, 100]) {
  const find = jest
    .fn()
    .mockResolvedValue(weights.map((bp, index) => ({ level: index + 1, bp })));
  const ds = { getRepository: jest.fn().mockReturnValue({ find }) };
  const service = new MarketService(ds as unknown as DataSource, {} as never);
  const internals = service as unknown as {
    requestIndexer: (path: string) => Promise<unknown>;
  };
  const request = jest.spyOn(internals, 'requestIndexer').mockResolvedValue({
    pool: '0xpool',
    startTime: 100,
    endTime: 200,
    page: 1,
    pageSize: 20,
    total: ranks.length,
    items: ranks.map((rank) => ({
      address: `account-${rank}`,
      rank,
      spaceAmount: '100',
    })),
  });
  return { service, ds, find, request };
}

describe('buyback ranking reward estimates', () => {
  it('uses the configured allocation for global ranks, including filtered or paginated results', async () => {
    const f = fixture([2, 5, 6, 21]);
    const result = await f.service.getBuybackRanking(100, 200, 2, 20, '0xABC');
    expect(result.items.map((item) => item.rewardBp)).toEqual([
      1800, 100, 0, 0,
    ]);
    expect(f.request).toHaveBeenCalledWith(
      '/buyback/ranking?startTime=100&endTime=200&page=2&pageSize=20&account=0xabc',
    );
    expect(f.ds.getRepository).toHaveBeenCalledWith(DividendRule);
    expect(f.find).toHaveBeenCalledWith({
      where: {
        category: DividendRuleCategory.Buyback,
        token: AccountBalanceLogToken.Usdt,
      },
    });
  });

  it('does not redistribute vacant positions among remaining traders', async () => {
    const result = await fixture([1, 2]).service.getBuybackRanking(100, 200);
    expect(result.items.map((item) => item.rewardBp)).toEqual([7000, 1800]);
  });

  it('uses updated administrator allocations rather than hard-coded frontend percentages', async () => {
    const result = await fixture(
      [1, 2, 3, 4, 5],
      [6000, 2000, 1000, 600, 400],
    ).service.getBuybackRanking(100, 200);
    expect(result.items.map((item) => item.rewardBp)).toEqual([
      6000, 2000, 1000, 600, 400,
    ]);
  });

  it('rejects incomplete reward rules instead of displaying misleading estimates', async () => {
    await expect(
      fixture([1], [7000]).service.getBuybackRanking(100, 200),
    ).rejects.toThrow('INVALID_BUYBACK_DIVIDEND_RULES');
  });
});
