import { MoreThan } from 'typeorm';
import { AccountService } from './account.service';
import { Account } from './entities/account.entity';
import { AccountRelation } from './entities/account-relation.entity';
import { AccountMiner } from 'src/miner/entities/account-miner.entity';
import { FreeMiner } from 'src/miner/entities/free-miner.entity';
jest.mock('src/web3/web3.service', () => ({ Web3Service: class {} }));
jest.mock('src/market/market.service', () => ({ MarketService: class {} }));
const parentAddress = '0x' + 'a'.repeat(40);

function fixture(
  nodeLevel = 0,
  paid = false,
  free = false,
  freeEnabled = false,
) {
  const accountRepo = { exists: jest.fn().mockResolvedValue(nodeLevel > 0) };
  const paidRepo = { exists: jest.fn().mockResolvedValue(paid) };
  const freeRepo = { exists: jest.fn().mockResolvedValue(free) };
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === Account) return accountRepo;
      if (entity === AccountMiner) return paidRepo;
      if (entity === FreeMiner) return freeRepo;
      throw new Error('unexpected repository');
    },
  };
  const config = {
    getFreeMinerCanInvite: jest.fn().mockResolvedValue(freeEnabled),
  };
  return {
    service: new AccountService(
      { manager } as never,
      {} as never,
      config as never,
      {} as never,
    ),
    accountRepo,
    paidRepo,
    freeRepo,
    config,
  };
}

describe('node referral eligibility', () => {
  it.each([1, 2, 3, 4])(
    'allows node level %s without paid/free miners',
    async (level) => {
      const f = fixture(level);
      expect(await f.service.canInvite(1, parentAddress)).toBe(true);
      expect(f.accountRepo.exists).toHaveBeenCalledWith({
        where: { id: 1, nodeLevel: MoreThan(0) },
      });
      expect(f.paidRepo.exists).not.toHaveBeenCalled();
      expect(f.config.getFreeMinerCanInvite).not.toHaveBeenCalled();
    },
  );
  it('does not grant eligibility to a level-zero account without miners', async () => {
    expect(await fixture().service.canInvite(1, parentAddress)).toBe(false);
  });
  it('keeps the existing paid-miner invitation path', async () => {
    expect(await fixture(0, true).service.canInvite(1, parentAddress)).toBe(
      true,
    );
  });
  it('keeps the existing free-miner invitation switch', async () => {
    expect(
      await fixture(0, false, true, true).service.canInvite(1, parentAddress),
    ).toBe(true);
    expect(
      await fixture(0, false, true, false).service.canInvite(1, parentAddress),
    ).toBe(false);
  });
  it('still allows an internal system account to invite', async () => {
    const f = fixture();
    expect(await f.service.canInvite(1, '0x' + '0'.repeat(40))).toBe(true);
    expect(f.accountRepo.exists).not.toHaveBeenCalled();
  });
  it('accepts a node-only referrer during actual registration and creates the mining referral relation', async () => {
    const parent = {
      id: 1,
      address: parentAddress,
      nodeLevel: 1,
      refCode: 'NODECODE',
    };
    const accountRepo = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(parent),
      exists: jest.fn().mockResolvedValue(true),
      create: (v: Record<string, unknown>) => v,
      save: (v: Record<string, unknown>) => Promise.resolve({ ...v, id: 2 }),
    };
    const relationRepo = {
      find: jest.fn().mockResolvedValue([]),
      insert: jest.fn().mockResolvedValue({}),
    };
    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Account) return accountRepo;
        if (entity === AccountRelation) return relationRepo;
        throw new Error('Node-only invitation must not require miner records');
      },
    };
    const db = {
      transaction: (fn: (m: typeof manager) => Promise<unknown>) => fn(manager),
    };
    const service = new AccountService(
      db as never,
      { getNodeLevel: jest.fn().mockResolvedValue(0) } as never,
      {} as never,
      {} as never,
    );
    const account = await service.createAccount(
      '0x' + 'b'.repeat(40),
      'NODECODE',
    );
    expect(account.id).toBe(2);
    expect(relationRepo.insert).toHaveBeenCalledWith([
      { superiorId: 1, subordinateId: 2, level: 1 },
    ]);
  });
});
