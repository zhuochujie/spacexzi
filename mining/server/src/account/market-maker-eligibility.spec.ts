import { AccountService } from './account.service';
import { Account } from './entities/account.entity';
import { MarketMakerWhitelist } from './entities/market-maker-whitelist.entity';
jest.mock('src/web3/web3.service', () => ({ Web3Service: class {} }));
jest.mock('src/market/market.service', () => ({ MarketService: class {} }));

function fixture(
  slot: number,
  options: {
    dbLevel?: number;
    vip?: number;
    manualVip?: number;
    whitelist?: boolean;
  } = {},
) {
  const account = {
    id: 1,
    address: '0xabc',
    nodeLevel: options.dbLevel ?? 4,
    vipLevel: options.vip ?? 0,
    manualVipLevel: options.manualVip ?? 0,
  };
  const query = jest
    .fn()
    .mockResolvedValue(slot >= 1 && slot <= 30 ? [{ slot }] : []);
  const manager = { query };
  const ds = {
    transaction: jest.fn((fn: (m: typeof manager) => Promise<unknown>) =>
      fn(manager),
    ),
    getRepository: (entity: unknown) => {
      if (entity === Account)
        return { findOne: jest.fn().mockResolvedValue(account) };
      if (entity === MarketMakerWhitelist)
        return {
          exists: jest.fn().mockResolvedValue(options.whitelist ?? false),
        };
      throw new Error('unexpected repository');
    },
  };
  const web3 = {
    getNodeDeployment: jest
      .fn()
      .mockReturnValue({ chainId: 56, contractAddress: '0xnode' }),
    signFeeExempt: jest.fn().mockResolvedValue({ signature: 'signed' }),
  };
  const config = {
    getMarketMakerEligibilityConfig: jest
      .fn()
      .mockResolvedValue({ nodeLevel: 4, vipLevel: 3 }),
  };
  return {
    service: new AccountService(
      ds as never,
      web3 as never,
      config as never,
      {} as never,
    ),
    web3,
    query,
  };
}

describe('signature-based first 30 node market makers', () => {
  it.each([1, 30])(
    'allows a confirmed node purchaser with permanent slot %s',
    async (slot) => {
      const f = fixture(slot);
      expect(await f.service.claimFeeExempt(1)).toMatchObject({ exempt: true });
      expect(f.query).toHaveBeenLastCalledWith(
        expect.stringContaining('SELECT slot'),
        [56, '0xnode', 4, 1],
      );
    },
  );
  it.each([0, 31, 100])(
    'rejects a purchaser without one of the first 30 slots: %s',
    async (slot) => {
      const f = fixture(slot);
      await expect(f.service.claimFeeExempt(1)).rejects.toThrow(
        'MARKET_MAKER_REQUIREMENTS_NOT_MET',
      );
      expect(f.web3.signFeeExempt).not.toHaveBeenCalled();
    },
  );
  it('rejects an incorrect account node level even if it has a slot', async () => {
    const f = fixture(1, { dbLevel: 3 });
    await expect(f.service.claimFeeExempt(1)).rejects.toThrow(
      'MARKET_MAKER_REQUIREMENTS_NOT_MET',
    );
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each([{ vip: 3 }, { manualVip: 3 }, { whitelist: true }])(
    'keeps VIP and whitelist channels independent %p',
    async (options) => {
      const f = fixture(31, options);
      expect(await f.service.claimFeeExempt(1)).toMatchObject({ exempt: true });
      expect(f.query).not.toHaveBeenCalled();
    },
  );
  it('does not sign when slot allocation fails', async () => {
    const f = fixture(1);
    f.query.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(f.service.claimFeeExempt(1)).rejects.toThrow(
      'database unavailable',
    );
    expect(f.web3.signFeeExempt).not.toHaveBeenCalled();
  });
});
