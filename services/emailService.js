// services/emailService.js
const nodemailer = require("nodemailer");

function normalizeList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map(String);
  // allow comma-separated string
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function asAddressField(v) {
  const list = normalizeList(v);
  return list.length ? list.join(", ") : undefined;
}

function isValidEmailLike(s) {
  // pragmatic (not perfect) validation
  return typeof s === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function validateMessage(msg) {
  if (!msg) throw new Error("Missing message payload");

  const to = normalizeList(msg.to);
  const cc = normalizeList(msg.cc);
  const bcc = normalizeList(msg.bcc);

  if (!to.length && !cc.length && !bcc.length) {
    throw new Error("At least one recipient is required in to/cc/bcc");
  }

  const all = [...to, ...cc, ...bcc];
  const bad = all.filter((e) => !isValidEmailLike(e));
  if (bad.length) {
    throw new Error(`Invalid email(s): ${bad.join(", ")}`);
  }

  if (!msg.subject || !String(msg.subject).trim()) {
    throw new Error("Subject is required");
  }

  if (!msg.text && !msg.html) {
    throw new Error("Email body is required (text or html)");
  }

  return {
    to,
    cc,
    bcc,
    subject: String(msg.subject).trim(),
    text: msg.text ? String(msg.text) : undefined,
    html: msg.html ? String(msg.html) : undefined,
    replyTo: msg.replyTo ? String(msg.replyTo) : undefined,
    headers:
      msg.headers && typeof msg.headers === "object" ? msg.headers : undefined,
  };
}

function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error("Missing GMAIL_USER or GMAIL_APP_PASSWORD in env");
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) =>
      setTimeout(() => rej(new Error("SMTP timeout")), ms),
    ),
  ]);
}

/**
 * Common send function:
 * - accepts single message object OR array of messages
 * - supports to/cc/bcc/subject/text/html/replyTo/headers
 * - returns detailed results, including partial failures for bulk
 */
async function sendEmail(input) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },

    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 20000,
  });

  const from = process.env.GMAIL_FROM || process.env.GMAIL_USER;

  // SINGLE
  if (!Array.isArray(input)) {
    const msg = validateMessage(input);
    const info = await withTimeout(
      transporter.sendMail({
        from,
        to: asAddressField(msg.to),
        cc: asAddressField(msg.cc),
        bcc: asAddressField(msg.bcc),
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        replyTo: msg.replyTo,
        headers: msg.headers,
      }),
      25000,
    );

    return {
      mode: "single",
      sent: 1,
      failed: 0,
      results: [
        {
          ok: true,
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
          response: info.response,
        },
      ],
    };
  }

  // BULK (with concurrency limit)
  const concurrency = Number(process.env.EMAIL_SEND_CONCURRENCY || 3);
  const messages = input;

  // validate first so you fail fast on bad payloads
  const validated = messages.map((m, idx) => {
    try {
      return { idx, ok: true, msg: validateMessage(m) };
    } catch (e) {
      return { idx, ok: false, error: e.message };
    }
  });

  const invalid = validated.filter((v) => !v.ok);
  const valid = validated.filter((v) => v.ok);

  const results = new Array(messages.length).fill(null);

  // record invalid upfront
  for (const bad of invalid) {
    results[bad.idx] = { ok: false, error: bad.error };
  }

  // small concurrency pool
  let cursor = 0;
  async function worker() {
    while (cursor < valid.length) {
      const current = valid[cursor++];
      const msg = current.msg;

      try {
        const info = await transporter.sendMail({
          from,
          to: asAddressField(msg.to),
          cc: asAddressField(msg.cc),
          bcc: asAddressField(msg.bcc),
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
          replyTo: msg.replyTo,
          headers: msg.headers,
        });

        results[current.idx] = {
          ok: true,
          messageId: info.messageId,
          accepted: info.accepted,
          rejected: info.rejected,
          response: info.response,
        };
      } catch (e) {
        results[current.idx] = { ok: false, error: e.message || "Send failed" };
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () =>
    worker(),
  );
  await Promise.all(workers);

  const sent = results.filter((r) => r && r.ok).length;
  const failed = results.length - sent;

  return {
    mode: "bulk",
    total: results.length,
    sent,
    failed,
    results,
  };
}

module.exports = {
  sendEmail,
};
