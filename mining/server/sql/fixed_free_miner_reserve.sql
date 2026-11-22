-- 已有数据库切换至“领取免费矿机后，提现/转出预留 10 SpaceXZI”。
-- 首次空库建表使用当前实体，不需要执行本文件。
-- 执行前停止 API/Worker 并核对未完成的购买、提现签名；先备份数据库。
-- 本脚本只删除旧资金来源追踪字段，不修改任何账户总余额和矿机产出。
-- free_miner 记录必须保留，包括待启动和已产完矿机，它决定是否需要预留。
-- 在 server 目录、连接到业务数据库的 psql 中执行：
--   \i sql/fixed_free_miner_reserve.sql
BEGIN;
SET LOCAL lock_timeout = '5s';
ALTER TABLE public.account
    DROP CONSTRAINT IF EXISTS account_restricted_balance_check,
    DROP CONSTRAINT IF EXISTS account_balance_nonnegative_check,
    DROP COLUMN IF EXISTS non_withdrawable_balance,
    ADD CONSTRAINT account_balance_nonnegative_check CHECK (balance >= 0);
ALTER TABLE public.free_miner
    DROP COLUMN IF EXISTS non_withdrawable_reward;
ALTER TABLE public.miner_purchase_signature
    DROP COLUMN IF EXISTS restricted_value;
ALTER TABLE public.account_balance_log
    DROP COLUMN IF EXISTS restricted_change,
    DROP COLUMN IF EXISTS restricted_balance_after;
COMMIT;
