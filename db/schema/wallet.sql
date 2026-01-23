-- Wallet: one row per user, fast balance reads, safe debits via row lock
CREATE TABLE IF NOT EXISTS wallet (
  user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance_credits INT NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Ledger enums (create once)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_direction') THEN
    CREATE TYPE wallet_direction AS ENUM ('credit', 'debit');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'wallet_reason') THEN
    CREATE TYPE wallet_reason AS ENUM ('topup', 'session', 'refund', 'adjustment');
  END IF;
END $$;

-- Ledger table
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  direction wallet_direction NOT NULL,
  amount_credits INT NOT NULL CHECK (amount_credits > 0),
  reason wallet_reason NOT NULL,

  reference_kind VARCHAR(30),          -- 'order' | 'session' | 'admin' etc
  reference_id VARCHAR(100),           -- can store order_id or session_id as string

  idempotency_key VARCHAR(150) UNIQUE, -- best idempotency for retries/webhooks
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_created
ON wallet_transactions(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_user_reason
ON wallet_transactions(user_id, reason);

CREATE INDEX IF NOT EXISTS idx_wallet_tx_reference
ON wallet_transactions(reference_kind, reference_id);

-- Secondary idempotency when you use reference_kind/reference_id (optional but great)
CREATE UNIQUE INDEX IF NOT EXISTS ux_wallet_tx_ref_unique
ON wallet_transactions(user_id, reference_kind, reference_id, direction, reason)
WHERE reference_kind IS NOT NULL AND reference_id IS NOT NULL;

-- Platform wallet (if you're using it elsewhere)
CREATE TABLE IF NOT EXISTS platform_wallet (
  id INT PRIMARY KEY DEFAULT 1,
  balance_credits INT NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO platform_wallet (id, balance_credits)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- Auto-create wallet row on user creation (recommended)
CREATE OR REPLACE FUNCTION ensure_wallet_row()
RETURNS trigger AS $$
BEGIN
  INSERT INTO wallet(user_id, balance_credits)
  VALUES (NEW.id, 0)
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_wallet ON users;

CREATE TRIGGER trg_users_wallet
AFTER INSERT ON users
FOR EACH ROW
EXECUTE FUNCTION ensure_wallet_row();
