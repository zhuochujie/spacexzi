import { ConfigService } from './config.service';

describe('Node referral reward config', () => {
  it.each([
    ['0', 0n],
    ['1500', 1500n],
    ['10000', 10000n],
  ])('accepts BP %s', async (value, expected) => {
    const findOneBy = jest.fn().mockResolvedValue({ value });
    const service = new ConfigService({ findOneBy } as never, {} as never);
    await expect(service.getNodeReferralRewardBp()).resolves.toBe(expected);
    expect(findOneBy).toHaveBeenCalledWith({ key: 'NODE_REFERRAL_REWARD_BP' });
  });
  it.each([undefined, '-1', '10001', '15%', '1.5'])(
    'rejects invalid or missing BP %s',
    async (value) => {
      const findOneBy = jest
        .fn()
        .mockResolvedValue(value === undefined ? null : { value });
      const service = new ConfigService({ findOneBy } as never, {} as never);
      await expect(service.getNodeReferralRewardBp()).rejects.toThrow();
    },
  );
});
