-- 1) User inbox table
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  title TEXT NOT NULL,
  body TEXT NOT NULL,

  data JSONB DEFAULT '{}'::jsonb,         -- app routing payload
  channel TEXT DEFAULT 'push',            -- 'push'|'in_app'|'email' etc (future)
  status TEXT DEFAULT 'unread',           -- 'unread'|'read'

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  read_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS notifications_user_id_created_idx
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS notifications_user_id_status_idx
  ON notifications(user_id, status);

-- 2) Queue table (Option B worker model)
CREATE TABLE IF NOT EXISTS notification_jobs (
  id SERIAL PRIMARY KEY,
  event_key TEXT NOT NULL,               -- "order.paid", "campaign.broadcast"
  target_type TEXT NOT NULL,             -- 'user'|'users'|'role'|'all'
  target_value JSONB NOT NULL,           -- {user_id} OR {user_ids:[...]} OR {role:"lawyer"} OR {}
  payload JSONB NOT NULL,                -- {title, body, data, push:true/false, store:true/false}

  status TEXT DEFAULT 'queued',          -- queued|processing|sent|failed
  attempts INT DEFAULT 0,
  last_error TEXT NULL,

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL
);

CREATE INDEX IF NOT EXISTS notification_jobs_status_idx
  ON notification_jobs(status);

CREATE INDEX IF NOT EXISTS notification_jobs_created_idx
  ON notification_jobs(created_at DESC);

-- 1) Add job_id to notifications (links an inbox row to the job that created it)
ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS job_id INT REFERENCES notification_jobs(id) ON DELETE SET NULL;

-- 2) Enforce idempotency: only 1 inbox row per (user_id, job_id)
-- IMPORTANT: This works only when job_id is NOT NULL.
CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_job_unique
  ON notifications(user_id, job_id)
  WHERE job_id IS NOT NULL;
