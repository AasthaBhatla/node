const pool = require("../db");

const DOCUMENT_STATUSES = new Set([
  "created_by_kaptaan",
  "submitted",
  "in_review",
  "in_progress",
  "version_uploaded",
  "completed",
  "cancelled",
]);

const SERVICE_TO_DOCUMENT_STATUS = {
  submitted: "created_by_kaptaan",
  in_review: "in_review",
  in_progress: "in_progress",
  completed: "completed",
  cancelled: "cancelled",
};

const STATUS_LABELS = {
  created_by_kaptaan: "Created by Kaptaan",
  submitted: "Created by Kaptaan",
  in_review: "Team will connect with you",
  in_progress: "Document is being prepared",
  version_uploaded: "New version uploaded",
  completed: "Completed",
  cancelled: "Cancelled",
};

function normalizeString(value) {
  return String(value ?? "").trim();
}

function normalizePositiveInteger(value, fieldName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    const error = new Error(`${fieldName} must be a valid integer`);
    error.statusCode = 422;
    throw error;
  }
  return parsed;
}

function normalizeStatus(value, fallback = "created_by_kaptaan") {
  const status = normalizeString(value).toLowerCase() || fallback;
  if (!DOCUMENT_STATUSES.has(status)) {
    const error = new Error(`Invalid document status: ${status}`);
    error.statusCode = 422;
    throw error;
  }
  return status;
}

function serviceStatusToDocumentStatus(status) {
  return SERVICE_TO_DOCUMENT_STATUS[normalizeString(status).toLowerCase()] || "created_by_kaptaan";
}

function documentStatusToServiceStatus(status) {
  const documentStatus = normalizeStatus(status);
  if (documentStatus === "created_by_kaptaan" || documentStatus === "submitted") {
    return "submitted";
  }
  if (documentStatus === "version_uploaded") {
    return "in_progress";
  }
  return documentStatus;
}

function statusLabel(status) {
  return STATUS_LABELS[status] || STATUS_LABELS.created_by_kaptaan;
}

function documentTypeFromFileName(fileName, contentType) {
  const ext = normalizeString(fileName).split(".").pop()?.toLowerCase();
  if (ext && ext !== fileName) return ext;
  if (normalizeString(contentType).includes("pdf")) return "pdf";
  return "document";
}

function formatSize(bytes) {
  const value = Number(bytes || 0);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function buildDocumentTitle(service, fallback = "Document") {
  return normalizeString(service?.title) || fallback;
}

function buildDocumentName(documentRow, version) {
  return (
    normalizeString(version?.file_name) ||
    `${normalizeString(documentRow?.title) || "Document"}.pdf`
  );
}

async function getWorkspaceForUser(workspaceId, userId, client = pool) {
  const result = await client.query(
    `SELECT id, user_id, type, title, created_at
     FROM workspace
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [workspaceId, userId],
  );
  return result.rows[0] || null;
}

async function validateWorkspaceForUser(workspaceId, userId, client = pool) {
  const id = normalizePositiveInteger(workspaceId, "workspace_id");
  const workspace = await getWorkspaceForUser(id, userId, client);
  if (!workspace) {
    const error = new Error("Selected profile was not found");
    error.statusCode = 404;
    throw error;
  }
  return workspace;
}

async function addActivityTx(client, documentId, {
  activityType,
  title,
  body = null,
  actorUserId = null,
  metadata = {},
}) {
  await client.query(
    `INSERT INTO profile_document_activities (
       profile_document_id,
       activity_type,
       title,
       body,
       actor_user_id,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      documentId,
      activityType,
      title,
      body,
      actorUserId,
      JSON.stringify(metadata || {}),
    ],
  );
}

async function createForServiceRequestTx(client, {
  userId,
  workspaceId,
  service,
  serviceRequestId,
  actorUserId = null,
}) {
  await validateWorkspaceForUser(workspaceId, userId, client);

  const existingResult = await client.query(
    `SELECT id FROM profile_documents WHERE service_request_id = $1 LIMIT 1`,
    [serviceRequestId],
  );
  if (existingResult.rows[0]) {
    return existingResult.rows[0];
  }

  const title = buildDocumentTitle(service);
  const result = await client.query(
    `INSERT INTO profile_documents (
       user_id,
       workspace_id,
       service_id,
       service_request_id,
       title,
       status
     )
     VALUES ($1, $2, $3, $4, $5, 'created_by_kaptaan')
     RETURNING *`,
    [userId, workspaceId, service.id, serviceRequestId, title],
  );

  const document = result.rows[0];
  await addActivityTx(client, document.id, {
    activityType: "created_by_kaptaan",
    title: `${title} created by Kaptaan`,
    body: "Team will connect with you and prepare this document.",
    actorUserId,
    metadata: { service_request_id: serviceRequestId, service_id: service.id },
  });

  return document;
}

async function updateDocumentStatusForServiceRequest(serviceRequestId, nextServiceStatus, actorUserId = null) {
  const documentStatus = serviceStatusToDocumentStatus(nextServiceStatus);
  return updateDocumentStatusByCondition(
    "service_request_id = $1",
    [serviceRequestId],
    documentStatus,
    actorUserId,
    { service_request_id: serviceRequestId },
  );
}

async function updateDocumentStatusById(profileDocumentId, nextStatus, actorUserId = null) {
  const documentId = normalizePositiveInteger(profileDocumentId, "profile_document_id");
  const documentStatus = normalizeStatus(nextStatus);
  return updateDocumentStatusByCondition(
    "id = $1",
    [documentId],
    documentStatus,
    actorUserId,
    { profile_document_id: documentId },
  );
}

async function updateDocumentStatusByCondition(whereSql, values, documentStatus, actorUserId, metadata) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE profile_documents
       SET status = $${values.length + 1},
           completed_at = CASE WHEN $${values.length + 1} = 'completed' THEN COALESCE(completed_at, CURRENT_TIMESTAMP) ELSE completed_at END,
           cancelled_at = CASE WHEN $${values.length + 1} = 'cancelled' THEN COALESCE(cancelled_at, CURRENT_TIMESTAMP) ELSE cancelled_at END,
           updated_at = CURRENT_TIMESTAMP
       WHERE ${whereSql}
       RETURNING *`,
      [...values, documentStatus],
    );

    const document = result.rows[0] || null;
    if (document) {
      if (document.service_request_id) {
        await client.query(
          `UPDATE service_requests
           SET status = $2,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [document.service_request_id, documentStatusToServiceStatus(documentStatus)],
        );
      }

      await addActivityTx(client, document.id, {
        activityType: documentStatus,
        title: statusLabel(documentStatus),
        actorUserId,
        metadata,
      });
    }

    await client.query("COMMIT");
    return document;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function addVersion(profileDocumentId, payload, actorUserId = null) {
  const documentId = normalizePositiveInteger(profileDocumentId, "profile_document_id");
  const fileUrl = normalizeString(payload?.file_url || payload?.fileUrl);
  if (!fileUrl) {
    const error = new Error("file_url is required");
    error.statusCode = 422;
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const documentResult = await client.query(
      `SELECT * FROM profile_documents WHERE id = $1 FOR UPDATE`,
      [documentId],
    );
    const document = documentResult.rows[0];
    if (!document) {
      const error = new Error("Document not found");
      error.statusCode = 404;
      throw error;
    }

    const versionResult = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) + 1 AS next_version
       FROM profile_document_versions
       WHERE profile_document_id = $1`,
      [documentId],
    );
    const versionNumber = Number(versionResult.rows[0]?.next_version || 1);
    const fileName = normalizeString(payload?.file_name || payload?.fileName) || `version-${versionNumber}.pdf`;
    const contentType = normalizeString(payload?.content_type || payload?.contentType) || "application/pdf";
    const documentType = normalizeString(payload?.document_type || payload?.documentType) || documentTypeFromFileName(fileName, contentType);
    const sizeBytes = Number.parseInt(payload?.document_size_bytes ?? payload?.documentSizeBytes ?? payload?.file_size ?? 0, 10);

    const inserted = await client.query(
      `INSERT INTO profile_document_versions (
         profile_document_id,
         version_number,
         file_url,
         file_name,
         content_type,
         document_type,
         document_size_bytes,
         uploaded_by_user_id,
         notes
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        documentId,
        versionNumber,
        fileUrl,
        fileName,
        contentType,
        documentType,
        Number.isFinite(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
        actorUserId,
        normalizeString(payload?.notes) || null,
      ],
    );
    const version = inserted.rows[0];

    await client.query(
      `UPDATE profile_documents
       SET latest_version_id = $2,
           status = 'completed',
           completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [documentId, version.id],
    );

    if (document.service_request_id) {
      await client.query(
        `UPDATE service_requests
         SET status = 'completed',
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [document.service_request_id],
      );
    }

    await addActivityTx(client, documentId, {
      activityType: versionNumber === 1 ? "completed" : "version_uploaded",
      title: versionNumber === 1 ? "Completed" : `Version ${versionNumber} uploaded`,
      body: fileName,
      actorUserId,
      metadata: { version_id: version.id, version_number: versionNumber },
    });

    await client.query("COMMIT");
    return getDocumentById(documentId, { admin: true });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function addGeneratedVersionForServiceRequest(serviceRequestId, generatedDocument, actorUserId = null) {
  const result = await pool.query(
    `SELECT id FROM profile_documents WHERE service_request_id = $1 LIMIT 1`,
    [serviceRequestId],
  );
  const document = result.rows[0];
  if (!document) return null;

  return addVersion(document.id, {
    file_url: generatedDocument.document_url,
    file_name: generatedDocument.file_name,
    content_type: generatedDocument.content_type,
    document_type: generatedDocument.document_type,
    document_size_bytes: generatedDocument.document_size,
  }, actorUserId);
}

async function getDocumentsBase({ userId = null, admin = false, search = "", status = "", limit = 100, offset = 0 } = {}) {
  const values = [];
  const conditions = [];

  if (!admin) {
    values.push(userId);
    conditions.push(`pd.user_id = $${values.length}`);
  }

  const safeStatus = normalizeString(status);
  if (safeStatus) {
    values.push(normalizeStatus(safeStatus));
    conditions.push(`pd.status = $${values.length}`);
  }

  const safeSearch = normalizeString(search);
  if (safeSearch) {
    values.push(`%${safeSearch}%`);
    conditions.push(
      `(pd.title ILIKE $${values.length}
        OR COALESCE(s.title, '') ILIKE $${values.length}
        OR COALESCE(w.title, '') ILIKE $${values.length}
        OR COALESCE(u.email, '') ILIKE $${values.length}
        OR COALESCE(u.phone, '') ILIKE $${values.length})`,
    );
  }

  values.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
  values.push(Math.max(Number(offset) || 0, 0));

  const result = await pool.query(
    `SELECT
       pd.*,
       w.title AS workspace_title,
       w.type AS workspace_type,
       workspace_meta.profile_image AS workspace_image,
       s.title AS service_title,
       s.slug AS service_slug,
       s.document_icon_url,
       s.document_icon_key,
       s.document_icon_tone,
       sr.status AS service_request_status,
       sr.payment_status,
       sr.quoted_price_paise,
       sv.title AS variant_title,
       v.id AS latest_version_id,
       v.version_number AS latest_version_number,
       v.file_url AS latest_file_url,
       v.file_name AS latest_file_name,
       v.content_type AS latest_content_type,
       v.document_type AS latest_document_type,
       v.document_size_bytes AS latest_document_size_bytes,
       v.created_at AS latest_uploaded_at,
       u.email AS user_email,
       u.phone AS user_phone,
       profile.first_name AS client_first_name,
       profile.last_name AS client_last_name,
       COUNT(*) OVER()::int AS total_count
     FROM profile_documents pd
     JOIN workspace w ON w.id = pd.workspace_id
     JOIN users u ON u.id = pd.user_id
     LEFT JOIN services s ON s.id = pd.service_id
     LEFT JOIN service_requests sr ON sr.id = pd.service_request_id
     LEFT JOIN service_variants sv ON sv.id = sr.service_variant_id
     LEFT JOIN profile_document_versions v ON v.id = pd.latest_version_id
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(
           MAX(CASE WHEN wm.meta_key = 'profile-image' THEN wm.meta_value END),
           MAX(CASE WHEN wm.meta_key = 'profile_image' THEN wm.meta_value END),
           MAX(CASE WHEN wm.meta_key = 'cover_image' THEN wm.meta_value END),
           MAX(CASE WHEN wm.meta_key = 'cover_image_hidden' THEN wm.meta_value END)
         ) AS profile_image
       FROM workspace_metadata wm
       WHERE wm.workspace_id = w.id
     ) workspace_meta ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         MAX(CASE WHEN um.key = 'first_name' THEN um.value END) AS first_name,
         MAX(CASE WHEN um.key = 'last_name' THEN um.value END) AS last_name
       FROM user_metadata um
       WHERE um.user_id = u.id AND um.key IN ('first_name', 'last_name')
     ) profile ON TRUE
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY pd.updated_at DESC, pd.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  return {
    total: result.rows[0] ? Number(result.rows[0].total_count) : 0,
    rows: result.rows,
  };
}

async function loadVersions(documentIds) {
  if (!documentIds.length) return new Map();
  const result = await pool.query(
    `SELECT *
     FROM profile_document_versions
     WHERE profile_document_id = ANY($1::bigint[])
     ORDER BY profile_document_id ASC, version_number DESC, id DESC`,
    [documentIds],
  );
  const map = new Map();
  for (const row of result.rows) {
    const key = Number(row.profile_document_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

async function loadActivities(documentIds) {
  if (!documentIds.length) return new Map();
  const result = await pool.query(
    `SELECT *
     FROM profile_document_activities
     WHERE profile_document_id = ANY($1::bigint[])
     ORDER BY profile_document_id ASC, created_at DESC, id DESC`,
    [documentIds],
  );
  const map = new Map();
  for (const row of result.rows) {
    const key = Number(row.profile_document_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function serializeVersion(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    documentName: row.file_name || "Document",
    document_url: row.file_url,
    document_type: row.document_type || "pdf",
    document_size: formatSize(row.document_size_bytes),
    document_size_bytes: Number(row.document_size_bytes || 0),
    uploaded_at: row.created_at,
    version_number: row.version_number === 1 ? "latest" : `V_${String(row.version_number).padStart(2, "0")}`,
    raw_version_number: Number(row.version_number || 0),
    content_type: row.content_type,
    notes: row.notes,
  };
}

function serializeActivity(row, documentRow) {
  const latestUrl = documentRow.latest_file_url || undefined;
  const latestName = buildDocumentName(documentRow, {
    file_name: documentRow.latest_file_name,
  });
  const type =
    row.activity_type === "version_uploaded" || row.activity_type === "completed"
      ? "upload"
      : row.activity_type === "cancelled"
        ? "delete"
        : row.activity_type === "in_review" || row.activity_type === "in_progress"
          ? "update"
          : "created";

  return {
    id: `profile-document-activity-${row.id}`,
    title: row.title || statusLabel(documentRow.status),
    body: row.body || "",
    createdAt: row.created_at,
    type,
    documentUrl: latestUrl,
    documentName: latestUrl ? latestName : documentRow.title,
    workspaceId: String(documentRow.workspace_id),
    workspaceTitle: documentRow.workspace_title,
    workspaceType: documentRow.workspace_type === null ? undefined : String(documentRow.workspace_type),
    profileDocumentId: String(documentRow.id),
    serviceRequestId: documentRow.service_request_id === null ? null : String(documentRow.service_request_id),
    status: documentRow.status,
    statusLabel: statusLabel(documentRow.status),
  };
}

function serializeDocument(row, versions) {
  const latestVersion = versions[0] || null;
  const latest = latestVersion ? serializeVersion(latestVersion) : null;
  const documentName = latest?.documentName || `${row.title}.pdf`;

  return {
    id: `profile-document-${row.id}`,
    profile_document_id: String(row.id),
    service_request_id: row.service_request_id === null ? null : String(row.service_request_id),
    service_id: row.service_id === null ? null : Number(row.service_id),
    documentName,
    title: row.title,
    document_url: latest?.document_url || "",
    document_type: latest?.document_type || "pdf",
    document_size: latest?.document_size || "",
    uploaded_at: latest?.uploaded_at || row.updated_at || row.created_at,
    status: row.status,
    status_label: statusLabel(row.status),
    payment_status: row.payment_status || "",
    service_request_status: row.service_request_status || "",
    version: versions.map(serializeVersion),
  };
}

function serializeAdminDocument(row, versions, activities) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    workspaceId: String(row.workspace_id),
    workspaceTitle: row.workspace_title || "Profile",
    workspaceType: row.workspace_type === null ? "" : String(row.workspace_type),
    client: {
      id: String(row.user_id),
      name:
        [row.client_first_name, row.client_last_name].filter(Boolean).join(" ") ||
        row.user_phone ||
        row.user_email ||
        `User ${row.user_id}`,
      email: row.user_email || "",
      phone: row.user_phone || "",
    },
    service: {
      id: row.service_id === null ? "" : String(row.service_id),
      title: row.service_title || row.title,
      slug: row.service_slug || "",
    },
    variantTitle: row.variant_title || "",
    serviceRequestId: row.service_request_id === null ? "" : String(row.service_request_id),
    serviceRequestStatus: row.service_request_status || "",
    paymentStatus: row.payment_status || "",
    quotedPricePaise: Number(row.quoted_price_paise || 0),
    title: row.title,
    status: row.status,
    statusLabel: statusLabel(row.status),
    latestVersion: versions[0] ? serializeVersion(versions[0]) : null,
    versions: versions.map(serializeVersion),
    activities: activities.map((activity) => ({
      id: String(activity.id),
      type: activity.activity_type,
      title: activity.title,
      body: activity.body || "",
      createdAt: activity.created_at,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getDocumentById(id, { admin = false, userId = null } = {}) {
  const documentId = normalizePositiveInteger(id, "profile_document_id");
  const values = [documentId];
  const conditions = ["pd.id = $1"];
  if (!admin) {
    values.push(userId);
    conditions.push(`pd.user_id = $${values.length}`);
  }
  const result = await pool.query(
    `SELECT
       pd.*,
       w.title AS workspace_title,
       w.type AS workspace_type,
       workspace_meta.profile_image AS workspace_image,
       s.title AS service_title,
       s.slug AS service_slug,
       s.document_icon_url,
       s.document_icon_key,
       s.document_icon_tone,
       sr.status AS service_request_status,
       sr.payment_status,
       sr.quoted_price_paise,
       sv.title AS variant_title,
       v.id AS latest_version_id,
       v.version_number AS latest_version_number,
       v.file_url AS latest_file_url,
       v.file_name AS latest_file_name,
       v.content_type AS latest_content_type,
       v.document_type AS latest_document_type,
       v.document_size_bytes AS latest_document_size_bytes,
       v.created_at AS latest_uploaded_at,
       u.email AS user_email,
       u.phone AS user_phone,
       profile.first_name AS client_first_name,
       profile.last_name AS client_last_name
     FROM profile_documents pd
     JOIN workspace w ON w.id = pd.workspace_id
     JOIN users u ON u.id = pd.user_id
     LEFT JOIN services s ON s.id = pd.service_id
     LEFT JOIN service_requests sr ON sr.id = pd.service_request_id
     LEFT JOIN service_variants sv ON sv.id = sr.service_variant_id
     LEFT JOIN profile_document_versions v ON v.id = pd.latest_version_id
     LEFT JOIN LATERAL (
       SELECT
         COALESCE(
           MAX(CASE WHEN wm.meta_key = 'profile-image' THEN wm.meta_value END),
           MAX(CASE WHEN wm.meta_key = 'profile_image' THEN wm.meta_value END),
           MAX(CASE WHEN wm.meta_key = 'cover_image' THEN wm.meta_value END),
           MAX(CASE WHEN wm.meta_key = 'cover_image_hidden' THEN wm.meta_value END)
         ) AS profile_image
       FROM workspace_metadata wm
       WHERE wm.workspace_id = w.id
     ) workspace_meta ON TRUE
     LEFT JOIN LATERAL (
       SELECT
         MAX(CASE WHEN um.key = 'first_name' THEN um.value END) AS first_name,
         MAX(CASE WHEN um.key = 'last_name' THEN um.value END) AS last_name
       FROM user_metadata um
       WHERE um.user_id = u.id AND um.key IN ('first_name', 'last_name')
     ) profile ON TRUE
     WHERE ${conditions.join(" AND ")}
     LIMIT 1`,
    values,
  );
  const row = result.rows[0] || null;
  if (!row) return null;
  const versions = await loadVersions([documentId]);
  const activities = await loadActivities([documentId]);
  return admin
    ? serializeAdminDocument(row, versions.get(documentId) || [], activities.get(documentId) || [])
    : serializeDocument(row, versions.get(documentId) || []);
}

async function listForUser(userId) {
  const { rows } = await getDocumentsBase({ userId, admin: false, limit: 200, offset: 0 });
  const documentIds = rows.map((row) => Number(row.id));
  const versionsByDocument = await loadVersions(documentIds);
  const activitiesByDocument = await loadActivities(documentIds);

  const groupsByWorkspace = new Map();
  const activities = [];

  for (const row of rows) {
    const documentId = Number(row.id);
    const versions = versionsByDocument.get(documentId) || [];
    const document = serializeDocument(row, versions);
    const collectionId = row.service_id === null ? `admin-${documentId}` : String(row.service_id);
    const collectionTitle = row.service_title || row.title || "Documents";

    if (!groupsByWorkspace.has(String(row.workspace_id))) {
      groupsByWorkspace.set(String(row.workspace_id), {
        workspaceId: String(row.workspace_id),
        workspaceTitle: row.workspace_title || "Profile",
        workspaceSubtitle: row.workspace_type === null ? "Saved profile" : String(row.workspace_type),
        workspaceImage: row.workspace_image || undefined,
        collections: [],
      });
    }

    const group = groupsByWorkspace.get(String(row.workspace_id));
    let collection = group.collections.find((item) => String(item.id) === collectionId);
    if (!collection) {
      collection = {
        id: collectionId,
        title: collectionTitle,
        icon_hidden: row.document_icon_url || row.document_icon_key || "",
        color: row.document_icon_tone || "",
        documents: [],
      };
      group.collections.push(collection);
    }
    collection.documents.push(document);

    const rowActivities = activitiesByDocument.get(documentId) || [];
    activities.push(...rowActivities.map((activity) => serializeActivity(activity, row)));
  }

  activities.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return {
    activities,
    groups: Array.from(groupsByWorkspace.values()),
  };
}

async function listForAdmin(filters = {}) {
  const { total, rows } = await getDocumentsBase({
    admin: true,
    search: filters.search,
    status: filters.status,
    limit: filters.limit,
    offset: filters.offset,
  });
  const documentIds = rows.map((row) => Number(row.id));
  const versionsByDocument = await loadVersions(documentIds);
  const activitiesByDocument = await loadActivities(documentIds);

  return {
    total,
    limit: Math.min(Math.max(Number(filters.limit) || 100, 1), 200),
    offset: Math.max(Number(filters.offset) || 0, 0),
    items: rows.map((row) => {
      const id = Number(row.id);
      return serializeAdminDocument(
        row,
        versionsByDocument.get(id) || [],
        activitiesByDocument.get(id) || [],
      );
    }),
  };
}

module.exports = {
  addGeneratedVersionForServiceRequest,
  addVersion,
  createForServiceRequestTx,
  listForAdmin,
  listForUser,
  normalizeStatus,
  serviceStatusToDocumentStatus,
  statusLabel,
  updateDocumentStatusForServiceRequest,
  updateDocumentStatusById,
  validateWorkspaceForUser,
};
