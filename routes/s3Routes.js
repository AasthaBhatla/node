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

/** Map allowed mime types to file extension */
/** Map allowed mime types to file extension */
const EXT_MAP = {
  // Images
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",

  // Documents
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "text/plain": "txt",

  // Audio
  "audio/mpeg": "mp3", // most common for mp3 uploads
  "audio/mp3": "mp3", // non-standard, but allow if some client sends it
  "audio/mp4": "m4a", // often used for .m4a
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

const ALLOWED_MIME = Object.keys(EXT_MAP);

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
    const { content_type, folder } = req.body || {};
    const mime = content_type || "image/jpeg";

    if (!ALLOWED_MIME.includes(mime)) {
      return res.status(400).json({
        error: "invalid_mime",
        message: `Only ${ALLOWED_MIME.join(", ")} allowed`,
      });
    }

    const ext = EXT_MAP[mime] || "bin";
    const rand = crypto.randomBytes(8).toString("hex");

    const baseFolder =
      typeof folder === "string" && folder.trim()
        ? folder.trim().replace(/^\/+/, "")
        : "uploads/";
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
