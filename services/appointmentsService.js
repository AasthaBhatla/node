const pool = require("../db");
const { DateTime, Interval } = require("luxon");

function httpError(message, statusCode = 400) {
  const e = new Error(message);
  e.statusCode = statusCode;
  return e;
}

const PARTNER_ROLES = new Set(["officer", "lawyer", "ngo"]);

async function assertPartnerUser(partnerId) {
  const r = await pool.query("SELECT id, role FROM users WHERE id=$1", [
    partnerId,
  ]);
  const row = r.rows[0];
  if (!row) throw httpError("Partner not found", 404);

  const role = String(row.role || "")
    .toLowerCase()
    .trim();
  if (!PARTNER_ROLES.has(role))
    throw httpError("Selected user is not a partner", 400);
}

async function getPartnerSettings(partnerId) {
  const r = await pool.query(
    "SELECT partner_id, slot_duration_minutes, timezone FROM partner_settings WHERE partner_id=$1",
    [partnerId],
  );
  if (r.rows[0]) return r.rows[0];
  return {
    partner_id: Number(partnerId),
    slot_duration_minutes: 10,
    timezone: "Asia/Kolkata",
  };
}

function parseISOorThrow(dtStr, message = "Invalid datetime") {
  const dt = DateTime.fromISO(String(dtStr || ""), { setZone: true });
  if (!dt.isValid) throw httpError(message, 400);
  return dt;
}

// Add this helper near overlapsAny()
function overlapsAnyBool(slotStart, slotEnd, ranges) {
  const slot = Interval.fromDateTimes(slotStart, slotEnd);
  for (const r of ranges) {
    const a = r.start_at
      ? DateTime.fromISO(r.start_at, { setZone: true })
      : r.start;
    const b = r.end_at ? DateTime.fromISO(r.end_at, { setZone: true }) : r.end;
    const it = Interval.fromDateTimes(a, b);
    if (slot.overlaps(it)) return true;
  }
  return false;
}

/**
 * windows payload format:
 * {
 *   windows: [
 *     { day_of_week: 1, start_time: "10:00", end_time: "18:00" },
 *     { day_of_week: 2, start_time: "10:00", end_time: "18:00" },
 *   ]
 * }
 */
async function replaceWeeklyAvailability({ partnerId, windows }) {
  if (!Array.isArray(windows)) throw httpError("windows must be an array", 400);

  // Validate structure
  for (const w of windows) {
    const dow = Number(w.day_of_week);
    if (!Number.isInteger(dow) || dow < 0 || dow > 6)
      throw httpError("Invalid day_of_week", 400);
    if (!w.start_time || !w.end_time)
      throw httpError("start_time and end_time required", 400);
    if (String(w.start_time) >= String(w.end_time))
      throw httpError("start_time must be < end_time", 400);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM partner_weekly_availability WHERE partner_id=$1",
      [partnerId],
    );

    for (const w of windows) {
      await client.query(
        `INSERT INTO partner_weekly_availability (partner_id, day_of_week, start_time, end_time)
         VALUES ($1,$2,$3,$4)`,
        [partnerId, w.day_of_week, w.start_time, w.end_time],
      );
    }

    await client.query("COMMIT");

    const out = await pool.query(
      `SELECT id, day_of_week, start_time, end_time
       FROM partner_weekly_availability
       WHERE partner_id=$1
       ORDER BY day_of_week, start_time`,
      [partnerId],
    );
    return out.rows;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function upsertPartnerSettings({
  partnerId,
  slotDurationMinutes,
  timezone,
}) {
  if (slotDurationMinutes != null) {
    const n = Number(slotDurationMinutes);
    if (!Number.isInteger(n) || n < 5 || n > 180) {
      throw httpError(
        "slot_duration_minutes must be an integer between 5 and 180",
        400,
      );
    }
  }
  if (timezone != null && typeof timezone !== "string")
    throw httpError("timezone must be a string", 400);

  const cur = await getPartnerSettings(partnerId);
  const duration =
    slotDurationMinutes != null
      ? Number(slotDurationMinutes)
      : cur.slot_duration_minutes;
  const tz = timezone != null ? String(timezone) : cur.timezone;

  const r = await pool.query(
    `INSERT INTO partner_settings (partner_id, slot_duration_minutes, timezone, updated_at)
     VALUES ($1,$2,$3,NOW())
     ON CONFLICT (partner_id)
     DO UPDATE SET slot_duration_minutes=EXCLUDED.slot_duration_minutes, timezone=EXCLUDED.timezone, updated_at=NOW()
     RETURNING partner_id, slot_duration_minutes, timezone`,
    [partnerId, duration, tz],
  );

  return r.rows[0];
}

async function addTimeOff({ partnerId, startAt, endAt, reason }) {
  const start = parseISOorThrow(startAt, "Invalid start_at");
  const end = parseISOorThrow(endAt, "Invalid end_at");
  if (end <= start) throw httpError("end_at must be after start_at", 400);

  const r = await pool.query(
    `INSERT INTO partner_time_off (partner_id, start_at, end_at, reason)
     VALUES ($1,$2,$3,$4)
     RETURNING *`,
    [partnerId, start.toISO(), end.toISO(), reason || null],
  );
  return r.rows[0];
}

async function listPartnerAppointments({
  partnerId,
  from,
  to,
  status,
  page,
  limit,
}) {
  const p = Math.max(1, Number(page || 1));
  const l = Math.min(100, Math.max(1, Number(limit || 20)));
  const offset = (p - 1) * l;

  const where = ["partner_id=$1"];
  const params = [partnerId];
  let idx = params.length;

  if (status) {
    idx += 1;
    where.push(`status=$${idx}`);
    params.push(String(status));
  }
  if (from) {
    idx += 1;
    where.push(`start_at >= $${idx}`);
    params.push(parseISOorThrow(from, "Invalid from").toISO());
  }
  if (to) {
    idx += 1;
    where.push(`start_at < $${idx}`);
    params.push(parseISOorThrow(to, "Invalid to").toISO());
  }

  const sql = `
    SELECT *
    FROM appointments
    WHERE ${where.join(" AND ")}
    ORDER BY start_at DESC
    LIMIT ${l} OFFSET ${offset}
  `;
  const rows = (await pool.query(sql, params)).rows;

  return { page: p, limit: l, appointments: rows };
}

async function listMyAppointments({ clientId, from, to, status, page, limit }) {
  const p = Math.max(1, Number(page || 1));
  const l = Math.min(100, Math.max(1, Number(limit || 20)));
  const offset = (p - 1) * l;

  const where = ["client_id=$1"];
  const params = [clientId];
  let idx = params.length;

  if (status) {
    idx += 1;
    where.push(`status=$${idx}`);
    params.push(String(status));
  }
  if (from) {
    idx += 1;
    where.push(`start_at >= $${idx}`);
    params.push(parseISOorThrow(from, "Invalid from").toISO());
  }
  if (to) {
    idx += 1;
    where.push(`start_at < $${idx}`);
    params.push(parseISOorThrow(to, "Invalid to").toISO());
  }

  const sql = `
    SELECT *
    FROM appointments
    WHERE ${where.join(" AND ")}
    ORDER BY start_at DESC
    LIMIT ${l} OFFSET ${offset}
  `;
  const rows = (await pool.query(sql, params)).rows;

  return { page: p, limit: l, appointments: rows };
}

async function fetchDayAvailabilityWindows(partnerId, dayOfWeek) {
  const r = await pool.query(
    `SELECT start_time, end_time
     FROM partner_weekly_availability
     WHERE partner_id=$1 AND day_of_week=$2
     ORDER BY start_time`,
    [partnerId, dayOfWeek],
  );
  return r.rows;
}

async function fetchDayTimeOff(partnerId, dayStartISO, dayEndISO) {
  const r = await pool.query(
    `SELECT start_at, end_at
     FROM partner_time_off
     WHERE partner_id=$1
       AND start_at < $3
       AND end_at > $2`,
    [partnerId, dayStartISO, dayEndISO],
  );
  return r.rows;
}

async function fetchDayBooked(partnerId, dayStartISO, dayEndISO) {
  const r = await pool.query(
    `SELECT start_at, end_at, status
     FROM appointments
     WHERE partner_id=$1
       AND status IN ('pending','accepted')
       AND start_at < $3
       AND end_at > $2`,
    [partnerId, dayStartISO, dayEndISO],
  );
  return r.rows;
}

function toDT(v, zone = null) {
  if (!v) return null;

  // pg may return TIMESTAMPTZ as JS Date
  if (v instanceof Date) {
    const dt = DateTime.fromJSDate(v, { zone: "utc" });
    return zone ? dt.setZone(zone) : dt;
  }

  const raw = String(v).trim();
  if (!raw) return null;

  const dt = DateTime.fromISO(raw, { setZone: true });
  if (!dt.isValid) return null;

  return zone ? dt.setZone(zone) : dt;
}

function overlapsAny(slotStart, slotEnd, ranges, tz = null) {
  const slot = Interval.fromDateTimes(slotStart, slotEnd);

  for (const r of ranges) {
    // support both shapes:
    // {start_at, end_at} from DB
    // OR {start, end} custom
    const a = toDT(r.start_at ?? r.start, tz);
    const b = toDT(r.end_at ?? r.end, tz);
    if (!a || !b) continue;

    const it = Interval.fromDateTimes(a, b);
    if (slot.overlaps(it)) return true;
  }
  return false;
}

async function getPartnerSlotsByDate({ partnerId, date }) {
  await assertPartnerUser(partnerId);

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
    throw httpError("date is required in YYYY-MM-DD format", 400);
  }

  const settings = await getPartnerSettings(partnerId);
  const duration = Number(settings.slot_duration_minutes || 10);
  const tz = settings.timezone || "Asia/Kolkata";

  const day = DateTime.fromISO(date, { zone: tz });
  if (!day.isValid) throw httpError("Invalid date", 400);

  // Luxon: weekday is 1..7 (Mon..Sun). Convert to 0..6 (Sun..Sat)
  const dow0 = day.weekday === 7 ? 0 : day.weekday;

  const windows = await fetchDayAvailabilityWindows(partnerId, dow0);

  const dayStart = day.startOf("day");
  const dayEnd = day.endOf("day");

  const timeOff = await fetchDayTimeOff(
    partnerId,
    dayStart.toISO(),
    dayEnd.toISO(),
  );
  const booked = await fetchDayBooked(
    partnerId,
    dayStart.toISO(),
    dayEnd.toISO(),
  );

  // Generate slots inside each window
  const slots = [];

  for (const w of windows) {
    const [sh, sm] = String(w.start_time).split(":").map(Number);
    const [eh, em] = String(w.end_time).split(":").map(Number);

    let cursor = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
    const windowEnd = day.set({
      hour: eh,
      minute: em,
      second: 0,
      millisecond: 0,
    });

    while (cursor.plus({ minutes: duration }) <= windowEnd) {
      const slotStart = cursor;
      const slotEnd = cursor.plus({ minutes: duration });

      const isTimeOff = overlapsAny(slotStart, slotEnd, timeOff);
      const isBooked = overlapsAny(slotStart, slotEnd, booked);

      const isAvailable = !isTimeOff && !isBooked;

      // ✅ IMPORTANT:
      // We now return ALL slots (available + blocked) so `is_booked` is meaningful.
      slots.push({
        start_at: slotStart.toUTC().toISO(),
        end_at: slotEnd.toUTC().toISO(),
        start_local: slotStart.toISO(),
        end_local: slotEnd.toISO(),
        timezone: tz,
        minutes: duration,

        // ✅ new keys
        is_booked: isBooked,
        is_available: isAvailable,
        blocked_reason: !isAvailable
          ? isBooked
            ? "booked"
            : "time_off"
          : null,
      });

      cursor = cursor.plus({ minutes: duration });
    }
  }

  return {
    partner_id: Number(partnerId),
    date,
    timezone: tz,
    slot_duration_minutes: duration,
    slots,
  };
}

async function validateSlotAllowed({ partnerId, startUTC, endUTC }) {
  const settings = await getPartnerSettings(partnerId);
  const tz = settings.timezone || "Asia/Kolkata";

  // Convert slot into partner local day and check weekly windows
  const startLocal = DateTime.fromISO(startUTC, { zone: "utc" }).setZone(tz);
  const endLocal = DateTime.fromISO(endUTC, { zone: "utc" }).setZone(tz);

  if (!startLocal.isValid || !endLocal.isValid)
    throw httpError("Invalid slot times", 400);

  const dow0 = startLocal.weekday === 7 ? 0 : startLocal.weekday;

  const windows = await fetchDayAvailabilityWindows(partnerId, dow0);
  if (!windows.length)
    throw httpError("Partner not available on selected day", 400);

  // Must fit in at least one window
  let fits = false;
  for (const w of windows) {
    const [sh, sm] = String(w.start_time).split(":").map(Number);
    const [eh, em] = String(w.end_time).split(":").map(Number);

    const winStart = startLocal.startOf("day").set({ hour: sh, minute: sm });
    const winEnd = startLocal.startOf("day").set({ hour: eh, minute: em });

    if (startLocal >= winStart && endLocal <= winEnd) {
      fits = true;
      break;
    }
  }
  if (!fits) throw httpError("Slot is outside partner availability", 400);

  // Check time off overlap quickly
  const timeOff = await pool.query(
    `SELECT 1
     FROM partner_time_off
     WHERE partner_id=$1 AND start_at < $3 AND end_at > $2
     LIMIT 1`,
    [partnerId, startUTC, endUTC],
  );
  if (timeOff.rows[0])
    throw httpError("Partner is not available on this slot", 400);
}

async function createAppointment({ clientId, partnerId, startAt, clientNote }) {
  await assertPartnerUser(partnerId);

  const settings = await getPartnerSettings(partnerId);
  const duration = Number(settings.slot_duration_minutes || 10);

  const start = parseISOorThrow(startAt, "Invalid start_at").toUTC();
  const end = start.plus({ minutes: duration });

  // Validate against availability + time off (DB still guarantees overlap prevention)
  await validateSlotAllowed({
    partnerId,
    startUTC: start.toISO(),
    endUTC: end.toISO(),
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const ins = await client.query(
      `INSERT INTO appointments (client_id, partner_id, start_at, end_at, slot_duration_minutes, client_note)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [
        clientId,
        partnerId,
        start.toISO(),
        end.toISO(),
        duration,
        clientNote || null,
      ],
    );

    await client.query("COMMIT");
    return ins.rows[0];
  } catch (e) {
    await client.query("ROLLBACK");
    // overlap violation from exclusion constraint
    if (e.code === "23P01") throw httpError("Slot already booked", 409);
    throw e;
  } finally {
    client.release();
  }
}

async function respondAsPartner({ partnerId, appointmentId, action, note }) {
  const normalized = String(action || "")
    .toLowerCase()
    .trim();
  if (!["accept", "reject"].includes(normalized))
    throw httpError("Invalid action", 400);

  const newStatus = normalized === "accept" ? "accepted" : "rejected";

  const r = await pool.query(
    `UPDATE appointments
     SET status=$1, partner_note=$2, updated_at=NOW()
     WHERE id=$3 AND partner_id=$4 AND status='pending'
     RETURNING *`,
    [newStatus, note || null, appointmentId, partnerId],
  );

  if (!r.rows[0]) throw httpError("Appointment not found or not pending", 404);
  return r.rows[0];
}

async function cancelAsClient({ clientId, appointmentId }) {
  const r = await pool.query(
    `UPDATE appointments
     SET status='cancelled_by_client', updated_at=NOW()
     WHERE id=$1 AND client_id=$2 AND status IN ('pending','accepted')
     RETURNING *`,
    [appointmentId, clientId],
  );
  if (!r.rows[0])
    throw httpError("Appointment not found or cannot cancel", 404);
  return r.rows[0];
}

async function cancelAsPartner({ partnerId, appointmentId, note }) {
  const r = await pool.query(
    `UPDATE appointments
     SET status='cancelled_by_partner', partner_note=COALESCE($3, partner_note), updated_at=NOW()
     WHERE id=$1 AND partner_id=$2 AND status IN ('pending','accepted')
     RETURNING *`,
    [appointmentId, partnerId, note || null],
  );
  if (!r.rows[0])
    throw httpError("Appointment not found or cannot cancel", 404);
  return r.rows[0];
}

// services/appointmentsService.js (ADD these functions)

// Read settings (returns default if none in DB)
async function getPartnerSettingsService({ partnerId }) {
  const out = await getPartnerSettings(partnerId); // uses existing internal helper in this file
  return {
    partner_id: Number(partnerId),
    slot_duration_minutes: Number(out.slot_duration_minutes || 10),
    timezone: out.timezone || "Asia/Kolkata",
  };
}

// Read weekly availability windows
async function getWeeklyAvailability({ partnerId }) {
  const r = await pool.query(
    `SELECT id, day_of_week, start_time, end_time
     FROM partner_weekly_availability
     WHERE partner_id=$1
     ORDER BY day_of_week, start_time`,
    [partnerId],
  );
  return r.rows;
}

// List time off blocks (paged)
async function listTimeOff({ partnerId, from, to, page, limit }) {
  const p = Math.max(1, Number(page || 1));
  const l = Math.min(100, Math.max(1, Number(limit || 20)));
  const offset = (p - 1) * l;

  const where = ["partner_id=$1"];
  const params = [partnerId];
  let idx = 1;

  if (from) {
    idx += 1;
    where.push(`start_at >= $${idx}`);
    params.push(parseISOorThrow(from, "Invalid from").toISO());
  }

  if (to) {
    idx += 1;
    where.push(`end_at <= $${idx}`);
    params.push(parseISOorThrow(to, "Invalid to").toISO());
  }

  const sql = `
    SELECT id, partner_id, start_at, end_at, reason, created_at
    FROM partner_time_off
    WHERE ${where.join(" AND ")}
    ORDER BY start_at DESC
    LIMIT ${l} OFFSET ${offset}
  `;

  const rows = (await pool.query(sql, params)).rows;

  return { page: p, limit: l, time_off: rows };
}

async function deleteTimeOff({ partnerId, timeOffId }) {
  const id = Number(timeOffId);
  if (!Number.isInteger(id) || id <= 0)
    throw httpError("Invalid time-off id", 400);

  const r = await pool.query(
    `DELETE FROM partner_time_off
     WHERE id=$1 AND partner_id=$2
     RETURNING id`,
    [id, partnerId],
  );

  if (!r.rows[0]) throw httpError("Time-off not found", 404);

  return { deleted: true, id };
}

async function updateTimeOff({ partnerId, timeOffId, startAt, endAt, reason }) {
  const id = Number(timeOffId);
  if (!Number.isInteger(id) || id <= 0)
    throw httpError("Invalid time-off id", 400);

  // Require both start/end for update (simple and predictable)
  const start = parseISOorThrow(startAt, "Invalid start_at");
  const end = parseISOorThrow(endAt, "Invalid end_at");
  if (end <= start) throw httpError("end_at must be after start_at", 400);

  const r = await pool.query(
    `UPDATE partner_time_off
     SET start_at=$1, end_at=$2, reason=$3, updated_at=NOW()
     WHERE id=$4 AND partner_id=$5
     RETURNING id, partner_id, start_at, end_at, reason, created_at, updated_at`,
    [start.toISO(), end.toISO(), reason || null, id, partnerId],
  );

  if (!r.rows[0]) throw httpError("Time-off not found", 404);

  return r.rows[0];
}

async function getPartnerAvailableDaysInMonth({ partnerId, month }) {
  await assertPartnerUser(partnerId);

  const m = String(month || "").trim();
  if (!/^\d{4}-\d{2}$/.test(m)) {
    throw httpError("month is required in YYYY-MM format", 400);
  }

  const settings = await getPartnerSettings(partnerId);
  const duration = Number(settings.slot_duration_minutes || 10);
  const tz = settings.timezone || "Asia/Kolkata";

  const monthStart = DateTime.fromISO(`${m}-01`, { zone: tz }).startOf("day");
  if (!monthStart.isValid) throw httpError("Invalid month", 400);

  const monthEnd = monthStart.endOf("month").endOf("day");

  // Weekly windows for partner (all days)
  const windowsRes = await pool.query(
    `SELECT day_of_week, start_time, end_time
     FROM partner_weekly_availability
     WHERE partner_id=$1
     ORDER BY day_of_week, start_time`,
    [partnerId],
  );

  const windowsByDow = new Map(); // dow -> [{start_time,end_time}]
  for (const row of windowsRes.rows) {
    const dow = Number(row.day_of_week);
    if (!windowsByDow.has(dow)) windowsByDow.set(dow, []);
    windowsByDow.get(dow).push(row);
  }

  // Time-off blocks for whole month (single query)
  const timeOffRes = await pool.query(
    `SELECT start_at, end_at
     FROM partner_time_off
     WHERE partner_id=$1
       AND start_at < $3
       AND end_at > $2`,
    [partnerId, monthStart.toISO(), monthEnd.toISO()],
  );

  // Booked (pending/accepted) for whole month (single query)
  const bookedRes = await pool.query(
    `SELECT start_at, end_at
     FROM appointments
     WHERE partner_id=$1
       AND status IN ('pending','accepted')
       AND start_at < $3
       AND end_at > $2`,
    [partnerId, monthStart.toISO(), monthEnd.toISO()],
  );

  const timeOffAll = timeOffRes.rows || [];
  const bookedAll = bookedRes.rows || [];

  const availableDays = [];
  const unavailableDays = [];

  // Iterate days in partner TZ
  let day = monthStart;
  while (day <= monthEnd) {
    const dow0 = day.weekday === 7 ? 0 : day.weekday;
    const dayISO = day.toFormat("yyyy-LL-dd");

    const windows = windowsByDow.get(dow0) || [];
    if (!windows.length) {
      unavailableDays.push(dayISO);
      day = day.plus({ days: 1 });
      continue;
    }

    const dayStart = day.startOf("day");
    const dayEndLocal = day.endOf("day");

    // Filter month ranges to just this day (cheap enough for ~31 days)
    const timeOff = timeOffAll.filter((r) => {
      const a = DateTime.fromISO(r.start_at, { setZone: true }).setZone(tz);
      const b = DateTime.fromISO(r.end_at, { setZone: true }).setZone(tz);
      return a < dayEndLocal && b > dayStart;
    });

    const booked = bookedAll.filter((r) => {
      const a = DateTime.fromISO(r.start_at, { setZone: true }).setZone(tz);
      const b = DateTime.fromISO(r.end_at, { setZone: true }).setZone(tz);
      return a < dayEndLocal && b > dayStart;
    });

    // Find if at least 1 slot exists that isn't blocked
    let hasAnyAvailableSlot = false;

    for (const w of windows) {
      const [sh, sm] = String(w.start_time).split(":").map(Number);
      const [eh, em] = String(w.end_time).split(":").map(Number);

      let cursor = day.set({ hour: sh, minute: sm, second: 0, millisecond: 0 });
      const windowEnd = day.set({
        hour: eh,
        minute: em,
        second: 0,
        millisecond: 0,
      });

      while (cursor.plus({ minutes: duration }) <= windowEnd) {
        const slotStart = cursor;
        const slotEnd = cursor.plus({ minutes: duration });

        const isTimeOff = overlapsAnyBool(slotStart, slotEnd, timeOff);
        const isBooked = overlapsAnyBool(slotStart, slotEnd, booked);

        if (!isTimeOff && !isBooked) {
          hasAnyAvailableSlot = true;
          break;
        }

        cursor = cursor.plus({ minutes: duration });
      }

      if (hasAnyAvailableSlot) break;
    }

    if (hasAnyAvailableSlot) availableDays.push(dayISO);
    else unavailableDays.push(dayISO);

    day = day.plus({ days: 1 });
  }

  return {
    partner_id: Number(partnerId),
    month: m,
    timezone: tz,
    slot_duration_minutes: duration,
    available_days: availableDays,
    unavailable_days: unavailableDays,
  };
}

module.exports = {
  upsertPartnerSettings,
  replaceWeeklyAvailability,
  addTimeOff,
  listPartnerAppointments,
  getPartnerSlotsByDate,
  createAppointment,
  listMyAppointments,
  cancelAsClient,
  respondAsPartner,
  cancelAsPartner,
  getPartnerSettings: getPartnerSettingsService,
  getWeeklyAvailability,
  listTimeOff,
  deleteTimeOff,
  updateTimeOff,
  getPartnerAvailableDaysInMonth,
};
