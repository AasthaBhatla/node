// controllers/emailController.js
const emailService = require("../services/emailService");

function success(res, body = {}) {
  return res.status(200).json({ status: "success", body });
}
function failure(res, message = "Error", code = 400) {
  return res.status(code).json({ status: "failure", body: { message } });
}

async function sendSingle(req, res) {
  try {
    // expects: { to, cc?, bcc?, subject, text?, html? }
    const result = await emailService.sendEmail(req.body);
    return success(res, result);
  } catch (e) {
    return failure(res, e.message || "Failed to send email", 400);
  }
}

async function sendBulk(req, res) {
  try {
    // expects: { emails: [ {to, subject, text/html, ...}, ... ] }
    const emails = req.body?.emails;
    if (!Array.isArray(emails) || !emails.length) {
      return failure(res, "emails[] is required", 400);
    }

    const result = await emailService.sendEmail(emails);
    return success(res, result);
  } catch (e) {
    return failure(res, e.message || "Failed to send bulk emails", 400);
  }
}

module.exports = {
  sendSingle,
  sendBulk,
};
