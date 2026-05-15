-- db/schema/tasks.sql
-- Tasks + Applications + Escrow + Posting Fees
-- Assumptions:
-- - credits == rupees
-- - locations table exists (you already have it)
-- - users table exists
-- - wallet + wallet_transactions + platform_wallet exist (from your wallet.sql)

BEGIN;

-- 1) Enums (create once)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status') THEN
    CREATE TYPE task_status AS ENUM (
      'open',
      'assigned',
      'in_progress',
      'completion_requested',
      'completed',
      'disputed',
      'cancelled',
      'refunded'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_urgency') THEN
    CREATE TYPE task_urgency AS ENUM ('low', 'medium', 'high', 'critical');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_application_status') THEN
    CREATE TYPE task_application_status AS ENUM ('applied', 'withdrawn', 'rejected', 'accepted');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'escrow_status') THEN
    CREATE TYPE escrow_status AS ENUM ('held', 'released', 'refunded');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'escrow_tx_kind') THEN
    CREATE TYPE escrow_tx_kind AS ENUM ('hold', 'release', 'refund');
  END IF;
END $$;

-- 2) Wallet reasons (extend enum safely)
-- You already have: ('topup','session','refund','adjustment')
-- We'll add task-specific reasons to keep reporting clean.
DO $$
BEGIN
  -- Postgres 12+ supports ADD VALUE IF NOT EXISTS.
  -- If your PG is older, this might fail; tell me and I'll adjust.
  BEGIN
    ALTER TYPE wallet_reason ADD VALUE IF NOT EXISTS 'task_post_fee';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TYPE wallet_reason ADD VALUE IF NOT EXISTS 'task_escrow_hold';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TYPE wallet_reason ADD VALUE IF NOT EXISTS 'task_payout';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END $$;

-- 3) updated_at trigger helper (safe to reuse across tables)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4) Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id BIGSERIAL PRIMARY KEY,

  client_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  case_description TEXT NOT NULL,
  case_type TEXT, -- free text (can evolve later)
  category_term_id INT NULL,
  type_term_id INT NULL,

  location_id INT,
  urgency task_urgency NOT NULL,
  execution_mode TEXT NULL,
  registration_required BOOLEAN NOT NULL DEFAULT FALSE,
  notarisation_required BOOLEAN NOT NULL DEFAULT FALSE,

  budget_credits INT NOT NULL DEFAULT 0 CHECK (budget_credits >= 0),

  status task_status NOT NULL DEFAULT 'open',

  assigned_partner_id INT REFERENCES users(id),
  assigned_at TIMESTAMP NULL,

  partner_marked_complete_at TIMESTAMP NULL,
  client_approved_complete_at TIMESTAMP NULL,

  cancelled_by_admin_at TIMESTAMP NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_tasks_updated_at ON tasks;
CREATE TRIGGER trg_tasks_updated_at
BEFORE UPDATE ON tasks
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_tasks_client_created
ON tasks(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_partner_created
ON tasks(assigned_partner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_status_created
ON tasks(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_location
ON tasks(location_id);

CREATE INDEX IF NOT EXISTS idx_tasks_category_status_created
ON tasks(category_term_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_type_status_created
ON tasks(type_term_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_execution_status_created
ON tasks(registration_required, notarisation_required, status, created_at DESC);

-- 5) Attachments (URL only; no cap for now)
CREATE TABLE IF NOT EXISTS task_attachments (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task
ON task_attachments(task_id);

-- 6) Applications (one per partner per task, updatable)
CREATE TABLE IF NOT EXISTS task_applications (
  id BIGSERIAL PRIMARY KEY,

  task_id BIGINT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  partner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  quote_credits INT NOT NULL CHECK (quote_credits > 0),
  message TEXT,

  status task_application_status NOT NULL DEFAULT 'applied',
  withdrawn_at TIMESTAMP NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT ux_task_applications_task_partner UNIQUE (task_id, partner_id)
);

DROP TRIGGER IF EXISTS trg_task_applications_updated_at ON task_applications;
CREATE TRIGGER trg_task_applications_updated_at
BEFORE UPDATE ON task_applications
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_task_applications_task_created
ON task_applications(task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_applications_partner_created
ON task_applications(partner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_applications_status
ON task_applications(status);

-- 7) Posting fee ledger (platform revenue from task posting)
CREATE TABLE IF NOT EXISTS task_posting_fees (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  client_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  amount_credits INT NOT NULL CHECK (amount_credits > 0),

  -- Optional linkage / audit keys
  wallet_tx_id BIGINT NULL,
  idempotency_key VARCHAR(150) UNIQUE NOT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_posting_fees_client_created
ON task_posting_fees(client_id, created_at DESC);

-- 8) Escrow: one escrow record per task
CREATE TABLE IF NOT EXISTS task_escrow (
  id BIGSERIAL PRIMARY KEY,

  task_id BIGINT NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,

  client_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  amount_credits INT NOT NULL CHECK (amount_credits > 0),

  status escrow_status NOT NULL DEFAULT 'held',

  held_at TIMESTAMP NOT NULL DEFAULT NOW(),
  released_at TIMESTAMP NULL,
  refunded_at TIMESTAMP NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_task_escrow_client
ON task_escrow(client_id);

CREATE INDEX IF NOT EXISTS idx_task_escrow_partner
ON task_escrow(partner_id);

CREATE INDEX IF NOT EXISTS idx_task_escrow_status
ON task_escrow(status);

-- 9) Task escrow events (audit trail: hold/release/refund)
CREATE TABLE IF NOT EXISTS task_escrow_events (
  id BIGSERIAL PRIMARY KEY,

  escrow_id BIGINT NOT NULL REFERENCES task_escrow(id) ON DELETE CASCADE,

  kind escrow_tx_kind NOT NULL,
  amount_credits INT NOT NULL CHECK (amount_credits > 0),

  idempotency_key VARCHAR(150) UNIQUE NOT NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_escrow_events_escrow_created
ON task_escrow_events(escrow_id, created_at DESC);

COMMIT;

-- =========================
-- PATCH: Hardening constraints + indexes
-- (WRAPPED IN A TXN)
-- =========================
BEGIN;

-- 1) task_escrow updated_at
ALTER TABLE task_escrow
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_task_escrow_updated_at ON task_escrow;
CREATE TRIGGER trg_task_escrow_updated_at
BEFORE UPDATE ON task_escrow
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 2) Enforce assigned_partner_id presence only when it truly must exist
--    IMPORTANT: allow cancelled/refunded even when unassigned.
ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS chk_tasks_assigned_partner_required;

ALTER TABLE tasks
ADD CONSTRAINT chk_tasks_assigned_partner_required
CHECK (
  status IN ('open', 'cancelled', 'refunded')
  OR assigned_partner_id IS NOT NULL
);

-- 3) Completion timestamps consistency
ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS chk_tasks_client_approved_only_when_completed;

ALTER TABLE tasks
ADD CONSTRAINT chk_tasks_client_approved_only_when_completed
CHECK (
  client_approved_complete_at IS NULL
  OR status = 'completed'
);

ALTER TABLE tasks
DROP CONSTRAINT IF EXISTS chk_tasks_partner_marked_complete_status;

ALTER TABLE tasks
ADD CONSTRAINT chk_tasks_partner_marked_complete_status
CHECK (
  partner_marked_complete_at IS NULL
  OR status IN ('completion_requested', 'completed')
);

-- 4) Only one accepted application per task
CREATE UNIQUE INDEX IF NOT EXISTS ux_task_applications_one_accepted_per_task
ON task_applications(task_id)
WHERE status = 'accepted';

-- 5) Composite indexes for list APIs
CREATE INDEX IF NOT EXISTS idx_task_applications_task_status_created
ON task_applications(task_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_applications_partner_status_created
ON task_applications(partner_id, status, created_at DESC);

-- 6) Helpful index for partner browsing open tasks by location
CREATE INDEX IF NOT EXISTS idx_tasks_status_location_created
ON tasks(status, location_id, created_at DESC);

-- 7) HIGH VALUE PERF: partner browse endpoint (open + unassigned + newest first)
CREATE INDEX IF NOT EXISTS idx_tasks_open_unassigned_created
ON tasks(created_at DESC)
WHERE status = 'open' AND assigned_partner_id IS NULL;

COMMIT;

-- =========================
-- MIGRATION: Copy existing job data into task tables
-- Safe to re-run; leaves old job tables untouched as backup.
-- =========================
BEGIN;

INSERT INTO tasks (
  id,
  client_id,
  title,
  case_description,
  case_type,
  location_id,
  urgency,
  budget_credits,
  status,
  assigned_partner_id,
  assigned_at,
  partner_marked_complete_at,
  client_approved_complete_at,
  cancelled_by_admin_at,
  metadata,
  created_at,
  updated_at
)
SELECT
  id,
  client_id,
  title,
  case_description,
  case_type,
  location_id,
  urgency::text::task_urgency,
  budget_credits,
  status::text::task_status,
  assigned_partner_id,
  assigned_at,
  partner_marked_complete_at,
  client_approved_complete_at,
  cancelled_by_admin_at,
  COALESCE(metadata, '{}'::jsonb),
  created_at,
  updated_at
FROM jobs
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_attachments (id, task_id, url, created_at)
SELECT id, job_id, url, created_at
FROM job_attachments
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_applications (
  id,
  task_id,
  partner_id,
  quote_credits,
  message,
  status,
  withdrawn_at,
  created_at,
  updated_at
)
SELECT
  id,
  job_id,
  partner_id,
  quote_credits,
  message,
  status::text::task_application_status,
  withdrawn_at,
  created_at,
  updated_at
FROM job_applications
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_posting_fees (
  id,
  task_id,
  client_id,
  amount_credits,
  wallet_tx_id,
  idempotency_key,
  created_at
)
SELECT
  id,
  job_id,
  client_id,
  amount_credits,
  wallet_tx_id,
  REPLACE(idempotency_key, 'job_', 'task_'),
  created_at
FROM job_posting_fees
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_escrow (
  id,
  task_id,
  client_id,
  partner_id,
  amount_credits,
  status,
  held_at,
  released_at,
  refunded_at,
  metadata,
  updated_at
)
SELECT
  id,
  job_id,
  client_id,
  partner_id,
  amount_credits,
  status,
  held_at,
  released_at,
  refunded_at,
  COALESCE(metadata, '{}'::jsonb),
  COALESCE(updated_at, held_at, NOW())
FROM job_escrow
ON CONFLICT (id) DO NOTHING;

INSERT INTO task_escrow_events (
  id,
  escrow_id,
  kind,
  amount_credits,
  idempotency_key,
  metadata,
  created_at
)
SELECT
  id,
  escrow_id,
  kind,
  amount_credits,
  REPLACE(idempotency_key, 'job_', 'task_'),
  COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('migrated_from_job_escrow', true),
  created_at
FROM escrow_transactions
ON CONFLICT (id) DO NOTHING;

SELECT setval('tasks_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM tasks), 1), true);
SELECT setval('task_attachments_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM task_attachments), 1), true);
SELECT setval('task_applications_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM task_applications), 1), true);
SELECT setval('task_posting_fees_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM task_posting_fees), 1), true);
SELECT setval('task_escrow_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM task_escrow), 1), true);
SELECT setval('task_escrow_events_id_seq', GREATEST((SELECT COALESCE(MAX(id), 1) FROM task_escrow_events), 1), true);

COMMIT;
