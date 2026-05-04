const pool = require("../db");

const ALLOWED_STATUSES = new Set(["draft", "published", "archived"]);
const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;
const PUBLIC_SITE_BASE_URL = normalizePublicSiteBaseUrl(
  process.env.PUBLIC_SITE_BASE_URL || "https://kaptaan.law",
);
const BLOGS_PUBLIC_PATH_PREFIX = normalizePublicPathPrefix(
  process.env.BLOGS_PUBLIC_PATH_PREFIX || "/blogs",
);
const SERVICES_PUBLIC_PATH_PREFIX = normalizePublicPathPrefix(
  process.env.SERVICES_PUBLIC_PATH_PREFIX || "/services",
);
const PUBLIC_ORGANIZATION_NAME = normalizeString(
  process.env.PUBLIC_ORGANIZATION_NAME || "Kaptaan",
);

function createValidationError(message, details) {
  const error = new Error(message);
  error.statusCode = 422;
  if (details) {
    error.details = details;
  }
  return error;
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizeNullableString(value) {
  const text = normalizeString(value);
  return text === "" ? null : text;
}

function normalizePublicSiteBaseUrl(value) {
  const normalized = normalizeString(value).replace(/\/+$/, "");
  return normalized || "https://kaptaan.law";
}

function normalizePublicPathPrefix(value) {
  const normalized = normalizeString(value).replace(/^\/+|\/+$/g, "");
  return normalized ? `/${normalized}` : "";
}

function sanitizeSlug(value) {
  return normalizeString(value)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBooleanInput(value, fallback = null) {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === 1 || value === "1" || String(value).toLowerCase() === "true") {
    return true;
  }

  if (value === 0 || value === "0" || String(value).toLowerCase() === "false") {
    return false;
  }

  return fallback;
}

function normalizeTimestamp(value) {
  const text = normalizeString(value);
  if (!text) {
    return null;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) {
    throw createValidationError(`Invalid timestamp: ${text}`);
  }

  return parsed.toISOString();
}

function normalizeLimit(limit) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
}

function normalizeOffset(offset) {
  const parsed = Number.parseInt(offset, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }

  return parsed;
}

function normalizePositiveInteger(value, fieldName, { fallback = null } = {}) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createValidationError(`${fieldName} must be a valid integer`);
  }

  return parsed;
}

function normalizeIntegerArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(
    values
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => Number.isInteger(value) && value > 0),
  )];
}

function normalizeStatus(value, fallback = "draft") {
  const status = normalizeString(value).toLowerCase() || fallback;
  if (!ALLOWED_STATUSES.has(status)) {
    throw createValidationError(`Invalid status: ${status}`);
  }

  return status;
}

function normalizeCategoryInputs(payload) {
  const categoryIds = normalizeIntegerArray(payload.category_ids);
  const categoryEntries = [];
  const inputGroups = [
    payload.categories,
    payload.category_titles,
    payload.category_names,
    payload.category_slugs,
  ];

  for (const group of inputGroups) {
    if (!Array.isArray(group)) {
      continue;
    }

    for (const item of group) {
      if (item && typeof item === "object") {
        const id = Number.parseInt(item.id ?? item.category_id, 10);
        if (Number.isInteger(id) && id > 0) {
          categoryIds.push(id);
          continue;
        }

        const title = normalizeString(item.title ?? item.label ?? item.name ?? item.slug);
        const slug = sanitizeSlug(item.slug ?? title);
        if (title || slug) {
          categoryEntries.push({
            title: title || slug,
            slug,
          });
        }
        continue;
      }

      const title = normalizeString(item);
      const slug = sanitizeSlug(title);
      if (title || slug) {
        categoryEntries.push({
          title: title || slug,
          slug,
        });
      }
    }
  }

  const seenEntrySlugs = new Set();
  const entries = categoryEntries.filter((entry) => {
    if (!entry.slug || seenEntrySlugs.has(entry.slug)) {
      return false;
    }
    seenEntrySlugs.add(entry.slug);
    return true;
  });

  return {
    category_ids: [...new Set(categoryIds)],
    category_entries: entries,
  };
}

function normalizeBlogPayload(payload, existing = null) {
  const source = payload || {};
  const status = normalizeStatus(source.status, existing?.status || "draft");
  const title = normalizeString(source.title ?? existing?.title);
  if (!title) {
    throw createValidationError("title is required");
  }

  const slug = sanitizeSlug(source.slug ?? existing?.slug ?? title);
  if (!slug) {
    throw createValidationError("slug is required");
  }

  const publishedAtInput = source.published_at ?? source.publishedAt ?? existing?.published_at;
  const publishedAt = normalizeTimestamp(publishedAtInput)
    || (status === "published" && !existing?.published_at ? new Date().toISOString() : null);

  return {
    status,
    title,
    slug,
    excerpt: normalizeNullableString(source.excerpt ?? existing?.excerpt),
    content_html: normalizeString(source.content_html ?? source.content ?? existing?.content_html),
    featured_image_url: normalizeNullableString(source.featured_image_url ?? existing?.featured_image_url),
    featured_image_alt: normalizeNullableString(source.featured_image_alt ?? existing?.featured_image_alt),
    meta_title: normalizeNullableString(source.meta_title ?? existing?.meta_title),
    meta_description: normalizeNullableString(source.meta_description ?? existing?.meta_description),
    canonical_url_override: normalizeNullableString(source.canonical_url_override ?? existing?.canonical_url_override),
    og_title: normalizeNullableString(source.og_title ?? existing?.og_title),
    og_description: normalizeNullableString(source.og_description ?? existing?.og_description),
    is_indexable: normalizeBooleanInput(source.is_indexable ?? source.isIndexable, existing?.is_indexable ?? true),
    related_service_id: normalizePositiveInteger(
      source.related_service_id ?? source.relatedServiceId ?? existing?.related_service_id,
      "related_service_id",
      { fallback: null },
    ),
    published_at: publishedAt,
    ...normalizeCategoryInputs(source),
  };
}

function buildBlogPublicUrl(slug) {
  return `${PUBLIC_SITE_BASE_URL}${BLOGS_PUBLIC_PATH_PREFIX}/${encodeURIComponent(slug)}`;
}

function buildServicePublicUrl(slug) {
  return `${PUBLIC_SITE_BASE_URL}${SERVICES_PUBLIC_PATH_PREFIX}/${encodeURIComponent(slug)}`;
}

function resolveBlogCanonicalUrl(slug, override) {
  const canonical = normalizeString(override);
  return canonical || buildBlogPublicUrl(slug);
}

function buildGeneratedBlogSchema(blog) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: blog.title,
    description: blog.meta_description || blog.excerpt || "",
    datePublished: blog.published_at || blog.created_at,
    dateModified: blog.updated_at || blog.published_at || blog.created_at,
    url: blog.public_url,
    publisher: {
      "@type": "Organization",
      name: PUBLIC_ORGANIZATION_NAME,
    },
  };

  if (blog.featured_image_url) {
    schema.image = blog.featured_image_url;
  }

  return schema;
}

async function fetchBlogCategories(blogId) {
  const result = await pool.query(
    `SELECT c.id, c.slug, c.title, c.description
     FROM blog_category_relationships rel
     JOIN blog_categories c ON c.id = rel.category_id
     WHERE rel.blog_id = $1
     ORDER BY c.title ASC`,
    [blogId],
  );

  return result.rows.map((row) => ({
    id: Number(row.id),
    slug: row.slug,
    title: row.title,
    description: row.description,
  }));
}

async function fetchRelatedService(serviceId, { publicOnly = false } = {}) {
  if (!serviceId) {
    return null;
  }

  const values = [serviceId];
  const conditions = ["s.id = $1"];
  if (publicOnly) {
    values.push("published");
    conditions.push(`s.status = $${values.length}`);
  }

  const result = await pool.query(
    `SELECT
       s.id,
       s.status,
       s.title,
       s.slug,
       s.short_description,
       s.featured_image_url,
       COALESCE(
         (
           SELECT MIN(variant.price_paise)
           FROM service_variants variant
           WHERE variant.service_id = s.id
             AND variant.is_active = TRUE
         ),
         0
       ) AS starting_price_paise
     FROM services s
     WHERE ${conditions.join(" AND ")}
     LIMIT 1`,
    values,
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: Number(row.id),
    status: row.status,
    title: row.title,
    slug: row.slug,
    short_description: row.short_description,
    featured_image_url: row.featured_image_url,
    starting_price_paise: Number(row.starting_price_paise || 0),
    public_url: buildServicePublicUrl(row.slug),
  };
}

async function serializeBlog(row, { publicOnly = false } = {}) {
  const categories = await fetchBlogCategories(Number(row.id));
  const relatedService = await fetchRelatedService(row.related_service_id, { publicOnly });
  const blog = {
    id: Number(row.id),
    status: row.status,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    content_html: row.content_html,
    featured_image_url: row.featured_image_url,
    featured_image_alt: row.featured_image_alt,
    meta_title: row.meta_title,
    meta_description: row.meta_description,
    canonical_url_override: row.canonical_url_override,
    canonical_url: resolveBlogCanonicalUrl(row.slug, row.canonical_url_override),
    effective_canonical_url: resolveBlogCanonicalUrl(row.slug, row.canonical_url_override),
    public_url: buildBlogPublicUrl(row.slug),
    og_title: row.og_title,
    og_description: row.og_description,
    is_indexable: Boolean(row.is_indexable),
    related_service_id: row.related_service_id === null ? null : Number(row.related_service_id),
    related_service: relatedService,
    categories,
    published_at: row.published_at,
    author_id: row.author_id === null ? null : Number(row.author_id),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  blog.schema_json = buildGeneratedBlogSchema(blog);
  blog.effective_schema_json = blog.schema_json;
  return blog;
}

async function getBlogRowById(id, { publicOnly = false } = {}) {
  const values = [id];
  const conditions = ["b.id = $1"];
  if (publicOnly) {
    values.push("published");
    conditions.push(`b.status = $${values.length}`);
  }

  const result = await pool.query(
    `SELECT b.*
     FROM blogs b
     WHERE ${conditions.join(" AND ")}
     LIMIT 1`,
    values,
  );

  return result.rows[0] || null;
}

async function getBlogRowBySlug(slug, { publicOnly = false } = {}) {
  const safeSlug = sanitizeSlug(slug);
  if (!safeSlug) {
    return null;
  }

  const values = [safeSlug];
  const conditions = ["b.slug = $1"];
  if (publicOnly) {
    values.push("published");
    conditions.push(`b.status = $${values.length}`);
  }

  const result = await pool.query(
    `SELECT b.*
     FROM blogs b
     WHERE ${conditions.join(" AND ")}
     LIMIT 1`,
    values,
  );

  return result.rows[0] || null;
}

async function syncBlogCategories(client, blogId, normalized) {
  const categoryIds = [...normalized.category_ids];

  for (const entry of normalized.category_entries) {
    const result = await client.query(
      `INSERT INTO blog_categories (slug, title)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE
       SET title = EXCLUDED.title,
           updated_at = CURRENT_TIMESTAMP
       RETURNING id`,
      [entry.slug, entry.title],
    );
    categoryIds.push(Number(result.rows[0].id));
  }

  const uniqueIds = [...new Set(categoryIds)].filter((id) => Number.isInteger(id) && id > 0);
  if (uniqueIds.length === 0) {
    await client.query(`DELETE FROM blog_category_relationships WHERE blog_id = $1`, [blogId]);
    return;
  }

  await client.query(
    `DELETE FROM blog_category_relationships
     WHERE blog_id = $1
       AND category_id <> ALL($2::bigint[])`,
    [blogId, uniqueIds],
  );

  for (const categoryId of uniqueIds) {
    await client.query(
      `INSERT INTO blog_category_relationships (blog_id, category_id)
       VALUES ($1, $2)
       ON CONFLICT (blog_id, category_id) DO NOTHING`,
      [blogId, categoryId],
    );
  }
}

async function upsertBlogRecord(client, id, normalized, user, { isUpdate = false } = {}) {
  if (isUpdate) {
    const result = await client.query(
      `UPDATE blogs
       SET status = $1,
           title = $2,
           slug = $3,
           excerpt = $4,
           content_html = $5,
           featured_image_url = $6,
           featured_image_alt = $7,
           meta_title = $8,
           meta_description = $9,
           canonical_url_override = $10,
           og_title = $11,
           og_description = $12,
           is_indexable = $13,
           related_service_id = $14,
           published_at = $15,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $16
       RETURNING id`,
      [
        normalized.status,
        normalized.title,
        normalized.slug,
        normalized.excerpt,
        normalized.content_html,
        normalized.featured_image_url,
        normalized.featured_image_alt,
        normalized.meta_title,
        normalized.meta_description,
        normalized.canonical_url_override,
        normalized.og_title,
        normalized.og_description,
        normalized.is_indexable,
        normalized.related_service_id,
        normalized.published_at,
        id,
      ],
    );

    await syncBlogCategories(client, id, normalized);
    return Number(result.rows[0].id);
  }

  const result = await client.query(
    `INSERT INTO blogs (
       status,
       title,
       slug,
       excerpt,
       content_html,
       featured_image_url,
       featured_image_alt,
       meta_title,
       meta_description,
       canonical_url_override,
       og_title,
       og_description,
       is_indexable,
       related_service_id,
       published_at,
       author_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
     RETURNING id`,
    [
      normalized.status,
      normalized.title,
      normalized.slug,
      normalized.excerpt,
      normalized.content_html,
      normalized.featured_image_url,
      normalized.featured_image_alt,
      normalized.meta_title,
      normalized.meta_description,
      normalized.canonical_url_override,
      normalized.og_title,
      normalized.og_description,
      normalized.is_indexable,
      normalized.related_service_id,
      normalized.published_at,
      user?.id || null,
    ],
  );

  const blogId = Number(result.rows[0].id);
  await syncBlogCategories(client, blogId, normalized);
  return blogId;
}

function blogToMutablePayload(blog) {
  return {
    status: blog.status,
    title: blog.title,
    slug: blog.slug,
    excerpt: blog.excerpt,
    content_html: blog.content_html,
    featured_image_url: blog.featured_image_url,
    featured_image_alt: blog.featured_image_alt,
    meta_title: blog.meta_title,
    meta_description: blog.meta_description,
    canonical_url_override: blog.canonical_url_override,
    og_title: blog.og_title,
    og_description: blog.og_description,
    is_indexable: blog.is_indexable,
    related_service_id: blog.related_service_id,
    published_at: blog.published_at,
    category_ids: blog.categories.map((category) => category.id),
  };
}

async function getBlogById(id) {
  const row = await getBlogRowById(id);
  if (!row) {
    return null;
  }

  return serializeBlog(row);
}

async function getPublicBlogBySlug(slug) {
  const row = await getBlogRowBySlug(slug, { publicOnly: true });
  if (!row) {
    return null;
  }

  return serializeBlog(row, { publicOnly: true });
}

async function createBlog(payload, user) {
  const normalized = normalizeBlogPayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const blogId = await upsertBlogRecord(client, null, normalized, user, { isUpdate: false });
    await client.query("COMMIT");
    return getBlogById(blogId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateBlog(id, payload, user) {
  const existing = await getBlogById(id);
  if (!existing) {
    return null;
  }

  const mergedPayload = {
    ...blogToMutablePayload(existing),
    ...payload,
  };
  const hasCategoryInput = [
    "categories",
    "category_titles",
    "category_names",
    "category_slugs",
    "category_ids",
  ].some((key) => Object.prototype.hasOwnProperty.call(payload || {}, key));
  if (hasCategoryInput && !Object.prototype.hasOwnProperty.call(payload || {}, "category_ids")) {
    mergedPayload.category_ids = [];
  }

  const normalized = normalizeBlogPayload(mergedPayload, existing);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const blogId = await upsertBlogRecord(client, id, normalized, user, { isUpdate: true });
    await client.query("COMMIT");
    return getBlogById(blogId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteBlog(id) {
  const result = await pool.query(
    `DELETE FROM blogs
     WHERE id = $1
     RETURNING *`,
    [id],
  );

  return result.rows[0] || null;
}

function normalizeStatusList(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => normalizeStatus(value)).filter(Boolean))];
}

function buildBlogFilters(filters = {}, { publicOnly = false } = {}) {
  const values = [];
  const conditions = [];

  if (publicOnly) {
    values.push("published");
    conditions.push(`b.status = $${values.length}`);
  } else {
    const statuses = normalizeStatusList(filters.statuses);
    if (statuses.length > 0) {
      values.push(statuses);
      conditions.push(`b.status = ANY($${values.length}::blog_status[])`);
    }
  }

  const search = normalizeString(filters.search ?? filters.q);
  if (search) {
    values.push(`%${search}%`);
    conditions.push(
      `(b.title ILIKE $${values.length}
        OR b.slug ILIKE $${values.length}
        OR b.excerpt ILIKE $${values.length}
        OR b.content_html ILIKE $${values.length})`,
    );
  }

  const categoryIds = normalizeIntegerArray(filters.category_ids);
  const categoryId = normalizePositiveInteger(filters.category_id, "category_id", { fallback: null });
  if (categoryId) {
    categoryIds.push(categoryId);
  }
  if (categoryIds.length > 0) {
    values.push([...new Set(categoryIds)]);
    conditions.push(
      `EXISTS (
         SELECT 1
         FROM blog_category_relationships rel
         WHERE rel.blog_id = b.id
           AND rel.category_id = ANY($${values.length}::bigint[])
       )`,
    );
  }

  const categorySlugs = [
    ...(
      Array.isArray(filters.category_slugs)
        ? filters.category_slugs
        : []
    ),
    filters.category,
    filters.category_slug,
  ].map(sanitizeSlug).filter(Boolean);
  if (categorySlugs.length > 0) {
    values.push([...new Set(categorySlugs)]);
    conditions.push(
      `EXISTS (
         SELECT 1
         FROM blog_category_relationships rel
         JOIN blog_categories c ON c.id = rel.category_id
         WHERE rel.blog_id = b.id
           AND c.slug = ANY($${values.length}::text[])
       )`,
    );
  }

  const relatedServiceId = normalizePositiveInteger(filters.related_service_id, "related_service_id", { fallback: null });
  if (relatedServiceId) {
    values.push(relatedServiceId);
    conditions.push(`b.related_service_id = $${values.length}`);
  }

  if (typeof filters.has_featured_image === "boolean") {
    conditions.push(
      filters.has_featured_image
        ? `COALESCE(BTRIM(b.featured_image_url), '') <> ''`
        : `COALESCE(BTRIM(b.featured_image_url), '') = ''`,
    );
  }

  if (filters.missing_meta_title === true) {
    conditions.push(`COALESCE(BTRIM(b.meta_title), '') = ''`);
  }

  if (filters.missing_meta_description === true) {
    conditions.push(`COALESCE(BTRIM(b.meta_description), '') = ''`);
  }

  return {
    values,
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
  };
}

function normalizeSort(sortBy, sortOrder) {
  const allowedSorts = {
    title: "b.title",
    status: "b.status",
    published_at: "b.published_at",
    created_at: "b.created_at",
    updated_at: "b.updated_at",
  };
  const safeSortBy = allowedSorts[sortBy] || "COALESCE(b.published_at, b.created_at)";
  const safeSortOrder = String(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

  return `${safeSortBy} ${safeSortOrder}, b.id DESC`;
}

async function categoriesForReportItem(blogId) {
  return fetchBlogCategories(blogId);
}

async function reportBlogs(filters = {}) {
  const { values, whereSql } = buildBlogFilters(filters);
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  const orderBy = normalizeSort(filters.sort_by, filters.sort_order);
  values.push(limit, offset);

  const result = await pool.query(
    `SELECT
       b.id,
       b.status,
       b.title,
       b.slug,
       b.excerpt,
       b.featured_image_url,
       b.meta_title,
       b.meta_description,
       b.is_indexable,
       b.related_service_id,
       b.published_at,
       b.created_at,
       b.updated_at,
       s.title AS related_service_title,
       s.slug AS related_service_slug,
       COUNT(*) OVER()::int AS total_count
     FROM blogs b
     LEFT JOIN services s ON s.id = b.related_service_id
     ${whereSql}
     ORDER BY ${orderBy}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  const total = result.rows[0] ? Number(result.rows[0].total_count) : 0;
  const items = await Promise.all(result.rows.map(async (row) => ({
    id: Number(row.id),
    status: row.status,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    featured_image_url: row.featured_image_url,
    meta_title: row.meta_title,
    meta_description: row.meta_description,
    is_indexable: Boolean(row.is_indexable),
    related_service_id: row.related_service_id === null ? null : Number(row.related_service_id),
    related_service_title: row.related_service_title,
    related_service_slug: row.related_service_slug,
    categories: await categoriesForReportItem(Number(row.id)),
    public_url: buildBlogPublicUrl(row.slug),
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  })));

  return {
    total,
    limit,
    offset,
    items,
  };
}

async function listPublicBlogs(filters = {}) {
  const { values, whereSql } = buildBlogFilters(filters, { publicOnly: true });
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  values.push(limit, offset);

  const publicResult = await pool.query(
    `SELECT
       b.id,
       b.status,
       b.title,
       b.slug,
       b.excerpt,
       b.featured_image_url,
       b.featured_image_alt,
       b.meta_title,
       b.meta_description,
       b.related_service_id,
       b.published_at,
       b.created_at,
       b.updated_at,
       COUNT(*) OVER()::int AS total_count
     FROM blogs b
     ${whereSql}
     ORDER BY COALESCE(b.published_at, b.created_at) DESC, b.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  const total = publicResult.rows[0] ? Number(publicResult.rows[0].total_count) : 0;
  return {
    total,
    limit,
    offset,
    items: await Promise.all(publicResult.rows.map(async (row) => ({
      id: Number(row.id),
      status: row.status,
      title: row.title,
      slug: row.slug,
      excerpt: row.excerpt,
      featured_image_url: row.featured_image_url,
      featured_image_alt: row.featured_image_alt,
      meta_title: row.meta_title,
      meta_description: row.meta_description,
      related_service_id: row.related_service_id === null ? null : Number(row.related_service_id),
      categories: await categoriesForReportItem(Number(row.id)),
      public_url: buildBlogPublicUrl(row.slug),
      published_at: row.published_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }))),
  };
}

async function listPublicBlogFilters() {
  const result = await pool.query(
    `SELECT
       c.id,
       c.slug,
       c.title,
       c.description,
       COUNT(DISTINCT b.id)::int AS count
     FROM blog_categories c
     JOIN blog_category_relationships rel ON rel.category_id = c.id
     JOIN blogs b ON b.id = rel.blog_id
     WHERE b.status = 'published'
     GROUP BY c.id, c.slug, c.title, c.description
     HAVING COUNT(DISTINCT b.id) > 0
     ORDER BY count DESC, c.title ASC`,
  );

  return {
    categories: result.rows.map((row) => ({
      id: Number(row.id),
      slug: row.slug,
      title: row.title,
      description: row.description,
      count: Number(row.count || 0),
    })),
  };
}

module.exports = {
  createBlog,
  deleteBlog,
  getBlogById,
  getPublicBlogBySlug,
  listPublicBlogFilters,
  listPublicBlogs,
  reportBlogs,
  updateBlog,
};
