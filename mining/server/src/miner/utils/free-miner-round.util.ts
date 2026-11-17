import { FreeMiner } from '../entities/free-miner.entity';

export const FREE_MINER_ROUND_SECONDS = 86400;
export type FreeMinerState =
  | 'pending_start'
  | 'running'
  | 'pending_claim'
  | 'finished';

// The yield cycle follows wall time. Only the current 24-hour round earns rewards.
export function calculateFreeMinerRound(miner: FreeMiner, now: number) {
  let cycle = miner.cycle;
  let cycleEndAt = miner.cycleEndAt;
  let rate = BigInt(miner.rewardPerSecond);
  const produced = BigInt(miner.producedReward);
  const expected = BigInt(miner.expectedReward);
  const claimed = BigInt(miner.claimedReward);
  const roundStartedAt = miner.roundStartedAt;
  if (cycleEndAt === null || roundStartedAt === null) {
    const state: FreeMinerState =
      produced >= expected ? 'finished' : 'pending_start';
    return {
      state,
      roundEndAt: null,
      roundReward: 0n,
      availableReward: 0n,
      projectedProducedReward: produced,
      cycle,
      cycleEndAt,
      rewardPerSecond: rate,
    };
  }
  const roundEndAt = roundStartedAt + FREE_MINER_ROUND_SECONDS;
  function advanceTo(time: number) {
    while (cycleEndAt !== null && cycleEndAt <= time) {
      cycle = Math.min(cycle + miner.roundCycleExtension, miner.roundMaxCycle);
      cycleEndAt += cycle;
      rate =
        (BigInt(miner.price) * BigInt(miner.roundRewardBp)) /
        10000n /
        BigInt(cycle);
      if (cycle === miner.roundMaxCycle && cycleEndAt <= time) {
        cycleEndAt += (Math.floor((time - cycleEndAt) / cycle) + 1) * cycle;
      }
    }
  }
  let cursor = roundStartedAt;
  const earningEnd = Math.max(cursor, Math.min(now, roundEndAt));
  let roundReward = 0n;
  advanceTo(cursor);
  while (cursor < earningEnd) {
    const end = Math.min(earningEnd, cycleEndAt);
    roundReward += BigInt(end - cursor) * rate;
    cursor = end;
    advanceTo(cursor);
  }
  const remaining = expected > produced ? expected - produced : 0n;
  roundReward = roundReward > remaining ? remaining : roundReward;
  const due = now >= roundEndAt;
  const availableReward = due ? produced + roundReward - claimed : 0n;
  // Waiting for a claim advances cycles but never adds more than one round of output.
  advanceTo(now);
  const state: FreeMinerState =
    produced >= expected && claimed >= produced
      ? 'finished'
      : due
        ? 'pending_claim'
        : 'running';
  return {
    state,
    roundEndAt,
    roundReward,
    availableReward: availableReward > 0n ? availableReward : 0n,
    projectedProducedReward: produced + roundReward,
    cycle,
    cycleEndAt,
    rewardPerSecond: rate,
  };
}
