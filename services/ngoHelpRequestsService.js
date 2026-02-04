// services/ngoHelpRequestsService.js
const pool = require("../db");

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
}

function isValidDateString(d) {
  // expects YYYY-MM-DD
  return typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
}

const HELP_TYPE_MAP = {
  "Medical Help": "medical_help",
  "Education Support": "education_support",
  "Food / Ration": "food_ration",
  "Financial Help": "financial_help",
  "Employment / Skill Support": "employment_skill_support",
  "Legal Help": "legal_help",
  "Environmental Issue": "environmental_issue",
  "Women Support": "women_support",
  "Farmer Support": "farmer_support",
  Other: "other",
};

function normalizeHelpTypes(input) {
  const raw = normalizeArray(input);
  // allow both API slugs and UI labels
  const normalized = raw
    .map((x) => HELP_TYPE_MAP[x] || String(x).toLowerCase().trim())
    .filter(Boolean);

  // whitelist
  const allowed = new Set([
    "medical_help",
    "education_support",
    "food_ration",
    "financial_help",
    "employment_skill_support",
    "legal_help",
    "environmental_issue",
    "women_support",
    "farmer_support",
    "other",
  ]);

  return [...new Set(normalized)].filter((x) => allowed.has(x));
}

async function ensureNgoUser(ngoUserId) {
  const r = await pool.query("SELECT id, role FROM users WHERE id = $1", [
    ngoUserId,
  ]);
  const ngo = r.rows[0];
  if (!ngo)
    return { ok: false, message: "NGO user not found", statusCode: 404 };

  const role = String(ngo.role || "")
    .toLowerCase()
    .trim();
  if (role !== "ngo") {
    return {
      ok: false,
      message: "Target user is not an NGO",
      statusCode: 400,
    };
  }

  return { ok: true };
}

async function createHelpRequest({ clientUserId, ngoUserId, payload }) {
  const ngoCheck = await ensureNgoUser(ngoUserId);
  if (!ngoCheck.ok) return ngoCheck;

  const required = [
    "full_name",
    "phone",
    "location_id",
    "pin_code",
    "age",
    "dob",
    "help_types",
    "problem_text",
    "consent_contact",
  ];

  for (const k of required) {
    const v = payload?.[k];
    if (v === undefined || v === null || v === "") {
      return { ok: false, message: `Missing required field: ${k}` };
    }
  }

  const locationId = parseInt(payload.location_id, 10);
  if (!locationId) return { ok: false, message: "Invalid location_id" };

  const age = parseInt(payload.age, 10);
  if (!(age >= 0 && age <= 120)) return { ok: false, message: "Invalid age" };

  const pin = String(payload.pin_code).trim();
  if (!/^\d{4,10}$/.test(pin)) {
    return { ok: false, message: "Invalid pin_code" };
  }

  const dob = String(payload.dob).trim();
  if (!isValidDateString(dob)) {
    return { ok: false, message: "dob must be YYYY-MM-DD" };
  }

  const helpTypes = normalizeHelpTypes(payload.help_types);
  if (helpTypes.length === 0) {
    return { ok: false, message: "help_types must have at least 1 item" };
  }

  const problemText = String(payload.problem_text || "").trim();
  if (problemText.length < 5) {
    return { ok: false, message: "problem_text is too short" };
  }

  const consentContact = !!payload.consent_contact;
  if (!consentContact) {
    return { ok: false, message: "consent_contact must be true" };
  }

  const q = `
    INSERT INTO ngo_help_requests (
      client_user_id, ngo_user_id,
      full_name, phone, location_id, pin_code, age, dob,
      help_types, problem_text,
      consent_contact
    ) VALUES (
      $1, $2,
      $3, $4, $5, $6, $7, $8,
      $9, $10,
      $11
    )
    RETURNING *;
  `;

  try {
    const r = await pool.query(q, [
      clientUserId,
      ngoUserId,
      String(payload.full_name).trim(),
      String(payload.phone).trim(),
      locationId,
      pin,
      age,
      dob,
      helpTypes,
      problemText,
      consentContact,
    ]);

    return { ok: true, data: r.rows[0] };
  } catch (e) {
    if (String(e.message || "").includes("uniq_ngo_help_pending")) {
      return {
        ok: false,
        message: "You already have a pending help request for this NGO",
        statusCode: 400,
      };
    }
    return {
      ok: false,
      message: e.message || "Failed to create help request",
      statusCode: 400,
    };
  }
}

async function listMyHelpRequests(
  clientUserId,
  { status, page = 1, limit = 20 },
) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (p - 1) * l;

  const where = ["hr.client_user_id = $1"];
  const params = [clientUserId];

  if (status) {
    params.push(status);
    where.push(`hr.status = $${params.length}`);
  }

  const q = `
    SELECT
      hr.*,
      ngo.id as ngo_id,
      ngo.role as ngo_role
    FROM ngo_help_requests hr
    JOIN users ngo ON ngo.id = hr.ngo_user_id
    WHERE ${where.join(" AND ")}
    ORDER BY hr.created_at DESC
    LIMIT ${l} OFFSET ${offset};
  `;

  const r = await pool.query(q, params);
  return { ok: true, data: { page: p, limit: l, items: r.rows } };
}

async function getMyHelpRequestById(clientUserId, requestId) {
  const r = await pool.query(
    `SELECT * FROM ngo_help_requests WHERE id = $1 AND client_user_id = $2`,
    [requestId, clientUserId],
  );

  const row = r.rows[0];
  if (!row) return { ok: false, message: "Request not found" };
  return { ok: true, data: row };
}

async function withdrawHelpRequest({ clientUserId, requestId }) {
  const r = await pool.query(
    `SELECT * FROM ngo_help_requests WHERE id = $1 AND client_user_id = $2`,
    [requestId, clientUserId],
  );
  const row = r.rows[0];
  if (!row) return { ok: false, message: "Request not found", statusCode: 404 };

  if (row.status !== "pending") {
    return {
      ok: false,
      message: `Only pending requests can be withdrawn (current: ${row.status})`,
      statusCode: 400,
    };
  }

  const u = await pool.query(
    `
    UPDATE ngo_help_requests
    SET status = 'withdrawn'
    WHERE id = $1
    RETURNING *;
    `,
    [requestId],
  );

  return { ok: true, data: u.rows[0] };
}

async function listNgoHelpRequests(
  ngoUserId,
  { status, page = 1, limit = 20 },
) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (p - 1) * l;

  const where = ["ngo_user_id = $1"];
  const params = [ngoUserId];

  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }

  const q = `
    SELECT *
    FROM ngo_help_requests
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT ${l} OFFSET ${offset};
  `;

  const r = await pool.query(q, params);
  return { ok: true, data: { page: p, limit: l, items: r.rows } };
}

async function getNgoHelpRequestById(ngoUserId, requestId) {
  const r = await pool.query(
    `SELECT * FROM ngo_help_requests WHERE id = $1 AND ngo_user_id = $2`,
    [requestId, ngoUserId],
  );

  const row = r.rows[0];
  if (!row) return { ok: false, message: "Request not found" };
  return { ok: true, data: row };
}

async function decideHelpRequest({ ngoUserId, requestId, decision, note }) {
  const decisionLower = String(decision || "")
    .toLowerCase()
    .trim();
  if (!["accepted", "rejected"].includes(decisionLower)) {
    return { ok: false, message: "decision must be 'accepted' or 'rejected'" };
  }

  const r = await pool.query(
    `SELECT * FROM ngo_help_requests WHERE id = $1 AND ngo_user_id = $2`,
    [requestId, ngoUserId],
  );
  const row = r.rows[0];
  if (!row) return { ok: false, message: "Request not found", statusCode: 404 };

  if (row.status !== "pending") {
    return {
      ok: false,
      message: `Only pending requests can be decided (current: ${row.status})`,
      statusCode: 400,
    };
  }

  const u = await pool.query(
    `
    UPDATE ngo_help_requests
    SET status = $1,
        ngo_decision_at = NOW(),
        ngo_decision_by = $2,
        ngo_decision_note = $3
    WHERE id = $4
    RETURNING *;
    `,
    [decisionLower, ngoUserId, note || null, requestId],
  );

  return { ok: true, data: u.rows[0] };
}

module.exports = {
  createHelpRequest,
  listMyHelpRequests,
  getMyHelpRequestById,
  withdrawHelpRequest,
  listNgoHelpRequests,
  getNgoHelpRequestById,
  decideHelpRequest,
};
