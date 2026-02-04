-- volunteer_applications.sql
-- ENUMs
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'volunteer_application_status') THEN
    CREATE TYPE volunteer_application_status AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'volunteer_time_commitment') THEN
    CREATE TYPE volunteer_time_commitment AS ENUM ('1-2', '3-5', 'weekends', 'full-day-occasionally');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'volunteer_mode') THEN
    CREATE TYPE volunteer_mode AS ENUM ('online', 'on-ground', 'both');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'volunteer_gender') THEN
    CREATE TYPE volunteer_gender AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');
  END IF;
END
$$;

-- Main table
CREATE TABLE IF NOT EXISTS volunteer_applications (
  id SERIAL PRIMARY KEY,

  -- applicant is a logged-in user (client)
  applicant_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- ngo is also a user row (partner type NGO)
  ngo_user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- applicant details (snapshot at time of applying)
  full_name TEXT NOT NULL,
  phone VARCHAR(20) NOT NULL,
  email VARCHAR(255) NOT NULL,
  location_id INT,
  age INT CHECK (age >= 0 AND age <= 120),
  gender volunteer_gender,

  time_commitment volunteer_time_commitment NOT NULL,
  preferred_mode volunteer_mode NOT NULL,

  -- routing engine data
  areas_of_interest TEXT[] NOT NULL DEFAULT '{}',
  other_interest_text TEXT,

  -- skills/background
  profession TEXT,
  key_skills TEXT, -- keep free text (or comma-separated tags)
  languages_spoken TEXT[] DEFAULT '{}',
  other_language_text TEXT,

  -- past experience
  volunteered_before BOOLEAN,
  past_experience_text TEXT,

  -- mobility
  comfortable_traveling BOOLEAN,
  transport_modes TEXT[] DEFAULT '{}', -- e.g. {'two_wheeler','car','public_transport_only'}

  -- consent
  consent_contact BOOLEAN NOT NULL,
  consent_code_of_conduct BOOLEAN NOT NULL,

  -- socials
  linkedin_url TEXT,
  instagram_url TEXT,

  -- status workflow
  status volunteer_application_status NOT NULL DEFAULT 'pending',
  ngo_decision_at TIMESTAMP,
  ngo_decision_by INT REFERENCES users(id), -- should be ngo_user_id generally
  ngo_decision_note TEXT,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Prevent duplicate pending apps to same NGO (optional, but recommended)
-- Allows re-apply only after rejected/withdrawn/accepted
CREATE UNIQUE INDEX IF NOT EXISTS uniq_vol_app_pending
ON volunteer_applications(applicant_user_id, ngo_user_id)
WHERE status = 'pending';

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_vol_app_ngo ON volunteer_applications(ngo_user_id);
CREATE INDEX IF NOT EXISTS idx_vol_app_applicant ON volunteer_applications(applicant_user_id);
CREATE INDEX IF NOT EXISTS idx_vol_app_status ON volunteer_applications(status);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_vol_app_updated_at ON volunteer_applications;
CREATE TRIGGER trg_vol_app_updated_at
BEFORE UPDATE ON volunteer_applications
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
