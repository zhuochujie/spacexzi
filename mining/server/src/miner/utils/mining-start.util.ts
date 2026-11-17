import { EntityManager } from 'typeorm';
import { Config } from 'src/config/entities/config.entity';
import { CustomException } from 'src/common/custom.exception';

export const MINING_STARTED_AT_KEY = 'MINING_STARTED_AT';

// Config values are strings; JSON null represents a mining system that has not started.
export function parseMiningStartedAt(value: string): number | null {
  if (value === 'null') return null;
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw new CustomException('INVALID_MINING_STARTED_AT', 500);
  }
  return timestamp;
}

export async function lockMiningStart(manager: EntityManager, write = false) {
  const config = await manager.getRepository(Config).findOne({
    where: { key: MINING_STARTED_AT_KEY },
    lock: { mode: write ? 'pessimistic_write' : 'pessimistic_read' },
  });
  if (!config) throw new CustomException('MINING_START_CONFIG_NOT_FOUND', 500);
  return { config, miningStartedAt: parseMiningStartedAt(config.value) };
}

export async function getMiningState(manager: EntityManager) {
  const config = await manager
    .getRepository(Config)
    .findOneBy({ key: MINING_STARTED_AT_KEY });
  if (!config) throw new CustomException('MINING_START_CONFIG_NOT_FOUND', 500);
  const [counts] = await manager.query<
    Array<{ pendingMiners: number; pendingFreeMiners: number }>
  >(`
    SELECT (SELECT count(*)::int FROM account_miner WHERE last_reward_at IS NULL) AS "pendingMiners",
           (SELECT count(*)::int FROM free_miner WHERE last_reward_at IS NULL) AS "pendingFreeMiners"
  `);
  return { miningStartedAt: parseMiningStartedAt(config.value), ...counts };
}
