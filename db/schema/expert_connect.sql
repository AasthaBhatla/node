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

COMMIT;
