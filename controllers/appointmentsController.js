// controllers/appointmentsController.js
const svc = require("../services/appointmentsService");
const notify = require("../services/notify");
const userService = require("../services/userService");
const { DateTime } = require("luxon");

function success(res, body = {}) {
  return res.status(200).json({ status: "success", body });
}
function failure(res, message = "Error", code = 400) {
  return res.status(code).json({ status: "failure", body: { message } });
}

function displayFirstName(userObj, fallback = "Someone") {
  const first =
    userObj?.metadata?.first_name ||
    userObj?.metadata?.name ||
    userObj?.metadata?.display_name ||
    "";
  const v = String(first).trim();
  return v || fallback;
}

function formatApptDateTime(startAt, tz = "Asia/Kolkata") {
  try {
    if (!startAt) return "Unknown time";

    // 1) If it's already a JS Date (common from Postgres timestamptz)
    let dt;
    if (startAt instanceof Date) {
      // JS Date is an absolute instant (internally UTC)
      dt = DateTime.fromJSDate(startAt, { zone: "utc" });
    } else {
      const raw = String(startAt).trim();
      if (!raw) return "Unknown time";

      // 2) If it's ISO like "2026-02-16T12:30:00+05:30"
      dt = DateTime.fromISO(raw, { setZone: true });

      // 3) Fallback: if someone passed "Mon Feb 16 2026 07:00:00 GMT+0000..."
      if (!dt.isValid) {
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) {
          dt = DateTime.fromJSDate(d, { zone: "utc" });
        }
      }
    }

    if (!dt || !dt.isValid) return "Unknown time";

    const local = dt.setZone(tz);

    return `${local.toFormat("dd LLL yyyy, hh:mm a")}`;
  } catch (e) {
    return "Unknown time";
  }
}

async function getPartnerTimezone(partnerId) {
  try {
    const s = await svc.getPartnerSettings({ partnerId });
    return s?.timezone || "Asia/Kolkata";
  } catch (_) {
    return "Asia/Kolkata";
  }
}

function parseToUTCDateTime(value) {
  // value can be ISO string or JS Date from Postgres
  if (!value) return null;

  if (value instanceof Date) {
    const dt = DateTime.fromJSDate(value, { zone: "utc" });
    return dt.isValid ? dt : null;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const dt = DateTime.fromISO(raw, { setZone: true }).toUTC();
  return dt.isValid ? dt : null;
}

async function scheduleAppointmentReminders({
  appointment,
  clientId,
  partnerId,
  partnerTz,
  clientTz = "Asia/Kolkata",
  clientName = "The client",
  partnerName = "The partner",
}) {
  // appointment.start_at can be JS Date or ISO string; we normalize to UTC
  const startUtc = parseToUTCDateTime(appointment?.start_at);
  if (!startUtc) return;

  const nowUtc = DateTime.utc();

  const tMinus10 = startUtc.minus({ minutes: 10 });
  const atTime = startUtc;

  // Skip reminders that are already in the past (with a small buffer)
  const schedulePoints = [
    { whenUtc: tMinus10, kind: "tminus10" },
    { whenUtc: atTime, kind: "at" },
  ].filter((x) => x.whenUtc > nowUtc.plus({ seconds: 5 }));

  if (!schedulePoints.length) return;

  const apptIdStr = String(appointment.id);
  const startAtRaw = appointment.start_at; // keep original for display + data

  // Human-friendly local time strings for message bodies
  const whenForPartner = formatApptDateTime(startAtRaw, partnerTz);
  const whenForClient = formatApptDateTime(startAtRaw, clientTz);

  for (const sp of schedulePoints) {
    const eventKey =
      sp.kind === "tminus10"
        ? "appointments.reminder.tminus10"
        : "appointments.reminder.at";

    const title =
      sp.kind === "tminus10"
        ? "Appointment starts in 10 minutes"
        : "Appointment starting now";

    // ---------------------------
    // Partner reminder
    // ---------------------------
    await notify.userAt(
      Number(partnerId),
      {
        title,
        body:
          sp.kind === "tminus10"
            ? `Your appointment with ${clientName} is at ${whenForPartner}.`
            : `Your appointment with ${clientName} is starting now (${whenForPartner}).`,
        data: {
          type:
            sp.kind === "tminus10"
              ? "appointment_reminder_10m"
              : "appointment_reminder_now",
          reminder_kind: sp.kind, // ✅ used for cancellation
          appointment_id: apptIdStr, // ✅ store as string for JSONB matching
          client_id: Number(clientId),
          partner_id: Number(partnerId),
          start_at: startAtRaw,
          timezone: partnerTz,
        },
        push: true,
        store: true,
      },
      sp.whenUtc.toISO(), // ISO string (UTC). notify.js will normalize to UTC anyway.
      eventKey,
    );

    // ---------------------------
    // Client reminder
    // ---------------------------
    await notify.userAt(
      Number(clientId),
      {
        title,
        body:
          sp.kind === "tminus10"
            ? `Your appointment with ${partnerName} is at ${whenForClient}.`
            : `Your appointment with ${partnerName} is starting now (${whenForClient}).`,
        data: {
          type:
            sp.kind === "tminus10"
              ? "appointment_reminder_10m"
              : "appointment_reminder_now",
          reminder_kind: sp.kind, // ✅ used for cancellation
          appointment_id: apptIdStr, // ✅ store as string for JSONB matching
          client_id: Number(clientId),
          partner_id: Number(partnerId),
          start_at: startAtRaw,
          timezone: clientTz,
        },
        push: true,
        store: true,
      },
      sp.whenUtc.toISO(),
      eventKey,
    );
  }
}

async function cancelAppointmentReminders({
  appointmentId,
  clientId,
  partnerId,
}) {
  const apptId = String(appointmentId);

  // cancel partner reminders
  await notify.cancelScheduled({
    event_key_like: "appointments.reminder.%",
    target_type: "user",
    target_user_id: Number(partnerId),
    data_equals: { appointment_id: apptId },
    data_in: { reminder_kind: ["tminus10", "at"] },
    reason: "appointment_cancelled",
  });

  // cancel client reminders
  await notify.cancelScheduled({
    event_key_like: "appointments.reminder.%",
    target_type: "user",
    target_user_id: Number(clientId),
    data_equals: { appointment_id: apptId },
    data_in: { reminder_kind: ["tminus10", "at"] },
    reason: "appointment_cancelled",
  });
}

exports.upsertPartnerSettings = async (req, res) => {
  try {
    const out = await svc.upsertPartnerSettings({
      partnerId: req.user.id,
      slotDurationMinutes: req.body.slot_duration_minutes,
      timezone: req.body.timezone,
    });
    return success(res, { settings: out });
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.replaceWeeklyAvailability = async (req, res) => {
  try {
    const out = await svc.replaceWeeklyAvailability({
      partnerId: req.user.id,
      windows: req.body.windows, // array
    });
    return success(res, { availability: out });
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.addTimeOff = async (req, res) => {
  try {
    const out = await svc.addTimeOff({
      partnerId: req.user.id,
      startAt: req.body.start_at,
      endAt: req.body.end_at,
      reason: req.body.reason,
    });
    return success(res, { time_off: out });
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.listPartnerAppointments = async (req, res) => {
  try {
    const out = await svc.listPartnerAppointments({
      partnerId: req.user.id,
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });
    return success(res, out);
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.getPartnerSlotsByDate = async (req, res) => {
  try {
    const out = await svc.getPartnerSlotsByDate({
      partnerId: req.params.partnerId,
      date: req.query.date, // YYYY-MM-DD
    });
    return success(res, out);
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.createAppointment = async (req, res) => {
  try {
    const out = await svc.createAppointment({
      clientId: req.user.id,
      partnerId: req.body.partner_id,
      startAt: req.body.start_at, // ISO or date-time string
      clientNote: req.body.client_note,
    });

    // Notify partner: appointment booked
    try {
      const partnerId = Number(out.partner_id || req.body.partner_id);
      const partnerTz = await getPartnerTimezone(partnerId);

      const client = await userService.getUserById(req.user.id);
      const clientName = displayFirstName(client, "A client");
      const when = formatApptDateTime(out.start_at, partnerTz);

      await notify.user(
        partnerId,
        {
          title: "New Appointment Request",
          body: `${clientName} requested an appointment for ${when}. (pending approval)`,
          data: {
            type: "appointment_booked",
            appointment_id: out.id,
            client_id: out.client_id,
            partner_id: out.partner_id,
            start_at: out.start_at,
            timezone: partnerTz,
          },
          push: true,
          store: true,
        },
        "appointments.booked",
      );
    } catch (e) {
      console.error(
        "Notify partner (appointment booked) failed:",
        e.message || e,
      );
    }

    return success(res, { appointment: out });
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.listMyAppointments = async (req, res) => {
  try {
    const out = await svc.listMyAppointments({
      clientId: req.user.id,
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
      page: req.query.page,
      limit: req.query.limit,
    });
    return success(res, out);
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.cancelAsClient = async (req, res) => {
  try {
    const out = await svc.cancelAsClient({
      clientId: req.user.id,
      appointmentId: req.params.id,
    });

    // Notify partner: cancelled by client
    try {
      const partnerId = Number(out.partner_id);
      const partnerTz = await getPartnerTimezone(partnerId);

      const client = await userService.getUserById(req.user.id);
      const clientName = displayFirstName(client, "The client");
      const when = formatApptDateTime(out.start_at, partnerTz);

      await notify.user(
        partnerId,
        {
          title: "Appointment Cancelled",
          body: `${clientName} cancelled the appointment scheduled for ${when}.`,
          data: {
            type: "appointment_cancelled_by_client",
            appointment_id: out.id,
            client_id: out.client_id,
            partner_id: out.partner_id,
            start_at: out.start_at,
            timezone: partnerTz,
          },
          push: true,
          store: true,
        },
        "appointments.cancelled.by.client",
      );
    } catch (e) {
      console.error(
        "Notify partner (cancelled by client) failed:",
        e.message || e,
      );
    }

    try {
      await cancelAppointmentReminders({
        appointmentId: out.id,
        clientId: Number(out.client_id),
        partnerId: Number(out.partner_id),
      });
    } catch (e) {
      console.error(
        "Cancel appointment reminders (by client) failed:",
        e.message || e,
      );
    }

    return success(res, { appointment: out });
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.respondAsPartner = async (req, res) => {
  try {
    const out = await svc.respondAsPartner({
      partnerId: req.user.id,
      appointmentId: req.params.id,
      action: req.body.action, // accept|reject
      note: req.body.note,
    });

    // Notify client: accepted/rejected
    try {
      const clientId = Number(out.client_id);
      const clientTz = "Asia/Kolkata"; // If you later store client timezone, switch here.
      const when = formatApptDateTime(out.start_at, clientTz);

      const partner = await userService.getUserById(req.user.id);
      const partnerName = displayFirstName(partner, "The partner");

      const statusWord =
        out.status === "accepted"
          ? "accepted"
          : out.status === "rejected"
            ? "rejected"
            : "updated";

      await notify.user(
        clientId,
        {
          title: `Appointment ${statusWord.charAt(0).toUpperCase() + statusWord.slice(1)}`,
          body: `${partnerName} ${statusWord} your appointment for ${when}.`,
          data: {
            type:
              out.status === "accepted"
                ? "appointment_accepted"
                : "appointment_rejected",
            appointment_id: out.id,
            client_id: out.client_id,
            partner_id: out.partner_id,
            start_at: out.start_at,
            timezone: clientTz,
          },
          push: true,
          store: true,
        },
        out.status === "accepted"
          ? "appointments.accepted"
          : "appointments.rejected",
      );
    } catch (e) {
      console.error("Notify client (partner respond) failed:", e.message || e);
    }

    // After notifying client accepted/rejected...
    if (out.status === "accepted") {
      try {
        const partnerId = Number(out.partner_id);
        const clientId = Number(out.client_id);

        const partnerTz = await getPartnerTimezone(partnerId);
        const clientTz = "Asia/Kolkata"; // replace later if you store client tz

        const partner = await userService.getUserById(partnerId);
        const client = await userService.getUserById(clientId);

        const partnerName = displayFirstName(partner, "The partner");
        const clientName = displayFirstName(client, "The client");

        await scheduleAppointmentReminders({
          appointment: out,
          clientId,
          partnerId,
          partnerTz,
          clientTz,
          clientName,
          partnerName,
        });
      } catch (e) {
        console.error("Schedule appointment reminders failed:", e.message || e);
      }
    }

    return success(res, { appointment: out });
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.cancelAsPartner = async (req, res) => {
  try {
    const out = await svc.cancelAsPartner({
      partnerId: req.user.id,
      appointmentId: req.params.id,
      note: req.body.note,
    });

    // Notify client: cancelled by partner
    try {
      const clientId = Number(out.client_id);
      const clientTz = "Asia/Kolkata";
      const when = formatApptDateTime(out.start_at, clientTz);

      const partner = await userService.getUserById(req.user.id);
      const partnerName = displayFirstName(partner, "The partner");

      await notify.user(
        clientId,
        {
          title: "Appointment Cancelled",
          body: `${partnerName} cancelled your appointment scheduled for ${when}.`,
          data: {
            type: "appointment_cancelled_by_partner",
            appointment_id: out.id,
            client_id: out.client_id,
            partner_id: out.partner_id,
            start_at: out.start_at,
            timezone: clientTz,
          },
          push: true,
          store: true,
        },
        "appointments.cancelled.by.partner",
      );
    } catch (e) {
      console.error(
        "Notify client (cancelled by partner) failed:",
        e.message || e,
      );
    }
    try {
      await cancelAppointmentReminders({
        appointmentId: out.id,
        clientId: Number(out.client_id),
        partnerId: Number(out.partner_id),
      });
    } catch (e) {
      console.error(
        "Cancel appointment reminders (by partner) failed:",
        e.message || e,
      );
    }

    return success(res, { appointment: out });
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.getPartnerSettings = async (req, res) => {
  try {
    const out = await svc.getPartnerSettings({ partnerId: req.user.id });
    return success(res, { settings: out });
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.getWeeklyAvailability = async (req, res) => {
  try {
    const out = await svc.getWeeklyAvailability({ partnerId: req.user.id });
    return success(res, { windows: out });
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.listTimeOff = async (req, res) => {
  try {
    const out = await svc.listTimeOff({
      partnerId: req.user.id,
      from: req.query.from,
      to: req.query.to,
      page: req.query.page,
      limit: req.query.limit,
    });
    return success(res, out);
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.getMySlotsByDate = async (req, res) => {
  try {
    const out = await svc.getPartnerSlotsByDate({
      partnerId: req.user.id,
      date: req.query.date,
    });
    return success(res, out);
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.deleteTimeOff = async (req, res) => {
  try {
    const out = await svc.deleteTimeOff({
      partnerId: req.user.id,
      timeOffId: req.params.id,
    });
    return success(res, out);
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.updateTimeOff = async (req, res) => {
  try {
    const out = await svc.updateTimeOff({
      partnerId: req.user.id,
      timeOffId: req.params.id,
      startAt: req.body.start_at,
      endAt: req.body.end_at,
      reason: req.body.reason,
    });
    return success(res, { time_off: out });
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};

exports.getPartnerAvailableDaysInMonth = async (req, res) => {
  try {
    const out = await svc.getPartnerAvailableDaysInMonth({
      partnerId: req.params.partnerId,
      month: req.query.month, // YYYY-MM
    });
    return success(res, out);
  } catch (e) {
    return failure(res, e.message, e.statusCode || 500);
  }
};
