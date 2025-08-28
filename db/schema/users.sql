-- db/schema/users.sql

-- Create ENUM type only if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_status') THEN
        CREATE TYPE user_status AS ENUM ('new', 'registered', 'verified', 'blocked');
    END IF;
END
$$;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(20) UNIQUE,
  otp VARCHAR(10),
  status user_status DEFAULT 'new',
  role VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_metadata (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, key)
);

CREATE TABLE IF NOT EXISTS user_devices (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  device_token TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, device_token)
);
ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS language_id INT REFERENCES languages(id);

UPDATE users 
SET language_id = (SELECT id FROM languages WHERE slug = 'english')
WHERE language_id IS NULL;

ALTER TABLE users 
  ADD COLUMN IF NOT EXISTS location_id INT REFERENCES locations(id); 

CREATE TABLE IF NOT EXISTS user_reviews (
  id SERIAL PRIMARY KEY,
  reviewer_id INT REFERENCES users(id) ON DELETE CASCADE,
  reviewee_id INT REFERENCES users(id) ON DELETE CASCADE,
  rating INT CHECK (rating >= 1 AND rating <= 5),
  review TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(reviewer_id, reviewee_id) -- one review per pair
);