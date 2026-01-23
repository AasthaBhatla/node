-- 1) Remove legacy tables
DROP TABLE IF EXISTS credit_transactions CASCADE;
DROP TABLE IF EXISTS wallet CASCADE;

-- 2) Remove legacy user balance
ALTER TABLE users DROP COLUMN IF EXISTS wallet_credits;