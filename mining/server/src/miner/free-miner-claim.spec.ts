import { MinerService } from './miner.service';
import { Account } from 'src/account/entities/account.entity';
import { AccountBalanceLog } from 'src/account/entities/account-balance-log.entity';
import { FreeMiner } from './entities/free-miner.entity';
jest.mock('src/web3/web3.service', () => ({ Web3Service: class {} }));

function fixture(
  produced = 50n * 10n ** 18n,
  claimed = 0n,
  overrides: Partial<FreeMiner> = {},
) {
  const freeMiner = {
    accountId: 1,
    producedReward: String(produced),
    claimedReward: String(claimed),
    expectedReward: String(50n * 10n ** 18n),
    price: '10000000000000000000',
    nonWithdrawableReward: '10000000000000000000',
    roundStartedAt: 0 as number | null,
    roundRewardBp: 4000,
    roundMaxCycle: 120 * 86400,
    roundCycleExtension: 86400,
    cycle: 30 * 86400,
    cycleEndAt: 30 * 86400,
    lastRewardAt: 0,
    rewardPerSecond: '0',
    ...overrides,
  };
  const account = { id: 1, balance: '123', nonWithdrawableBalance: '0' };
  const saveLog = jest.fn().mockResolvedValue({});
  const freeRepo = {
    findOne: jest.fn().mockResolvedValue(freeMiner),
    save: jest.fn().mockResolvedValue({}),
  };
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === FreeMiner) return freeRepo;
      if (entity === Account)
        return {
          findOne: jest.fn().mockResolvedValue(account),
          save: jest.fn().mockResolvedValue({}),
        };
      if (entity === AccountBalanceLog)
        return { create: (value: unknown) => value, save: saveLog };
      throw new Error('Must not read paid miner purchase history');
    },
  };
  const ds = {
    getRepository: manager.getRepository,
    transaction: (fn: (m: typeof manager) => Promise<unknown>) => fn(manager),
  };
  return {
    service: new MinerService(
      ds as never,
      {} as never,
      {
        getMinerCycleConfig: jest.fn().mockResolvedValue({
          initCycle: 30 * 86400,
          maxCycle: 120 * 86400,
          minerExtendedPerCycle: 86400,
          cycleRewardBp: 4000n,
        }),
        getFreeMinerConfig: jest
          .fn()
          .mockResolvedValue({ cycleRewardBp: 4000n }),
      } as never,
      {} as never,
    ),
    account,
    freeMiner,
    saveLog,
    freeRepo,
  };
}

describe('free miner claims without a paid-purchase allowance', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(86400 * 1000));
  afterEach(() => jest.restoreAllMocks());
  it('allows a user without paid miners to claim all pending output', async () => {
    const f = fixture();
    const result = await f.service.claimFreeMinerReward(1);
    expect(result.claimedAmount).toBe('50000000000000000000');
    expect(f.account.balance).toBe('50000000000000000123');
    expect(f.account.nonWithdrawableBalance).toBe('10000000000000000000');
    expect(f.freeMiner.claimedReward).toBe('50000000000000000000');
    expect(result.freeMiner.claimableReward).toBe('0');
    expect(result.freeMiner).not.toHaveProperty('claimLimit');
    expect(f.freeRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    await expect(f.service.claimFreeMinerReward(1)).rejects.toThrow(
      'NO_FREE_MINER_REWARD_TO_CLAIM',
    );
    expect(f.saveLog).toHaveBeenCalledTimes(1);
  });

  it('only claims output that has not already been claimed', async () => {
    const f = fixture(40n, 30n);
    expect((await f.service.getMyFreeMiner(1))?.claimableReward).toBe('10');
    expect((await f.service.claimFreeMinerReward(1)).claimedAmount).toBe('10');
    expect(f.freeMiner.claimedReward).toBe('40');
  });

  it('rejects an empty claim without changing the balance', async () => {
    const f = fixture(0n, 0n);
    await expect(f.service.claimFreeMinerReward(1)).rejects.toThrow(
      'NO_FREE_MINER_REWARD_TO_CLAIM',
    );
    expect(f.account.balance).toBe('123');
    expect(f.saveLog).not.toHaveBeenCalled();
  });
  it('splits a claim crossing the first-ten threshold and resumes only at claim time', async () => {
    const unit = 10n ** 18n;
    const f = fixture(11n * unit, 9n * unit);
    await f.service.claimFreeMinerReward(1);
    expect(f.account.nonWithdrawableBalance).toBe(unit.toString());
    expect(f.freeMiner.roundStartedAt).toBe(86400);
    await expect(f.service.claimFreeMinerReward(1)).rejects.toThrow(
      'NO_FREE_MINER_REWARD_TO_CLAIM',
    );
    expect(f.saveLog).toHaveBeenCalledTimes(1);
  });
  it('queries calculate output without persisting or crediting a balance', async () => {
    const f = fixture(0n, 0n, { rewardPerSecond: '1' });
    expect((await f.service.getMyFreeMiner(1))?.availableReward).toBe('86400');
    expect(f.freeMiner.producedReward).toBe('0');
    expect(f.account.balance).toBe('123');
    expect(f.freeRepo.save).not.toHaveBeenCalled();
  });
  it('preserves completed rewards when the administrator changes policy, applying new rates only to the next round', async () => {
    const unit = 10n ** 18n;
    const oldRate = (10n * unit * 8000n) / 10000n / BigInt(30 * 86400);
    const f = fixture(0n, 0n, {
      rewardPerSecond: oldRate.toString(),
      roundRewardBp: 8000,
    });
    const oldReward = oldRate * 86400n;
    expect((await f.service.getMyFreeMiner(1))?.claimableReward).toBe(
      oldReward.toString(),
    );
    expect((await f.service.claimFreeMinerReward(1)).claimedAmount).toBe(
      oldReward.toString(),
    );
    expect(f.freeMiner.roundRewardBp).toBe(4000);
    jest.spyOn(Date, 'now').mockReturnValue(2 * 86400 * 1000);
    const newRate = (10n * unit * 4000n) / 10000n / BigInt(30 * 86400);
    expect((await f.service.getMyFreeMiner(1))?.claimableReward).toBe(
      (newRate * 86400n).toString(),
    );
  });

  it('returns the current per-second yield together with the advanced cycle without mutating stored state', async () => {
    const f = fixture(0n, 0n, {
      rewardPerSecond: '1543209876543',
      roundCycleExtension: 10 * 86400,
    });
    jest.spyOn(Date, 'now').mockReturnValue(100 * 86400 * 1000);
    const view = await f.service.getMyFreeMiner(1);
    expect(view?.cycle).toBe(50 * 86400);
    expect(view?.rewardPerSecond).toBe(
      ((10n ** 19n * 4000n) / 10000n / BigInt(50 * 86400)).toString(),
    );
    expect(f.freeMiner.cycle).toBe(30 * 86400);
  });
});
