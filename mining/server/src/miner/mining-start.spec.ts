import { AdminService } from 'src/admin/admin.service';
import { MinerService } from './miner.service';
import { Config } from 'src/config/entities/config.entity';
import { Account } from 'src/account/entities/account.entity';
import { AccountMiner } from './entities/account-miner.entity';
import { Miner } from './entities/miner.entity';
import { FreeMiner } from './entities/free-miner.entity';
import { computeCycleEndAt, computePaidCycleEndAt } from './utils/cycle.util';
import {
  lockMiningStart,
  parseMiningStartedAt,
} from './utils/mining-start.util';

jest.mock('src/web3/web3.service', () => ({ Web3Service: class {} }));

function fixture(startedAt: number | null = null) {
  const config = {
    key: 'MINING_STARTED_AT',
    value: startedAt === null ? 'null' : String(startedAt),
  };
  const calls: string[] = [];
  const configRepo = {
    findOne: jest.fn(() => {
      calls.push('lock');
      return Promise.resolve(config);
    }),
    findOneBy: jest.fn(() => Promise.resolve(config)),
    save: jest.fn(() => {
      calls.push('save-start');
      return Promise.resolve(config);
    }),
  };
  const paidRepo = {
    findOne: jest.fn(() => Promise.resolve(null)),
    create: jest.fn((v: unknown) => v),
    save: jest.fn((v: unknown) => Promise.resolve(v)),
  };
  const freeRepo = { insert: jest.fn((v: unknown) => Promise.resolve(v)) };
  const manager = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === Config) return configRepo;
      if (entity === AccountMiner) return paidRepo;
      if (entity === FreeMiner) return freeRepo;
      if (entity === Account)
        return {
          findOne: jest.fn(() => Promise.resolve({ id: 1, address: '0xabc' })),
        };
      if (entity === Miner)
        return {
          findOne: jest.fn(() =>
            Promise.resolve({ id: 'SPACE_30', price: '300000' }),
          ),
        };
      throw new Error('unexpected repository');
    }),
    query: jest.fn((sql: string) => {
      calls.push(sql);
      return Promise.resolve([{ pendingMiners: 0, pendingFreeMiners: 0 }]);
    }),
  };
  const ds = {
    manager,
    getRepository: manager.getRepository,
    transaction: jest.fn((fn: (m: unknown) => Promise<unknown>) => fn(manager)),
  };
  const cycleConfig = {
    initCycle: 86400,
    cycleRewardBp: 100n,
    maxCycle: 864000,
    minerExtendedPerCycle: 86400,
  };
  const configService = {
    getMinerCycleConfig: jest.fn(() => Promise.resolve(cycleConfig)),
    getFreeMinerConfig: jest.fn(() =>
      Promise.resolve({
        price: 300000n,
        cycleRewardBp: 100n,
      }),
    ),
  };
  const web3 = {
    getFreeMinerClaimEvent: jest.fn(() =>
      Promise.resolve({
        account: '0xabc',
        blockTimestamp: 1500,
        spaceAmount: '500000',
      }),
    ),
  };
  const service = new MinerService(
    ds as never,
    web3 as never,
    configService as never,
    {} as never,
  );
  return {
    admin: new AdminService(ds as never),
    service,
    manager,
    configRepo,
    config,
    calls,
    paidRepo,
    freeRepo,
  };
}

describe('manual global mining start', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(2000000));
  afterEach(() => jest.restoreAllMocks());

  it('starts both types atomically before recording the one-time timestamp', async () => {
    const f = fixture();
    expect(await f.admin.startMining()).toMatchObject({
      miningStartedAt: 2000,
    });
    expect(f.configRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(f.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE account_miner'),
      [2000],
    );
    expect(f.manager.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE free_miner'),
      [2000],
    );
    expect(f.calls.indexOf('save-start')).toBeGreaterThan(2);
  });

  it('does not reset timestamps or cycles when already started', async () => {
    const f = fixture(1000);
    expect(await f.admin.startMining()).toMatchObject({
      miningStartedAt: 1000,
    });
    expect(f.configRepo.save).not.toHaveBeenCalled();
    expect(
      f.manager.query.mock.calls.every(([sql]) => !sql.startsWith('UPDATE')),
    ).toBe(true);
  });

  it('does not settle or advance cycles before start', async () => {
    const f = fixture();
    await f.service.resetCycleAndDistributeRewardTask();
    expect(f.manager.query).not.toHaveBeenCalled();
  });

  it.each([null, 1000])(
    'initializes paid purchases according to start state %s',
    async (startedAt) => {
      const f = fixture(startedAt);
      await (
        f.service as unknown as {
          purchaseMinerInTransaction: (
            manager: unknown,
            buyer: string,
            minerId: string,
            reward: string,
          ) => Promise<void>;
        }
      ).purchaseMinerInTransaction(f.manager, '0xabc', 'SPACE_30', '500000');
      expect(f.paidRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          lastRewardAt: startedAt === null ? null : 2000,
          cycleEndAt:
            startedAt === null ? null : computePaidCycleEndAt(2000, 86400),
        }),
      );
      expect(f.configRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ lock: { mode: 'pessimistic_read' } }),
      );
    },
  );

  it.each([null, 1000, 1800])(
    'initializes free miners using the later of claim time and actual start %s',
    async (startedAt) => {
      const f = fixture(startedAt);
      await f.service.processFreeMinerHash({
        accountId: 1,
        address: '0xabc',
        hash: '0x123',
      });
      const expected = startedAt === null ? null : Math.max(1500, startedAt);
      expect(f.freeRepo.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          lastRewardAt: expected,
          cycleEndAt: expected === null ? null : expected + 86400,
        }),
      );
    },
  );

  it('rejects missing or invalid start configuration instead of enabling rewards', async () => {
    const f = fixture();
    f.configRepo.findOne.mockResolvedValueOnce(null as never);
    await expect(lockMiningStart(f.manager as never)).rejects.toThrow(
      'MINING_START_CONFIG_NOT_FOUND',
    );
    expect(() => parseMiningStartedAt('0')).toThrow(
      'INVALID_MINING_STARTED_AT',
    );
  });

  it('prevents editing start time through generic config management', async () => {
    await expect(
      fixture().admin.updateConfig('MINING_STARTED_AT', { value: '1234' }),
    ).rejects.toThrow('MINING_START_NOT_EDITABLE');
  });

  it('keeps free cycles exact and floors paid cycles to Shanghai midnight', () => {
    expect(computeCycleEndAt(1794361234, 86400)).toBe(1794447634);
    const end = computePaidCycleEndAt(1794361234, 30 * 86400);
    expect((end + 28800) % 86400).toBe(0);
    expect(end).toBeLessThanOrEqual(1794361234 + 30 * 86400);
    expect(end).toBeGreaterThan(1794361234 + 29 * 86400);
    expect(computePaidCycleEndAt(end, 40 * 86400)).toBe(end + 40 * 86400);
  });
});
