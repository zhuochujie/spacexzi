import {
  AccountBalanceLog,
  AccountBalanceLogToken,
  AccountBalanceLogType,
} from 'src/account/entities/account-balance-log.entity';
import { NodeService } from './node.service';
import { NodePurchaseSignature, NodeRewardLog } from './node.entities';
import { Account } from 'src/account/entities/account.entity';
import { AccountRelation } from 'src/account/entities/account-relation.entity';
jest.mock('./node-web3.service', () => ({ NodeWeb3Service: class {} }));

const deployment = {
  chainId: 56,
  contractAddress: '0x0000000000000000000000000000000000000001',
};
function fixture() {
  const purchase = {
    ...deployment,
    id: 1,
    accountId: 3,
    buyer: '0xbuyer',
    action: 'purchase',
    fromLevel: 0,
    targetLevelIndex: 0,
    amount: '100',
    rewardAmount: '15',
    beneficiaryAccountId: 2,
    nonce: 'nonce',
    deadline: 1000,
    status: 'pending',
  } as NodePurchaseSignature;
  const balance = { id: 2, usdtBalance: '80' };
  const accountLogs: unknown[] = [];
  const logs: Partial<NodeRewardLog>[] = [];
  const manager = {
    query: jest.fn().mockResolvedValue([]),
    findOne: jest.fn(
      (
        entity: unknown,
        options: { where: { status?: string; id?: number } },
      ) => {
        if (entity === Account)
          return Promise.resolve(
            options.where.id === purchase.accountId
              ? { id: 3, address: '0xbuyer', usdtBalance: '0' }
              : balance,
          );
        return Promise.resolve(
          purchase.status === options.where.status ? purchase : null,
        );
      },
    ),
    findOneBy: jest.fn((entity: unknown) =>
      Promise.resolve(entity === AccountRelation ? { superiorId: 2 } : null),
    ),
    save: jest.fn((entity: unknown, value?: Partial<NodeRewardLog>) => {
      if (entity === NodeRewardLog) logs.push(value!);
      if (entity === AccountBalanceLog) accountLogs.push(value!);
      return Promise.resolve(value ?? entity);
    }),
    createQueryBuilder: jest.fn(),
  };
  const builder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({}),
  };
  manager.createQueryBuilder.mockReturnValue(builder);
  const db = {
    transaction: jest.fn((fn: (m: typeof manager) => Promise<unknown>) =>
      fn(manager),
    ),
    getRepository: jest.fn(),
  };
  const chain = {
    ...deployment,
    snapshot: jest.fn().mockResolvedValue({
      level: 0,
      paused: false,
      levels: [{ enabled: true, name: 'One', price: 100n }],
    }),
    signPurchase: jest.fn().mockResolvedValue('signature'),
    assertRewardReceiver: jest.fn().mockResolvedValue(undefined),
  };
  const queue = { add: jest.fn() };
  const config = {
    getNodeReferralRewardBp: jest.fn().mockResolvedValue(1500n),
  };
  const service = new NodeService(
    db as never,
    chain as never,
    queue as never,
    config as never,
  );
  return {
    service,
    purchase,
    balance,
    logs,
    accountLogs,
    db,
    chain,
    config,
    manager,
    builder,
  };
}
describe('Node settlement', () => {
  it('credits only the mining direct parent and settles a repeated nonce once', async () => {
    const f = fixture();
    await f.service.settlePurchase(f.purchase, true, 900n);
    await f.service.settlePurchase(f.purchase, true, 900n);
    expect(f.balance.usdtBalance).toBe('95');
    expect(f.purchase.status).toBe('used');
    expect(f.logs).toHaveLength(1);
    expect(f.accountLogs).toHaveLength(1);
    expect(f.accountLogs[0]).toMatchObject({
      accountId: 2,
      token: AccountBalanceLogToken.Usdt,
      type: AccountBalanceLogType.NodeReferralReward,
      amount: '15',
      balanceBefore: '80',
      balanceAfter: '95',
    });
    expect(f.logs[0]).toMatchObject({
      accountId: 2,
      purchaseSignatureId: 1,
      beforeBalance: '80',
      afterBalance: '95',
    });
    expect(f.builder.set).toHaveBeenCalled();
  });
  it('does not settle an unused nonce at the deadline', async () => {
    const f = fixture();
    await f.service.settlePurchase(f.purchase, false, 1000n);
    expect(f.db.transaction).not.toHaveBeenCalled();
    expect(f.purchase.status).toBe('pending');
  });
  it('expires an unused purchase without reward, level change or balance refund', async () => {
    const f = fixture();
    await f.service.settlePurchase(f.purchase, false, 1001n);
    expect(f.purchase.status).toBe('unused');
    expect(f.balance.usdtBalance).toBe('80');
    expect(f.logs).toHaveLength(0);
    expect(f.builder.update).not.toHaveBeenCalled();
  });
  it('records a root purchase without inventing a beneficiary', async () => {
    const f = fixture();
    f.purchase.beneficiaryAccountId = null;
    await f.service.settlePurchase(f.purchase, true, 900n);
    expect(f.logs).toHaveLength(0);
    expect(f.purchase.status).toBe('used');
  });
  it('rejects a missing RPC result instead of expiring a pending signature', async () => {
    const f = fixture();
    await expect(
      f.service.settlePurchase(f.purchase, undefined as never, 2000n),
    ).rejects.toThrow('NODE_NONCE_RESULT_MISSING');
    expect(f.purchase.status).toBe('pending');
  });
  it('does not credit personal balances unless the onchain reward receiver is the configured Mining', async () => {
    const f = fixture();
    f.chain.assertRewardReceiver.mockRejectedValueOnce(
      new Error('NODE_MINING_CONFIG_MISMATCH'),
    );
    await expect(
      f.service.settlePurchase(f.purchase, true, 900n),
    ).rejects.toThrow('NODE_MINING_CONFIG_MISMATCH');
    expect(f.db.transaction).not.toHaveBeenCalled();
    expect(f.accountLogs).toHaveLength(0);
    expect(f.balance.usdtBalance).toBe('80');
  });
  it('refuses to reconcile signatures against a different deployment', async () => {
    const f = fixture();
    f.purchase.contractAddress = '0xother';
    await expect(
      f.service.settlePurchase(f.purchase, true, 900n),
    ).rejects.toThrow('NODE_DEPLOYMENT_MISMATCH');
    expect(f.logs).toHaveLength(0);
  });
  it('quotes from chain data and freezes the mining direct parent into the signed record', async () => {
    const f = fixture();
    const result = await f.service.purchase(3, 0);
    expect(result).toMatchObject({
      accountId: 3,
      beneficiaryAccountId: 2,
      action: 'purchase',
      amount: '100',
      rewardAmount: '15',
    });
    expect(f.manager.findOneBy).toHaveBeenCalledWith(AccountRelation, {
      subordinateId: 3,
      level: 1,
    });
  });
  it.each([0n, 2000n, 10000n])(
    'uses configured reward BP %s for new signatures',
    async (bp) => {
      const f = fixture();
      f.config.getNodeReferralRewardBp.mockResolvedValue(bp);
      const result = await f.service.purchase(3, 0);
      const rewardAmount = ((100n * bp) / 10000n).toString();
      expect(result).toMatchObject({ amount: '100', rewardAmount });
      expect(f.chain.signPurchase).toHaveBeenCalledWith(
        expect.objectContaining({ rewardAmount }),
      );
    },
  );
  it('refuses disabled tiers and downgrades', async () => {
    const f = fixture();
    f.chain.snapshot.mockResolvedValue({
      level: 1,
      paused: false,
      levels: [{ enabled: true, name: 'One', price: 100n }],
    });
    await expect(f.service.purchase(3, 0)).rejects.toThrow(
      'NODE_INVALID_LEVEL',
    );
  });
  it('reuses an existing live pending quote and prevents multiple targets', async () => {
    const f = fixture();
    f.purchase.deadline = Math.floor(Date.now() / 1000) + 180;
    f.manager.findOneBy.mockResolvedValue(f.purchase as never);
    expect(await f.service.purchase(3, 0)).toBe(f.purchase);
    await expect(f.service.purchase(3, 1)).rejects.toThrow(
      'NODE_PURCHASE_PENDING',
    );
    expect(f.chain.signPurchase).not.toHaveBeenCalled();
    expect(f.config.getNodeReferralRewardBp).not.toHaveBeenCalled();
  });
});

describe('Node page queries', () => {
  it('reads referral statistics without an RPC dependency', async () => {
    const findOneBy = jest.fn().mockResolvedValue({ usdtBalance: '80' });
    const stats = {
      directCount: 1,
      teamCount: 2,
      directPerformance: '100',
      teamPerformance: '300',
    };
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ totalReward: '15' }])
      .mockResolvedValueOnce([stats]);
    const snapshot = jest.fn().mockRejectedValue(new Error('RPC unavailable'));
    const service = new NodeService(
      { getRepository: () => ({ findOneBy }), query } as never,
      { snapshot } as never,
      {} as never,
      {} as never,
    );
    await expect(service.referralStats(3)).resolves.toEqual({
      usdtBalance: '80',
      totalReward: '15',
      ...stats,
    });
    expect(findOneBy).toHaveBeenCalledWith({ id: 3 });
    expect(query).toHaveBeenNthCalledWith(1, expect.any(String), [3]);
    expect(query).toHaveBeenNthCalledWith(2, expect.any(String), [3]);
    expect(snapshot).not.toHaveBeenCalled();
  });
  it('limits pending purchase lookup to the authenticated account', async () => {
    const findOneBy = jest.fn().mockResolvedValue(null);
    const service = new NodeService(
      { getRepository: () => ({ findOneBy }) } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(service.pendingPurchase(3)).resolves.toBeNull();
    expect(findOneBy).toHaveBeenCalledWith({ accountId: 3, status: 'pending' });
  });
});
