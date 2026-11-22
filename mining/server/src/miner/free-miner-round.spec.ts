import { calculateFreeMinerRound } from './utils/free-miner-round.util';
import { FreeMiner } from './entities/free-miner.entity';

const day = 86400;
const unit = 10n ** 18n;
const config = {
  initCycle: 30 * day,
  maxCycle: 120 * day,
  minerExtendedPerCycle: day,
  cycleRewardBp: 4000n,
};
function miner(overrides: Partial<FreeMiner> = {}): FreeMiner {
  return {
    price: String(10n * unit),
    expectedReward: String(50n * unit),
    producedReward: '0',
    claimedReward: '0',
    cycle: 30 * day,
    cycleEndAt: 30 * day,
    rewardPerSecond: String((10n * unit * 4000n) / 10000n / BigInt(30 * day)),
    roundStartedAt: 0,
    roundRewardBp: 4000,
    roundMaxCycle: config.maxCycle,
    roundCycleExtension: config.minerExtendedPerCycle,
    lastRewardAt: 0,
    ...overrides,
  } as FreeMiner;
}

describe('free miner lazy 24-hour rounds with wall-time yield cycles', () => {
  it('shows progress but cannot be claimed before 24 hours', () => {
    const result = calculateFreeMinerRound(miner(), day - 1);
    expect(result.state).toBe('running');
    expect(result.availableReward).toBe(0n);
    expect(result.projectedProducedReward).toBeGreaterThan(0n);
  });
  it('offers exactly one round at the boundary and never backfills waiting days', () => {
    const due = calculateFreeMinerRound(miner(), day);
    const late = calculateFreeMinerRound(miner(), 100 * day);
    expect(due.state).toBe('pending_claim');
    expect(late.availableReward).toBe(due.availableReward);
    expect(late.cycle).toBeGreaterThan(due.cycle);
    expect(late.cycleEndAt).toBeGreaterThan(100 * day);
  });
  it('splits a round crossing a yield-cycle boundary using the rate on each side', () => {
    const m = miner({ roundStartedAt: 30 * day - day / 2 });
    const result = calculateFreeMinerRound(m, 30 * day + day / 2);
    const rate1 = BigInt(m.rewardPerSecond);
    const rate2 = (10n * unit * 4000n) / 10000n / BigInt(31 * day);
    expect(result.availableReward).toBe((rate1 + rate2) * BigInt(day / 2));
  });
  it('caps the final round at 50 and stops after its claim', () => {
    const m = miner({
      producedReward: String(50n * unit - 1n),
      claimedReward: String(50n * unit - 1n),
    });
    expect(calculateFreeMinerRound(m, day).availableReward).toBe(1n);
    expect(
      calculateFreeMinerRound(
        miner({
          producedReward: String(50n * unit),
          claimedReward: String(50n * unit),
          roundStartedAt: null,
        }),
        day,
      ).state,
    ).toBe('finished');
  });
  it('does not start before global activation and handles long waits at max cycle', () => {
    expect(
      calculateFreeMinerRound(
        miner({ roundStartedAt: null, cycleEndAt: null }),
        day,
      ).state,
    ).toBe('pending_start');
    const r = calculateFreeMinerRound(miner(), 1000000 * day);
    expect(r.cycle).toBe(config.maxCycle);
    expect(r.cycleEndAt).toBeGreaterThan(1000000 * day);
  });
});
