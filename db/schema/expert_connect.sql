BEGIN;

-- 1) Create enum if missing, otherwise ensure required values exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'expert_connection_status') THEN
    CREATE TYPE expert_connection_status AS ENUM (
      'queued',
      'offered',
      'assigned',
      'connected',
      'cancelled',
      'timed_out',
      'completed'
    );
  ELSE
    -- Add missing enum labels safely (Postgres requires separate ALTER TYPE)
    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'expert_connection_status'
        AND e.enumlabel = 'offered'
    ) THEN
      ALTER TYPE expert_connection_status ADD VALUE 'offered';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'expert_connection_status'
        AND e.enumlabel = 'queued'
    ) THEN
      ALTER TYPE expert_connection_status ADD VALUE 'queued';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'expert_connection_status'
        AND e.enumlabel = 'assigned'
    ) THEN
      ALTER TYPE expert_connection_status ADD VALUE 'assigned';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'expert_connection_status'
        AND e.enumlabel = 'connected'
    ) THEN
      ALTER TYPE expert_connection_status ADD VALUE 'connected';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'expert_connection_status'
        AND e.enumlabel = 'cancelled'
    ) THEN
      ALTER TYPE expert_connection_status ADD VALUE 'cancelled';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'expert_connection_status'
        AND e.enumlabel = 'timed_out'
    ) THEN
      ALTER TYPE expert_connection_status ADD VALUE 'timed_out';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'expert_connection_status'
        AND e.enumlabel = 'completed'
    ) THEN
      ALTER TYPE expert_connection_status ADD VALUE 'completed';
    END IF;
  END IF;
END
$$;

-- 2) expert_availability
CREATE TABLE IF NOT EXISTS expert_availability (
  expert_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  is_online BOOLEAN NOT NULL DEFAULT TRUE,
  max_concurrent_clients INTEGER NOT NULL DEFAULT 1 CHECK (max_concurrent_clients > 0),
  current_active_clients INTEGER NOT NULL DEFAULT 0 CHECK (current_active_clients >= 0),
  last_assigned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS expert_availability_online_idx
  ON expert_availability(is_online);

-- 3) expert_connection_queue
CREATE TABLE IF NOT EXISTS expert_connection_queue (
  id SERIAL PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expert_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

  status expert_connection_status NOT NULL DEFAULT 'queued',

  position INTEGER,
  estimated_wait_seconds INTEGER CHECK (estimated_wait_seconds IS NULL OR estimated_wait_seconds >= 0),

  offered_at TIMESTAMPTZ NULL,
  offer_expires_at TIMESTAMPTZ NULL,

  assigned_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  timed_out_at TIMESTAMPTZ,

  rejected_at TIMESTAMPTZ NULL,
  rejected_reason TEXT NULL,

  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- 4) indexes
CREATE INDEX IF NOT EXISTS expert_connection_queue_status_created_idx
  ON expert_connection_queue(status, created_at, id);

CREATE INDEX IF NOT EXISTS expert_connection_queue_expert_status_idx
  ON expert_connection_queue(expert_id, status);

CREATE INDEX IF NOT EXISTS idx_expert_queue_expert_status
  ON expert_connection_queue(expert_id, status, created_at);

-- 5) active request uniqueness (include offered)
DROP INDEX IF EXISTS expert_connection_queue_client_active_uniq;

CREATE UNIQUE INDEX expert_connection_queue_client_active_uniq
  ON expert_connection_queue(client_id)
  WHERE status IN ('queued', 'offered', 'assigned', 'connected');

-- 6) rejected stats indexes
CREATE INDEX IF NOT EXISTS expert_connection_queue_rejected_at_idx
  ON expert_connection_queue(rejected_at)
  WHERE rejected_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS expert_connection_queue_rejected_expert_idx
  ON expert_connection_queue(expert_id, rejected_at)
  WHERE rejected_at IS NOT NULL;

-- 7) offered lookup index (helps worker)
CREATE INDEX IF NOT EXISTS expert_connection_queue_offered_idx
  ON expert_connection_queue(status, offered_at)
  WHERE status = 'offered';

CREATE INDEX IF NOT EXISTS expert_conn_completed_at_idx
  ON expert_connection_queue (completed_at DESC, id DESC)
  WHERE status = 'completed' AND completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS expert_conn_client_completed_idx
  ON expert_connection_queue (client_id, completed_at DESC, id DESC)
  WHERE status = 'completed' AND completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS expert_conn_expert_completed_idx
  ON expert_connection_queue (expert_id, completed_at DESC, id DESC)
  WHERE status = 'completed' AND completed_at IS NOT NULL;

-- Add session link to expert connect
ALTER TABLE expert_connection_queue
  ADD COLUMN IF NOT EXISTS wallet_session_id BIGINT;

-- FK to sessions (safe add)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_expert_connection_queue_wallet_session'
  ) THEN
    ALTER TABLE expert_connection_queue
      ADD CONSTRAINT fk_expert_connection_queue_wallet_session
      FOREIGN KEY (wallet_session_id)
      REFERENCES sessions(session_id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS expert_connection_queue_wallet_session_idx
  ON expert_connection_queue(wallet_session_id);

-- Helpful for history listing
CREATE INDEX IF NOT EXISTS expert_connection_queue_client_completed_idx
  ON expert_connection_queue(client_id, completed_at DESC, id DESC)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS expert_connection_queue_expert_completed_idx
  ON expert_connection_queue(expert_id, completed_at DESC, id DESC)
  WHERE status = 'completed';

ALTER TABLE expert_connection_queue
ADD COLUMN IF NOT EXISTS session_id BIGINT REFERENCES sessions(session_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS expert_connection_queue_session_id_idx
  ON expert_connection_queue(session_id);

-- If any legacy code wrote into session_id, keep data by copying it into wallet_session_id
UPDATE expert_connection_queue
SET wallet_session_id = session_id
WHERE wallet_session_id IS NULL
  AND session_id IS NOT NULL;

-- Drop session_id (drops its FK and index automatically)
ALTER TABLE expert_connection_queue
  DROP COLUMN IF EXISTS session_id;


ALTER TABLE expert_connection_queue
  ADD COLUMN IF NOT EXISTS request_type TEXT;

-- Default existing rows to 'chat' (safe)
UPDATE expert_connection_queue
SET request_type = 'chat'
WHERE request_type IS NULL;

-- Enforce allowed values (optional but recommended)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expert_connection_queue_request_type_chk'
  ) THEN
    ALTER TABLE expert_connection_queue
      ADD CONSTRAINT expert_connection_queue_request_type_chk
      CHECK (request_type IN ('chat', 'call'));
  END IF;
END $$;

-- Make it NOT NULL after backfill
ALTER TABLE expert_connection_queue
  ALTER COLUMN request_type SET NOT NULL;

-- Helpful index if you filter by type later (optional)
CREATE INDEX IF NOT EXISTS expert_connection_queue_request_type_idx
  ON expert_connection_queue(request_type);

COMMIT;
