-- Run only against an isolated empty PostgreSQL database, from server directory.
\set ON_ERROR_STOP on
CREATE TABLE config (key text PRIMARY KEY, value text);
INSERT INTO config VALUES ('MINING_STARTED_AT','1'), ('MAX_CYCLE_SECONDS','10368000'),
 ('MINER_EXTENDED_PER_CYCLE_SECONDS','864000'), ('CYCLE_REWARD_BP','4000'), ('TEAM_REWARD_BP','1000');
CREATE TABLE miner (id text PRIMARY KEY, price numeric);
CREATE TABLE account (id integer PRIMARY KEY, balance numeric);
CREATE TABLE account_miner (id integer PRIMARY KEY, account_id integer, miner_id text,
 expected_reward numeric, produced_reward numeric, cycle integer, cycle_end_at integer,
 last_reward_at integer, reward_per_second numeric);
CREATE TABLE account_relation (superior_id integer, subordinate_id integer, level integer);
CREATE TABLE account_balance_log (account_id integer, type text, token text, amount numeric,
 balance_before numeric, balance_after numeric, created_at integer);
CREATE FUNCTION compute_commission_level(integer) RETURNS integer LANGUAGE sql AS 'SELECT 0';
\i sql/distribute_miner_rewards.sql
DO $$
DECLARE r record; base integer := 1704038400; price numeric := 10000000000000000000;
 rate1 numeric; rate2 numeric; rate3 numeric;
BEGIN
 rate1 := FLOOR(price * .4 / (30 * 86400));
 rate2 := FLOOR(price * .4 / (40 * 86400));
 rate3 := FLOOR(price * .4 / (50 * 86400));
 SELECT * INTO r FROM calculate_paid_miner_reward(base, base + 30*86400, 30*86400, rate1, price, base+80*86400);
 IF r.reward <> rate1*30*86400 + rate2*40*86400 + rate3*10*86400 OR
    r.next_cycle <> 50*86400 OR r.next_end <> base+120*86400 THEN
   RAISE EXCEPTION 'multiple missed cycles incorrect: %', r;
 END IF;
 SELECT * INTO r FROM calculate_paid_miner_reward(base+15*3600, base+30*86400,30*86400,rate1,price,base+30*86400);
 IF r.reward <> rate1*(30*86400-15*3600) OR r.next_end <> base+70*86400 THEN
   RAISE EXCEPTION 'short first cycle / exact boundary incorrect';
 END IF;
 SELECT * INTO r FROM calculate_paid_miner_reward(base,base+30*86400+15*3600,30*86400,rate1,price,base+31*86400);
 IF r.reward <> rate1*30*86400+rate2*86400 THEN
   RAISE EXCEPTION 'legacy non-midnight end not normalized';
 END IF;
END $$;
INSERT INTO miner VALUES ('SPACE_10',10000000000000000000);
INSERT INTO account VALUES (1,0);
INSERT INTO account_miner VALUES (1,1,'SPACE_10',100,0,2592000,
 FLOOR((EXTRACT(EPOCH FROM NOW())+28800)/86400)::integer*86400-28800,
 EXTRACT(EPOCH FROM NOW())::integer-86400, 100);
CALL distribute_miner_rewards();
DO $$ BEGIN
 IF (SELECT balance FROM account WHERE id=1) <> 100 OR
    (SELECT produced_reward FROM account_miner WHERE id=1) <> 100 THEN
   RAISE EXCEPTION 'reward cap failed';
 END IF;
END $$;
CALL distribute_miner_rewards();
DO $$ BEGIN
 IF (SELECT balance FROM account WHERE id=1) <> 100 OR
    (SELECT count(*) FROM account_balance_log) <> 1 THEN
   RAISE EXCEPTION 'repeated settlement duplicated payment';
 END IF;
END $$;
-- Delayed settlement must equal timely segments, even after reaching max cycle.
DO $$
DECLARE a record; b record; c record; base integer := 1704038400;
 price numeric := 10000000000000000000;
 rate numeric := FLOOR(10000000000000000000 * .4 / (30*86400));
BEGIN
 SELECT * INTO a FROM calculate_paid_miner_reward(base,base+30*86400,30*86400,rate,price,base+2000*86400);
 SELECT * INTO b FROM calculate_paid_miner_reward(base,base+30*86400,30*86400,rate,price,base+80*86400);
 SELECT * INTO c FROM calculate_paid_miner_reward(base+80*86400,b.next_end,b.next_cycle,b.next_rate,price,base+2000*86400);
 IF a.reward <> b.reward+c.reward OR a.next_end <> c.next_end OR a.next_cycle <> 120*86400 THEN
   RAISE EXCEPTION 'delayed settlement differs from timely settlement';
 END IF;
END $$;
\i sql/paid_miner_midnight.sql
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM account_miner WHERE (cycle_end_at+28800)%86400<>0) THEN
   RAISE EXCEPTION 'migration did not align midnight';
 END IF;
END $$;
