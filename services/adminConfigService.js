const pool = require("../db");

const CONFIG_KEY = "main";
const ALLOWED_META_TYPES = [
  "text",
  "textarea",
  "date",
  "file",
  "image",
  "select",
  "radio",
  "checkbox",
  "editor",
  "json",
];

const DEFAULT_PARTNER_PLATFORM_STATUS = {
  enabled: true,
  title: "Live Platform Status",
  status_label: "LIVE",
  update_text: "Update 5 mins ago",
  metrics: [
    {
      key: "tasks_available",
      value: "1,250",
      suffix: "↑",
      label: "Tasks available",
      tone: "blue",
    },
    {
      key: "tasks_active",
      value: "4,370",
      suffix: "↑",
      label: "Tasks active",
      tone: "orange",
    },
    {
      key: "tasks_estimated",
      value: "₹1,23,684/-",
      suffix: "↑",
      label: "Tasks Estimated",
      tone: "purple",
    },
    {
      key: "average_earning",
      value: "₹25,000/-",
      suffix: "↑",
      label: "Average Earning",
      tone: "teal",
    },
  ],
};

let ensureTablePromise = null;

function getDefaultConfig() {
  return {
    post_types: [],
    taxonomies: [],
    users: {
      role: [],
      status: [],
      meta_keys: [],
    },
    reviews: {
      meta_keys: [],
    },
    partner_platform_status: DEFAULT_PARTNER_PLATFORM_STATUS,
    posts: [],
  };
}

function sanitizeSlug(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\-_]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toIsoLikeDate(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeMetaKeys(metaKeys) {
  return (Array.isArray(metaKeys) ? metaKeys : [])
    .filter((meta) => meta && typeof meta === "object")
    .map((meta) => {
      const key = String(meta.key || "")
        .trim()
        .replace(/[^a-zA-Z0-9_\-]/g, "");
      const type = String(meta.type || "text").trim();

      if (!key || !ALLOWED_META_TYPES.includes(type)) {
        return null;
      }

      const record = {
        key,
        type,
      };

      if (Array.isArray(meta.values)) {
        const values = meta.values
          .map((value) => String(value || "").trim())
          .filter(Boolean);
        if (values.length > 0) {
          record.values = values;
        }
      }

      if (meta.required) {
        record.required = true;
      }

      return record;
    })
    .filter(Boolean);
}

function normalizePostTypes(postTypes) {
  return (Array.isArray(postTypes) ? postTypes : [])
    .filter((postType) => postType && typeof postType === "object")
    .map((postType) => {
      const title = String(postType.title || "").trim();
      const slug = sanitizeSlug(postType.slug || title);
      if (!title || !slug) {
        return null;
      }

      return {
        title,
        slug,
        meta_keys: normalizeMetaKeys(postType.meta_keys),
        created_at: toIsoLikeDate(postType.created_at, new Date().toISOString()),
        updated_at: toIsoLikeDate(postType.updated_at, new Date().toISOString()),
      };
    })
    .filter(Boolean);
}

function normalizeTaxonomies(taxonomies) {
  return (Array.isArray(taxonomies) ? taxonomies : [])
    .filter((taxonomy) => taxonomy && typeof taxonomy === "object")
    .map((taxonomy) => {
      const id = taxonomy.id;
      const title = String(taxonomy.title || "").trim();
      const slug = sanitizeSlug(taxonomy.slug || title);

      if ((id === undefined || id === null || id === "") || !title || !slug) {
        return null;
      }

      return {
        id,
        title,
        slug,
        meta_keys: normalizeMetaKeys(taxonomy.meta_keys),
        apply_to: (Array.isArray(taxonomy.apply_to) ? taxonomy.apply_to : [])
          .map((item) => String(item || "").trim())
          .filter(Boolean),
        created_at: toIsoLikeDate(taxonomy.created_at, new Date().toISOString()),
        updated_at: toIsoLikeDate(taxonomy.updated_at, new Date().toISOString()),
      };
    })
    .filter(Boolean);
}

function normalizeUsersConfig(users) {
  const source = users && typeof users === "object" ? users : {};
  return {
    role: (Array.isArray(source.role) ? source.role : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
    status: (Array.isArray(source.status) ? source.status : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
    meta_keys: normalizeMetaKeys(source.meta_keys),
  };
}

function normalizeReviewsConfig(reviews) {
  const source = reviews && typeof reviews === "object" ? reviews : {};
  return {
    meta_keys: normalizeMetaKeys(source.meta_keys),
  };
}

function normalizePartnerPlatformMetric(metric, index) {
  const fallback =
    DEFAULT_PARTNER_PLATFORM_STATUS.metrics[index] ||
    DEFAULT_PARTNER_PLATFORM_STATUS.metrics[0];
  const source = metric && typeof metric === "object" ? metric : {};
  const key = sanitizeSlug(source.key || fallback.key).replace(/-/g, "_");
  const value = String(source.value ?? fallback.value ?? "").trim();
  const label = String(source.label ?? fallback.label ?? "").trim();
  const suffix = String(source.suffix ?? fallback.suffix ?? "").trim();
  const tone = String(source.tone ?? fallback.tone ?? "blue").trim();

  return {
    key: key || fallback.key,
    value,
    suffix,
    label,
    tone,
  };
}

function normalizePartnerPlatformStatus(status) {
  const source = status && typeof status === "object" ? status : {};
  const metrics = Array.isArray(source.metrics)
    ? source.metrics
    : DEFAULT_PARTNER_PLATFORM_STATUS.metrics;
  const normalizedMetrics = DEFAULT_PARTNER_PLATFORM_STATUS.metrics.map((fallback, index) =>
    normalizePartnerPlatformMetric(metrics[index] || fallback, index),
  );

  return {
    enabled: source.enabled === undefined ? true : source.enabled !== false,
    title: String(source.title || DEFAULT_PARTNER_PLATFORM_STATUS.title).trim(),
    status_label: String(
      source.status_label || DEFAULT_PARTNER_PLATFORM_STATUS.status_label,
    ).trim(),
    update_text: String(
      source.update_text || DEFAULT_PARTNER_PLATFORM_STATUS.update_text,
    ).trim(),
    metrics: normalizedMetrics,
  };
}

function normalizeAdminConfig(config) {
  const source = config && typeof config === "object" ? config : {};
  return {
    post_types: normalizePostTypes(source.post_types),
    taxonomies: normalizeTaxonomies(source.taxonomies),
    users: normalizeUsersConfig(source.users),
    reviews: normalizeReviewsConfig(source.reviews),
    partner_platform_status: normalizePartnerPlatformStatus(
      source.partner_platform_status,
    ),
    posts: Array.isArray(source.posts) ? source.posts : [],
  };
}

async function ensureAdminConfigTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = pool.query(`
      CREATE TABLE IF NOT EXISTS admin_panel_configs (
        config_key VARCHAR(50) PRIMARY KEY,
        config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
        version INT NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_by_user_id INT REFERENCES users(id) ON DELETE SET NULL
      );
    `);
  }

  await ensureTablePromise;
}

async function readConfigRow() {
  await ensureAdminConfigTable();
  const result = await pool.query(
    `SELECT config_json, version, updated_at, updated_by_user_id
     FROM admin_panel_configs
     WHERE config_key = $1
     LIMIT 1`,
    [CONFIG_KEY],
  );
  return result.rows[0] || null;
}

async function writeConfig(config, adminUser) {
  await ensureAdminConfigTable();
  const normalized = normalizeAdminConfig(config);
  const result = await pool.query(
    `
      INSERT INTO admin_panel_configs (config_key, config_json, version, updated_at, updated_by_user_id)
      VALUES ($1, $2::jsonb, 1, CURRENT_TIMESTAMP, $3)
      ON CONFLICT (config_key)
      DO UPDATE SET
        config_json = EXCLUDED.config_json,
        version = admin_panel_configs.version + 1,
        updated_at = CURRENT_TIMESTAMP,
        updated_by_user_id = EXCLUDED.updated_by_user_id
      RETURNING config_json, version, updated_at, updated_by_user_id
    `,
    [
      CONFIG_KEY,
      JSON.stringify(normalized),
      adminUser && adminUser.id !== undefined && adminUser.id !== null
        ? Number(adminUser.id)
        : null,
    ],
  );

  return {
    config: normalizeAdminConfig(result.rows[0]?.config_json || {}),
    version: Number(result.rows[0]?.version || 1),
    updated_at: result.rows[0]?.updated_at || null,
    updated_by_user_id:
      result.rows[0]?.updated_by_user_id === undefined || result.rows[0]?.updated_by_user_id === null
        ? null
        : Number(result.rows[0].updated_by_user_id),
  };
}

async function getAdminConfig() {
  const row = await readConfigRow();
  const config = row ? normalizeAdminConfig(row.config_json || {}) : getDefaultConfig();

  return {
    ...config,
    _meta: {
      version: Number(row?.version || 0),
      updated_at: row?.updated_at || null,
      updated_by_user_id:
        row?.updated_by_user_id === undefined || row?.updated_by_user_id === null
          ? null
          : Number(row.updated_by_user_id),
    },
  };
}

async function importAdminConfig(config, adminUser) {
  return writeConfig(config, adminUser);
}

async function savePostType({ title, slug, previousSlug, adminUser }) {
  const configResponse = await getAdminConfig();
  const config = normalizeAdminConfig(configResponse);
  const safeTitle = String(title || "").trim();
  const safeSlug = sanitizeSlug(slug);
  const safePreviousSlug = sanitizeSlug(previousSlug);

  if (!safeTitle || !safeSlug) {
    const error = new Error("Title and slug are required");
    error.statusCode = 422;
    throw error;
  }

  const existingIndex = config.post_types.findIndex((postType) =>
    postType.slug === (safePreviousSlug || safeSlug),
  );

  const duplicateIndex = config.post_types.findIndex((postType) => postType.slug === safeSlug);
  if (duplicateIndex >= 0 && duplicateIndex !== existingIndex) {
    const error = new Error("A post type with this slug already exists");
    error.statusCode = 409;
    throw error;
  }

  const now = new Date().toISOString();
  const record = {
    title: safeTitle,
    slug: safeSlug,
    meta_keys:
      existingIndex >= 0 ? config.post_types[existingIndex].meta_keys || [] : [],
    created_at:
      existingIndex >= 0 ? config.post_types[existingIndex].created_at || now : now,
    updated_at: now,
  };

  if (existingIndex >= 0) {
    config.post_types[existingIndex] = record;
  } else {
    config.post_types.push(record);
  }

  await writeConfig(config, adminUser);
  return record;
}

async function deletePostType(slug, adminUser) {
  const safeSlug = sanitizeSlug(slug);
  const configResponse = await getAdminConfig();
  const config = normalizeAdminConfig(configResponse);
  const nextPostTypes = config.post_types.filter((postType) => postType.slug !== safeSlug);

  if (nextPostTypes.length === config.post_types.length) {
    const error = new Error("Post type not found");
    error.statusCode = 404;
    throw error;
  }

  config.post_types = nextPostTypes;
  await writeConfig(config, adminUser);
  return { success: true };
}

async function savePostTypeMeta(slug, metaKeys, adminUser) {
  const safeSlug = sanitizeSlug(slug);
  const configResponse = await getAdminConfig();
  const config = normalizeAdminConfig(configResponse);
  const index = config.post_types.findIndex((postType) => postType.slug === safeSlug);

  if (index < 0) {
    const error = new Error("Post type not found");
    error.statusCode = 404;
    throw error;
  }

  config.post_types[index].meta_keys = normalizeMetaKeys(metaKeys);
  config.post_types[index].updated_at = new Date().toISOString();
  await writeConfig(config, adminUser);
  return config.post_types[index];
}

async function saveTaxonomy(taxonomy, adminUser) {
  const configResponse = await getAdminConfig();
  const config = normalizeAdminConfig(configResponse);
  const id = taxonomy?.id;
  const title = String(taxonomy?.title || "").trim();
  const slug = sanitizeSlug(taxonomy?.slug || title);

  if ((id === undefined || id === null || id === "") || !title || !slug) {
    const error = new Error("Taxonomy id, title, and slug are required");
    error.statusCode = 422;
    throw error;
  }

  const now = new Date().toISOString();
  const index = config.taxonomies.findIndex((item) => String(item.id) === String(id));
  const record = {
    id,
    title,
    slug,
    meta_keys:
      index >= 0 ? config.taxonomies[index].meta_keys || [] : normalizeMetaKeys(taxonomy?.meta_keys),
    apply_to: (Array.isArray(taxonomy?.apply_to) ? taxonomy.apply_to : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean),
    created_at: index >= 0 ? config.taxonomies[index].created_at || now : now,
    updated_at: now,
  };

  if (index >= 0) {
    config.taxonomies[index] = record;
  } else {
    config.taxonomies.push(record);
  }

  await writeConfig(config, adminUser);
  return record;
}

async function saveTaxonomyMeta(id, metaKeys, adminUser) {
  const configResponse = await getAdminConfig();
  const config = normalizeAdminConfig(configResponse);
  const index = config.taxonomies.findIndex((taxonomy) => String(taxonomy.id) === String(id));

  if (index < 0) {
    const error = new Error("Taxonomy not found");
    error.statusCode = 404;
    throw error;
  }

  config.taxonomies[index].meta_keys = normalizeMetaKeys(metaKeys);
  config.taxonomies[index].updated_at = new Date().toISOString();
  await writeConfig(config, adminUser);
  return config.taxonomies[index];
}

async function saveUsersSettings(users, adminUser) {
  const configResponse = await getAdminConfig();
  const config = normalizeAdminConfig(configResponse);
  config.users = normalizeUsersConfig(users);
  await writeConfig(config, adminUser);
  return config.users;
}

async function saveReviewsSettings(reviews, adminUser) {
  const configResponse = await getAdminConfig();
  const config = normalizeAdminConfig(configResponse);
  config.reviews = normalizeReviewsConfig(reviews);
  await writeConfig(config, adminUser);
  return config.reviews;
}

async function savePartnerPlatformStatus(status, adminUser) {
  const configResponse = await getAdminConfig();
  const config = normalizeAdminConfig(configResponse);
  config.partner_platform_status = normalizePartnerPlatformStatus(status);
  await writeConfig(config, adminUser);
  return config.partner_platform_status;
}

async function getPartnerPlatformStatus() {
  const configResponse = await getAdminConfig();
  return normalizePartnerPlatformStatus(configResponse.partner_platform_status);
}

module.exports = {
  deletePostType,
  getAdminConfig,
  getPartnerPlatformStatus,
  importAdminConfig,
  savePostType,
  savePostTypeMeta,
  savePartnerPlatformStatus,
  saveReviewsSettings,
  saveTaxonomy,
  saveTaxonomyMeta,
  saveUsersSettings,
};
