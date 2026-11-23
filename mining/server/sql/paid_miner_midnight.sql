-- Stop API and Worker first. Already credited rewards are not reversed.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('distribute_miner_rewards'));
UPDATE account_miner
SET cycle_end_at = FLOOR((cycle_end_at::numeric + 28800) / 86400)::integer * 86400 - 28800
WHERE cycle_end_at IS NOT NULL;
COMMIT;
