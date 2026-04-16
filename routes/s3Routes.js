const express = require("express");
const crypto = require("crypto");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const router = express.Router();

const REGION = process.env.AWS_DEFAULT_REGION;
const BUCKET = process.env.S3_BUCKET;
const PUBLIC_CDN_DOMAIN = process.env.PUBLIC_CDN_DOMAIN || null;

if (!REGION || !BUCKET) {
  throw new Error("AWS_DEFAULT_REGION and S3_BUCKET must be set");
}

const s3 = new S3Client({ region: REGION });

const EXT_MAP = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",

  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/x-m4p": "m4p",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/webm": "webm",
  "audio/aac": "aac",
  "audio/flac": "flac",
  "audio/x-ms-wma": "wma",
  "audio/x-aiff": "aiff",
  "audio/3gpp": "3gp",
};

const MIME_BY_EXTENSION = Object.entries(EXT_MAP).reduce((record, [mime, ext]) => {
  record[ext] = mime;
  return record;
}, {});

function sanitizeExtension(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function extensionFromFilename(filename) {
  return sanitizeExtension(String(filename || "").split(".").pop() || "");
}

function resolveUploadKind(contentType, filename) {
  const safeType = String(contentType || "").trim().toLowerCase();
  const safeFilenameExt = extensionFromFilename(filename);

  if (EXT_MAP[safeType]) {
    return {
      mime: safeType,
      ext: EXT_MAP[safeType],
    };
  }

  if (safeFilenameExt && MIME_BY_EXTENSION[safeFilenameExt]) {
    return {
      mime:
        safeType && safeType !== "application/octet-stream"
          ? safeType
          : MIME_BY_EXTENSION[safeFilenameExt],
      ext: safeFilenameExt,
    };
  }

  return null;
}

/** Build YYYY/MM/ path like your PHP */
function folderByDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}/${mm}/`;
}

/** Public URL builder (works if object is public or behind a CDN) */
function publicUrlForKey(key) {
  if (PUBLIC_CDN_DOMAIN) {
    return `https://${PUBLIC_CDN_DOMAIN}/${key.replace(/^\/+/, "")}`;
  }
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key.replace(
    /^\/+/,
    "",
  )}`;
}

/**
 * POST /uploadnow/presign
 * Body: { content_type: "image/png", folder?: "mobile/" }
 * Returns: { put_url, key, public_url }
 */
router.post("/presign", async (req, res) => {
  try {
    const { content_type, folder, filename } = req.body || {};
    const uploadKind = resolveUploadKind(content_type, filename);

    if (!uploadKind) {
      return res.status(400).json({
        error: "invalid_mime",
        message: "Unsupported upload type",
      });
    }

    const mime = uploadKind.mime;
    const ext = uploadKind.ext;
    const rand = crypto.randomBytes(8).toString("hex");

    const baseFolder =
      typeof folder === "string" && folder.trim()
        ? folder.trim().replace(/^\/+/, "")
        : "mobile/";
    const key = `${baseFolder}${folderByDate()}${rand}.${ext}`;

    const putCmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: mime,
      // ACL: "public-read", // enable if needed
    });

    const put_url = await getSignedUrl(s3, putCmd, { expiresIn: 600 }); // 10 min

    return res.json({
      put_url,
      key,
      public_url: publicUrlForKey(key),
    });
  } catch (e) {
    console.error(e);
    return res
      .status(500)
      .json({ error: "presign_failed", message: e.message });
  }
});

/**
 * GET /uploadnow/get-url?key=path/to/object
 * Returns a short-lived GET URL for private files
 */
router.get("/get-url", async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: "missing_key" });

    const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const url = await getSignedUrl(s3, getCmd, { expiresIn: 300 }); // 5 min
    return res.json({ url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "geturl_failed", message: e.message });
  }
});

module.exports = router;
