const pool = require("../db");
const {
  SERVICE_CTA_KEYS,
  SERVICE_CTA_LABELS,
  SERVICE_FORM_FIELD_TYPES,
  SERVICE_TYPE_LABELS,
  SERVICE_TYPE_OPTIONS,
  SERVICE_TYPE_VALUES,
  SERVICE_TRUST_BADGE_KEYS,
  SERVICE_TRUST_BADGE_LABELS,
} = require("./serviceCatalogConstants");

const ALLOWED_STATUSES = new Set(["draft", "published", "archived"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const PUBLIC_SITE_BASE_URL = normalizePublicSiteBaseUrl(
  process.env.PUBLIC_SITE_BASE_URL || "https://kaptaan.law",
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

function normalizeHtmlContent(value) {
  const html = normalizeString(value);
  if (!html) {
    return null;
  }

  const plainText = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const hasMeaningfulElement = /<(?:img|table|hr)\b/i.test(html);

  return plainText || hasMeaningfulElement ? html : null;
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

function sanitizeKey(value, fallback = "") {
  const normalized = normalizeString(value)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
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

function normalizePositiveInteger(value, fieldName, { allowZero = false, fallback = null } = {}) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || (!allowZero && parsed <= 0)) {
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

function normalizePublicCatalogItems(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      id: Number(item.id),
      taxonomy_id: item.taxonomy_id === null || item.taxonomy_id === undefined
        ? null
        : Number(item.taxonomy_id),
      taxonomy_slug: item.taxonomy_slug || null,
      slug: item.slug,
      title: item.title,
      count: item.count === undefined ? undefined : Number(item.count || 0),
      is_primary: item.is_primary === undefined ? undefined : Boolean(item.is_primary),
    }))
    .filter((item) => Number.isFinite(item.id) && item.title);
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

function normalizeStatus(value, fallback = "draft") {
  const status = normalizeString(value).toLowerCase() || fallback;
  if (!ALLOWED_STATUSES.has(status)) {
    throw createValidationError(`Invalid status: ${status}`);
  }
  return status;
}

function normalizeServiceType(value, fallback = null) {
  const serviceType = normalizeString(value).toLowerCase() || fallback;
  if (!serviceType) {
    throw createValidationError("service_type is required");
  }

  if (!SERVICE_TYPE_VALUES.includes(serviceType)) {
    throw createValidationError(`Invalid service_type: ${serviceType}`);
  }

  return serviceType;
}

function normalizeStringList(values, fieldName) {
  if (!Array.isArray(values)) {
    return [];
  }

  const result = [];
  const seen = new Set();

  for (const value of values) {
    const item = typeof value === "object" && value !== null ? value.value ?? value.label ?? value.title ?? value.name : value;
    const normalized = normalizeString(item);
    if (!normalized) {
      continue;
    }

    const fingerprint = normalized.toLowerCase();
    if (seen.has(fingerprint)) {
      continue;
    }
    seen.add(fingerprint);
    result.push(normalized);
  }

  if (fieldName && result.some((item) => item.length > 1000)) {
    throw createValidationError(`${fieldName} entries must be shorter than 1000 characters`);
  }

  return result;
}

function normalizeProcessSteps(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => ({
      title: normalizeString(value?.title),
      description: normalizeString(value?.description),
    }))
    .filter((step) => step.title || step.description)
    .map((step) => {
      if (!step.title || !step.description) {
        throw createValidationError("Each process step requires a title and description");
      }
      return step;
    });
}

function normalizeTrustBadges(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const result = [];
  const seen = new Set();

  for (const value of values) {
    const normalized = sanitizeKey(value);
    if (!normalized) {
      continue;
    }

    if (!SERVICE_TRUST_BADGE_KEYS.includes(normalized)) {
      throw createValidationError(`Invalid trust badge: ${normalized}`);
    }

    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeVariants(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = values
    .map((value, index) => {
      const title = normalizeString(value?.title);
      if (!title) {
        throw createValidationError(`Variant ${index + 1} title is required`);
      }

      const pricePaise = normalizePositiveInteger(value?.price_paise, `Variant ${title} price`, {
        allowZero: true,
        fallback: 0,
      });
      const compareAtPricePaise = normalizePositiveInteger(
        value?.compare_at_price_paise,
        `Variant ${title} compare_at_price_paise`,
        { allowZero: true, fallback: null },
      );
      if (compareAtPricePaise !== null && compareAtPricePaise < pricePaise) {
        throw createValidationError(`Variant ${title} compare_at_price_paise must be greater than or equal to price_paise`);
      }

      return {
        id: normalizePositiveInteger(value?.id, `Variant ${title} id`, { fallback: null }),
        title,
        summary: normalizeNullableString(value?.summary),
        price_paise: pricePaise,
        compare_at_price_paise: compareAtPricePaise,
        duration_text: normalizeNullableString(value?.duration_text),
        turnaround_time_text: normalizeNullableString(value?.turnaround_time_text),
        sort_order: normalizePositiveInteger(value?.sort_order, `Variant ${title} sort_order`, {
          allowZero: true,
          fallback: index,
        }),
        is_default: normalizeBooleanInput(value?.is_default, false),
        is_active: normalizeBooleanInput(value?.is_active, true),
      };
    });

  const activeVariants = normalized.filter((variant) => variant.is_active);
  if (activeVariants.length === 0) {
    throw createValidationError("At least one active service variant is required");
  }

  const defaultVariant = activeVariants.find((variant) => variant.is_default) || activeVariants[0];
  return normalized.map((variant) => ({
    ...variant,
    is_default: variant.id === defaultVariant.id
      ? true
      : variant.title === defaultVariant.title
        && variant.sort_order === defaultVariant.sort_order
        && variant.price_paise === defaultVariant.price_paise,
  }));
}

function normalizeFaqs(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value, index) => ({
      question: normalizeString(value?.question),
      answer: normalizeString(value?.answer),
      sort_order: normalizePositiveInteger(value?.sort_order, "FAQ sort_order", {
        allowZero: true,
        fallback: index,
      }),
    }))
    .filter((item) => item.question || item.answer)
    .map((item) => {
      if (!item.question || !item.answer) {
        throw createValidationError("Each FAQ requires a question and answer");
      }
      return item;
    });
}

function normalizeTestimonials(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value, index) => ({
      quote: normalizeString(value?.quote),
      author_name: normalizeString(value?.author_name ?? value?.author),
      author_title: normalizeNullableString(value?.author_title),
      sort_order: normalizePositiveInteger(value?.sort_order, "Testimonial sort_order", {
        allowZero: true,
        fallback: index,
      }),
    }))
    .filter((item) => item.quote || item.author_name || item.author_title)
    .map((item) => {
      if (!item.quote || !item.author_name) {
        throw createValidationError("Each testimonial requires a quote and author name");
      }
      return item;
    });
}

function normalizeCtas(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const normalized = values
    .map((value, index) => {
      const ctaKey = normalizeString(value?.cta_key).toLowerCase();
      if (!ctaKey) {
        return null;
      }
      if (!SERVICE_CTA_KEYS.includes(ctaKey)) {
        throw createValidationError(`Invalid CTA key: ${ctaKey}`);
      }
      if (seen.has(ctaKey)) {
        throw createValidationError(`CTA ${ctaKey} was provided more than once`);
      }
      seen.add(ctaKey);

      return {
        cta_key: ctaKey,
        label: normalizeNullableString(value?.label) || SERVICE_CTA_LABELS[ctaKey],
        helper_text: normalizeNullableString(value?.helper_text),
        sort_order: normalizePositiveInteger(value?.sort_order, `CTA ${ctaKey} sort_order`, {
          allowZero: true,
          fallback: index,
        }),
        is_enabled: normalizeBooleanInput(value?.is_enabled, true),
      };
    })
    .filter(Boolean);

  if (normalized.filter((item) => item.is_enabled).length === 0) {
    throw createValidationError("At least one enabled CTA is required");
  }

  return normalized;
}

function normalizeFieldOptions(values) {
  return normalizeStringList(Array.isArray(values) ? values : [], "Form field options");
}

function normalizeFormFields(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set();
  const normalized = values
    .map((value, index) => {
      const label = normalizeString(value?.label);
      if (!label) {
        throw createValidationError(`Form field ${index + 1} label is required`);
      }

      const fieldType = normalizeString(value?.field_type).toLowerCase();
      if (!SERVICE_FORM_FIELD_TYPES.includes(fieldType)) {
        throw createValidationError(`Unsupported form field type: ${fieldType}`);
      }

      const fieldKey = sanitizeKey(value?.field_key, sanitizeKey(label, `field_${index + 1}`));
      if (!fieldKey) {
        throw createValidationError(`Form field ${label} key is required`);
      }
      if (seen.has(fieldKey)) {
        throw createValidationError(`Form field key ${fieldKey} was provided more than once`);
      }
      seen.add(fieldKey);

      const optionsJson = normalizeFieldOptions(value?.options_json ?? value?.options ?? []);
      if (["select", "radio", "checkbox"].includes(fieldType) && optionsJson.length === 0) {
        throw createValidationError(`Form field ${label} requires at least one option`);
      }

      return {
        field_key: fieldKey,
        label,
        field_type: fieldType,
        placeholder: normalizeNullableString(value?.placeholder),
        help_text: normalizeNullableString(value?.help_text),
        options_json: optionsJson,
        sort_order: normalizePositiveInteger(value?.sort_order, `Form field ${label} sort_order`, {
          allowZero: true,
          fallback: index,
        }),
      };
    });

  if (normalized.length === 0) {
    throw createValidationError("At least one intake form field is required");
  }

  return normalized;
}

function normalizeServicePayload(payload) {
  const title = normalizeString(payload?.title);
  if (!title) {
    throw createValidationError("title is required");
  }

  const slug = sanitizeSlug(payload?.slug);
  if (!slug) {
    throw createValidationError("slug is required");
  }

  const primaryServiceTermId = normalizePositiveInteger(
    payload?.primary_service_term_id,
    "primary_service_term_id",
    { fallback: null },
  );
  if (!primaryServiceTermId) {
    throw createValidationError("primary_service_term_id is required");
  }

  const status = normalizeStatus(payload?.status, "draft");
  const serviceType = normalizeServiceType(payload?.service_type);
  const publishedAt = status === "published"
    ? normalizeTimestamp(payload?.published_at) || new Date().toISOString()
    : normalizeTimestamp(payload?.published_at);

  const variants = normalizeVariants(payload?.variants);
  const ctas = normalizeCtas(payload?.ctas);
  const formFields = normalizeFormFields(payload?.form_fields);

  return {
    status,
    service_type: serviceType,
    title,
    slug,
    short_description: normalizeNullableString(payload?.short_description),
    featured_image_url: normalizeNullableString(payload?.featured_image_url),
    featured_image_alt: normalizeNullableString(payload?.featured_image_alt),
    custom_content_title: normalizeNullableString(payload?.custom_content_title),
    custom_content_html: normalizeHtmlContent(payload?.custom_content_html),
    meta_title: normalizeNullableString(payload?.meta_title),
    meta_description: normalizeNullableString(payload?.meta_description),
    canonical_url_override: normalizeNullableString(payload?.canonical_url_override),
    og_title: normalizeNullableString(payload?.og_title),
    og_description: normalizeNullableString(payload?.og_description),
    is_indexable: normalizeBooleanInput(payload?.is_indexable, true),
    primary_service_term_id: primaryServiceTermId,
    related_term_ids: normalizeIntegerArray(payload?.related_term_ids),
    who_this_is_for: normalizeStringList(payload?.who_this_is_for, "who_this_is_for"),
    problems_covered: normalizeStringList(payload?.problems_covered, "problems_covered"),
    included_items: normalizeStringList(payload?.included_items, "included_items"),
    excluded_items: normalizeStringList(payload?.excluded_items, "excluded_items"),
    required_information: normalizeStringList(payload?.required_information, "required_information"),
    deliverables: normalizeStringList(payload?.deliverables, "deliverables"),
    documents_required: normalizeStringList(payload?.documents_required, "documents_required"),
    process_steps: normalizeProcessSteps(payload?.process_steps),
    duration_text: normalizeNullableString(payload?.duration_text),
    turnaround_time_text: normalizeNullableString(payload?.turnaround_time_text),
    disclaimer_text: normalizeNullableString(payload?.disclaimer_text),
    refund_cancellation_policy_text: normalizeNullableString(payload?.refund_cancellation_policy_text),
    location_ids: normalizeIntegerArray(payload?.location_ids),
    location_coverage_note: normalizeNullableString(payload?.location_coverage_note),
    language_ids: normalizeIntegerArray(payload?.language_ids),
    consultations_completed_count: normalizePositiveInteger(
      payload?.consultations_completed_count,
      "consultations_completed_count",
      { allowZero: true, fallback: 0 },
    ),
    current_viewers_count: normalizePositiveInteger(
      payload?.current_viewers_count,
      "current_viewers_count",
      { allowZero: true, fallback: 0 },
    ),
    years_of_experience: normalizePositiveInteger(
      payload?.years_of_experience,
      "years_of_experience",
      { allowZero: true, fallback: 0 },
    ),
    enabled_trust_badges: normalizeTrustBadges(payload?.enabled_trust_badges),
    variants,
    faqs: normalizeFaqs(payload?.faqs),
    testimonials: normalizeTestimonials(payload?.testimonials),
    ctas,
    form_fields: formFields,
    published_at: publishedAt,
  };
}

function buildServicePublicPath(slug) {
  const safeSlug = sanitizeSlug(slug);
  if (!safeSlug) {
    return null;
  }

  return `${SERVICES_PUBLIC_PATH_PREFIX}/${encodeURIComponent(safeSlug)}`;
}

function buildServicePublicUrl(slug) {
  const path = buildServicePublicPath(slug);
  return path ? `${PUBLIC_SITE_BASE_URL}${path}` : null;
}

function resolveServiceCanonicalUrl(slug, canonicalOverride) {
  return normalizeNullableString(canonicalOverride) || buildServicePublicUrl(slug);
}

function serviceStartingPrice(variants) {
  const prices = variants
    .filter((variant) => variant.is_active)
    .map((variant) => Number(variant.price_paise))
    .filter((price) => Number.isInteger(price) && price >= 0);

  return prices.length > 0 ? Math.min(...prices) : 0;
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

function buildGeneratedServiceSchema(service) {
  const title = normalizeString(service.title);
  if (!title) {
    return null;
  }

  const description = normalizeNullableString(service.meta_description || service.short_description);
  const canonicalUrl = resolveServiceCanonicalUrl(service.slug, service.canonical_url_override);
  const imageUrl = normalizeImageUrl(service.featured_image_url);
  const activeVariants = (service.variants || []).filter((variant) => variant.is_active);
  const faqItems = (service.faqs || []).filter((item) => item.question && item.answer);
  const testimonials = (service.testimonials || []).filter((item) => item.quote && item.author_name);
  const locations = Array.isArray(service.locations) ? service.locations : [];
  const languages = Array.isArray(service.languages) ? service.languages : [];

  const serviceNode = {
    "@context": "https://schema.org",
    "@type": "Service",
    name: title,
    serviceType: normalizeString(service.primary_service_term?.title || title),
    provider: {
      "@type": "Organization",
      name: PUBLIC_ORGANIZATION_NAME || "Kaptaan",
      url: PUBLIC_SITE_BASE_URL,
    },
  };

  if (description) {
    serviceNode.description = description;
  }

  if (canonicalUrl) {
    serviceNode.url = canonicalUrl;
    serviceNode.mainEntityOfPage = canonicalUrl;
  }

  if (imageUrl) {
    serviceNode.image = imageUrl;
  }

  if (locations.length > 0) {
    serviceNode.areaServed = locations.map((location) => ({
      "@type": "Place",
      name: location.title,
    }));
  } else if (service.location_coverage_note) {
    serviceNode.areaServed = service.location_coverage_note;
  }

  if (languages.length > 0) {
    serviceNode.availableLanguage = languages.map((language) => language.title);
  }

  if (activeVariants.length > 0) {
    serviceNode.offers = activeVariants.map((variant) => ({
      "@type": "Offer",
      availability: "https://schema.org/InStock",
      priceCurrency: "INR",
      price: (Number(variant.price_paise || 0) / 100).toFixed(2),
      name: variant.title,
      description: variant.summary || undefined,
      url: canonicalUrl || undefined,
    }));
  }

  if (testimonials.length > 0) {
    serviceNode.review = testimonials.map((testimonial) => ({
      "@type": "Review",
      author: {
        "@type": "Person",
        name: testimonial.author_name,
      },
      reviewBody: testimonial.quote,
    }));
  }

  if (faqItems.length === 0) {
    return serviceNode;
  }

  return {
    "@context": "https://schema.org",
    "@graph": [
      serviceNode,
      {
        "@type": "FAQPage",
        mainEntity: faqItems.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: {
            "@type": "Answer",
            text: item.answer,
          },
        })),
      },
    ],
  };
}

async function ensureIdsExist(client, tableName, ids, fieldName) {
  if (!ids.length) {
    return;
  }

  const result = await client.query(
    `SELECT id FROM ${tableName} WHERE id = ANY($1::int[])`,
    [ids],
  );

  const found = new Set(result.rows.map((row) => Number(row.id)));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw createValidationError(`${fieldName} contains unknown ids`, {
      missing_ids: missing,
    });
  }
}

async function syncRelationshipTable(client, tableName, columnName, serviceId, ids) {
  await client.query(`DELETE FROM ${tableName} WHERE service_id = $1`, [serviceId]);

  for (const id of ids) {
    await client.query(
      `INSERT INTO ${tableName} (service_id, ${columnName})
       VALUES ($1, $2)
       ON CONFLICT (service_id, ${columnName}) DO NOTHING`,
      [serviceId, id],
    );
  }
}

async function syncSimpleChildTable(client, tableName, serviceId, rows, columns) {
  await client.query(`DELETE FROM ${tableName} WHERE service_id = $1`, [serviceId]);

  for (const row of rows) {
    const values = [serviceId];
    const placeholders = ["$1"];

    for (const column of columns) {
      values.push(
        Array.isArray(row[column])
          ? JSON.stringify(row[column])
          : row[column],
      );
      placeholders.push(`$${values.length}`);
    }

    await client.query(
      `INSERT INTO ${tableName} (service_id, ${columns.join(", ")})
       VALUES (${placeholders.join(", ")})`,
      values,
    );
  }
}

async function syncServiceVariants(client, serviceId, variants) {
  const existingResult = await client.query(
    `SELECT id
     FROM service_variants
     WHERE service_id = $1`,
    [serviceId],
  );
  const existingIds = new Set(existingResult.rows.map((row) => Number(row.id)));
  const referencedResult = await client.query(
    `SELECT DISTINCT service_variant_id
     FROM service_requests
     WHERE service_id = $1`,
    [serviceId],
  );
  const referencedIds = new Set(
    referencedResult.rows
      .map((row) => Number(row.service_variant_id))
      .filter((value) => Number.isInteger(value) && value > 0),
  );

  const retainedIds = new Set();

  for (const variant of variants) {
    if (variant.id && !existingIds.has(variant.id)) {
      throw createValidationError(`Variant ${variant.id} does not belong to service ${serviceId}`);
    }

    if (variant.id) {
      const updated = await client.query(
        `UPDATE service_variants
         SET title = $3,
             summary = $4,
             price_paise = $5,
             compare_at_price_paise = $6,
             duration_text = $7,
             turnaround_time_text = $8,
             sort_order = $9,
             is_default = $10,
             is_active = $11,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND service_id = $2
         RETURNING id`,
        [
          variant.id,
          serviceId,
          variant.title,
          variant.summary,
          variant.price_paise,
          variant.compare_at_price_paise,
          variant.duration_text,
          variant.turnaround_time_text,
          variant.sort_order,
          variant.is_default,
          variant.is_active,
        ],
      );
      retainedIds.add(Number(updated.rows[0].id));
      continue;
    }

    const inserted = await client.query(
      `INSERT INTO service_variants (
         service_id,
         title,
         summary,
         price_paise,
         compare_at_price_paise,
         duration_text,
         turnaround_time_text,
         sort_order,
         is_default,
         is_active
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        serviceId,
        variant.title,
        variant.summary,
        variant.price_paise,
        variant.compare_at_price_paise,
        variant.duration_text,
        variant.turnaround_time_text,
        variant.sort_order,
        variant.is_default,
        variant.is_active,
      ],
    );
    retainedIds.add(Number(inserted.rows[0].id));
  }

  for (const existingId of existingIds) {
    if (retainedIds.has(existingId)) {
      continue;
    }

    if (referencedIds.has(existingId)) {
      await client.query(
        `UPDATE service_variants
         SET is_active = FALSE,
             is_default = FALSE,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
           AND service_id = $2`,
        [existingId, serviceId],
      );
      retainedIds.add(existingId);
      continue;
    }

    await client.query(
      `DELETE FROM service_variants
       WHERE id = $1
         AND service_id = $2`,
      [existingId, serviceId],
    );
  }

  const defaultResult = await client.query(
    `SELECT id
     FROM service_variants
     WHERE service_id = $1
       AND is_active = TRUE
     ORDER BY is_default DESC, sort_order ASC, id ASC
     LIMIT 1`,
    [serviceId],
  );
  const defaultId = Number(defaultResult.rows[0]?.id || 0);

  if (defaultId > 0) {
    await client.query(
      `UPDATE service_variants
       SET is_default = CASE WHEN id = $2 THEN TRUE ELSE FALSE END,
           updated_at = CURRENT_TIMESTAMP
       WHERE service_id = $1`,
      [serviceId, defaultId],
    );
  }
}

async function fetchServiceRelationships(serviceId) {
  const [
    termsResult,
    locationsResult,
    languagesResult,
    variantsResult,
    faqsResult,
    testimonialsResult,
    ctasResult,
    formFieldsResult,
  ] = await Promise.all([
    pool.query(
      `SELECT term.id, term.taxonomy_id, term.slug, term.title
       FROM service_term_relationships rel
       JOIN terms term ON term.id = rel.term_id
       WHERE rel.service_id = $1
       ORDER BY term.title ASC, term.id ASC`,
      [serviceId],
    ),
    pool.query(
      `SELECT location.id, location.slug, location.title
       FROM service_location_relationships rel
       JOIN locations location ON location.id = rel.location_id
       WHERE rel.service_id = $1
       ORDER BY location.title ASC, location.id ASC`,
      [serviceId],
    ),
    pool.query(
      `SELECT language.id, language.slug, language.title
       FROM service_language_relationships rel
       JOIN languages language ON language.id = rel.language_id
       WHERE rel.service_id = $1
       ORDER BY language.title ASC, language.id ASC`,
      [serviceId],
    ),
    pool.query(
      `SELECT
         id,
         title,
         summary,
         price_paise,
         compare_at_price_paise,
         duration_text,
         turnaround_time_text,
         sort_order,
         is_default,
         is_active,
         created_at,
         updated_at
       FROM service_variants
       WHERE service_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [serviceId],
    ),
    pool.query(
      `SELECT id, question, answer, sort_order, created_at, updated_at
       FROM service_faqs
       WHERE service_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [serviceId],
    ),
    pool.query(
      `SELECT id, quote, author_name, author_title, sort_order, created_at, updated_at
       FROM service_testimonials
       WHERE service_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [serviceId],
    ),
    pool.query(
      `SELECT id, cta_key, label, helper_text, sort_order, is_enabled, created_at, updated_at
       FROM service_ctas
       WHERE service_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [serviceId],
    ),
    pool.query(
      `SELECT id, field_key, label, field_type, placeholder, help_text, options_json, sort_order, created_at, updated_at
       FROM service_form_fields
       WHERE service_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [serviceId],
    ),
  ]);

  return {
    terms: termsResult.rows.map((row) => ({
      id: Number(row.id),
      taxonomy_id: row.taxonomy_id === null ? null : Number(row.taxonomy_id),
      slug: row.slug,
      title: row.title,
    })),
    locations: locationsResult.rows.map((row) => ({
      id: Number(row.id),
      slug: row.slug,
      title: row.title,
    })),
    languages: languagesResult.rows.map((row) => ({
      id: Number(row.id),
      slug: row.slug,
      title: row.title,
    })),
    variants: variantsResult.rows.map((row) => ({
      id: Number(row.id),
      title: row.title,
      summary: row.summary,
      price_paise: Number(row.price_paise || 0),
      compare_at_price_paise: row.compare_at_price_paise === null ? null : Number(row.compare_at_price_paise),
      duration_text: row.duration_text,
      turnaround_time_text: row.turnaround_time_text,
      sort_order: Number(row.sort_order || 0),
      is_default: Boolean(row.is_default),
      is_active: Boolean(row.is_active),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    faqs: faqsResult.rows.map((row) => ({
      id: Number(row.id),
      question: row.question,
      answer: row.answer,
      sort_order: Number(row.sort_order || 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    testimonials: testimonialsResult.rows.map((row) => ({
      id: Number(row.id),
      quote: row.quote,
      author_name: row.author_name,
      author_title: row.author_title,
      sort_order: Number(row.sort_order || 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    ctas: ctasResult.rows.map((row) => ({
      id: Number(row.id),
      cta_key: row.cta_key,
      label: row.label || SERVICE_CTA_LABELS[row.cta_key] || row.cta_key,
      helper_text: row.helper_text,
      sort_order: Number(row.sort_order || 0),
      is_enabled: Boolean(row.is_enabled),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    form_fields: formFieldsResult.rows.map((row) => ({
      id: Number(row.id),
      field_key: row.field_key,
      label: row.label,
      field_type: row.field_type,
      placeholder: row.placeholder,
      help_text: row.help_text,
      options_json: Array.isArray(row.options_json) ? row.options_json : [],
      sort_order: Number(row.sort_order || 0),
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  };
}

async function serializeService(row, { publicOnly = false } = {}) {
  const relationships = await fetchServiceRelationships(Number(row.id));
  const variants = publicOnly
    ? relationships.variants.filter((variant) => variant.is_active)
    : relationships.variants;
  const ctas = publicOnly
    ? relationships.ctas.filter((cta) => cta.is_enabled)
    : relationships.ctas;

  const service = {
    id: Number(row.id),
    status: row.status,
    service_type: row.service_type,
    service_type_label: SERVICE_TYPE_LABELS[row.service_type] || row.service_type,
    title: row.title,
    slug: row.slug,
    short_description: row.short_description,
    featured_image_url: row.featured_image_url,
    featured_image_alt: row.featured_image_alt,
    custom_content_title: row.custom_content_title,
    custom_content_html: row.custom_content_html,
    meta_title: row.meta_title,
    meta_description: row.meta_description,
    canonical_url_override: row.canonical_url_override,
    canonical_url: resolveServiceCanonicalUrl(row.slug, row.canonical_url_override),
    effective_canonical_url: resolveServiceCanonicalUrl(row.slug, row.canonical_url_override),
    public_url: buildServicePublicUrl(row.slug),
    og_title: row.og_title,
    og_description: row.og_description,
    is_indexable: Boolean(row.is_indexable),
    primary_service_term_id: row.primary_service_term_id === null ? null : Number(row.primary_service_term_id),
    primary_service_term:
      row.primary_service_term_id === null
        ? null
        : {
            id: Number(row.primary_service_term_id),
            taxonomy_id: row.primary_service_taxonomy_id === null ? null : Number(row.primary_service_taxonomy_id),
            slug: row.primary_service_term_slug,
            title: row.primary_service_term_title,
          },
    terms: relationships.terms,
    locations: relationships.locations,
    languages: relationships.languages,
    who_this_is_for: Array.isArray(row.who_this_is_for) ? row.who_this_is_for : [],
    problems_covered: Array.isArray(row.problems_covered) ? row.problems_covered : [],
    included_items: Array.isArray(row.included_items) ? row.included_items : [],
    excluded_items: Array.isArray(row.excluded_items) ? row.excluded_items : [],
    required_information: Array.isArray(row.required_information) ? row.required_information : [],
    deliverables: Array.isArray(row.deliverables) ? row.deliverables : [],
    documents_required: Array.isArray(row.documents_required) ? row.documents_required : [],
    process_steps: Array.isArray(row.process_steps) ? row.process_steps : [],
    duration_text: row.duration_text,
    turnaround_time_text: row.turnaround_time_text,
    disclaimer_text: row.disclaimer_text,
    refund_cancellation_policy_text: row.refund_cancellation_policy_text,
    location_coverage_note: row.location_coverage_note,
    consultations_completed_count: Number(row.consultations_completed_count || 0),
    current_viewers_count: Number(row.current_viewers_count || 0),
    years_of_experience: Number(row.years_of_experience || 0),
    enabled_trust_badges: Array.isArray(row.enabled_trust_badges) ? row.enabled_trust_badges : [],
    trust_badges: (Array.isArray(row.enabled_trust_badges) ? row.enabled_trust_badges : []).map((key) => ({
      key,
      label: SERVICE_TRUST_BADGE_LABELS[key] || key,
    })),
    starting_price_paise: serviceStartingPrice(variants),
    active_variant_count: variants.filter((variant) => variant.is_active).length,
    enabled_cta_count: ctas.filter((cta) => cta.is_enabled).length,
    variants,
    faqs: relationships.faqs,
    testimonials: relationships.testimonials,
    ctas,
    form_fields: relationships.form_fields,
    published_at: row.published_at,
    author_id: row.author_id === null ? null : Number(row.author_id),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };

  service.schema_json = buildGeneratedServiceSchema(service);
  service.effective_schema_json = service.schema_json;
  return service;
}

async function getServiceRowById(id, { publicOnly = false } = {}) {
  const values = [id];
  let whereSql = `WHERE s.id = $1`;
  if (publicOnly) {
    values.push("published");
    whereSql += ` AND s.status = $2`;
  }

  const result = await pool.query(
    `SELECT
       s.*,
       primary_term.slug AS primary_service_term_slug,
       primary_term.title AS primary_service_term_title,
       primary_term.taxonomy_id AS primary_service_taxonomy_id
     FROM services s
     LEFT JOIN terms primary_term ON primary_term.id = s.primary_service_term_id
     ${whereSql}
     LIMIT 1`,
    values,
  );

  return result.rows[0] || null;
}

async function getServiceRowBySlug(slug, { publicOnly = false } = {}) {
  const safeSlug = sanitizeSlug(slug);
  if (!safeSlug) {
    return null;
  }

  const values = [safeSlug];
  let whereSql = `WHERE s.slug = $1`;
  if (publicOnly) {
    values.push("published");
    whereSql += ` AND s.status = $2`;
  }

  const result = await pool.query(
    `SELECT
       s.*,
       primary_term.slug AS primary_service_term_slug,
       primary_term.title AS primary_service_term_title,
       primary_term.taxonomy_id AS primary_service_taxonomy_id
     FROM services s
     LEFT JOIN terms primary_term ON primary_term.id = s.primary_service_term_id
     ${whereSql}
     LIMIT 1`,
    values,
  );

  return result.rows[0] || null;
}

function serviceToMutablePayload(service) {
  return {
    status: service.status,
    service_type: service.service_type,
    title: service.title,
    slug: service.slug,
    short_description: service.short_description,
    featured_image_url: service.featured_image_url,
    featured_image_alt: service.featured_image_alt,
    custom_content_title: service.custom_content_title,
    custom_content_html: service.custom_content_html,
    meta_title: service.meta_title,
    meta_description: service.meta_description,
    canonical_url_override: service.canonical_url_override,
    og_title: service.og_title,
    og_description: service.og_description,
    is_indexable: service.is_indexable,
    primary_service_term_id: service.primary_service_term_id,
    related_term_ids: service.terms
      .map((term) => term.id)
      .filter((termId) => termId !== service.primary_service_term_id),
    who_this_is_for: service.who_this_is_for,
    problems_covered: service.problems_covered,
    included_items: service.included_items,
    excluded_items: service.excluded_items,
    required_information: service.required_information,
    deliverables: service.deliverables,
    documents_required: service.documents_required,
    process_steps: service.process_steps,
    duration_text: service.duration_text,
    turnaround_time_text: service.turnaround_time_text,
    disclaimer_text: service.disclaimer_text,
    refund_cancellation_policy_text: service.refund_cancellation_policy_text,
    location_ids: service.locations.map((item) => item.id),
    location_coverage_note: service.location_coverage_note,
    language_ids: service.languages.map((item) => item.id),
    consultations_completed_count: service.consultations_completed_count,
    current_viewers_count: service.current_viewers_count,
    years_of_experience: service.years_of_experience,
    enabled_trust_badges: service.enabled_trust_badges,
    variants: service.variants.map((variant) => ({
      id: variant.id,
      title: variant.title,
      summary: variant.summary,
      price_paise: variant.price_paise,
      compare_at_price_paise: variant.compare_at_price_paise,
      duration_text: variant.duration_text,
      turnaround_time_text: variant.turnaround_time_text,
      sort_order: variant.sort_order,
      is_default: variant.is_default,
      is_active: variant.is_active,
    })),
    faqs: service.faqs.map((faq) => ({
      question: faq.question,
      answer: faq.answer,
      sort_order: faq.sort_order,
    })),
    testimonials: service.testimonials.map((testimonial) => ({
      quote: testimonial.quote,
      author_name: testimonial.author_name,
      author_title: testimonial.author_title,
      sort_order: testimonial.sort_order,
    })),
    ctas: service.ctas.map((cta) => ({
      cta_key: cta.cta_key,
      label: cta.label,
      helper_text: cta.helper_text,
      sort_order: cta.sort_order,
      is_enabled: cta.is_enabled,
    })),
    form_fields: service.form_fields.map((field) => ({
      field_key: field.field_key,
      label: field.label,
      field_type: field.field_type,
      placeholder: field.placeholder,
      help_text: field.help_text,
      options_json: field.options_json,
      sort_order: field.sort_order,
    })),
    published_at: service.published_at,
  };
}

async function upsertServiceRecord(client, serviceId, payload, user, { isUpdate = false } = {}) {
  await ensureIdsExist(
    client,
    "terms",
    [...new Set([payload.primary_service_term_id, ...payload.related_term_ids])],
    "related_term_ids",
  );
  await ensureIdsExist(client, "locations", payload.location_ids, "location_ids");
  await ensureIdsExist(client, "languages", payload.language_ids, "language_ids");

  if (isUpdate) {
    await client.query(
      `UPDATE services
       SET status = $2,
           service_type = $3,
           title = $4,
           slug = $5,
           short_description = $6,
           featured_image_url = $7,
           featured_image_alt = $8,
           custom_content_title = $9,
           custom_content_html = $10,
           meta_title = $11,
           meta_description = $12,
           canonical_url_override = $13,
           og_title = $14,
           og_description = $15,
           is_indexable = $16,
           primary_service_term_id = $17,
           who_this_is_for = $18::jsonb,
           problems_covered = $19::jsonb,
           included_items = $20::jsonb,
           excluded_items = $21::jsonb,
           required_information = $22::jsonb,
           deliverables = $23::jsonb,
           documents_required = $24::jsonb,
           process_steps = $25::jsonb,
           duration_text = $26,
           turnaround_time_text = $27,
           disclaimer_text = $28,
           refund_cancellation_policy_text = $29,
           location_coverage_note = $30,
           consultations_completed_count = $31,
           current_viewers_count = $32,
           years_of_experience = $33,
           enabled_trust_badges = $34::jsonb,
           published_at = $35,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        serviceId,
        payload.status,
        payload.service_type,
        payload.title,
        payload.slug,
        payload.short_description,
        payload.featured_image_url,
        payload.featured_image_alt,
        payload.custom_content_title,
        payload.custom_content_html,
        payload.meta_title,
        payload.meta_description,
        payload.canonical_url_override,
        payload.og_title,
        payload.og_description,
        payload.is_indexable,
        payload.primary_service_term_id,
        JSON.stringify(payload.who_this_is_for),
        JSON.stringify(payload.problems_covered),
        JSON.stringify(payload.included_items),
        JSON.stringify(payload.excluded_items),
        JSON.stringify(payload.required_information),
        JSON.stringify(payload.deliverables),
        JSON.stringify(payload.documents_required),
        JSON.stringify(payload.process_steps),
        payload.duration_text,
        payload.turnaround_time_text,
        payload.disclaimer_text,
        payload.refund_cancellation_policy_text,
        payload.location_coverage_note,
        payload.consultations_completed_count,
        payload.current_viewers_count,
        payload.years_of_experience,
        JSON.stringify(payload.enabled_trust_badges),
        payload.published_at,
      ],
    );
  } else {
    const created = await client.query(
      `INSERT INTO services (
         status,
         service_type,
         title,
         slug,
         short_description,
         featured_image_url,
         featured_image_alt,
         custom_content_title,
         custom_content_html,
         meta_title,
         meta_description,
         canonical_url_override,
         og_title,
         og_description,
         is_indexable,
         primary_service_term_id,
         who_this_is_for,
         problems_covered,
         included_items,
         excluded_items,
         required_information,
         deliverables,
         documents_required,
         process_steps,
         duration_text,
         turnaround_time_text,
         disclaimer_text,
         refund_cancellation_policy_text,
         location_coverage_note,
         consultations_completed_count,
         current_viewers_count,
         years_of_experience,
         enabled_trust_badges,
         published_at,
         author_id
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20::jsonb,
         $21::jsonb, $22::jsonb, $23::jsonb, $24::jsonb, $25, $26, $27, $28, $29, $30,
         $31, $32, $33::jsonb, $34, $35
       )
       RETURNING id`,
      [
        payload.status,
        payload.service_type,
        payload.title,
        payload.slug,
        payload.short_description,
        payload.featured_image_url,
        payload.featured_image_alt,
        payload.custom_content_title,
        payload.custom_content_html,
        payload.meta_title,
        payload.meta_description,
        payload.canonical_url_override,
        payload.og_title,
        payload.og_description,
        payload.is_indexable,
        payload.primary_service_term_id,
        JSON.stringify(payload.who_this_is_for),
        JSON.stringify(payload.problems_covered),
        JSON.stringify(payload.included_items),
        JSON.stringify(payload.excluded_items),
        JSON.stringify(payload.required_information),
        JSON.stringify(payload.deliverables),
        JSON.stringify(payload.documents_required),
        JSON.stringify(payload.process_steps),
        payload.duration_text,
        payload.turnaround_time_text,
        payload.disclaimer_text,
        payload.refund_cancellation_policy_text,
        payload.location_coverage_note,
        payload.consultations_completed_count,
        payload.current_viewers_count,
        payload.years_of_experience,
        JSON.stringify(payload.enabled_trust_badges),
        payload.published_at,
        user?.id ?? null,
      ],
    );
    serviceId = Number(created.rows[0].id);
  }

  await syncRelationshipTable(
    client,
    "service_term_relationships",
    "term_id",
    serviceId,
    [...new Set([payload.primary_service_term_id, ...payload.related_term_ids])],
  );
  await syncRelationshipTable(
    client,
    "service_location_relationships",
    "location_id",
    serviceId,
    payload.location_ids,
  );
  await syncRelationshipTable(
    client,
    "service_language_relationships",
    "language_id",
    serviceId,
    payload.language_ids,
  );

  await syncServiceVariants(client, serviceId, payload.variants);
  await syncSimpleChildTable(
    client,
    "service_faqs",
    serviceId,
    payload.faqs,
    ["question", "answer", "sort_order"],
  );
  await syncSimpleChildTable(
    client,
    "service_testimonials",
    serviceId,
    payload.testimonials,
    ["quote", "author_name", "author_title", "sort_order"],
  );
  await syncSimpleChildTable(
    client,
    "service_ctas",
    serviceId,
    payload.ctas,
    ["cta_key", "label", "helper_text", "sort_order", "is_enabled"],
  );
  await syncSimpleChildTable(
    client,
    "service_form_fields",
    serviceId,
    payload.form_fields,
    ["field_key", "label", "field_type", "placeholder", "help_text", "options_json", "sort_order"],
  );

  return serviceId;
}

async function getServiceById(id) {
  const row = await getServiceRowById(id);
  if (!row) {
    return null;
  }

  return serializeService(row);
}

async function getPublicServiceBySlug(slug) {
  const row = await getServiceRowBySlug(slug, { publicOnly: true });
  if (!row) {
    return null;
  }

  return serializeService(row, { publicOnly: true });
}

async function createService(payload, user) {
  const normalized = normalizeServicePayload(payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const serviceId = await upsertServiceRecord(client, null, normalized, user, { isUpdate: false });
    await client.query("COMMIT");
    return getServiceById(serviceId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateService(id, payload, user) {
  const existing = await getServiceById(id);
  if (!existing) {
    return null;
  }

  const mergedPayload = {
    ...serviceToMutablePayload(existing),
    ...payload,
  };

  const normalized = normalizeServicePayload(mergedPayload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await upsertServiceRecord(client, id, normalized, user, { isUpdate: true });
    await client.query("COMMIT");
    return getServiceById(id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function deleteService(id) {
  const pendingRequests = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM service_requests
     WHERE service_id = $1`,
    [id],
  );

  if (Number(pendingRequests.rows[0]?.total || 0) > 0) {
    throw createValidationError("Service cannot be deleted because it already has requests");
  }

  const result = await pool.query(
    `DELETE FROM services
     WHERE id = $1
     RETURNING id`,
    [id],
  );

  return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
}

function buildReportFilters(filters = {}) {
  const values = [];
  const conditions = [];

  const statuses = Array.isArray(filters.statuses)
    ? filters.statuses.map((status) => normalizeStatus(status, "draft"))
    : [];
  if (statuses.length > 0) {
    values.push(statuses);
    conditions.push(`s.status = ANY($${values.length}::text[])`);
  }

  const serviceTypes = Array.isArray(filters.service_types)
    ? filters.service_types.map((serviceType) => normalizeServiceType(serviceType))
    : [];
  if (serviceTypes.length > 0) {
    values.push(serviceTypes);
    conditions.push(`s.service_type = ANY($${values.length}::service_type[])`);
  }

  const primaryServiceTermIds = normalizeIntegerArray(filters.primary_service_term_ids);
  if (primaryServiceTermIds.length > 0) {
    values.push(primaryServiceTermIds);
    conditions.push(`s.primary_service_term_id = ANY($${values.length}::int[])`);
  }

  const termIds = normalizeIntegerArray(filters.term_ids);
  if (termIds.length > 0) {
    values.push(termIds);
    conditions.push(
      `EXISTS (
         SELECT 1
         FROM service_term_relationships rel
         WHERE rel.service_id = s.id
           AND rel.term_id = ANY($${values.length}::int[])
       )`,
    );
  }

  const isIndexable = normalizeBooleanInput(filters.is_indexable, null);
  if (isIndexable !== null) {
    values.push(isIndexable);
    conditions.push(`s.is_indexable = $${values.length}`);
  }

  const hasFeaturedImage = normalizeBooleanInput(filters.has_featured_image, null);
  if (hasFeaturedImage !== null) {
    conditions.push(
      hasFeaturedImage
        ? `COALESCE(BTRIM(s.featured_image_url), '') <> ''`
        : `COALESCE(BTRIM(s.featured_image_url), '') = ''`,
    );
  }

  const missingMetaTitle = normalizeBooleanInput(filters.missing_meta_title, null);
  if (missingMetaTitle !== null) {
    conditions.push(
      missingMetaTitle
        ? `COALESCE(BTRIM(s.meta_title), '') = ''`
        : `COALESCE(BTRIM(s.meta_title), '') <> ''`,
    );
  }

  const missingMetaDescription = normalizeBooleanInput(filters.missing_meta_description, null);
  if (missingMetaDescription !== null) {
    conditions.push(
      missingMetaDescription
        ? `COALESCE(BTRIM(s.meta_description), '') = ''`
        : `COALESCE(BTRIM(s.meta_description), '') <> ''`,
    );
  }

  const search = normalizeString(filters.search);
  if (search) {
    values.push(`%${search}%`);
    conditions.push(
      `(s.title ILIKE $${values.length}
        OR s.slug ILIKE $${values.length}
        OR COALESCE(s.short_description, '') ILIKE $${values.length}
        OR COALESCE(s.meta_title, '') ILIKE $${values.length}
        OR COALESCE(s.meta_description, '') ILIKE $${values.length})`,
    );
  }

  const publishedFrom = normalizeTimestamp(filters.published_from);
  if (publishedFrom) {
    values.push(publishedFrom);
    conditions.push(`s.published_at >= $${values.length}`);
  }

  const publishedTo = normalizeTimestamp(filters.published_to);
  if (publishedTo) {
    values.push(publishedTo);
    conditions.push(`s.published_at <= $${values.length}`);
  }

  const updatedFrom = normalizeTimestamp(filters.updated_from);
  if (updatedFrom) {
    values.push(updatedFrom);
    conditions.push(`s.updated_at >= $${values.length}`);
  }

  const updatedTo = normalizeTimestamp(filters.updated_to);
  if (updatedTo) {
    values.push(updatedTo);
    conditions.push(`s.updated_at <= $${values.length}`);
  }

  return {
    values,
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
  };
}

function normalizeSort(sortBy, sortOrder) {
  const columns = {
    updated_at: "s.updated_at",
    created_at: "s.created_at",
    published_at: "s.published_at",
    title: "s.title",
    slug: "s.slug",
    status: "s.status",
    service_type: "s.service_type",
    starting_price_paise: "starting_price_paise",
  };

  const safeSortBy = columns[normalizeString(sortBy).toLowerCase()] || "s.updated_at";
  const safeSortOrder = normalizeString(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";

  return `${safeSortBy} ${safeSortOrder}, s.id DESC`;
}

async function reportServices(filters = {}) {
  const { values, whereSql } = buildReportFilters(filters);
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  const orderBy = normalizeSort(filters.sort_by, filters.sort_order);
  values.push(limit, offset);

  const result = await pool.query(
    `SELECT
       s.id,
       s.status,
       s.service_type,
       s.title,
       s.slug,
       s.short_description,
       s.meta_title,
       s.meta_description,
       s.featured_image_url,
       s.is_indexable,
       s.published_at,
       s.created_at,
       s.updated_at,
       s.primary_service_term_id,
       primary_term.slug AS primary_service_term_slug,
       primary_term.title AS primary_service_term_title,
       COALESCE(
         ARRAY(
           SELECT rel.term_id
           FROM service_term_relationships rel
           WHERE rel.service_id = s.id
           ORDER BY rel.term_id ASC
         ),
         '{}'
       ) AS term_ids,
       COALESCE(
         (
           SELECT MIN(variant.price_paise)
           FROM service_variants variant
           WHERE variant.service_id = s.id
             AND variant.is_active = TRUE
         ),
         0
       ) AS starting_price_paise,
       COALESCE(
         (
           SELECT COUNT(*)::int
           FROM service_variants variant
           WHERE variant.service_id = s.id
             AND variant.is_active = TRUE
         ),
         0
       ) AS active_variant_count,
       COALESCE(
         (
           SELECT COUNT(*)::int
           FROM service_ctas cta
           WHERE cta.service_id = s.id
             AND cta.is_enabled = TRUE
         ),
         0
       ) AS enabled_cta_count,
       COUNT(*) OVER()::int AS total_count
     FROM services s
     LEFT JOIN terms primary_term ON primary_term.id = s.primary_service_term_id
     ${whereSql}
     ORDER BY ${orderBy}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  const rows = result.rows;
  const total = rows[0] ? Number(rows[0].total_count) : 0;

  return {
    total,
    limit,
    offset,
    items: rows.map((row) => ({
      id: Number(row.id),
      status: row.status,
      service_type: row.service_type,
      service_type_label: SERVICE_TYPE_LABELS[row.service_type] || row.service_type,
      title: row.title,
      slug: row.slug,
      short_description: row.short_description,
      meta_title: row.meta_title,
      meta_description: row.meta_description,
      featured_image_url: row.featured_image_url,
      is_indexable: Boolean(row.is_indexable),
      published_at: row.published_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      primary_service_term_id: row.primary_service_term_id === null ? null : Number(row.primary_service_term_id),
      primary_service_term_slug: row.primary_service_term_slug,
      primary_service_term_title: row.primary_service_term_title,
      term_ids: Array.isArray(row.term_ids) ? row.term_ids.map((value) => Number(value)) : [],
      starting_price_paise: Number(row.starting_price_paise || 0),
      active_variant_count: Number(row.active_variant_count || 0),
      enabled_cta_count: Number(row.enabled_cta_count || 0),
    })),
  };
}

async function getServiceReportSummary(filters = {}) {
  const { values, whereSql } = buildReportFilters(filters);
  const [totalsResult, breakdownResult] = await Promise.all([
    pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE s.is_indexable = TRUE)::int AS indexable_count,
         COUNT(*) FILTER (WHERE COALESCE(BTRIM(s.featured_image_url), '') = '')::int AS missing_featured_image_count,
         COUNT(*) FILTER (WHERE COALESCE(BTRIM(s.meta_title), '') = '')::int AS missing_meta_title_count,
         COUNT(*) FILTER (WHERE COALESCE(BTRIM(s.meta_description), '') = '')::int AS missing_meta_description_count
       FROM services s
       ${whereSql}`,
      values,
    ),
    pool.query(
      `SELECT
         s.status,
         COUNT(*)::int AS total
       FROM services s
       ${whereSql}
       GROUP BY s.status
       ORDER BY s.status ASC`,
      values,
    ),
  ]);

  const totalsRow = totalsResult.rows[0] || {};
  return {
    total: Number(totalsRow.total || 0),
    indexable_count: Number(totalsRow.indexable_count || 0),
    missing_featured_image_count: Number(totalsRow.missing_featured_image_count || 0),
    missing_meta_title_count: Number(totalsRow.missing_meta_title_count || 0),
    missing_meta_description_count: Number(totalsRow.missing_meta_description_count || 0),
    breakdown: breakdownResult.rows.map((row) => ({
      status: row.status,
      total: Number(row.total || 0),
    })),
  };
}

async function listPublicServices(filters = {}) {
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  const search = normalizeString(filters.search);
  const termId = normalizePositiveInteger(filters.term_id, "term_id", { fallback: null });
  const locationId = normalizePositiveInteger(filters.location_id, "location_id", { fallback: null });
  const languageId = normalizePositiveInteger(filters.language_id, "language_id", { fallback: null });
  const publicServiceType = normalizeString(filters.service_type)
    ? normalizeServiceType(filters.service_type)
    : null;

  const values = ["published"];
  const conditions = [`s.status = $1`];

  if (publicServiceType) {
    values.push(publicServiceType);
    conditions.push(`s.service_type = $${values.length}`);
  }

  if (termId) {
    values.push(termId);
    conditions.push(
      `(s.primary_service_term_id = $${values.length}
        OR EXISTS (
          SELECT 1
          FROM service_term_relationships rel
          WHERE rel.service_id = s.id
            AND rel.term_id = $${values.length}
        ))`,
    );
  }

  if (locationId) {
    values.push(locationId);
    conditions.push(
      `EXISTS (
         SELECT 1
         FROM service_location_relationships rel
         WHERE rel.service_id = s.id
           AND rel.location_id = $${values.length}
       )`,
    );
  }

  if (languageId) {
    values.push(languageId);
    conditions.push(
      `EXISTS (
         SELECT 1
         FROM service_language_relationships rel
         WHERE rel.service_id = s.id
           AND rel.language_id = $${values.length}
       )`,
    );
  }

  if (search) {
    values.push(`%${search}%`);
    conditions.push(
      `(s.title ILIKE $${values.length}
        OR s.slug ILIKE $${values.length}
        OR COALESCE(s.short_description, '') ILIKE $${values.length}
        OR COALESCE(s.meta_description, '') ILIKE $${values.length}
        OR EXISTS (
          SELECT 1
          FROM terms term
          WHERE term.id = s.primary_service_term_id
            AND (term.title ILIKE $${values.length} OR term.slug ILIKE $${values.length})
        )
        OR EXISTS (
          SELECT 1
          FROM service_term_relationships rel
          JOIN terms term ON term.id = rel.term_id
          WHERE rel.service_id = s.id
            AND (term.title ILIKE $${values.length} OR term.slug ILIKE $${values.length})
        ))`,
    );
  }

  values.push(limit, offset);

  const result = await pool.query(
    `SELECT
       s.id,
       s.service_type,
       s.title,
       s.slug,
       s.short_description,
       s.meta_title,
       s.meta_description,
       s.featured_image_url,
       s.featured_image_alt,
       s.published_at,
       s.primary_service_term_id,
       primary_taxonomy.slug AS primary_service_taxonomy_slug,
       primary_term.taxonomy_id AS primary_service_taxonomy_id,
       primary_term.slug AS primary_service_term_slug,
       primary_term.title AS primary_service_term_title,
       COALESCE(
         (
           SELECT jsonb_agg(
                    jsonb_build_object(
                      'id', mapped_term.id,
                      'taxonomy_id', mapped_term.taxonomy_id,
                      'taxonomy_slug', mapped_term.taxonomy_slug,
                      'slug', mapped_term.slug,
                      'title', mapped_term.title
                    )
                    ORDER BY mapped_term.title ASC, mapped_term.id ASC
                  )
           FROM (
             SELECT DISTINCT
               term.id,
               term.taxonomy_id,
               taxonomy.slug AS taxonomy_slug,
               term.slug,
               term.title
             FROM (
               SELECT rel.term_id
               FROM service_term_relationships rel
               WHERE rel.service_id = s.id
               UNION
               SELECT s.primary_service_term_id
               WHERE s.primary_service_term_id IS NOT NULL
             ) service_terms
             JOIN terms term ON term.id = service_terms.term_id
             LEFT JOIN taxonomy ON taxonomy.id = term.taxonomy_id
           ) mapped_term
         ),
         '[]'::jsonb
       ) AS terms,
       COALESCE(
         (
           SELECT jsonb_agg(
                    jsonb_build_object(
                      'id', location.id,
                      'slug', location.slug,
                      'title', location.title
                    )
                    ORDER BY location.title ASC, location.id ASC
                  )
           FROM service_location_relationships rel
           JOIN locations location ON location.id = rel.location_id
           WHERE rel.service_id = s.id
         ),
         '[]'::jsonb
       ) AS locations,
       COALESCE(
         (
           SELECT jsonb_agg(
                    jsonb_build_object(
                      'id', language.id,
                      'slug', language.slug,
                      'title', language.title
                    )
                    ORDER BY language.title ASC, language.id ASC
                  )
           FROM service_language_relationships rel
           JOIN languages language ON language.id = rel.language_id
           WHERE rel.service_id = s.id
         ),
         '[]'::jsonb
       ) AS languages,
       COALESCE(
         (
           SELECT MIN(variant.price_paise)
           FROM service_variants variant
           WHERE variant.service_id = s.id
             AND variant.is_active = TRUE
         ),
         0
       ) AS starting_price_paise,
       COUNT(*) OVER()::int AS total_count
     FROM services s
     LEFT JOIN terms primary_term ON primary_term.id = s.primary_service_term_id
     LEFT JOIN taxonomy primary_taxonomy ON primary_taxonomy.id = primary_term.taxonomy_id
     WHERE ${conditions.join(" AND ")}
     ORDER BY COALESCE(s.published_at, s.updated_at) DESC, s.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  const rows = result.rows;
  const total = rows[0] ? Number(rows[0].total_count) : 0;

  return {
    total,
    limit,
    offset,
    items: rows.map((row) => ({
      id: Number(row.id),
      service_type: row.service_type,
      service_type_label: SERVICE_TYPE_LABELS[row.service_type] || row.service_type,
      title: row.title,
      slug: row.slug,
      short_description: row.short_description || row.meta_description || "",
      meta_title: row.meta_title,
      meta_description: row.meta_description,
      featured_image_url: row.featured_image_url,
      featured_image_alt: row.featured_image_alt,
      published_at: row.published_at,
      starting_price_paise: Number(row.starting_price_paise || 0),
      primary_service_term:
        row.primary_service_term_id === null
          ? null
          : {
              id: Number(row.primary_service_term_id),
              taxonomy_id: row.primary_service_taxonomy_id === null ? null : Number(row.primary_service_taxonomy_id),
              taxonomy_slug: row.primary_service_taxonomy_slug,
              slug: row.primary_service_term_slug,
              title: row.primary_service_term_title,
            },
      terms: normalizePublicCatalogItems(row.terms),
      locations: normalizePublicCatalogItems(row.locations),
      languages: normalizePublicCatalogItems(row.languages),
    })),
  };
}

async function listPublicServiceFilters() {
  const [serviceTypesResult, primaryTermsResult, termsResult, locationsResult, languagesResult] = await Promise.all([
    pool.query(
      `SELECT
         s.service_type,
         COUNT(DISTINCT s.id)::int AS count
       FROM services s
       WHERE s.status = 'published'
       GROUP BY s.service_type
       ORDER BY s.service_type ASC`,
    ),
    pool.query(
      `SELECT
         term.id,
         term.taxonomy_id,
         taxonomy.slug AS taxonomy_slug,
         term.slug,
         term.title,
         COUNT(DISTINCT s.id)::int AS count
       FROM services s
       JOIN terms term ON term.id = s.primary_service_term_id
       LEFT JOIN taxonomy ON taxonomy.id = term.taxonomy_id
       WHERE s.status = 'published'
       GROUP BY term.id, taxonomy.slug
       ORDER BY count DESC, term.title ASC, term.id ASC`,
    ),
    pool.query(
      `WITH mapped_terms AS (
         SELECT
           s.id AS service_id,
           s.primary_service_term_id AS term_id,
           TRUE AS is_primary
         FROM services s
         WHERE s.status = 'published'
           AND s.primary_service_term_id IS NOT NULL

         UNION

         SELECT
           rel.service_id,
           rel.term_id,
           FALSE AS is_primary
         FROM service_term_relationships rel
         JOIN services s ON s.id = rel.service_id
         WHERE s.status = 'published'
       )
       SELECT
         term.id,
         term.taxonomy_id,
         taxonomy.slug AS taxonomy_slug,
         term.slug,
         term.title,
         COUNT(DISTINCT mapped_terms.service_id)::int AS count,
         BOOL_OR(mapped_terms.is_primary)::boolean AS is_primary
       FROM mapped_terms
       JOIN terms term ON term.id = mapped_terms.term_id
       LEFT JOIN taxonomy ON taxonomy.id = term.taxonomy_id
       GROUP BY term.id, taxonomy.slug
       ORDER BY
         BOOL_OR(mapped_terms.is_primary) DESC,
         count DESC,
         term.title ASC,
         term.id ASC`,
    ),
    pool.query(
      `SELECT
         location.id,
         location.slug,
         location.title,
         COUNT(DISTINCT rel.service_id)::int AS count
       FROM service_location_relationships rel
       JOIN services s ON s.id = rel.service_id
       JOIN locations location ON location.id = rel.location_id
       WHERE s.status = 'published'
       GROUP BY location.id
       ORDER BY count DESC, location.title ASC, location.id ASC`,
    ),
    pool.query(
      `SELECT
         language.id,
         language.slug,
         language.title,
         COUNT(DISTINCT rel.service_id)::int AS count
       FROM service_language_relationships rel
       JOIN services s ON s.id = rel.service_id
       JOIN languages language ON language.id = rel.language_id
       WHERE s.status = 'published'
       GROUP BY language.id
       ORDER BY count DESC, language.title ASC, language.id ASC`,
    ),
  ]);

  return {
    service_types: SERVICE_TYPE_OPTIONS.map((option) => {
      const matched = serviceTypesResult.rows.find((row) => row.service_type === option.value);
      return {
        value: option.value,
        label: option.label,
        count: Number(matched?.count || 0),
      };
    }),
    primary_terms: normalizePublicCatalogItems(primaryTermsResult.rows),
    terms: normalizePublicCatalogItems(termsResult.rows),
    locations: normalizePublicCatalogItems(locationsResult.rows),
    languages: normalizePublicCatalogItems(languagesResult.rows),
  };
}

module.exports = {
  SERVICE_CTA_KEYS,
  SERVICE_CTA_LABELS,
  SERVICE_FORM_FIELD_TYPES,
  SERVICE_TYPE_LABELS,
  SERVICE_TYPE_OPTIONS,
  SERVICE_TYPE_VALUES,
  SERVICE_TRUST_BADGE_KEYS,
  createService,
  deleteService,
  getPublicServiceBySlug,
  getServiceById,
  getServiceReportSummary,
  listPublicServiceFilters,
  listPublicServices,
  reportServices,
  updateService,
};
