CREATE TABLE IF NOT EXISTS service_pages (
  id BIGSERIAL PRIMARY KEY,
  primary_service_term_id INT REFERENCES terms(id) ON DELETE RESTRICT,
  page_kind VARCHAR(50) NOT NULL DEFAULT 'primary',
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_pages_primary_term
  ON service_pages (primary_service_term_id);

CREATE INDEX IF NOT EXISTS idx_service_pages_kind
  ON service_pages (page_kind);

CREATE TABLE IF NOT EXISTS service_page_translations (
  id BIGSERIAL PRIMARY KEY,
  service_page_id BIGINT NOT NULL REFERENCES service_pages(id) ON DELETE CASCADE,
  locale VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  slug VARCHAR(255) NOT NULL,
  body_html TEXT NOT NULL DEFAULT '',
  featured_image_url TEXT,
  featured_image_alt TEXT,
  meta_title TEXT,
  meta_description TEXT,
  canonical_url TEXT,
  og_title TEXT,
  og_description TEXT,
  schema_json JSONB,
  is_indexable BOOLEAN NOT NULL DEFAULT TRUE,
  published_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT service_page_translations_status_check
    CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT service_page_translations_locale_unique
    UNIQUE (service_page_id, locale),
  CONSTRAINT service_page_translations_locale_slug_unique
    UNIQUE (locale, slug)
);

CREATE INDEX IF NOT EXISTS idx_service_page_translations_page
  ON service_page_translations (service_page_id);

CREATE INDEX IF NOT EXISTS idx_service_page_translations_locale_status
  ON service_page_translations (locale, status);

CREATE INDEX IF NOT EXISTS idx_service_page_translations_status_published
  ON service_page_translations (status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_service_page_translations_indexable
  ON service_page_translations (is_indexable);

CREATE TABLE IF NOT EXISTS service_page_term_relationships (
  service_page_id BIGINT NOT NULL REFERENCES service_pages(id) ON DELETE CASCADE,
  term_id INT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service_page_id, term_id)
);

CREATE INDEX IF NOT EXISTS idx_service_page_term_relationships_term
  ON service_page_term_relationships (term_id, service_page_id);
