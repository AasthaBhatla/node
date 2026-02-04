CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'appointment_status') THEN
    CREATE TYPE appointment_status AS ENUM (
      'pending',
      'accepted',
      'rejected',
      'cancelled_by_client',
      'cancelled_by_partner'
    );
  END IF;
END$$;

-- Partner settings (slot duration etc.)
CREATE TABLE IF NOT EXISTS partner_settings (
  partner_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  slot_duration_minutes INT NOT NULL DEFAULT 10,
  timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Weekly availability windows
-- day_of_week: 0=Sun ... 6=Sat
CREATE TABLE IF NOT EXISTS partner_weekly_availability (
  id SERIAL PRIMARY KEY,
  partner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS pwa_partner_day_idx
  ON partner_weekly_availability(partner_id, day_of_week);

-- Date/range time off
CREATE TABLE IF NOT EXISTS partner_time_off (
  id SERIAL PRIMARY KEY,
  partner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  reason TEXT,
  CHECK (start_at < end_at)
);

CREATE INDEX IF NOT EXISTS pto_partner_idx
  ON partner_time_off(partner_id, start_at);

-- Appointments
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  client_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  partner_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  start_at TIMESTAMPTZ NOT NULL,
  end_at   TIMESTAMPTZ NOT NULL,
  CHECK (start_at < end_at),

  status appointment_status NOT NULL DEFAULT 'pending',

  slot_duration_minutes INT NOT NULL, -- snapshot at booking time

  client_note TEXT,
  partner_note TEXT,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS appt_partner_start_idx ON appointments(partner_id, start_at);
CREATE INDEX IF NOT EXISTS appt_client_start_idx ON appointments(client_id, start_at);

-- HARD guarantee: prevent overlapping slots for same partner (pending/accepted)
ALTER TABLE appointments
  ADD CONSTRAINT appointments_no_overlap
  EXCLUDE USING gist (
    partner_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status IN ('pending','accepted'));

ALTER TABLE partner_time_off
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;