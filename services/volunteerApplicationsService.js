// services/volunteerApplicationsService.js
const pool = require("../db");

function normalizeArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((s) => String(s).trim()).filter(Boolean);
  }
  return [String(value).trim()].filter(Boolean);
}

async function ensureNgoUser(ngoUserId) {
  const r = await pool.query("SELECT id, role FROM users WHERE id = $1", [
    ngoUserId,
  ]);
  const ngo = r.rows[0];
  if (!ngo) return { ok: false, message: "NGO user not found" };

  const role = String(ngo.role || "")
    .toLowerCase()
    .trim();
  if (role !== "ngo")
    return { ok: false, message: "Target user is not an NGO" };

  return { ok: true };
}

async function createApplication({ applicantUserId, ngoUserId, payload }) {
  const ngoCheck = await ensureNgoUser(ngoUserId);
  if (!ngoCheck.ok) return { ok: false, message: ngoCheck.message };

  const required = [
    "full_name",
    "phone",
    "email",
    "time_commitment",
    "preferred_mode",
    "consent_contact",
    "consent_code_of_conduct",
    "areas_of_interest",
  ];

  for (const k of required) {
    const v = payload?.[k];
    if (v === undefined || v === null || v === "") {
      return { ok: false, message: `Missing required field: ${k}` };
    }
  }

  const areas = normalizeArray(payload.areas_of_interest);
  if (areas.length === 0) {
    return {
      ok: false,
      message: "areas_of_interest must have at least 1 item",
    };
  }

  const languages = normalizeArray(payload.languages_spoken);
  const transport = normalizeArray(payload.transport_modes);

  const q = `
    INSERT INTO volunteer_applications (
      applicant_user_id, ngo_user_id,
      full_name, phone, email, location_id, age, gender,
      time_commitment, preferred_mode,
      areas_of_interest, other_interest_text,
      profession, key_skills,
      languages_spoken, other_language_text,
      volunteered_before, past_experience_text,
      comfortable_traveling, transport_modes,
      consent_contact, consent_code_of_conduct,
      linkedin_url, instagram_url
    ) VALUES (
      $1, $2,
      $3, $4, $5, $6, $7, $8,
      $9, $10,
      $11, $12,
      $13, $14,
      $15, $16,
      $17, $18,
      $19, $20,
      $21, $22,
      $23, $24
    )
    RETURNING *;
  `;

  try {
    const r = await pool.query(q, [
      applicantUserId,
      ngoUserId,

      String(payload.full_name).trim(),
      String(payload.phone).trim(),
      String(payload.email).trim(),
      payload.location_id || null,
      payload.age || null,
      payload.gender || null,

      payload.time_commitment,
      payload.preferred_mode,

      areas,
      payload.other_interest_text || null,

      payload.profession || null,
      payload.key_skills || null,

      languages,
      payload.other_language_text || null,

      payload.volunteered_before === undefined
        ? null
        : !!payload.volunteered_before,
      payload.past_experience_text || null,

      payload.comfortable_traveling === undefined
        ? null
        : !!payload.comfortable_traveling,
      transport,

      !!payload.consent_contact,
      !!payload.consent_code_of_conduct,

      payload.linkedin_url || null,
      payload.instagram_url || null,
    ]);

    return { ok: true, data: r.rows[0] };
  } catch (e) {
    // Unique pending constraint
    if (String(e.message || "").includes("uniq_vol_app_pending")) {
      return {
        ok: false,
        message: "You already have a pending application for this NGO",
      };
    }
    return { ok: false, message: e.message || "Failed to create application" };
  }
}

async function listMyApplications(
  applicantUserId,
  { status, page = 1, limit = 20 },
) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const offset = (p - 1) * l;

  const where = ["va.applicant_user_id = $1"];
  const params = [applicantUserId];

  if (status) {
    params.push(status);
    where.push(`va.status = $${params.length}`);
  }

  const q = `
    SELECT
      va.*,
      ngo.id as ngo_id,
      ngo.role as ngo_role
    FROM volunteer_applications va
    JOIN users ngo ON ngo.id = va.ngo_user_id
    WHERE ${where.join(" AND ")}
    ORDER BY va.created_at DESC
    LIMIT ${l} OFFSET ${offset};
  `;

  const r = await pool.query(q, params);
  return { ok: true, data: { page: p, limit: l, items: r.rows } };
}

async function getMyApplicationById(applicantUserId, applicationId) {
  const r = await pool.query(
    `SELECT * FROM volunteer_applications WHERE id = $1 AND applicant_user_id = $2`,
    [applicationId, applicantUserId],
  );

  const row = r.rows[0];
  if (!row) return { ok: false, message: "Application not found" };
  return { ok: true, data: row };
}

async function listNgoApplications(
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
    FROM volunteer_applications
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT ${l} OFFSET ${offset};
  `;

  const r = await pool.query(q, params);
  return { ok: true, data: { page: p, limit: l, items: r.rows } };
}

async function getNgoApplicationById(ngoUserId, applicationId) {
  const r = await pool.query(
    `SELECT * FROM volunteer_applications WHERE id = $1 AND ngo_user_id = $2`,
    [applicationId, ngoUserId],
  );

  const row = r.rows[0];
  if (!row) return { ok: false, message: "Application not found" };
  return { ok: true, data: row };
}

async function decideApplication({ ngoUserId, applicationId, decision, note }) {
  const decisionLower = String(decision || "")
    .toLowerCase()
    .trim();
  if (!["accepted", "rejected"].includes(decisionLower)) {
    return { ok: false, message: "decision must be 'accepted' or 'rejected'" };
  }

  const r = await pool.query(
    `SELECT * FROM volunteer_applications WHERE id = $1 AND ngo_user_id = $2`,
    [applicationId, ngoUserId],
  );

  const app = r.rows[0];
  if (!app) return { ok: false, message: "Application not found" };

  if (app.status !== "pending") {
    return {
      ok: false,
      message: `Only pending applications can be decided (current: ${app.status})`,
    };
  }

  const u = await pool.query(
    `
    UPDATE volunteer_applications
    SET status = $1,
        ngo_decision_at = NOW(),
        ngo_decision_by = $2,
        ngo_decision_note = $3
    WHERE id = $4
    RETURNING *;
    `,
    [decisionLower, ngoUserId, note || null, applicationId],
  );

  return { ok: true, data: u.rows[0] };
}

module.exports = {
  createApplication,
  listMyApplications,
  getMyApplicationById,
  listNgoApplications,
  getNgoApplicationById,
  decideApplication,
};
