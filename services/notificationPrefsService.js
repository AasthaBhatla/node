// services/notificationPrefsService.js
const pool = require("../db");

const KEY_PAUSE_ALL = "notif_pause_all";
const KEY_MUTED_SCOPES = "notif_muted_scopes";

function defaultPrefs() {
  return { pause_all: false, muted_scopes: [] };
}

function isTruthy(v) {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function normalizeScope(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ".")
    .replace(/[^a-z0-9.]/g, "")
    .replace(/\.+/g, ".")
    .replace(/^\./, "")
    .replace(/\.$/, "");
}

function parseMutedScopes(v) {
  if (v == null) return [];

  // already an array (jsonb can come back as array in some setups)
  if (Array.isArray(v)) {
    return Array.from(new Set(v.map(normalizeScope).filter(Boolean)));
  }

  // object (rare, but handle safely)
  if (typeof v === "object") {
    // if it’s { muted_scopes: [...] }
    if (Array.isArray(v.muted_scopes)) {
      return Array.from(
        new Set(v.muted_scopes.map(normalizeScope).filter(Boolean)),
      );
    }
    return [];
  }

  const s = String(v).trim();
  if (!s) return [];

  // Try JSON parse first
  try {
    const parsed = JSON.parse(s);

    if (Array.isArray(parsed)) {
      return Array.from(new Set(parsed.map(normalizeScope).filter(Boolean)));
    }

    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray(parsed.muted_scopes)
    ) {
      return Array.from(
        new Set(parsed.muted_scopes.map(normalizeScope).filter(Boolean)),
      );
    }
  } catch {
    // ignore
  }

  // Fallback: CSV / space separated
  const parts = s
    .split(/[,\n\r\t ]+/g)
    .map(normalizeScope)
    .filter(Boolean);
  return Array.from(new Set(parts));
}

/**
 * Hierarchical mute check:
 * - muted "marketing" blocks "marketing.shopping"
 * - muted "marketing.shopping" blocks that subtree only
 */
function isEventMuted(eventKey, mutedScopes = []) {
  const ek = normalizeScope(eventKey);
  if (!ek) return false;

  const scopes = Array.isArray(mutedScopes) ? mutedScopes : [];
  for (const raw of scopes) {
    const scope = normalizeScope(raw);
    if (!scope) continue;

    if (ek === scope) return true;
    if (ek.startsWith(scope + ".")) return true;
  }
  return false;
}

/**
 * Returns a Map(user_id -> prefs)
 * ✅ Important: always includes all requested userIds with defaults, even if no rows exist.
 */
async function getPrefsMapByUserIds(userIds = []) {
  const ids = (Array.isArray(userIds) ? userIds : [])
    .map((x) => parseInt(x, 10))
    .filter(Number.isFinite);

  if (!ids.length) return new Map();

  // ✅ pre-seed defaults so map is never empty / missing userId
  const map = new Map(ids.map((uid) => [uid, defaultPrefs()]));

  const keys = [KEY_PAUSE_ALL, KEY_MUTED_SCOPES];

  const { rows } = await pool.query(
    `
    SELECT user_id, key, value
    FROM user_metadata
    WHERE user_id = ANY($1::int[])
      AND key = ANY($2::text[])
    `,
    [ids, keys],
  );

  for (const r of rows) {
    const uid = Number(r.user_id);
    if (!map.has(uid)) map.set(uid, defaultPrefs());
    const prefs = map.get(uid);

    if (r.key === KEY_PAUSE_ALL) prefs.pause_all = isTruthy(r.value);
    if (r.key === KEY_MUTED_SCOPES)
      prefs.muted_scopes = parseMutedScopes(r.value);
  }

  return map;
}

/**
 * Upsert prefs for one user.
 * - pause_all stored as "1" or "0"
 * - muted_scopes stored as JSON string: ["marketing","expert_connect"]
 */
async function setPrefs(userId, { pause_all = false, muted_scopes = [] } = {}) {
  const uid = parseInt(userId, 10);
  if (!Number.isFinite(uid) || uid < 1) throw new Error("Invalid userId");

  const pauseVal = pause_all === true ? "1" : "0";
  const scopesArr = Array.isArray(muted_scopes)
    ? muted_scopes.map(normalizeScope).filter(Boolean)
    : [];

  const scopesVal = JSON.stringify(Array.from(new Set(scopesArr)));

  await pool.query(
    `
    INSERT INTO user_metadata (user_id, key, value)
    VALUES
      ($1, $2, $3),
      ($1, $4, $5)
    ON CONFLICT (user_id, key)
    DO UPDATE SET value = EXCLUDED.value
    `,
    [uid, KEY_PAUSE_ALL, pauseVal, KEY_MUTED_SCOPES, scopesVal],
  );

  return { pause_all: pause_all === true, muted_scopes: JSON.parse(scopesVal) };
}

module.exports = {
  KEY_PAUSE_ALL,
  KEY_MUTED_SCOPES,
  defaultPrefs,
  isTruthy,
  normalizeScope,
  parseMutedScopes,
  isEventMuted,
  getPrefsMapByUserIds,
  setPrefs,
};
