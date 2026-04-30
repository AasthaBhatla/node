const pool = require("../db");
const razorpay = require("../utils/razorpay");
const {
  SERVICE_CTA_KEYS,
  SERVICE_FORM_FIELD_TYPES,
} = require("./serviceCatalogConstants");
const { getServiceById } = require("./serviceService");

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const REQUEST_STATUSES = new Set([
  "submitted",
  "in_review",
  "in_progress",
  "completed",
  "cancelled",
]);
const PAYMENT_STATUSES = new Set(["pending", "paid", "failed", "cancelled"]);

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

function normalizePositiveInteger(value, fieldName, { fallback = null, allowZero = false } = {}) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || (!allowZero && parsed <= 0)) {
    throw createValidationError(`${fieldName} must be a valid integer`);
  }

  return parsed;
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

function normalizeRequestStatus(value, fallback = "submitted") {
  const status = normalizeString(value).toLowerCase() || fallback;
  if (!REQUEST_STATUSES.has(status)) {
    throw createValidationError(`Invalid request status: ${status}`);
  }
  return status;
}

function normalizePaymentStatus(value, fallback = "pending") {
  const status = normalizeString(value).toLowerCase() || fallback;
  if (!PAYMENT_STATUSES.has(status)) {
    throw createValidationError(`Invalid payment status: ${status}`);
  }
  return status;
}

function normalizeAnswerValue(fieldType, rawValue, options = []) {
  if (fieldType === "checkbox") {
    if (Array.isArray(rawValue)) {
      const selected = rawValue
        .map((item) => normalizeString(item))
        .filter(Boolean);
      if (selected.length === 0) {
        throw createValidationError("Checkbox field requires at least one selection");
      }
      if (options.length > 0 && selected.some((item) => !options.includes(item))) {
        throw createValidationError("Checkbox answer contains an invalid option");
      }
      return {
        value_text: null,
        value_json: selected,
      };
    }

    const asBoolean = rawValue === true || rawValue === "true" || rawValue === 1 || rawValue === "1" || rawValue === "yes";
    if (!asBoolean) {
      throw createValidationError("Checkbox field must be accepted");
    }
    return {
      value_text: "true",
      value_json: true,
    };
  }

  if (fieldType === "number") {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) {
      throw createValidationError("Number field requires a valid number");
    }
    return {
      value_text: String(numeric),
      value_json: numeric,
    };
  }

  if (fieldType === "date") {
    const value = normalizeString(rawValue);
    if (!value) {
      throw createValidationError("Date field is required");
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      throw createValidationError("Date field requires a valid date");
    }
    return {
      value_text: value,
      value_json: value,
    };
  }

  const textValue = normalizeString(rawValue);
  if (!textValue) {
    throw createValidationError("Field value is required");
  }

  if (["select", "radio"].includes(fieldType) && options.length > 0 && !options.includes(textValue)) {
    throw createValidationError("Field value contains an invalid option");
  }

  return {
    value_text: textValue,
    value_json: ["select", "radio"].includes(fieldType) ? textValue : null,
  };
}

function normalizeCheckoutPayload(service, payload) {
  const serviceVariantId = normalizePositiveInteger(payload?.service_variant_id, "service_variant_id");
  const ctaKey = normalizeString(payload?.cta_key).toLowerCase();
  if (!SERVICE_CTA_KEYS.includes(ctaKey)) {
    throw createValidationError("cta_key is invalid");
  }

  const variant = (service.variants || []).find(
    (item) => item.id === serviceVariantId && item.is_active,
  );
  if (!variant) {
    throw createValidationError("The selected service variant is not available");
  }

  if (Number(variant.price_paise || 0) <= 0) {
    throw createValidationError("This service variant cannot be checked out until pricing is configured");
  }

  const cta = (service.ctas || []).find(
    (item) => item.cta_key === ctaKey && item.is_enabled,
  );
  if (!cta) {
    throw createValidationError("The selected CTA is not enabled for this service");
  }

  const answersInput = Array.isArray(payload?.answers) ? payload.answers : [];
  const filesInput = Array.isArray(payload?.files) ? payload.files : [];
  const allowDeferredIntake =
    payload?.intake_required === false ||
    payload?.lead_capture === true ||
    normalizeString(payload?.checkout_mode) === "direct_payment";
  const answersByKey = new Map();
  const filesByKey = new Map();

  for (const answer of answersInput) {
    const fieldKey = normalizeString(answer?.field_key);
    if (!fieldKey) {
      continue;
    }
    answersByKey.set(fieldKey, answer);
  }

  for (const file of filesInput) {
    const fieldKey = normalizeString(file?.field_key);
    const fileUrl = normalizeString(file?.file_url);
    if (!fieldKey || !fileUrl) {
      continue;
    }
    const current = filesByKey.get(fieldKey) || [];
    current.push({
      field_key: fieldKey,
      file_url: fileUrl,
      file_name: normalizeNullableString(file?.file_name),
      content_type: normalizeNullableString(file?.content_type),
      sort_order: current.length,
    });
    filesByKey.set(fieldKey, current);
  }

  const normalizedAnswers = [];
  const normalizedFiles = [];

  for (const field of service.form_fields || []) {
    if (field.field_type === "file") {
      const files = filesByKey.get(field.field_key) || [];
      if (files.length === 0) {
        if (allowDeferredIntake) {
          continue;
        }
        throw createValidationError(`${field.label} is required`);
      }
      normalizedFiles.push(...files);
      continue;
    }

    const answer = answersByKey.get(field.field_key);
    if (!answer) {
      if (allowDeferredIntake) {
        continue;
      }
      throw createValidationError(`${field.label} is required`);
    }

    const normalizedValue = normalizeAnswerValue(
      field.field_type,
      answer.value ?? answer.value_text ?? answer.value_json,
      Array.isArray(field.options_json) ? field.options_json : [],
    );

    normalizedAnswers.push({
      field_key: field.field_key,
      field_label: field.label,
      field_type: field.field_type,
      value_text: normalizedValue.value_text,
      value_json: normalizedValue.value_json,
      sort_order: field.sort_order ?? normalizedAnswers.length,
    });
  }

  return {
    service_variant_id: serviceVariantId,
    requested_action: ctaKey,
    quoted_price_paise: Number(variant.price_paise || 0),
    normalized_answers: normalizedAnswers,
    normalized_files: normalizedFiles,
    variant,
  };
}

function buildOrderNote(service, variant, ctaKey) {
  return `${service.title} | ${variant.title} | ${ctaKey}`;
}

function buildClientSummary(row) {
  const firstName = normalizeString(row.client_first_name);
  const lastName = normalizeString(row.client_last_name);
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  return {
    id: Number(row.user_id),
    name: fullName || row.user_phone || row.user_email || `User ${row.user_id}`,
    email: row.user_email || "",
    phone: row.user_phone || "",
    first_name: firstName,
    last_name: lastName,
  };
}

async function getServiceRequestRow(id, { userId = null, admin = false } = {}) {
  const values = [id];
  const conditions = ["sr.id = $1"];

  if (!admin) {
    values.push(userId);
    conditions.push(`sr.user_id = $${values.length}`);
  }

  const result = await pool.query(
    `SELECT
       sr.*,
       s.title AS service_title,
       s.slug AS service_slug,
       s.featured_image_url AS service_featured_image_url,
       sv.title AS variant_title,
       sv.summary AS variant_summary,
       sv.price_paise AS variant_price_paise,
       o.status AS order_status,
       o.total_amount_paise,
       o.order_mode,
       o.razorpay_order_id,
       o.razorpay_payment_id,
       o.paid_at AS order_paid_at,
       u.email AS user_email,
       u.phone AS user_phone,
       profile.first_name AS client_first_name,
       profile.last_name AS client_last_name
     FROM service_requests sr
     JOIN services s ON s.id = sr.service_id
     JOIN service_variants sv ON sv.id = sr.service_variant_id
     JOIN users u ON u.id = sr.user_id
     LEFT JOIN orders o ON o.order_id = sr.order_id
     LEFT JOIN LATERAL (
       SELECT
         MAX(CASE WHEN um.key = 'first_name' THEN um.value END) AS first_name,
         MAX(CASE WHEN um.key = 'last_name' THEN um.value END) AS last_name
       FROM user_metadata um
       WHERE um.user_id = u.id
         AND um.key IN ('first_name', 'last_name')
     ) profile ON TRUE
     WHERE ${conditions.join(" AND ")}
     LIMIT 1`,
    values,
  );

  return result.rows[0] || null;
}

async function getServiceRequestDetails(id, options = {}) {
  const row = await getServiceRequestRow(id, options);
  if (!row) {
    return null;
  }

  const [answersResult, filesResult] = await Promise.all([
    pool.query(
      `SELECT field_key, field_label, field_type, value_text, value_json, sort_order, created_at
       FROM service_request_answers
       WHERE service_request_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [id],
    ),
    pool.query(
      `SELECT field_key, file_url, file_name, content_type, sort_order, created_at
       FROM service_request_files
       WHERE service_request_id = $1
       ORDER BY sort_order ASC, id ASC`,
      [id],
    ),
  ]);

  return {
    id: Number(row.id),
    service_id: Number(row.service_id),
    service_variant_id: Number(row.service_variant_id),
    user_id: Number(row.user_id),
    requested_action: row.requested_action,
    status: row.status,
    payment_status: row.payment_status,
    quoted_price_paise: Number(row.quoted_price_paise || 0),
    order_id: row.order_id === null ? null : Number(row.order_id),
    submitted_at: row.submitted_at,
    paid_at: row.paid_at || row.order_paid_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    service: {
      id: Number(row.service_id),
      title: row.service_title,
      slug: row.service_slug,
      featured_image_url: row.service_featured_image_url,
    },
    variant: {
      id: Number(row.service_variant_id),
      title: row.variant_title,
      summary: row.variant_summary,
      price_paise: Number(row.variant_price_paise || 0),
    },
    order:
      row.order_id === null
        ? null
        : {
            id: Number(row.order_id),
            status: row.order_status,
            order_mode: row.order_mode,
            total_amount_paise: Number(row.total_amount_paise || 0),
            razorpay_order_id: row.razorpay_order_id,
            razorpay_payment_id: row.razorpay_payment_id,
            paid_at: row.order_paid_at,
          },
    client: buildClientSummary(row),
    answers: answersResult.rows.map((answer) => ({
      field_key: answer.field_key,
      field_label: answer.field_label,
      field_type: answer.field_type,
      value_text: answer.value_text,
      value_json: answer.value_json,
      sort_order: Number(answer.sort_order || 0),
      created_at: answer.created_at,
    })),
    files: filesResult.rows.map((file) => ({
      field_key: file.field_key,
      file_url: file.file_url,
      file_name: file.file_name,
      content_type: file.content_type,
      sort_order: Number(file.sort_order || 0),
      created_at: file.created_at,
    })),
  };
}

async function createServiceCheckout(userId, payload) {
  const serviceId = normalizePositiveInteger(payload?.service_id, "service_id");
  const service = await getServiceById(serviceId);
  if (!service || service.status !== "published") {
    throw createValidationError("The selected service is not available");
  }

  const normalizedPayload = normalizeCheckoutPayload(service, payload);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const serviceRequestResult = await client.query(
      `INSERT INTO service_requests (
         service_id,
         service_variant_id,
         user_id,
         requested_action,
         status,
         payment_status,
         quoted_price_paise
       )
       VALUES ($1, $2, $3, $4, 'submitted', 'pending', $5)
       RETURNING id`,
      [
        serviceId,
        normalizedPayload.service_variant_id,
        userId,
        normalizedPayload.requested_action,
        normalizedPayload.quoted_price_paise,
      ],
    );

    const serviceRequestId = Number(serviceRequestResult.rows[0].id);

    for (const answer of normalizedPayload.normalized_answers) {
      await client.query(
        `INSERT INTO service_request_answers (
           service_request_id,
           field_key,
           field_label,
           field_type,
           value_text,
           value_json,
           sort_order
         )
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
        [
          serviceRequestId,
          answer.field_key,
          answer.field_label,
          answer.field_type,
          answer.value_text,
          answer.value_json === null ? null : JSON.stringify(answer.value_json),
          answer.sort_order,
        ],
      );
    }

    for (const file of normalizedPayload.normalized_files) {
      await client.query(
        `INSERT INTO service_request_files (
           service_request_id,
           field_key,
           file_url,
           file_name,
           content_type,
           sort_order
         )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          serviceRequestId,
          file.field_key,
          file.file_url,
          file.file_name,
          file.content_type,
          file.sort_order,
        ],
      );
    }

    const orderResult = await client.query(
      `INSERT INTO orders (
         user_id,
         status,
         total_amount_paise,
         credits_to_grant,
         payment_provider,
         order_mode,
         order_note
       )
       VALUES ($1, 'pending', $2, 0, 'razorpay', 'service', $3)
       RETURNING *`,
      [
        userId,
        normalizedPayload.quoted_price_paise,
        buildOrderNote(service, normalizedPayload.variant, normalizedPayload.requested_action),
      ],
    );

    const order = orderResult.rows[0];

    await client.query(
      `UPDATE service_requests
       SET order_id = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [serviceRequestId, order.order_id],
    );

    await client.query("COMMIT");

    const razorpayOrder = await razorpay.orders.create({
      amount: normalizedPayload.quoted_price_paise,
      currency: "INR",
      receipt: `service_request_${serviceRequestId}`,
      notes: {
        internal_order_id: String(order.order_id),
        service_request_id: String(serviceRequestId),
        service_id: String(serviceId),
        service_variant_id: String(normalizedPayload.service_variant_id),
        order_mode: "service",
      },
    });

    await pool.query(
      `UPDATE orders
       SET razorpay_order_id = $1
       WHERE order_id = $2`,
      [razorpayOrder.id, order.order_id],
    );

    return {
      service_request: await getServiceRequestDetails(serviceRequestId, { userId }),
      razorpay: {
        key_id: process.env.RAZORPAY_KEY_ID,
        order_id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
      },
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    throw error;
  } finally {
    client.release();
  }
}

async function listServiceRequestsForUser(userId) {
  const result = await pool.query(
    `SELECT id
     FROM service_requests
     WHERE user_id = $1
     ORDER BY submitted_at DESC, id DESC`,
    [userId],
  );

  const items = [];
  for (const row of result.rows) {
    // eslint-disable-next-line no-await-in-loop
    const item = await getServiceRequestDetails(Number(row.id), { userId });
    if (item) {
      items.push(item);
    }
  }

  return {
    total: items.length,
    items,
  };
}

async function getServiceRequestByIdForUser(id, userId) {
  return getServiceRequestDetails(id, { userId });
}

function buildReportFilters(filters = {}) {
  const values = [];
  const conditions = [];

  const serviceIds = Array.isArray(filters.service_ids)
    ? filters.service_ids
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0)
    : [];
  if (serviceIds.length > 0) {
    values.push(serviceIds);
    conditions.push(`sr.service_id = ANY($${values.length}::bigint[])`);
  }

  const statuses = Array.isArray(filters.statuses)
    ? filters.statuses.map((status) => normalizeRequestStatus(status))
    : [];
  if (statuses.length > 0) {
    values.push(statuses);
    conditions.push(`sr.status = ANY($${values.length}::text[])`);
  }

  const paymentStatuses = Array.isArray(filters.payment_statuses)
    ? filters.payment_statuses.map((status) => normalizePaymentStatus(status))
    : [];
  if (paymentStatuses.length > 0) {
    values.push(paymentStatuses);
    conditions.push(`sr.payment_status = ANY($${values.length}::text[])`);
  }

  const search = normalizeString(filters.search);
  if (search) {
    values.push(`%${search}%`);
    conditions.push(
      `(s.title ILIKE $${values.length}
        OR sv.title ILIKE $${values.length}
        OR COALESCE(u.email, '') ILIKE $${values.length}
        OR COALESCE(u.phone, '') ILIKE $${values.length})`,
    );
  }

  const submittedFrom = normalizeTimestamp(filters.submitted_from);
  if (submittedFrom) {
    values.push(submittedFrom);
    conditions.push(`sr.submitted_at >= $${values.length}`);
  }

  const submittedTo = normalizeTimestamp(filters.submitted_to);
  if (submittedTo) {
    values.push(submittedTo);
    conditions.push(`sr.submitted_at <= $${values.length}`);
  }

  return {
    values,
    whereSql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
  };
}

function normalizeSort(sortBy, sortOrder) {
  const columns = {
    submitted_at: "sr.submitted_at",
    updated_at: "sr.updated_at",
    paid_at: "sr.paid_at",
    status: "sr.status",
    payment_status: "sr.payment_status",
    service_title: "s.title",
    price: "sr.quoted_price_paise",
  };

  const safeSortBy = columns[normalizeString(sortBy).toLowerCase()] || "sr.submitted_at";
  const safeSortOrder = normalizeString(sortOrder).toLowerCase() === "asc" ? "ASC" : "DESC";
  return `${safeSortBy} ${safeSortOrder}, sr.id DESC`;
}

async function reportServiceRequests(filters = {}) {
  const { values, whereSql } = buildReportFilters(filters);
  const limit = normalizeLimit(filters.limit);
  const offset = normalizeOffset(filters.offset);
  const orderBy = normalizeSort(filters.sort_by, filters.sort_order);

  values.push(limit, offset);

  const result = await pool.query(
    `SELECT
       sr.id,
       sr.service_id,
       sr.service_variant_id,
       sr.user_id,
       sr.requested_action,
       sr.status,
       sr.payment_status,
       sr.quoted_price_paise,
       sr.order_id,
       sr.submitted_at,
       sr.paid_at,
       sr.updated_at,
       s.title AS service_title,
       s.slug AS service_slug,
       sv.title AS variant_title,
       u.email AS user_email,
       u.phone AS user_phone,
       profile.first_name AS client_first_name,
       profile.last_name AS client_last_name,
       COUNT(*) OVER()::int AS total_count
     FROM service_requests sr
     JOIN services s ON s.id = sr.service_id
     JOIN service_variants sv ON sv.id = sr.service_variant_id
     JOIN users u ON u.id = sr.user_id
     LEFT JOIN LATERAL (
       SELECT
         MAX(CASE WHEN um.key = 'first_name' THEN um.value END) AS first_name,
         MAX(CASE WHEN um.key = 'last_name' THEN um.value END) AS last_name
       FROM user_metadata um
       WHERE um.user_id = u.id
         AND um.key IN ('first_name', 'last_name')
     ) profile ON TRUE
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
      service_id: Number(row.service_id),
      service_variant_id: Number(row.service_variant_id),
      user_id: Number(row.user_id),
      requested_action: row.requested_action,
      status: row.status,
      payment_status: row.payment_status,
      quoted_price_paise: Number(row.quoted_price_paise || 0),
      order_id: row.order_id === null ? null : Number(row.order_id),
      submitted_at: row.submitted_at,
      paid_at: row.paid_at,
      updated_at: row.updated_at,
      service_title: row.service_title,
      service_slug: row.service_slug,
      variant_title: row.variant_title,
      client: buildClientSummary(row),
    })),
  };
}

async function getServiceRequestByIdForAdmin(id) {
  return getServiceRequestDetails(id, { admin: true });
}

async function updateServiceRequestStatus(id, nextStatus) {
  const status = normalizeRequestStatus(nextStatus);
  const result = await pool.query(
    `UPDATE service_requests
     SET status = $2,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1
     RETURNING id`,
    [id, status],
  );

  if (!result.rows[0]) {
    return null;
  }

  return getServiceRequestByIdForAdmin(id);
}

async function markServiceRequestPaidByOrderId(orderId, paidAt) {
  if (!orderId) {
    return;
  }

  await pool.query(
    `UPDATE service_requests
     SET payment_status = 'paid',
         paid_at = COALESCE(paid_at, $2),
         updated_at = CURRENT_TIMESTAMP
     WHERE order_id = $1`,
    [orderId, paidAt || new Date().toISOString()],
  );
}

async function markServiceRequestPaymentCancelledByOrderId(orderId) {
  if (!orderId) {
    return;
  }

  await pool.query(
    `UPDATE service_requests
     SET payment_status = 'cancelled',
         updated_at = CURRENT_TIMESTAMP
     WHERE order_id = $1`,
    [orderId],
  );
}

module.exports = {
  createServiceCheckout,
  getServiceRequestByIdForAdmin,
  getServiceRequestByIdForUser,
  listServiceRequestsForUser,
  markServiceRequestPaidByOrderId,
  markServiceRequestPaymentCancelledByOrderId,
  reportServiceRequests,
  updateServiceRequestStatus,
};
