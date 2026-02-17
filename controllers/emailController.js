// controllers/emailController.js
const emailService = require("../services/emailService");

function success(res, body = {}) {
  return res.status(200).json({ status: "success", body });
}

function failure(res, message = "Error", code = 400, extra = {}) {
  return res.status(code).json({
    status: "failure",
    body: { message, ...extra },
  });
}

function normalizeList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function isEmailLike(s) {
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function validateEmailPayload(payload) {
  const to = normalizeList(payload.to);
  const cc = normalizeList(payload.cc);
  const bcc = normalizeList(payload.bcc);

  if (!to.length && !cc.length && !bcc.length) {
    return {
      ok: false,
      code: 400,
      message: "At least one recipient is required in to/cc/bcc",
    };
  }

  const all = [...to, ...cc, ...bcc];
  const bad = all.filter((e) => !isEmailLike(e));
  if (bad.length) {
    return {
      ok: false,
      code: 400,
      message: `Invalid email(s): ${bad.join(", ")}`,
    };
  }

  const subject = String(payload.subject || "").trim();
  if (!subject) {
    return { ok: false, code: 400, message: "subject is required" };
  }

  const hasBody = !!(payload.text || payload.html);
  if (!hasBody) {
    return {
      ok: false,
      code: 400,
      message: "Email body is required (text or html)",
    };
  }

  return {
    ok: true,
    cleaned: {
      to,
      cc,
      bcc,
      subject,
      text: payload.text ? String(payload.text) : undefined,
      html: payload.html ? String(payload.html) : undefined,
    },
  };
}

/**
 * POST /admin/emails/send
 * Body:
 * {
 *   "to": "a@x.com" | ["a@x.com","b@x.com"],
 *   "cc": "...",
 *   "bcc": "...",
 *   "subject": "...",
 *   "text": "...",
 *   "html": "..."
 * }
 */
async function sendSingle(req, res) {
  try {
    const v = validateEmailPayload(req.body || {});
    if (!v.ok) return failure(res, v.message, v.code);

    const result = await emailService.sendEmail(v.cleaned);
    return success(res, result);
  } catch (e) {
    // Zoho API errors can be noisy; keep message useful
    return failure(res, e.message || "Failed to send email", 500);
  }
}

/**
 * POST /admin/emails/bulk
 * Body:
 * {
 *   "emails": [
 *     { "to":"a@x.com", "subject":"..", "text":".." },
 *     { "to":["b@x.com"], "subject":"..", "html":".." }
 *   ]
 * }
 */
async function sendBulk(req, res) {
  try {
    const emails = req.body?.emails;

    if (!Array.isArray(emails) || emails.length === 0) {
      return failure(res, "emails[] is required", 400);
    }

    // Validate each item; keep good ones, report bad ones
    const cleaned = [];
    const errors = [];

    emails.forEach((item, idx) => {
      const v = validateEmailPayload(item || {});
      if (!v.ok) {
        errors.push({ index: idx, message: v.message });
      } else {
        cleaned.push({ index: idx, email: v.cleaned });
      }
    });

    // If everything invalid, fail fast
    if (cleaned.length === 0) {
      return failure(res, "All emails are invalid", 400, { errors });
    }

    // We must preserve ordering for results.
    // emailService.sendEmail expects an array of messages (no index), so we map out.
    const payload = cleaned.map((x) => x.email);

    const svcResult = await emailService.sendEmail(payload);

    // Merge back validation errors into final results with original indexes.
    // svcResult.results corresponds to `payload` order.
    const finalResults = new Array(emails.length).fill(null);

    // place invalids
    errors.forEach((e) => {
      finalResults[e.index] = { ok: false, error: e.message };
    });

    // place valids with service results
    cleaned.forEach((x, i) => {
      finalResults[x.index] = svcResult?.results?.[i] || { ok: true };
    });

    const sent = finalResults.filter((r) => r && r.ok).length;
    const failed = finalResults.length - sent;

    return success(res, {
      mode: "bulk",
      total: finalResults.length,
      sent,
      failed,
      results: finalResults,
    });
  } catch (e) {
    return failure(res, e.message || "Failed to send bulk emails", 500);
  }
}

module.exports = {
  sendSingle,
  sendBulk,
};
