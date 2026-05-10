DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_status') THEN
    CREATE TYPE service_status AS ENUM ('draft', 'published', 'archived');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_type') THEN
    CREATE TYPE service_type AS ENUM ('consultation', 'managed_service', 'documents');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_cta_key') THEN
    CREATE TYPE service_cta_key AS ENUM (
      'book_consultation',
      'talk_to_legal_expert',
      'upload_documents_for_review',
      'get_legal_notice_drafted',
      'request_callback'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_form_field_type') THEN
    CREATE TYPE service_form_field_type AS ENUM (
      'text',
      'textarea',
      'phone',
      'email',
      'number',
      'select',
      'radio',
      'checkbox',
      'date',
      'file'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_request_status') THEN
    CREATE TYPE service_request_status AS ENUM (
      'submitted',
      'in_review',
      'in_progress',
      'completed',
      'cancelled'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'service_payment_status') THEN
    CREATE TYPE service_payment_status AS ENUM (
      'pending',
      'paid',
      'failed',
      'cancelled'
    );
  END IF;
END $$;

ALTER TYPE service_type ADD VALUE IF NOT EXISTS 'documents';

CREATE TABLE IF NOT EXISTS services (
  id BIGSERIAL PRIMARY KEY,
  status service_status NOT NULL DEFAULT 'draft',
  service_type service_type NOT NULL DEFAULT 'consultation',
  title TEXT NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  short_description TEXT,
  featured_image_url TEXT,
  featured_image_alt TEXT,
  custom_content_title TEXT,
  custom_content_html TEXT,
  meta_title TEXT,
  meta_description TEXT,
  canonical_url_override TEXT,
  og_title TEXT,
  og_description TEXT,
  is_indexable BOOLEAN NOT NULL DEFAULT TRUE,
  primary_service_term_id INT REFERENCES terms(id) ON DELETE RESTRICT,
  who_this_is_for JSONB NOT NULL DEFAULT '[]'::jsonb,
  benefit_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  problems_covered JSONB NOT NULL DEFAULT '[]'::jsonb,
  included_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  excluded_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  required_information JSONB NOT NULL DEFAULT '[]'::jsonb,
  deliverables JSONB NOT NULL DEFAULT '[]'::jsonb,
  documents_required JSONB NOT NULL DEFAULT '[]'::jsonb,
  process_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  duration_text TEXT,
  turnaround_time_text TEXT,
  disclaimer_text TEXT,
  refund_cancellation_policy_text TEXT,
  location_coverage_note TEXT,
  consultations_completed_count INT NOT NULL DEFAULT 0,
  current_viewers_count INT NOT NULL DEFAULT 0,
  years_of_experience INT NOT NULL DEFAULT 0,
  enabled_trust_badges JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMP NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT services_consultations_completed_count_check
    CHECK (consultations_completed_count >= 0),
  CONSTRAINT services_current_viewers_count_check
    CHECK (current_viewers_count >= 0),
  CONSTRAINT services_years_of_experience_check
    CHECK (years_of_experience >= 0)
);

ALTER TABLE IF EXISTS services
  ADD COLUMN IF NOT EXISTS current_viewers_count INT NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS services
  ADD COLUMN IF NOT EXISTS service_type service_type NOT NULL DEFAULT 'consultation';

ALTER TABLE IF EXISTS services
  ADD COLUMN IF NOT EXISTS custom_content_title TEXT;

ALTER TABLE IF EXISTS services
  ADD COLUMN IF NOT EXISTS custom_content_html TEXT;

ALTER TABLE IF EXISTS services
  ADD COLUMN IF NOT EXISTS benefit_cards JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE IF EXISTS services
  ADD COLUMN IF NOT EXISTS document_icon_url TEXT,
  ADD COLUMN IF NOT EXISTS document_icon_key TEXT,
  ADD COLUMN IF NOT EXISTS document_icon_tone TEXT,
  ADD COLUMN IF NOT EXISTS document_card_summary TEXT,
  ADD COLUMN IF NOT EXISTS document_download_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_package_featured BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS package_sort_order INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS document_sort_order INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_services_service_type
  ON services (service_type);

CREATE INDEX IF NOT EXISTS idx_services_documents_catalog
  ON services (service_type, document_sort_order ASC, id DESC)
  WHERE service_type = 'documents';

CREATE INDEX IF NOT EXISTS idx_services_documents_packages
  ON services (service_type, is_package_featured, package_sort_order ASC, id DESC)
  WHERE service_type = 'documents';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'services_current_viewers_count_check'
  ) THEN
    ALTER TABLE services
      ADD CONSTRAINT services_current_viewers_count_check
      CHECK (current_viewers_count >= 0);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_services_status
  ON services (status, published_at DESC);

CREATE INDEX IF NOT EXISTS idx_services_primary_term
  ON services (primary_service_term_id);

CREATE TABLE IF NOT EXISTS service_term_relationships (
  service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  term_id INT NOT NULL REFERENCES terms(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service_id, term_id)
);

CREATE INDEX IF NOT EXISTS idx_service_term_relationships_term
  ON service_term_relationships (term_id, service_id);

DO $service_taxonomy_mapping$
DECLARE
  v_services_taxonomy_id INT;
BEGIN
  INSERT INTO taxonomy (slug, title)
  VALUES ('services', 'Services')
  ON CONFLICT (slug) DO UPDATE
  SET title = EXCLUDED.title;

  SELECT id
  INTO v_services_taxonomy_id
  FROM taxonomy
  WHERE slug = 'services'
  LIMIT 1;

  CREATE TEMP TABLE service_terms_to_normalize ON COMMIT DROP AS
  SELECT DISTINCT
    term.id AS old_term_id,
    term.slug,
    term.title
  FROM terms term
  WHERE term.taxonomy_id <> v_services_taxonomy_id
    AND (
      EXISTS (
        SELECT 1
        FROM services service
        WHERE service.primary_service_term_id = term.id
      )
      OR EXISTS (
        SELECT 1
        FROM service_term_relationships rel
        WHERE rel.term_id = term.id
      )
    );

  UPDATE terms existing
  SET title = source.title,
      updated_at = CURRENT_TIMESTAMP
  FROM service_terms_to_normalize source
  WHERE existing.taxonomy_id = v_services_taxonomy_id
    AND existing.slug = source.slug;

  INSERT INTO terms (taxonomy_id, slug, title)
  SELECT
    v_services_taxonomy_id,
    source.slug,
    source.title
  FROM service_terms_to_normalize source
  WHERE NOT EXISTS (
    SELECT 1
    FROM terms existing
    WHERE existing.taxonomy_id = v_services_taxonomy_id
      AND existing.slug = source.slug
  );

  CREATE TEMP TABLE service_term_normalized_ids ON COMMIT DROP AS
  SELECT
    source.old_term_id,
    normalized.id AS new_term_id
  FROM service_terms_to_normalize source
  JOIN terms normalized
    ON normalized.taxonomy_id = v_services_taxonomy_id
   AND normalized.slug = source.slug;

  INSERT INTO term_metadata (term_id, key, value)
  SELECT
    mapped.new_term_id,
    metadata.key,
    metadata.value
  FROM term_metadata metadata
  JOIN service_term_normalized_ids mapped
    ON mapped.old_term_id = metadata.term_id
  ON CONFLICT (term_id, key) DO UPDATE
  SET value = EXCLUDED.value;

  UPDATE services service
  SET primary_service_term_id = mapped.new_term_id,
      updated_at = CURRENT_TIMESTAMP
  FROM service_term_normalized_ids mapped
  WHERE service.primary_service_term_id = mapped.old_term_id;

  INSERT INTO service_term_relationships (service_id, term_id, created_at)
  SELECT DISTINCT
    rel.service_id,
    mapped.new_term_id,
    rel.created_at
  FROM service_term_relationships rel
  JOIN service_term_normalized_ids mapped
    ON mapped.old_term_id = rel.term_id
  ON CONFLICT (service_id, term_id) DO NOTHING;

  DELETE FROM service_term_relationships rel
  USING service_term_normalized_ids mapped
  WHERE rel.term_id = mapped.old_term_id;

  INSERT INTO service_term_relationships (service_id, term_id)
  SELECT
    service.id,
    service.primary_service_term_id
  FROM services service
  WHERE service.primary_service_term_id IS NOT NULL
  ON CONFLICT (service_id, term_id) DO NOTHING;
END
$service_taxonomy_mapping$;

CREATE TABLE IF NOT EXISTS service_location_relationships (
  service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  location_id INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_service_location_relationships_location
  ON service_location_relationships (location_id, service_id);

CREATE TABLE IF NOT EXISTS service_language_relationships (
  service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  language_id INT NOT NULL REFERENCES languages(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service_id, language_id)
);

CREATE INDEX IF NOT EXISTS idx_service_language_relationships_language
  ON service_language_relationships (language_id, service_id);

CREATE TABLE IF NOT EXISTS service_variants (
  id BIGSERIAL PRIMARY KEY,
  service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT,
  features_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  highlight_text TEXT,
  icon_key TEXT,
  tone TEXT,
  price_label TEXT,
  price_paise INT NOT NULL DEFAULT 0,
  compare_at_price_paise INT,
  duration_text TEXT,
  turnaround_time_text TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT service_variants_price_paise_check
    CHECK (price_paise >= 0),
  CONSTRAINT service_variants_compare_at_price_paise_check
    CHECK (compare_at_price_paise IS NULL OR compare_at_price_paise >= price_paise)
);

ALTER TABLE IF EXISTS service_variants
  ADD COLUMN IF NOT EXISTS features_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS highlight_text TEXT,
  ADD COLUMN IF NOT EXISTS icon_key TEXT,
  ADD COLUMN IF NOT EXISTS tone TEXT,
  ADD COLUMN IF NOT EXISTS price_label TEXT;

CREATE INDEX IF NOT EXISTS idx_service_variants_service
  ON service_variants (service_id, sort_order ASC, id ASC);

CREATE TABLE IF NOT EXISTS service_faqs (
  id BIGSERIAL PRIMARY KEY,
  service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_faqs_service
  ON service_faqs (service_id, sort_order ASC, id ASC);

CREATE TABLE IF NOT EXISTS service_testimonials (
  id BIGSERIAL PRIMARY KEY,
  service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  quote TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_title TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_testimonials_service
  ON service_testimonials (service_id, sort_order ASC, id ASC);

CREATE TABLE IF NOT EXISTS service_ctas (
  id BIGSERIAL PRIMARY KEY,
  service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  cta_key service_cta_key NOT NULL,
  label TEXT,
  helper_text TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT service_ctas_service_key_unique
    UNIQUE (service_id, cta_key)
);

CREATE INDEX IF NOT EXISTS idx_service_ctas_service
  ON service_ctas (service_id, sort_order ASC, id ASC);

CREATE TABLE IF NOT EXISTS service_form_fields (
  id BIGSERIAL PRIMARY KEY,
  service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  field_key VARCHAR(120) NOT NULL,
  label TEXT NOT NULL,
  field_type service_form_field_type NOT NULL,
  placeholder TEXT,
  help_text TEXT,
  options_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT service_form_fields_service_key_unique
    UNIQUE (service_id, field_key)
);

CREATE INDEX IF NOT EXISTS idx_service_form_fields_service
  ON service_form_fields (service_id, sort_order ASC, id ASC);

CREATE TABLE IF NOT EXISTS service_requests (
  id BIGSERIAL PRIMARY KEY,
  service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  service_variant_id BIGINT NOT NULL REFERENCES service_variants(id) ON DELETE RESTRICT,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_action service_cta_key NOT NULL,
  status service_request_status NOT NULL DEFAULT 'submitted',
  payment_status service_payment_status NOT NULL DEFAULT 'pending',
  quoted_price_paise INT NOT NULL DEFAULT 0,
  order_id INT UNIQUE REFERENCES orders(order_id) ON DELETE SET NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT service_requests_quoted_price_paise_check
    CHECK (quoted_price_paise >= 0)
);

CREATE INDEX IF NOT EXISTS idx_service_requests_user
  ON service_requests (user_id, submitted_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_service_requests_service
  ON service_requests (service_id, submitted_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_service_requests_status
  ON service_requests (status, payment_status, submitted_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS service_request_answers (
  id BIGSERIAL PRIMARY KEY,
  service_request_id BIGINT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  field_key VARCHAR(120) NOT NULL,
  field_label TEXT NOT NULL,
  field_type service_form_field_type NOT NULL,
  value_text TEXT,
  value_json JSONB,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_request_answers_request
  ON service_request_answers (service_request_id, sort_order ASC, id ASC);

CREATE TABLE IF NOT EXISTS service_request_files (
  id BIGSERIAL PRIMARY KEY,
  service_request_id BIGINT NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  field_key VARCHAR(120) NOT NULL,
  file_url TEXT NOT NULL,
  file_name TEXT,
  content_type TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_service_request_files_request
  ON service_request_files (service_request_id, sort_order ASC, id ASC);

CREATE TABLE IF NOT EXISTS service_migration_archive (
  id BIGSERIAL PRIMARY KEY,
  legacy_service_page_id BIGINT NOT NULL UNIQUE,
  legacy_translation_id BIGINT,
  legacy_payload JSONB NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $legacy$
BEGIN
  IF to_regclass('public.service_pages') IS NOT NULL
    AND to_regclass('public.service_page_translations') IS NOT NULL
    AND to_regclass('public.service_page_term_relationships') IS NOT NULL THEN

    EXECUTE $sql$
      WITH latest_translations AS (
        SELECT DISTINCT ON (spt.service_page_id)
          spt.id,
          spt.service_page_id,
          spt.locale,
          spt.status,
          spt.title,
          spt.slug,
          spt.body_html,
          spt.featured_image_url,
          spt.featured_image_alt,
          spt.meta_title,
          spt.meta_description,
          spt.canonical_url,
          spt.og_title,
          spt.og_description,
          spt.schema_json,
          spt.is_indexable,
          spt.published_at,
          spt.created_at,
          spt.updated_at
        FROM service_page_translations spt
        ORDER BY
          spt.service_page_id ASC,
          CASE WHEN spt.locale = 'en' THEN 0 ELSE 1 END ASC,
          spt.updated_at DESC,
          spt.id DESC
      )
      INSERT INTO service_migration_archive (
        legacy_service_page_id,
        legacy_translation_id,
        legacy_payload
      )
      SELECT
        sp.id,
        lt.id,
        jsonb_build_object(
          'service_page', to_jsonb(sp),
          'translation', to_jsonb(lt)
        )
      FROM service_pages sp
      JOIN latest_translations lt
        ON lt.service_page_id = sp.id
      ON CONFLICT (legacy_service_page_id) DO NOTHING
    $sql$;

    EXECUTE $sql$
      WITH latest_translations AS (
        SELECT DISTINCT ON (spt.service_page_id)
          spt.id,
          spt.service_page_id,
          spt.status,
          spt.title,
          spt.slug,
          spt.body_html,
          spt.featured_image_url,
          spt.featured_image_alt,
          spt.meta_title,
          spt.meta_description,
          spt.canonical_url,
          spt.og_title,
          spt.og_description,
          spt.is_indexable,
          spt.published_at,
          spt.created_at,
          spt.updated_at
        FROM service_page_translations spt
        ORDER BY
          spt.service_page_id ASC,
          CASE WHEN spt.locale = 'en' THEN 0 ELSE 1 END ASC,
          spt.updated_at DESC,
          spt.id DESC
      )
      INSERT INTO services (
        id,
        status,
        title,
        slug,
        short_description,
        featured_image_url,
        featured_image_alt,
        meta_title,
        meta_description,
        canonical_url_override,
        og_title,
        og_description,
        is_indexable,
        primary_service_term_id,
        disclaimer_text,
        refund_cancellation_policy_text,
        author_id,
        published_at,
        created_at,
        updated_at
      )
      SELECT
        sp.id,
        CASE
          WHEN lt.status = 'published' THEN 'published'::service_status
          WHEN lt.status = 'archived' THEN 'archived'::service_status
          ELSE 'draft'::service_status
        END,
        lt.title,
        lt.slug,
        NULLIF(
          LEFT(
            REGEXP_REPLACE(
              REGEXP_REPLACE(COALESCE(lt.meta_description, lt.body_html, ''), '<[^>]+>', ' ', 'g'),
              '\s+',
              ' ',
              'g'
            ),
            320
          ),
          ''
        ),
        lt.featured_image_url,
        lt.featured_image_alt,
        lt.meta_title,
        lt.meta_description,
        NULLIF(BTRIM(lt.canonical_url), ''),
        lt.og_title,
        lt.og_description,
        COALESCE(lt.is_indexable, TRUE),
        sp.primary_service_term_id,
        'This service content was migrated from the legacy service-pages system. Please review the detailed structure before publishing checkout.',
        'Refund and cancellation details need review after migration from the legacy service-pages system.',
        sp.author_id,
        CASE
          WHEN lt.status = 'published' THEN COALESCE(lt.published_at, lt.updated_at, sp.updated_at, sp.created_at)
          ELSE NULL
        END,
        COALESCE(sp.created_at, lt.created_at, CURRENT_TIMESTAMP),
        GREATEST(
          COALESCE(sp.updated_at, sp.created_at, CURRENT_TIMESTAMP),
          COALESCE(lt.updated_at, lt.created_at, CURRENT_TIMESTAMP)
        )
      FROM service_pages sp
      JOIN latest_translations lt
        ON lt.service_page_id = sp.id
      ON CONFLICT (id) DO NOTHING
    $sql$;

    EXECUTE $sql$
      INSERT INTO service_term_relationships (service_id, term_id, created_at)
      SELECT
        rel.service_page_id,
        rel.term_id,
        rel.created_at
      FROM service_page_term_relationships rel
      JOIN services s
        ON s.id = rel.service_page_id
      ON CONFLICT (service_id, term_id) DO NOTHING
    $sql$;
  END IF;
END
$legacy$;

INSERT INTO service_variants (
  service_id,
  title,
  summary,
  price_paise,
  sort_order,
  is_default,
  is_active
)
SELECT
  s.id,
  'Standard',
  COALESCE(NULLIF(s.short_description, ''), 'Review pricing and add a service variant before publishing checkout.'),
  0,
  0,
  TRUE,
  TRUE
FROM services s
WHERE NOT EXISTS (
  SELECT 1
  FROM service_variants sv
  WHERE sv.service_id = s.id
);

INSERT INTO service_ctas (
  service_id,
  cta_key,
  label,
  helper_text,
  sort_order,
  is_enabled
)
SELECT
  s.id,
  'book_consultation'::service_cta_key,
  'Book Consultation',
  'Migrated from the legacy services content. Review the intake flow before taking payments.',
  0,
  TRUE
FROM services s
WHERE NOT EXISTS (
  SELECT 1
  FROM service_ctas c
  WHERE c.service_id = s.id
);

INSERT INTO service_form_fields (
  service_id,
  field_key,
  label,
  field_type,
  placeholder,
  help_text,
  options_json,
  sort_order
)
SELECT
  s.id,
  'case_summary',
  'Case summary',
  'textarea'::service_form_field_type,
  'Briefly explain what you need help with.',
  'This default field was created during migration from the legacy service-pages system.',
  '[]'::jsonb,
  0
FROM services s
WHERE NOT EXISTS (
  SELECT 1
  FROM service_form_fields f
  WHERE f.service_id = s.id
);

SELECT setval(
  pg_get_serial_sequence('services', 'id'),
  COALESCE((SELECT MAX(id) FROM services), 1),
  TRUE
);
