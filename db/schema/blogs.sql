DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'blog_status') THEN
    CREATE TYPE blog_status AS ENUM ('draft', 'published', 'archived');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS blog_categories (
  id BIGSERIAL PRIMARY KEY,
  slug VARCHAR(255) NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blogs (
  id BIGSERIAL PRIMARY KEY,
  status blog_status NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  slug VARCHAR(255) NOT NULL UNIQUE,
  excerpt TEXT,
  content_html TEXT NOT NULL DEFAULT '',
  featured_image_url TEXT,
  featured_image_alt TEXT,
  meta_title TEXT,
  meta_description TEXT,
  canonical_url_override TEXT,
  og_title TEXT,
  og_description TEXT,
  is_indexable BOOLEAN NOT NULL DEFAULT TRUE,
  related_service_id BIGINT REFERENCES services(id) ON DELETE SET NULL,
  published_at TIMESTAMP NULL,
  author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blog_category_relationships (
  blog_id BIGINT NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
  category_id BIGINT NOT NULL REFERENCES blog_categories(id) ON DELETE CASCADE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blog_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_blogs_status_published
  ON blogs (status, published_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_blogs_related_service
  ON blogs (related_service_id);

CREATE INDEX IF NOT EXISTS idx_blog_categories_slug
  ON blog_categories (slug);

CREATE INDEX IF NOT EXISTS idx_blog_category_relationships_category
  ON blog_category_relationships (category_id, blog_id);
