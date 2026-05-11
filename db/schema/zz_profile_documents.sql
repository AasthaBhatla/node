ALTER TABLE service_requests
  ADD COLUMN IF NOT EXISTS workspace_id INT REFERENCES workspace(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_service_requests_workspace
  ON service_requests (workspace_id, submitted_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS profile_documents (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id INT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  service_id BIGINT REFERENCES services(id) ON DELETE SET NULL,
  service_request_id BIGINT UNIQUE REFERENCES service_requests(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'created_by_kaptaan',
  latest_version_id BIGINT,
  completed_at TIMESTAMP NULL,
  cancelled_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT profile_documents_status_check
    CHECK (status IN (
      'created_by_kaptaan',
      'submitted',
      'in_review',
      'in_progress',
      'version_uploaded',
      'completed',
      'cancelled'
    ))
);

CREATE INDEX IF NOT EXISTS idx_profile_documents_user
  ON profile_documents (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_profile_documents_workspace
  ON profile_documents (workspace_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_profile_documents_service_request
  ON profile_documents (service_request_id);

CREATE TABLE IF NOT EXISTS profile_document_versions (
  id BIGSERIAL PRIMARY KEY,
  profile_document_id BIGINT NOT NULL REFERENCES profile_documents(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT,
  content_type TEXT,
  document_type TEXT NOT NULL DEFAULT 'pdf',
  document_size_bytes INT NOT NULL DEFAULT 0,
  uploaded_by_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT profile_document_versions_version_number_check
    CHECK (version_number > 0),
  CONSTRAINT profile_document_versions_size_check
    CHECK (document_size_bytes >= 0),
  CONSTRAINT profile_document_versions_unique_version
    UNIQUE (profile_document_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_profile_document_versions_document
  ON profile_document_versions (profile_document_id, version_number DESC, id DESC);

CREATE TABLE IF NOT EXISTS profile_document_activities (
  id BIGSERIAL PRIMARY KEY,
  profile_document_id BIGINT NOT NULL REFERENCES profile_documents(id) ON DELETE CASCADE,
  activity_type VARCHAR(40) NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  actor_user_id INT REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_profile_document_activities_document
  ON profile_document_activities (profile_document_id, created_at DESC, id DESC);
