DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_status') THEN
    CREATE TYPE session_status AS ENUM ('active', 'ended');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS sessions (
  session_id BIGSERIAL PRIMARY KEY,

  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  session_type VARCHAR(20) NOT NULL, -- 'call' | 'chat' etc
  status session_status NOT NULL DEFAULT 'active',

  rate_credits_per_min INT NOT NULL CHECK (rate_credits_per_min > 0),

  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMP,
  ended_reason VARCHAR(50),

  total_minutes_billed INT NOT NULL DEFAULT 0 CHECK (total_minutes_billed >= 0),
  total_credits_billed INT NOT NULL DEFAULT 0 CHECK (total_credits_billed >= 0),

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_created
ON sessions(user_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_partner_created
ON sessions(partner_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_status_started
ON sessions(status, started_at);

CREATE TABLE IF NOT EXISTS session_minutes (
  id BIGSERIAL PRIMARY KEY,

  session_id BIGINT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  minute_index INT NOT NULL CHECK (minute_index >= 1),

  amount_credits INT NOT NULL CHECK (amount_credits > 0),

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),

  UNIQUE(session_id, minute_index)
);

CREATE INDEX IF NOT EXISTS idx_session_minutes_session
ON session_minutes(session_id, minute_index);
