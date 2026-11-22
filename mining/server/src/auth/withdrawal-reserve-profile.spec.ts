import { AuthService } from './auth.service';
jest.mock('src/web3/web3.service', () => ({ Web3Service: class {} }));
jest.mock('src/nonce/nonce.service', () => ({ NonceService: class {} }));
const unit = 10n ** 18n;

describe('profile returns calculated withdrawal balances', () => {
  it.each([
    [true, 0n, 0n, 0n],
    [true, 8n, 8n, 0n],
    [true, 15n, 10n, 5n],
    [false, 15n, 0n, 15n],
  ])(
    'calculates reserve for free=%s and total=%s',
    async (free, total, retained, available) => {
      const accounts = {
        findOne: jest.fn().mockResolvedValue({
          id: 1,
          address: '0xabc',
          balance: String(total * unit),
          usdtBalance: '100',
          vipLevel: 0,
          manualVipLevel: 0,
        }),
        canInvite: jest.fn().mockResolvedValue(true),
        hasFreeMiner: jest.fn().mockResolvedValue(free),
        hasPaidMiner: jest.fn().mockResolvedValue(false),
      };
      const service = new AuthService(
        accounts as never,
        {} as never,
        {} as never,
        {} as never,
      );
      const result = await service.getProfile('0xabc');
      expect(result.nonWithdrawableBalance).toBe(String(retained * unit));
      expect(result.withdrawableBalance).toBe(String(available * unit));
      expect(result.balance).toBe(String(total * unit));
      expect(result.canWithdrawSpace).toBe(false);
      expect(result.usdtBalance).toBe('100');
      expect(accounts.hasFreeMiner).toHaveBeenCalledWith(1);
      expect(accounts.hasPaidMiner).toHaveBeenCalledWith(1);
    },
  );
});
