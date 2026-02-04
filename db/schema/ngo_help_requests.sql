-- ngo_help_requests.sql

-- ENUMs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ngo_help_request_status') THEN
    CREATE TYPE ngo_help_request_status AS ENUM (
      'pending',
      'accepted',
      'rejected',
      'withdrawn'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ngo_help_type') THEN
    CREATE TYPE ngo_help_type AS ENUM (
      'medical_help',
      'education_support',
      'food_ration',
      'financial_help',
      'employment_skill_support',
      'legal_help',
      'environmental_issue',
      'women_support',
      'farmer_support',
      'other'
    );
  END IF;
END
$$;

-- Table
CREATE TABLE IF NOT EXISTS ngo_help_requests (
  id SERIAL PRIMARY KEY,

  -- requester is logged-in client
  client_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- NGO is also a user row (role='ngo')
  ngo_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- snapshot of request data
  full_name TEXT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  location_id INT NOT NULL,
  pin_code VARCHAR(10) NOT NULL,
  age INT NOT NULL CHECK (age >= 0 AND age <= 120),
  dob DATE NOT NULL,

  help_types ngo_help_type[] NOT NULL DEFAULT '{}',
  problem_text TEXT NOT NULL,

  consent_contact BOOLEAN NOT NULL,

  status ngo_help_request_status NOT NULL DEFAULT 'pending',
  ngo_decision_at TIMESTAMP,
  ngo_decision_by INT REFERENCES users(id),
  ngo_decision_note TEXT,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Prevent duplicate pending help requests to same NGO (optional but recommended)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_ngo_help_pending
ON ngo_help_requests(client_user_id, ngo_user_id)
WHERE status = 'pending';

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_ngo_help_ngo ON ngo_help_requests(ngo_user_id);
CREATE INDEX IF NOT EXISTS idx_ngo_help_client ON ngo_help_requests(client_user_id);
CREATE INDEX IF NOT EXISTS idx_ngo_help_status ON ngo_help_requests(status);

-- updated_at trigger (reuse your existing set_updated_at() if already created)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'set_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  END IF;
END
$$;

DROP TRIGGER IF EXISTS trg_ngo_help_updated_at ON ngo_help_requests;
CREATE TRIGGER trg_ngo_help_updated_at
BEFORE UPDATE ON ngo_help_requests
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
