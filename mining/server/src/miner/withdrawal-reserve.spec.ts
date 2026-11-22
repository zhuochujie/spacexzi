import { MinerService } from './miner.service';
import { AccountService } from 'src/account/account.service';
import { Account } from 'src/account/entities/account.entity';
import { AccountBalanceLog } from 'src/account/entities/account-balance-log.entity';
import { AccountWithdrawSignature } from 'src/account/entities/account-withdraw-signature.entity';
import { Miner } from './entities/miner.entity';
import { AccountMiner } from './entities/account-miner.entity';
import { FreeMiner } from './entities/free-miner.entity';
import { withdrawableSpace } from 'src/account/utils/space-balance.util';
import { MinerPurchaseSignature } from './entities/miner-purchase-signature.entity';
import { MinerPurchaseSignatureStatus } from './enums/miner-purchase-signature-status.enum';
import { PurchaseMethod } from './enums/purchase-method.enum';
jest.mock('src/web3/web3.service', () => ({ Web3Service: class {} }));
jest.mock('src/market/market.service', () => ({ MarketService: class {} }));

const unit = 10n ** 18n;
function fixture(paid = false, free = true) {
  const account = {
    id: 1,
    address: '0xabc',
    balance: String(15n * unit),
  };
  let signature: Record<string, unknown> | null = null;
  const logs: unknown[] = [];
  const signatures = {
    findOne: jest.fn(() =>
      Promise.resolve(
        signature?.status === MinerPurchaseSignatureStatus.Pending
          ? signature
          : null,
      ),
    ),
    create: (value: Record<string, unknown>) => value,
    save: jest.fn((value: Record<string, unknown>) => {
      signature = value;
      return Promise.resolve(value);
    }),
  };
  const miner = {
    id: 'SPACE_TEST',
    price: String(12n * unit),
    expectedReward: String(60n * unit),
    isPurchasable: true,
  };
  const minerRepository = { findOne: jest.fn().mockResolvedValue(miner) };
  const accountMinerRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    exists: jest.fn().mockResolvedValue(paid),
  };
  const freeMinerRepository = { exists: jest.fn().mockResolvedValue(free) };
  const manager = {
    getRepository: (entity: unknown) => {
      if (entity === Account)
        return {
          findOne: jest.fn().mockResolvedValue(account),
          save: jest.fn().mockResolvedValue({}),
        };
      if (entity === MinerPurchaseSignature) return signatures;
      if (entity === AccountMiner) return accountMinerRepository;
      if (entity === FreeMiner) return freeMinerRepository;
      if (entity === Miner) return minerRepository;
      if (entity === AccountBalanceLog)
        return {
          create: (value: unknown) => value,
          save: (value: unknown) => {
            logs.push(value);
            return Promise.resolve(value);
          },
        };
      if (entity === AccountWithdrawSignature)
        return {
          create: (value: unknown) => value,
          save: jest.fn().mockResolvedValue({}),
        };
      throw new Error('unexpected repository');
    },
  };
  const ds = {
    manager,
    transaction: (fn: (m: typeof manager) => Promise<unknown>) => fn(manager),
  };
  const web3 = {
    signPurchaseMiner: jest.fn().mockResolvedValue({ signature: 'signed' }),
    signClaim: jest.fn().mockResolvedValue({ signature: 'signed' }),
  };
  const cfg = {
    getWithdrawFeeBps: jest
      .fn()
      .mockResolvedValue({ vipFeeBp: 0n, nodeFeeBp: 0n }),
  };
  return {
    miner,
    minerRepository,
    accountMinerRepository,
    freeMinerRepository,
    account,
    signatures,
    logs,
    web3,
    miners: new MinerService(
      ds as never,
      web3 as never,
      cfg as never,
      {} as never,
    ),
    accounts: new AccountService(
      ds as never,
      web3 as never,
      cfg as never,
      {} as never,
    ),
  };
}

describe('fixed free-miner withdrawal reserve', () => {
  it('allows spending below the reserve and refunds the total exactly once', async () => {
    const f = fixture();
    const signature = await f.miners.generatePurchaseMinerSignature(
      1,
      'SPACE_TEST',
      PurchaseMethod.InternalBalance,
    );
    expect(f.account.balance).toBe(String(3n * unit));
    expect(withdrawableSpace(f.account, true)).toBe(0n);
    const processor = f.miners as unknown as {
      processPurchaseMinerSignature: (
        s: MinerPurchaseSignature,
        used: boolean,
        at: number,
      ) => Promise<void>;
    };
    await processor.processPurchaseMinerSignature(
      signature,
      false,
      signature.deadline + 1000,
    );
    expect(f.account.balance).toBe(String(15n * unit));
    expect(withdrawableSpace(f.account, true)).toBe(5n * unit);
    await processor.processPurchaseMinerSignature(
      signature,
      false,
      signature.deadline + 1001,
    );
    expect(f.logs).toHaveLength(2);
  });
  it('does not consume internal balances for a wallet-only purchase', async () => {
    const f = fixture();
    const signature = await f.miners.generatePurchaseMinerSignature(
      1,
      'SPACE_TEST',
      PurchaseMethod.WalletBalance,
    );
    expect(signature.payValue).toBe(String(12n * unit));
    expect(f.account.balance).toBe(String(15n * unit));
    expect(withdrawableSpace(f.account, true)).toBe(5n * unit);
  });
  it('requires a successful paid purchase before allowing SPACE withdrawal', async () => {
    const f = fixture(false);
    await expect(f.accounts.generateWithdrawSignature(1, '1')).rejects.toThrow(
      'PAID_MINER_REQUIRED_FOR_WITHDRAW',
    );
    expect(f.accountMinerRepository.exists).toHaveBeenCalledWith({
      where: { accountId: 1 },
    });
    expect(f.freeMinerRepository.exists).not.toHaveBeenCalled();
    expect(f.web3.signClaim).not.toHaveBeenCalled();
  });
  it('retains ten from the whole balance regardless of its income source', async () => {
    const f = fixture(true);
    await expect(
      f.accounts.generateWithdrawSignature(1, String(6n * unit)),
    ).rejects.toThrow('INSUFFICIENT_BALANCE');
    await f.accounts.generateWithdrawSignature(1, String(5n * unit));
    expect(f.account.balance).toBe(String(10n * unit));
    expect(withdrawableSpace(f.account, true)).toBe(0n);
    await expect(f.accounts.generateWithdrawSignature(1, '1')).rejects.toThrow(
      'INSUFFICIENT_BALANCE',
    );
  });
  it('allows a paid-miner account without a free miner to withdraw its full balance', async () => {
    const f = fixture(true, false);
    await f.accounts.generateWithdrawSignature(1, String(15n * unit));
    expect(f.account.balance).toBe('0');
    expect(f.freeMinerRepository.exists).toHaveBeenCalledWith({
      where: { accountId: 1 },
    });
  });
  it('reapplies the ten-token floor to new income after consuming the balance', async () => {
    const f = fixture(true);
    await f.miners.generatePurchaseMinerSignature(
      1,
      'SPACE_TEST',
      PurchaseMethod.InternalBalance,
    );
    expect(f.account.balance).toBe(String(3n * unit));
    f.account.balance = String(7n * unit);
    await expect(f.accounts.generateWithdrawSignature(1, '1')).rejects.toThrow(
      'INSUFFICIENT_BALANCE',
    );
    f.account.balance = String(15n * unit);
    await f.accounts.generateWithdrawSignature(1, String(5n * unit));
    expect(f.account.balance).toBe(String(10n * unit));
  });
  it.each(Object.values(PurchaseMethod))(
    'rejects an unlisted miner for %s without signing or debiting funds',
    async (method) => {
      const f = fixture();
      f.miner.isPurchasable = false;
      await expect(
        f.miners.generatePurchaseMinerSignature(1, 'SPACE_TEST', method),
      ).rejects.toThrow('MINER_NOT_PURCHASABLE');
      expect(f.web3.signPurchaseMiner).not.toHaveBeenCalled();
      expect(f.signatures.save).not.toHaveBeenCalled();
      expect(f.logs).toHaveLength(0);
      expect(f.account.balance).toBe(String(15n * unit));
      expect(withdrawableSpace(f.account, true)).toBe(5n * unit);
    },
  );

  it('does not return a previously issued pending signature after the miner is delisted', async () => {
    const f = fixture();
    await f.miners.generatePurchaseMinerSignature(
      1,
      'SPACE_TEST',
      PurchaseMethod.WalletBalance,
    );
    f.miner.isPurchasable = false;
    await expect(
      f.miners.generatePurchaseMinerSignature(
        1,
        'SPACE_TEST',
        PurchaseMethod.WalletBalance,
      ),
    ).rejects.toThrow('MINER_NOT_PURCHASABLE');
    expect(f.web3.signPurchaseMiner).toHaveBeenCalledTimes(1);
    expect(f.signatures.save).toHaveBeenCalledTimes(1);
  });

  it('still reuses a valid pending signature while the miner is listed', async () => {
    const f = fixture();
    const first = await f.miners.generatePurchaseMinerSignature(
      1,
      'SPACE_TEST',
      PurchaseMethod.WalletBalance,
    );
    expect(
      await f.miners.generatePurchaseMinerSignature(
        1,
        'SPACE_TEST',
        PurchaseMethod.WalletBalance,
      ),
    ).toBe(first);
    expect(f.web3.signPurchaseMiner).toHaveBeenCalledTimes(1);
    expect(f.minerRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'SPACE_TEST' },
      lock: { mode: 'pessimistic_write' },
    });
  });

  it('also rejects reinvestment in a delisted miner after the old miner expires', async () => {
    const f = fixture();
    f.miner.isPurchasable = false;
    f.accountMinerRepository.findOne.mockResolvedValueOnce({
      producedReward: '50',
      expectedReward: '50',
    });
    await expect(
      f.miners.generatePurchaseMinerSignature(
        1,
        'SPACE_TEST',
        PurchaseMethod.InternalBalance,
      ),
    ).rejects.toThrow('MINER_NOT_PURCHASABLE');
    expect(f.web3.signPurchaseMiner).not.toHaveBeenCalled();
  });
});
