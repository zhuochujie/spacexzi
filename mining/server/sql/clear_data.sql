-- 清空当前 server 的全部数据库数据（包括管理员、配置、矿机档位和公告）。
-- 保留表结构、索引、约束、枚举及函数/存储过程，重置自增 ID。
-- 执行前停止用户 API、管理 API 和 Worker，并确认已连接到需要清空的数据库。
-- 在 server 目录中，使用连接到目标数据库的 psql 执行：
--   \i sql/clear_data.sql
-- 成功 COMMIT 后无法回滚，请按需先备份。
-- 此脚本仅清理 public schema 的业务表，不清理 Redis/BullMQ、索引器或链上数据。
-- 链上已使用的 nonce、节点等级、免费矿机领取记录等不会被重置；
-- 若需要完整重置测试环境，应配合重新部署合约、重建索引和清理旧任务。
-- 清空后启动用户 API，会按当前代码和 env 重新创建默认配置、矿机和内置账户。

BEGIN;

-- 有服务仍占用表时尽快报错，避免无限等待。
SET LOCAL lock_timeout = '5s';

-- 显式列出当前实体表，不使用 CASCADE，防止误清理关联的其他表。
-- 表不存在或有未列出的外键依赖时，整笔事务失败，不会部分清空。
TRUNCATE TABLE
    public.node_market_maker_slot,
    public.node_reward_log,
    public.node_purchase_signature,
    public.market_maker_whitelist,
    public.account_relation,
    public.account_balance_log,
    public.account_withdraw_signature,
    public.dividend_level_stat,
    public.account_miner,
    public.miner_purchase_signature,
    public.free_miner,
    public.account,
    public.admin_user,
    public.config,
    public.dividend_rule,
    public.miner,
    public.notice
RESTART IDENTITY RESTRICT;

COMMIT;
