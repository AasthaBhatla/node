-- db/schema/jobs.sql
-- Jobs + Applications + Escrow + Posting Fees
-- Assumptions:
-- - credits == rupees
-- - locations table exists (you already have it)
-- - users table exists
-- - wallet + wallet_transactions + platform_wallet exist (from your wallet.sql)

BEGIN;

-- 1) Enums (create once)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
    CREATE TYPE job_status AS ENUM (
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
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_urgency') THEN
    CREATE TYPE job_urgency AS ENUM ('low', 'medium', 'high', 'critical');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_application_status') THEN
    CREATE TYPE job_application_status AS ENUM ('applied', 'withdrawn', 'rejected', 'accepted');
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
-- We'll add job-specific reasons to keep reporting clean.
DO $$
BEGIN
  -- Postgres 12+ supports ADD VALUE IF NOT EXISTS.
  -- If your PG is older, this might fail; tell me and I'll adjust.
  BEGIN
    ALTER TYPE wallet_reason ADD VALUE IF NOT EXISTS 'job_post_fee';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TYPE wallet_reason ADD VALUE IF NOT EXISTS 'job_escrow_hold';
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;

  BEGIN
    ALTER TYPE wallet_reason ADD VALUE IF NOT EXISTS 'job_payout';
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

-- 4) Jobs table
CREATE TABLE IF NOT EXISTS jobs (
  id BIGSERIAL PRIMARY KEY,

  client_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  case_description TEXT NOT NULL,
  case_type TEXT, -- free text (can evolve later)

  location_id INT,
  urgency job_urgency NOT NULL,

  budget_credits INT NOT NULL DEFAULT 0 CHECK (budget_credits >= 0),

  status job_status NOT NULL DEFAULT 'open',

  assigned_partner_id INT REFERENCES users(id),
  assigned_at TIMESTAMP NULL,

  partner_marked_complete_at TIMESTAMP NULL,
  client_approved_complete_at TIMESTAMP NULL,

  cancelled_by_admin_at TIMESTAMP NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
CREATE TRIGGER trg_jobs_updated_at
BEFORE UPDATE ON jobs
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_jobs_client_created
ON jobs(client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_assigned_partner_created
ON jobs(assigned_partner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_status_created
ON jobs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_jobs_location
ON jobs(location_id);

-- 5) Attachments (URL only; no cap for now)
CREATE TABLE IF NOT EXISTS job_attachments (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_attachments_job
ON job_attachments(job_id);

-- 6) Applications (one per partner per job, updatable)
CREATE TABLE IF NOT EXISTS job_applications (
  id BIGSERIAL PRIMARY KEY,

  job_id BIGINT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  partner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  quote_credits INT NOT NULL CHECK (quote_credits > 0),
  message TEXT,

  status job_application_status NOT NULL DEFAULT 'applied',
  withdrawn_at TIMESTAMP NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),

  CONSTRAINT ux_job_applications_job_partner UNIQUE (job_id, partner_id)
);

DROP TRIGGER IF EXISTS trg_job_applications_updated_at ON job_applications;
CREATE TRIGGER trg_job_applications_updated_at
BEFORE UPDATE ON job_applications
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_job_applications_job_created
ON job_applications(job_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_applications_partner_created
ON job_applications(partner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_applications_status
ON job_applications(status);

-- 7) Posting fee ledger (platform revenue from job posting)
CREATE TABLE IF NOT EXISTS job_posting_fees (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  client_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  amount_credits INT NOT NULL CHECK (amount_credits > 0),

  -- Optional linkage / audit keys
  wallet_tx_id BIGINT NULL,
  idempotency_key VARCHAR(150) UNIQUE NOT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_posting_fees_client_created
ON job_posting_fees(client_id, created_at DESC);

-- 8) Escrow: one escrow record per job
CREATE TABLE IF NOT EXISTS job_escrow (
  id BIGSERIAL PRIMARY KEY,

  job_id BIGINT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,

  client_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  amount_credits INT NOT NULL CHECK (amount_credits > 0),

  status escrow_status NOT NULL DEFAULT 'held',

  held_at TIMESTAMP NOT NULL DEFAULT NOW(),
  released_at TIMESTAMP NULL,
  refunded_at TIMESTAMP NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_job_escrow_client
ON job_escrow(client_id);

CREATE INDEX IF NOT EXISTS idx_job_escrow_partner
ON job_escrow(partner_id);

CREATE INDEX IF NOT EXISTS idx_job_escrow_status
ON job_escrow(status);

-- 9) Escrow transactions (audit trail: hold/release/refund)
CREATE TABLE IF NOT EXISTS escrow_transactions (
  id BIGSERIAL PRIMARY KEY,

  escrow_id BIGINT NOT NULL REFERENCES job_escrow(id) ON DELETE CASCADE,

  kind escrow_tx_kind NOT NULL,
  amount_credits INT NOT NULL CHECK (amount_credits > 0),

  idempotency_key VARCHAR(150) UNIQUE NOT NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escrow_transactions_escrow_created
ON escrow_transactions(escrow_id, created_at DESC);

COMMIT;

-- =========================
-- PATCH: Hardening constraints + indexes
-- (WRAPPED IN A TXN)
-- =========================
BEGIN;

-- 1) job_escrow updated_at
ALTER TABLE job_escrow
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW();

DROP TRIGGER IF EXISTS trg_job_escrow_updated_at ON job_escrow;
CREATE TRIGGER trg_job_escrow_updated_at
BEFORE UPDATE ON job_escrow
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

-- 2) Enforce assigned_partner_id presence only when it truly must exist
--    IMPORTANT: allow cancelled/refunded even when unassigned.
ALTER TABLE jobs
DROP CONSTRAINT IF EXISTS chk_jobs_assigned_partner_required;

ALTER TABLE jobs
ADD CONSTRAINT chk_jobs_assigned_partner_required
CHECK (
  status IN ('open', 'cancelled', 'refunded')
  OR assigned_partner_id IS NOT NULL
);

-- 3) Completion timestamps consistency
ALTER TABLE jobs
DROP CONSTRAINT IF EXISTS chk_jobs_client_approved_only_when_completed;

ALTER TABLE jobs
ADD CONSTRAINT chk_jobs_client_approved_only_when_completed
CHECK (
  client_approved_complete_at IS NULL
  OR status = 'completed'
);

ALTER TABLE jobs
DROP CONSTRAINT IF EXISTS chk_jobs_partner_marked_complete_status;

ALTER TABLE jobs
ADD CONSTRAINT chk_jobs_partner_marked_complete_status
CHECK (
  partner_marked_complete_at IS NULL
  OR status IN ('completion_requested', 'completed')
);

-- 4) Only one accepted application per job
CREATE UNIQUE INDEX IF NOT EXISTS ux_job_applications_one_accepted_per_job
ON job_applications(job_id)
WHERE status = 'accepted';

-- 5) Composite indexes for list APIs
CREATE INDEX IF NOT EXISTS idx_job_applications_job_status_created
ON job_applications(job_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_applications_partner_status_created
ON job_applications(partner_id, status, created_at DESC);

-- 6) Helpful index for partner browsing open jobs by location
CREATE INDEX IF NOT EXISTS idx_jobs_status_location_created
ON jobs(status, location_id, created_at DESC);

-- 7) HIGH VALUE PERF: partner browse endpoint (open + unassigned + newest first)
CREATE INDEX IF NOT EXISTS idx_jobs_open_unassigned_created
ON jobs(created_at DESC)
WHERE status = 'open' AND assigned_partner_id IS NULL;

COMMIT;
