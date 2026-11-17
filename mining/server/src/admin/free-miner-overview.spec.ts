import { AdminService } from './admin.service';
import { MinerService } from 'src/miner/miner.service';
import { FreeMiner } from 'src/miner/entities/free-miner.entity';
import { Config } from 'src/config/entities/config.entity';
jest.mock('src/web3/web3.service', () => ({ Web3Service: class {} }));
const day = 86400,
  unit = 10n ** 18n;
function miner(id: number, start: number): FreeMiner {
  return {
    id,
    accountId: id,
    price: String(10n * unit),
    expectedReward: String(50n * unit),
    producedReward: '0',
    claimedReward: '0',
    roundStartedAt: start,
    cycle: 30 * day,
    cycleEndAt: 30 * day,
    roundRewardBp: 4000,
    roundMaxCycle: 120 * day,
    roundCycleExtension: 10 * day,
    rewardPerSecond: String((10n * unit * 4000n) / 10000n / BigInt(30 * day)),
  } as FreeMiner;
}
describe('free miner round consistency fixes', () => {
  afterEach(() => jest.restoreAllMocks());
  it('keeps paid midnight estimates separate from free rewards currently claimable, with no waiting-time accrual', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(10 * day * 1000);
    const items = [miner(1, 0), miner(2, 9 * day), miner(3, 10 * day - 60)];
    const find = jest
      .fn()
      .mockResolvedValueOnce(items)
      .mockResolvedValueOnce([]);
    const query = jest
      .fn()
      .mockResolvedValue([
        { minerCount: '2', accountCount: '2', rewardTotal: '100' },
      ]);
    const ds = {
      query,
      getRepository: jest.fn((entity) => {
        expect(entity).toBe(FreeMiner);
        return { find };
      }),
    };
    const result = await new AdminService(
      ds as never,
    ).getEstimatedMinerRewards();
    const oneRound = BigInt(items[0].rewardPerSecond) * BigInt(day);
    expect(result.freeMiner.rewardTotal).toBe((2n * oneRound).toString());
    expect(result.freeMiner.minerCount).toBe(2);
    expect(result.freeMiner.calculatedAt).toBe(10 * day);
    expect(result.totalReward).toBe('100');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('updates only the future reward policy when an administrator changes free-miner BP', async () => {
    const config = {
      key: 'FREE_MINER_CYCLE_REWARD_BP',
      value: '8000',
      isAdminEditable: true,
    };
    const repo = {
      findOne: jest.fn().mockResolvedValue(config),
      save: jest.fn((v: unknown) => Promise.resolve(v)),
    };
    const manager = {
      query: jest.fn(),
      getRepository: jest.fn((entity) => {
        expect(entity).toBe(Config);
        return repo;
      }),
    };
    const ds = {
      transaction: (fn: (m: typeof manager) => Promise<unknown>) => fn(manager),
    };
    await new AdminService(ds as never).updateConfig(config.key, {
      value: '4000',
    });
    expect(config.value).toBe('4000');
    expect(manager.query).not.toHaveBeenCalled();
  });

  it('returns only backend valuation and cycle configuration, leaving the amount to the frontend contract read', async () => {
    const web3 = {
      getFreeMinerAmount: jest.fn().mockResolvedValue(200n * unit),
    };
    const config = {
      getFreeMinerConfig: jest.fn().mockResolvedValue({ price: 10n * unit }),
      getMinerCycleConfig: jest.fn().mockResolvedValue({ initCycle: 30 * day }),
    };
    const service = new MinerService(
      {} as never,
      web3 as never,
      config as never,
      {} as never,
    );
    expect(await service.getFreeMinerConfig()).toEqual({
      price: String(10n * unit),
      initialCycleDays: 30,
    });
  });
});
