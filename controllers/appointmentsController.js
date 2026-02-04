const svc = require("../services/appointmentsService");

function success(res, body = {}) {
  return res.status(200).json({ status: "success", body });
}
function failure(res, message = "Error", code = 400) {
  return res.status(code).json({ status: "failure", body: { message } });
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
