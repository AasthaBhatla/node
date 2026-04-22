const pool = require("../db");

const ALLOWED_STATUSES = new Set(["draft", "published", "archived"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_SERVICE_PAGE_LOCALE = sanitizeLocale(
  process.env.DEFAULT_SERVICE_PAGE_LOCALE || "en",
) || "en";
const PREFERRED_SERVICE_PAGE_LOCALE_ORDER_SQL =
  `CASE WHEN spt.locale = '${DEFAULT_SERVICE_PAGE_LOCALE}' THEN 0 ELSE 1 END`;
const PUBLIC_SITE_BASE_URL = normalizePublicSiteBaseUrl(
  process.env.PUBLIC_SITE_BASE_URL || "https://kaptaan.law",
);
const SERVICE_PAGE_PUBLIC_PATH_PREFIX = normalizePublicPathPrefix(
  process.env.SERVICE_PAGE_PUBLIC_PATH_PREFIX || "/services",
);
const PUBLIC_ORGANIZATION_NAME = normalizeString(
  process.env.PUBLIC_ORGANIZATION_NAME || "Kaptaan",
);
const SERVICE_PAGE_AREA_SERVED = normalizeString(
  process.env.SERVICE_PAGE_AREA_SERVED || "India",
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

function normalizeComparableUrl(value) {
  return normalizeString(value).replace(/\/+$/, "");
}

function sanitizeLocale(value) {
  return normalizeString(value).replace(/_/g, "-").toLowerCase();
}

function sanitizePageKind(value) {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "primary";
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

function normalizeTextArray(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [...new Set(values.map((value) => normalizeString(value)).filter(Boolean))];
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

function buildServicePagePublicPath(slug) {
  const safeSlug = sanitizeSlug(slug);

  if (!safeSlug) {
    return null;
  }

  return `${SERVICE_PAGE_PUBLIC_PATH_PREFIX}/${encodeURIComponent(safeSlug)}`;
}

function buildLegacyServicePagePublicPath(locale, slug) {
  const safeLocale = sanitizeLocale(locale);
  const safeSlug = sanitizeSlug(slug);

  if (!safeLocale || !safeSlug) {
    return null;
  }

  return `${SERVICE_PAGE_PUBLIC_PATH_PREFIX}/${encodeURIComponent(safeLocale)}/${encodeURIComponent(safeSlug)}`;
}

function buildServicePagePublicUrl(slug) {
  const path = buildServicePagePublicPath(slug);
  return path ? `${PUBLIC_SITE_BASE_URL}${path}` : null;
}

function buildLegacyServicePagePublicUrl(locale, slug) {
  const path = buildLegacyServicePagePublicPath(locale, slug);
  return path ? `${PUBLIC_SITE_BASE_URL}${path}` : null;
}

function normalizeServicePageCanonicalOverride(slug, overrideUrl, locale = DEFAULT_SERVICE_PAGE_LOCALE) {
  const normalizedOverride = normalizeNullableString(overrideUrl);
  if (!normalizedOverride) {
    return null;
  }

  const comparableOverride = normalizeComparableUrl(normalizedOverride);
  const comparableCurrent = normalizeComparableUrl(buildServicePagePublicUrl(slug));
  const comparableLegacy = normalizeComparableUrl(buildLegacyServicePagePublicUrl(locale, slug));

  if (
    comparableOverride
    && (comparableOverride === comparableCurrent || comparableOverride === comparableLegacy)
  ) {
    return null;
  }

  return normalizedOverride;
}

function resolveServicePageCanonicalUrl(slug, overrideUrl) {
  return normalizeServicePageCanonicalOverride(slug, overrideUrl) || buildServicePagePublicUrl(slug);
}

function pickPrimaryTranslationInput(payload) {
  if (payload?.translation && typeof payload.translation === "object" && !Array.isArray(payload.translation)) {
    return payload.translation;
  }

  if (!Array.isArray(payload?.translations)) {
    return null;
  }

  const candidates = payload.translations.filter(
    (translation) => translation && typeof translation === "object" && !Array.isArray(translation),
  );

  if (!candidates.length) {
    return null;
  }

  return (
    candidates.find((translation) => sanitizeLocale(translation.locale) === DEFAULT_SERVICE_PAGE_LOCALE)
    || candidates[0]
  );
}

function isAutoGeneratedServiceSchemaOverride(schemaValue, translation, { primaryServiceTerm = null } = {}) {
  if (!schemaValue || typeof schemaValue !== "object" || Array.isArray(schemaValue)) {
    return false;
  }

  const schemaType = normalizeString(schemaValue["@type"]);
  const schemaContext = normalizeString(schemaValue["@context"]);

  if (schemaType !== "Service" || schemaContext !== "https://schema.org") {
    return false;
  }

  const expectedTitle = normalizeString(translation.title);
  const expectedServiceType = normalizeString(primaryServiceTerm?.title || expectedTitle);
  const expectedDescription = buildServicePageDescription(translation);
  const expectedImageUrl = normalizeImageUrl(translation.featured_image_url);
  const expectedLanguage = translation.locale || DEFAULT_SERVICE_PAGE_LOCALE;
  const provider = schemaValue.provider;
  const areaServed = schemaValue.areaServed;
  const candidateUrls = new Set(
    [
      buildServicePagePublicUrl(translation.slug),
      buildLegacyServicePagePublicUrl(translation.locale || DEFAULT_SERVICE_PAGE_LOCALE, translation.slug),
    ].map((value) => normalizeComparableUrl(value)).filter(Boolean),
  );
  const schemaUrl = normalizeComparableUrl(schemaValue.url);
  const schemaMainEntityOfPage = normalizeComparableUrl(schemaValue.mainEntityOfPage);

  if (normalizeString(schemaValue.name) !== expectedTitle) {
    return false;
  }

  if (normalizeString(schemaValue.serviceType) !== expectedServiceType) {
    return false;
  }

  if (
    !provider
    || typeof provider !== "object"
    || normalizeString(provider["@type"]) !== "Organization"
    || normalizeString(provider.name) !== PUBLIC_ORGANIZATION_NAME
    || normalizeComparableUrl(provider.url) !== normalizeComparableUrl(PUBLIC_SITE_BASE_URL)
  ) {
    return false;
  }

  if (expectedDescription && normalizeString(schemaValue.description) !== expectedDescription) {
    return false;
  }

  if (expectedImageUrl && normalizeComparableUrl(schemaValue.image) !== normalizeComparableUrl(expectedImageUrl)) {
    return false;
  }

  if (
    SERVICE_PAGE_AREA_SERVED
    && (
      !areaServed
      || typeof areaServed !== "object"
      || normalizeString(areaServed["@type"]) !== "Country"
      || normalizeString(areaServed.name) !== SERVICE_PAGE_AREA_SERVED
    )
  ) {
    return false;
  }

  if (normalizeString(schemaValue.inLanguage) !== expectedLanguage) {
    return false;
  }

  if ((schemaUrl && !candidateUrls.has(schemaUrl)) || (schemaMainEntityOfPage && !candidateUrls.has(schemaMainEntityOfPage))) {
    return false;
  }

  return true;
}

function serializeServicePageTranslationRow(translation, { primaryServiceTerm = null } = {}) {
  const canonicalOverrideUrl = normalizeServicePageCanonicalOverride(
    translation.slug,
    translation.canonical_url,
    translation.locale,
  );
  const publicUrl = buildServicePagePublicUrl(translation.slug);
  const effectiveCanonicalUrl = resolveServicePageCanonicalUrl(translation.slug, canonicalOverrideUrl);
  const schemaOverrideJson = isAutoGeneratedServiceSchemaOverride(
    translation.schema_json,
    {
      ...translation,
      canonical_url: canonicalOverrideUrl,
    },
    { primaryServiceTerm },
  )
    ? null
    : (translation.schema_json ?? null);
  const generatedSchemaJson = buildGeneratedServicePageSchema(
    {
      ...translation,
      canonical_url: canonicalOverrideUrl,
    },
    { primaryServiceTerm },
  );
  const effectiveSchemaJson = schemaOverrideJson ?? generatedSchemaJson;

  return {
    id: Number(translation.id),
    service_page_id: Number(translation.service_page_id),
    locale: translation.locale,
    status: translation.status,
    title: translation.title,
    slug: translation.slug,
    body_html: translation.body_html,
    featured_image_url: translation.featured_image_url,
    featured_image_alt: translation.featured_image_alt,
    meta_title: translation.meta_title,
    meta_description: translation.meta_description,
    canonical_url: effectiveCanonicalUrl,
    canonical_override_url: canonicalOverrideUrl,
    effective_canonical_url: effectiveCanonicalUrl,
    public_url: publicUrl,
    og_title: translation.og_title,
    og_description: translation.og_description,
    schema_json: effectiveSchemaJson,
    schema_override_json: schemaOverrideJson,
    generated_schema_json: generatedSchemaJson,
    effective_schema_json: effectiveSchemaJson,
    is_indexable: translation.is_indexable,
    published_at: translation.published_at,
    created_at: translation.created_at,
    updated_at: translation.updated_at,
  };
}

function normalizeJsonValue(value) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === "") {
    return null;
  }

  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw createValidationError("schema_json must be valid JSON");
    }
  }

  if (typeof value === "object") {
    return value;
  }

  throw createValidationError("schema_json must be a JSON object, array, or string");
}

function decodeHtmlEntities(value) {
  return String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripHtmlToText(value) {
  const raw = String(value ?? "");
  const withoutTags = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ");

  return normalizeString(decodeHtmlEntities(withoutTags).replace(/\s+/g, " "));
}

function truncateText(value, maxLength = 320) {
  const text = normalizeString(value);
  if (!text || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeImageUrl(value) {
  const imageUrl = normalizeNullableString(value);
  if (!imageUrl) {
    return null;
  }

  if (/^https?:\/\//i.test(imageUrl)) {
    return imageUrl;
  }

  if (imageUrl.startsWith("/")) {
    return `${PUBLIC_SITE_BASE_URL}${imageUrl}`;
  }

  return imageUrl;
}

function buildServicePageDescription(translation) {
  return (
    normalizeNullableString(translation.meta_description)
    || truncateText(stripHtmlToText(translation.body_html), 320)
    || null
  );
}

function buildGeneratedServicePageSchema(translation, { primaryServiceTerm = null } = {}) {
  const title = normalizeString(translation.title);
  if (!title) {
    return null;
  }

  const url = resolveServicePageCanonicalUrl(
    translation.slug,
    translation.canonical_url,
  );
  const description = buildServicePageDescription(translation);
  const imageUrl = normalizeImageUrl(translation.featured_image_url);
  const serviceType = normalizeString(primaryServiceTerm?.title || title);
  const schema = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: title,
    serviceType,
    provider: {
      "@type": "Organization",
      name: PUBLIC_ORGANIZATION_NAME || "Kaptaan",
      url: PUBLIC_SITE_BASE_URL,
    },
    inLanguage: translation.locale || DEFAULT_SERVICE_PAGE_LOCALE,
  };

  if (description) {
    schema.description = description;
  }

  if (SERVICE_PAGE_AREA_SERVED) {
    schema.areaServed = {
      "@type": "Country",
      name: SERVICE_PAGE_AREA_SERVED,
    };
  }

  if (url) {
    schema.url = url;
    schema.mainEntityOfPage = url;
  }

  if (imageUrl) {
    schema.image = imageUrl;
  }

  return schema;
}

function normalizeStatus(value, fallback = "draft") {
  const status = normalizeString(value).toLowerCase() || fallback;
  if (!ALLOWED_STATUSES.has(status)) {
    throw createValidationError(`Invalid status: ${status}`);
  }
  return status;
}

function normalizeTranslationInput(raw, { requireSlug = true } = {}) {
  if (!raw || typeof raw !== "object") {
    throw createValidationError("Translation is required");
  }

  const locale = DEFAULT_SERVICE_PAGE_LOCALE;
  const title = normalizeString(raw.title);
  const slug = sanitizeSlug(raw.slug);
  const status = normalizeStatus(raw.status, "draft");
  const publishedAt =
    status === "published"
      ? normalizeTimestamp(raw.published_at) || new Date().toISOString()
      : normalizeTimestamp(raw.published_at);

  if (requireSlug && !slug) {
    throw createValidationError("Translation slug is required");
  }

  if (!title) {
    throw createValidationError("Translation title is required");
  }

  return {
    locale,
    status,
    title,
    slug,
    body_html: typeof raw.body_html === "string" ? raw.body_html.trim() : "",
    featured_image_url: normalizeNullableString(raw.featured_image_url),
    featured_image_alt: normalizeNullableString(raw.featured_image_alt),
    meta_title: normalizeNullableString(raw.meta_title),
    meta_description: normalizeNullableString(raw.meta_description),
    canonical_url: normalizeServicePageCanonicalOverride(slug, raw.canonical_url, locale),
    og_title: normalizeNullableString(raw.og_title),
    og_description: normalizeNullableString(raw.og_description),
    schema_json: normalizeJsonValue(raw.schema_json),
    is_indexable: normalizeBooleanInput(raw.is_indexable, true),
    published_at: publishedAt,
  };
}

async function ensureTermsExist(client, termIds) {
  if (!termIds.length) {
    return;
  }

  const result = await client.query(
    `SELECT id FROM terms WHERE id = ANY($1::int[])`,
    [termIds],
  );

  const found = new Set(result.rows.map((row) => Number(row.id)));
  const missing = termIds.filter((id) => !found.has(id));

  if (missing.length > 0) {
    throw createValidationError("Some service term ids do not exist", {
      missing_term_ids: missing,
    });
  }
}

async function syncServicePageTerms(client, servicePageId, primaryServiceTermId, relatedTermIds) {
  const uniqueTermIds = [...new Set([primaryServiceTermId, ...relatedTermIds].filter(Boolean))];

  await client.query(
    `DELETE FROM service_page_term_relationships WHERE service_page_id = $1`,
    [servicePageId],
  );

  if (!uniqueTermIds.length) {
    return;
  }

  for (const termId of uniqueTermIds) {
    await client.query(
      `INSERT INTO service_page_term_relationships (service_page_id, term_id)
       VALUES ($1, $2)
       ON CONFLICT (service_page_id, term_id) DO NOTHING`,
      [servicePageId, termId],
    );
  }
}

async function upsertTranslation(client, servicePageId, translation) {
  await client.query(
    `INSERT INTO service_page_translations (
       service_page_id,
       locale,
       status,
       title,
       slug,
       body_html,
       featured_image_url,
       featured_image_alt,
       meta_title,
       meta_description,
       canonical_url,
       og_title,
       og_description,
       schema_json,
       is_indexable,
       published_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16
     )
     ON CONFLICT (service_page_id, locale)
     DO UPDATE SET
       status = EXCLUDED.status,
       title = EXCLUDED.title,
       slug = EXCLUDED.slug,
       body_html = EXCLUDED.body_html,
       featured_image_url = EXCLUDED.featured_image_url,
       featured_image_alt = EXCLUDED.featured_image_alt,
       meta_title = EXCLUDED.meta_title,
       meta_description = EXCLUDED.meta_description,
       canonical_url = EXCLUDED.canonical_url,
       og_title = EXCLUDED.og_title,
       og_description = EXCLUDED.og_description,
       schema_json = EXCLUDED.schema_json,
       is_indexable = EXCLUDED.is_indexable,
       published_at = EXCLUDED.published_at,
       updated_at = CURRENT_TIMESTAMP`,
    [
      servicePageId,
      translation.locale,
      translation.status,
      translation.title,
      translation.slug,
      translation.body_html,
      translation.featured_image_url,
      translation.featured_image_alt,
      translation.meta_title,
      translation.meta_description,
      translation.canonical_url,
      translation.og_title,
      translation.og_description,
      translation.schema_json === undefined ? null : JSON.stringify(translation.schema_json),
      translation.is_indexable,
      translation.published_at,
    ],
  );
}

async function getServicePageById(id) {
  const pageResult = await pool.query(
    `SELECT
       sp.id,
       sp.primary_service_term_id,
       sp.page_kind,
       sp.author_id,
       sp.created_at,
       sp.updated_at,
       term.slug AS primary_service_term_slug,
       term.title AS primary_service_term_title,
       term.taxonomy_id AS primary_service_taxonomy_id
     FROM service_pages sp
     LEFT JOIN terms term ON term.id = sp.primary_service_term_id
     WHERE sp.id = $1
     LIMIT 1`,
    [id],
  );

  const page = pageResult.rows[0];
  if (!page) {
    return null;
  }

  const [translationsResult, termsResult] = await Promise.all([
    pool.query(
      `SELECT
         id,
         service_page_id,
         locale,
         status,
         title,
         slug,
         body_html,
         featured_image_url,
         featured_image_alt,
         meta_title,
         meta_description,
         canonical_url,
         og_title,
         og_description,
         schema_json,
         is_indexable,
         published_at,
         created_at,
         updated_at
       FROM service_page_translations
       WHERE service_page_id = $1
       ORDER BY CASE WHEN locale = $2 THEN 0 ELSE 1 END ASC,
                updated_at DESC,
                id DESC`,
      [id, DEFAULT_SERVICE_PAGE_LOCALE],
    ),
    pool.query(
      `SELECT
         term.id,
         term.taxonomy_id,
         term.slug,
         term.title
       FROM service_page_term_relationships rel
       JOIN terms term ON term.id = rel.term_id
       WHERE rel.service_page_id = $1
       ORDER BY term.title ASC, term.id ASC`,
      [id],
    ),
  ]);

  const primaryTranslation = translationsResult.rows[0] || null;

  return {
    id: Number(page.id),
    primary_service_term_id:
      page.primary_service_term_id === null ? null : Number(page.primary_service_term_id),
    primary_service_term:
      page.primary_service_term_id === null
        ? null
        : {
            id: Number(page.primary_service_term_id),
            taxonomy_id:
              page.primary_service_taxonomy_id === null
                ? null
                : Number(page.primary_service_taxonomy_id),
            slug: page.primary_service_term_slug,
            title: page.primary_service_term_title,
          },
    page_kind: page.page_kind,
    author_id: page.author_id === null ? null : Number(page.author_id),
    created_at: page.created_at,
    updated_at: page.updated_at,
    terms: termsResult.rows.map((term) => ({
      id: Number(term.id),
      taxonomy_id: term.taxonomy_id === null ? null : Number(term.taxonomy_id),
      slug: term.slug,
      title: term.title,
    })),
    translations: primaryTranslation
      ? [
          serializeServicePageTranslationRow(primaryTranslation, {
            primaryServiceTerm:
              page.primary_service_term_id === null
                ? null
                : {
                    id: Number(page.primary_service_term_id),
                    slug: page.primary_service_term_slug,
                    title: page.primary_service_term_title,
                  },
          }),
        ]
      : [],
  };
}

async function createServicePage(payload, user) {
  const primaryServiceTermId = Number.parseInt(payload?.primary_service_term_id, 10);
  if (!Number.isInteger(primaryServiceTermId) || primaryServiceTermId <= 0) {
    throw createValidationError("primary_service_term_id is required");
  }

  const pageKind = sanitizePageKind(payload?.page_kind);
  const relatedTermIds = normalizeIntegerArray(payload?.related_term_ids);
  const translationInput = pickPrimaryTranslationInput(payload);
  const translation = translationInput ? normalizeTranslationInput(translationInput) : null;

  if (!translation) {
    throw createValidationError("A single service-page content entry is required");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureTermsExist(client, [...new Set([primaryServiceTermId, ...relatedTermIds])]);

    const createdResult = await client.query(
      `INSERT INTO service_pages (primary_service_term_id, page_kind, author_id)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [primaryServiceTermId, pageKind, user?.id ?? null],
    );

    const servicePageId = Number(createdResult.rows[0].id);

    await syncServicePageTerms(client, servicePageId, primaryServiceTermId, relatedTermIds);

    await upsertTranslation(client, servicePageId, translation);

    await client.query("COMMIT");
    return getServicePageById(servicePageId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateServicePage(id, payload) {
  const existing = await getServicePageById(id);
  if (!existing) {
    return null;
  }

  const nextPrimaryServiceTermId =
    payload?.primary_service_term_id === undefined
      ? existing.primary_service_term_id
      : Number.parseInt(payload.primary_service_term_id, 10);

  if (!Number.isInteger(nextPrimaryServiceTermId) || nextPrimaryServiceTermId <= 0) {
    throw createValidationError("primary_service_term_id must be a valid term id");
  }

  const nextPageKind =
    payload?.page_kind === undefined ? existing.page_kind : sanitizePageKind(payload.page_kind);

  const currentRelatedTermIds = existing.terms
    .map((term) => term.id)
    .filter((termId) => termId !== existing.primary_service_term_id);
  const nextRelatedTermIds =
    payload?.related_term_ids === undefined
      ? currentRelatedTermIds
      : normalizeIntegerArray(payload.related_term_ids);

  const hasTranslationInput =
    payload?.translation !== undefined || payload?.translations !== undefined;
  const translationInput = hasTranslationInput ? pickPrimaryTranslationInput(payload) : null;
  const translation = translationInput ? normalizeTranslationInput(translationInput) : null;

  if (hasTranslationInput && !translation) {
    throw createValidationError("translation must be provided when updating page content");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await ensureTermsExist(client, [...new Set([nextPrimaryServiceTermId, ...nextRelatedTermIds])]);

    await client.query(
      `UPDATE service_pages
       SET primary_service_term_id = $1,
           page_kind = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [nextPrimaryServiceTermId, nextPageKind, id],
    );

    await syncServicePageTerms(client, id, nextPrimaryServiceTermId, nextRelatedTermIds);

    if (translation) {
      await upsertTranslation(client, id, translation);

      await client.query(
        `DELETE FROM service_page_translations
         WHERE service_page_id = $1
           AND locale <> $2`,
        [id, DEFAULT_SERVICE_PAGE_LOCALE],
      );
    }

    const translationCountResult = await client.query(
      `SELECT COUNT(*)::int AS total
       FROM service_page_translations
       WHERE service_page_id = $1`,
      [id],
    );

    if (Number(translationCountResult.rows[0]?.total || 0) <= 0) {
      throw createValidationError("A service page must keep at least one translation");
    }

    await client.query("COMMIT");
    return getServicePageById(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteServicePage(id) {
  const result = await pool.query(
    `DELETE FROM service_pages
     WHERE id = $1
     RETURNING id`,
    [id],
  );

  return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
}

function buildReportFilters(filters = {}) {
  const values = [];
  const conditions = [];

  const statuses = normalizeTextArray(filters.statuses).map((status) =>
    normalizeStatus(status, "draft"),
  );
  if (statuses.length > 0) {
    values.push(statuses);
    conditions.push(`spt.status = ANY($${values.length}::text[])`);
  }

  const pageKinds = normalizeTextArray(filters.page_kinds).map((pageKind) =>
    sanitizePageKind(pageKind),
  );
  if (pageKinds.length > 0) {
    values.push(pageKinds);
    conditions.push(`sp.page_kind = ANY($${values.length}::text[])`);
  }

  const primaryServiceTermIds = normalizeIntegerArray(filters.primary_service_term_ids);
  if (primaryServiceTermIds.length > 0) {
    values.push(primaryServiceTermIds);
    conditions.push(`sp.primary_service_term_id = ANY($${values.length}::int[])`);
  }

  const termIds = normalizeIntegerArray(filters.term_ids);
  if (termIds.length > 0) {
    values.push(termIds);
    conditions.push(
      `EXISTS (
         SELECT 1
         FROM service_page_term_relationships rel_filter
         WHERE rel_filter.service_page_id = sp.id
           AND rel_filter.term_id = ANY($${values.length}::int[])
       )`,
    );
  }

  const isIndexable = normalizeBooleanInput(filters.is_indexable, null);
  if (isIndexable !== null) {
    values.push(isIndexable);
    conditions.push(`spt.is_indexable = $${values.length}`);
  }

  const hasFeaturedImage = normalizeBooleanInput(filters.has_featured_image, null);
  if (hasFeaturedImage !== null) {
    conditions.push(
      hasFeaturedImage
        ? `COALESCE(BTRIM(spt.featured_image_url), '') <> ''`
        : `COALESCE(BTRIM(spt.featured_image_url), '') = ''`,
    );
  }

  const missingMetaTitle = normalizeBooleanInput(filters.missing_meta_title, null);
  if (missingMetaTitle !== null) {
    conditions.push(
      missingMetaTitle
        ? `COALESCE(BTRIM(spt.meta_title), '') = ''`
        : `COALESCE(BTRIM(spt.meta_title), '') <> ''`,
    );
  }

  const missingMetaDescription = normalizeBooleanInput(filters.missing_meta_description, null);
  if (missingMetaDescription !== null) {
    conditions.push(
      missingMetaDescription
        ? `COALESCE(BTRIM(spt.meta_description), '') = ''`
        : `COALESCE(BTRIM(spt.meta_description), '') <> ''`,
    );
  }

  const search = normalizeString(filters.search);
  if (search) {
    values.push(`%${search}%`);
    conditions.push(
      `(spt.title ILIKE $${values.length}
        OR spt.slug ILIKE $${values.length}
        OR COALESCE(spt.meta_title, '') ILIKE $${values.length}
        OR COALESCE(spt.meta_description, '') ILIKE $${values.length})`,
    );
  }

  const publishedFrom = normalizeTimestamp(filters.published_from);
  if (publishedFrom) {
    values.push(publishedFrom);
    conditions.push(`spt.published_at >= $${values.length}`);
  }

  const publishedTo = normalizeTimestamp(filters.published_to);
  if (publishedTo) {
    values.push(publishedTo);
    conditions.push(`spt.published_at <= $${values.length}`);
  }

  const updatedFrom = normalizeTimestamp(filters.updated_from);
  if (updatedFrom) {
    values.push(updatedFrom);
    conditions.push(`spt.updated_at >= $${values.length}`);
  }

  const updatedTo = normalizeTimestamp(filters.updated_to);
  if (updatedTo) {
    values.push(updatedTo);
    conditions.push(`spt.updated_at <= $${values.length}`);
  }

  return {
    values,
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
  };
}

function normalizeSort(sortBy, sortOrder) {
  const columns = {
    updated_at: "spt.updated_at",
    created_at: "spt.created_at",
    published_at: "spt.published_at",
    title: "spt.title",
    slug: "spt.slug",
    locale: "spt.locale",
    status: "spt.status",
  };

  const safeSortBy = columns[normalizeString(sortBy).toLowerCase()] || "spt.updated_at";
  const safeSortOrder = normalizeString(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

  return `${safeSortBy} ${safeSortOrder}, spt.id DESC`;
}

async function reportServicePages(filters = {}) {
  const { values, whereSql } = buildReportFilters(filters);
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  const orderBy = normalizeSort(filters.sort_by, filters.sort_order);

  values.push(limit, offset);

  const query = `
    SELECT
      spt.id AS translation_id,
      spt.service_page_id,
      spt.locale,
      spt.status,
      spt.title,
      spt.slug,
      spt.meta_title,
      spt.meta_description,
      spt.featured_image_url,
      spt.is_indexable,
      spt.published_at,
      spt.created_at,
      spt.updated_at,
      sp.page_kind,
      sp.primary_service_term_id,
      primary_term.slug AS primary_service_term_slug,
      primary_term.title AS primary_service_term_title,
      COALESCE(
        ARRAY(
          SELECT rel.term_id
          FROM service_page_term_relationships rel
          WHERE rel.service_page_id = sp.id
          ORDER BY rel.term_id ASC
        ),
        '{}'
      ) AS term_ids,
      COUNT(*) OVER()::int AS total_count
    FROM (
      SELECT DISTINCT ON (spt.service_page_id)
        spt.id,
        spt.service_page_id,
        spt.locale,
        spt.status,
        spt.title,
        spt.slug,
        spt.meta_title,
        spt.meta_description,
        spt.featured_image_url,
        spt.is_indexable,
        spt.published_at,
        spt.created_at,
        spt.updated_at
      FROM service_page_translations spt
      ORDER BY
        spt.service_page_id ASC,
        ${PREFERRED_SERVICE_PAGE_LOCALE_ORDER_SQL} ASC,
        spt.updated_at DESC,
        spt.id DESC
    ) spt
    JOIN service_pages sp ON sp.id = spt.service_page_id
    LEFT JOIN terms primary_term ON primary_term.id = sp.primary_service_term_id
    ${whereSql}
    ORDER BY ${orderBy}
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `;

  const result = await pool.query(query, values);
  const rows = result.rows;
  const total = rows[0] ? Number(rows[0].total_count) : 0;

  return {
    total,
    limit,
    offset,
    items: rows.map((row) => ({
      translation_id: Number(row.translation_id),
      service_page_id: Number(row.service_page_id),
      locale: row.locale,
      status: row.status,
      title: row.title,
      slug: row.slug,
      meta_title: row.meta_title,
      meta_description: row.meta_description,
      featured_image_url: row.featured_image_url,
      is_indexable: row.is_indexable,
      published_at: row.published_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      page_kind: row.page_kind,
      primary_service_term_id:
        row.primary_service_term_id === null ? null : Number(row.primary_service_term_id),
      primary_service_term_slug: row.primary_service_term_slug,
      primary_service_term_title: row.primary_service_term_title,
      term_ids: Array.isArray(row.term_ids) ? row.term_ids.map((value) => Number(value)) : [],
    })),
  };
}

async function getServicePageReportSummary(filters = {}) {
  const { values, whereSql } = buildReportFilters(filters);

  const totalsQuery = `
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE spt.is_indexable = TRUE)::int AS indexable_count,
      COUNT(*) FILTER (WHERE COALESCE(BTRIM(spt.featured_image_url), '') = '')::int AS missing_featured_image_count,
      COUNT(*) FILTER (WHERE COALESCE(BTRIM(spt.meta_title), '') = '')::int AS missing_meta_title_count,
      COUNT(*) FILTER (WHERE COALESCE(BTRIM(spt.meta_description), '') = '')::int AS missing_meta_description_count
    FROM (
      SELECT DISTINCT ON (spt.service_page_id)
        spt.id,
        spt.service_page_id,
        spt.locale,
        spt.status,
        spt.title,
        spt.slug,
        spt.meta_title,
        spt.meta_description,
        spt.featured_image_url,
        spt.is_indexable,
        spt.published_at,
        spt.created_at,
        spt.updated_at
      FROM service_page_translations spt
      ORDER BY
        spt.service_page_id ASC,
        ${PREFERRED_SERVICE_PAGE_LOCALE_ORDER_SQL} ASC,
        spt.updated_at DESC,
        spt.id DESC
    ) spt
    JOIN service_pages sp ON sp.id = spt.service_page_id
    ${whereSql}
  `;

  const breakdownQuery = `
    SELECT
      spt.locale,
      spt.status,
      COUNT(*)::int AS total
    FROM (
      SELECT DISTINCT ON (spt.service_page_id)
        spt.id,
        spt.service_page_id,
        spt.locale,
        spt.status,
        spt.title,
        spt.slug,
        spt.meta_title,
        spt.meta_description,
        spt.featured_image_url,
        spt.is_indexable,
        spt.published_at,
        spt.created_at,
        spt.updated_at
      FROM service_page_translations spt
      ORDER BY
        spt.service_page_id ASC,
        ${PREFERRED_SERVICE_PAGE_LOCALE_ORDER_SQL} ASC,
        spt.updated_at DESC,
        spt.id DESC
    ) spt
    JOIN service_pages sp ON sp.id = spt.service_page_id
    ${whereSql}
    GROUP BY spt.locale, spt.status
    ORDER BY spt.locale ASC, spt.status ASC
  `;

  const [totalsResult, breakdownResult] = await Promise.all([
    pool.query(totalsQuery, values),
    pool.query(breakdownQuery, values),
  ]);

  const totalsRow = totalsResult.rows[0] || {};

  return {
    total: Number(totalsRow.total || 0),
    indexable_count: Number(totalsRow.indexable_count || 0),
    missing_featured_image_count: Number(totalsRow.missing_featured_image_count || 0),
    missing_meta_title_count: Number(totalsRow.missing_meta_title_count || 0),
    missing_meta_description_count: Number(totalsRow.missing_meta_description_count || 0),
    breakdown: breakdownResult.rows.map((row) => ({
      locale: row.locale,
      status: row.status,
      total: Number(row.total || 0),
    })),
  };
}

async function getPublicServicePageBySlug(slug) {
  const safeSlug = sanitizeSlug(slug);

  if (!safeSlug) {
    return null;
  }

  const result = await pool.query(
    `SELECT
       sp.id AS service_page_id,
       sp.page_kind,
       sp.primary_service_term_id,
       primary_term.slug AS primary_service_term_slug,
       primary_term.title AS primary_service_term_title,
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
     JOIN service_pages sp ON sp.id = spt.service_page_id
     LEFT JOIN terms primary_term ON primary_term.id = sp.primary_service_term_id
     WHERE spt.slug = $1
       AND spt.status = 'published'
     ORDER BY
       CASE WHEN spt.locale = $2 THEN 0 ELSE 1 END ASC,
       spt.updated_at DESC,
       spt.id DESC
     LIMIT 1`,
    [safeSlug, DEFAULT_SERVICE_PAGE_LOCALE],
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  const termsResult = await pool.query(
    `SELECT
       term.id,
       term.taxonomy_id,
       term.slug,
       term.title
     FROM service_page_term_relationships rel
     JOIN terms term ON term.id = rel.term_id
     WHERE rel.service_page_id = $1
     ORDER BY term.title ASC, term.id ASC`,
    [row.service_page_id],
  );

  return {
    service_page_id: Number(row.service_page_id),
    page_kind: row.page_kind,
    primary_service_term:
      row.primary_service_term_id === null
        ? null
        : {
            id: Number(row.primary_service_term_id),
            slug: row.primary_service_term_slug,
            title: row.primary_service_term_title,
          },
    ...serializeServicePageTranslationRow(
      {
        ...row,
        id: row.service_page_id,
      },
      {
        primaryServiceTerm:
          row.primary_service_term_id === null
            ? null
            : {
                id: Number(row.primary_service_term_id),
                slug: row.primary_service_term_slug,
                title: row.primary_service_term_title,
              },
      },
    ),
    terms: termsResult.rows.map((term) => ({
      id: Number(term.id),
      taxonomy_id: term.taxonomy_id === null ? null : Number(term.taxonomy_id),
      slug: term.slug,
      title: term.title,
    })),
  };
}

async function listPublicServicePages(filters = {}) {
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  const pageKind = filters.page_kind ? sanitizePageKind(filters.page_kind) : null;
  const termId = Number.parseInt(filters.term_id, 10);
  const search = normalizeString(filters.search);

  const values = [];
  const conditions = [`spt.status = 'published'`];

  if (pageKind) {
    values.push(pageKind);
    conditions.push(`sp.page_kind = $${values.length}`);
  }

  if (Number.isInteger(termId) && termId > 0) {
    values.push(termId);
    conditions.push(
      `EXISTS (
         SELECT 1
         FROM service_page_term_relationships rel_filter
         WHERE rel_filter.service_page_id = sp.id
           AND rel_filter.term_id = $${values.length}
       )`,
    );
  }

  if (search) {
    values.push(`%${search}%`);
    conditions.push(
      `(spt.title ILIKE $${values.length}
        OR spt.slug ILIKE $${values.length}
        OR COALESCE(spt.meta_title, '') ILIKE $${values.length}
        OR COALESCE(spt.meta_description, '') ILIKE $${values.length})`,
    );
  }

  values.push(limit, offset);

  const query = `
    SELECT
      spt.service_page_id,
      spt.locale,
      spt.title,
      spt.slug,
      spt.meta_title,
      spt.meta_description,
      spt.featured_image_url,
      spt.published_at,
      sp.page_kind,
      sp.primary_service_term_id,
      primary_term.slug AS primary_service_term_slug,
      primary_term.title AS primary_service_term_title,
      COUNT(*) OVER()::int AS total_count
    FROM (
      SELECT DISTINCT ON (spt.service_page_id)
        spt.service_page_id,
        spt.locale,
        spt.status,
        spt.title,
        spt.slug,
        spt.meta_title,
        spt.meta_description,
        spt.featured_image_url,
        spt.published_at,
        spt.updated_at,
        spt.id
      FROM service_page_translations spt
      WHERE spt.status = 'published'
      ORDER BY
        spt.service_page_id ASC,
        ${PREFERRED_SERVICE_PAGE_LOCALE_ORDER_SQL} ASC,
        COALESCE(spt.published_at, spt.updated_at) DESC,
        spt.id DESC
    ) spt
    JOIN service_pages sp ON sp.id = spt.service_page_id
    LEFT JOIN terms primary_term ON primary_term.id = sp.primary_service_term_id
    WHERE ${conditions.join(" AND ")}
    ORDER BY COALESCE(spt.published_at, spt.updated_at) DESC, spt.service_page_id DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
  `;

  const result = await pool.query(query, values);
  const rows = result.rows;
  const total = rows[0] ? Number(rows[0].total_count) : 0;

  return {
    total,
    limit,
    offset,
    items: rows.map((row) => ({
      service_page_id: Number(row.service_page_id),
      locale: row.locale,
      title: row.title,
      slug: row.slug,
      meta_title: row.meta_title,
      meta_description: row.meta_description,
      featured_image_url: row.featured_image_url,
      published_at: row.published_at,
      page_kind: row.page_kind,
      primary_service_term:
        row.primary_service_term_id === null
          ? null
          : {
              id: Number(row.primary_service_term_id),
              slug: row.primary_service_term_slug,
              title: row.primary_service_term_title,
            },
    })),
  };
}

module.exports = {
  createServicePage,
  deleteServicePage,
  getPublicServicePageBySlug,
  getServicePageById,
  getServicePageReportSummary,
  listPublicServicePages,
  reportServicePages,
  updateServicePage,
};
