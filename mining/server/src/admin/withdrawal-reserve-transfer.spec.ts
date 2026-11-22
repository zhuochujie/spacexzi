import { AdminService } from './admin.service';
import { AccountBalanceLogToken } from 'src/account/entities/account-balance-log.entity';
import { FreeMiner } from 'src/miner/entities/free-miner.entity';

const unit = 10n ** 18n;
function fixture(free = true, balance = 15n) {
  const rows = [
    {
      id: 1,
      address: '0xaaa',
      balance: String(balance * unit),
      usdtBalance: String(30n * unit),
    },
    { id: 2, address: '0xbbb', balance: '0', usdtBalance: '0' },
  ];
  const exists = jest.fn().mockResolvedValue(free);
  const save = jest.fn().mockResolvedValue([]);
  const query = jest.fn().mockResolvedValueOnce(rows).mockResolvedValue([]);
  const manager = {
    query,
    getRepository: (entity: unknown) =>
      entity === FreeMiner
        ? { exists }
        : { create: (value: unknown) => value, save },
  };
  const service = new AdminService({
    transaction: (fn: (m: typeof manager) => unknown) => fn(manager),
  } as never);
  return { service, query, exists, save };
}

describe('admin transfers preserve the free-miner reserve', () => {
  it('blocks transfer of the retained amount', async () => {
    const f = fixture();
    await expect(
      f.service.transferUserBalance(1, {
        toAddress: '0xbbb',
        amount: String(6n * unit),
        token: AccountBalanceLogToken.Space,
      }),
    ).rejects.toThrow('INSUFFICIENT_BALANCE');
    expect(f.query).toHaveBeenCalledTimes(1);
    expect(f.save).not.toHaveBeenCalled();
    expect(f.exists).toHaveBeenCalledWith({ where: { accountId: 1 } });
    expect(f.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('FOR UPDATE'),
      [1, '0xbbb'],
    );
    expect(f.query.mock.invocationCallOrder[0]).toBeLessThan(
      f.exists.mock.invocationCallOrder[0],
    );
  });
  it('allows only the excess above ten for a free-miner account', async () => {
    const f = fixture();
    const result = await f.service.transferUserBalance(1, {
      toAddress: '0xbbb',
      amount: String(5n * unit),
      token: AccountBalanceLogToken.Space,
    });
    expect(result.from.balance).toBe(String(10n * unit));
    expect(result.to.balance).toBe(String(5n * unit));
    expect(f.save).toHaveBeenCalledTimes(1);
  });
  it('does not impose the reserve on accounts without a free miner', async () => {
    const f = fixture(false);
    const result = await f.service.transferUserBalance(1, {
      toAddress: '0xbbb',
      amount: String(15n * unit),
      token: AccountBalanceLogToken.Space,
    });
    expect(result.from.balance).toBe('0');
  });
  it('does not impose the SpaceXZI reserve on USDT', async () => {
    const f = fixture(true, 0n);
    const result = await f.service.transferUserBalance(1, {
      toAddress: '0xbbb',
      amount: String(30n * unit),
      token: AccountBalanceLogToken.Usdt,
    });
    expect(result.from.usdtBalance).toBe('0');
    expect(f.exists).not.toHaveBeenCalled();
  });
});
