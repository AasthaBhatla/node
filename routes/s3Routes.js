// routes/s3Routes.js
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

const s3 = new S3Client({
  region: REGION,
  // Credentials will be picked up from env automatically
});

/** Map allowed mime types to file extension */
const EXT_MAP = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

const ALLOWED_MIME = Object.keys(EXT_MAP);

/** Build YYYY/MM/ path like your PHP */
function folderByDate() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}/${mm}/`;
}

/** Public URL builder (works if object is public or behind a public CDN) */
function publicUrlForKey(key) {
  if (PUBLIC_CDN_DOMAIN) {
    // Use your CDN domain if provided
    return `https://${PUBLIC_CDN_DOMAIN}/${key.replace(/^\/+/, "")}`;
  }
  // S3 virtual-hosted–style URL
  return `https://${BUCKET}.s3.${REGION}.amazonaws.com/${key.replace(
    /^\/+/,
    ""
  )}`;
}

/**
 * POST /s3/presign
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

    const ext = EXT_MAP[mime] || "jpg";
    const rand = crypto.randomBytes(8).toString("hex");

    // Keep your existing pattern: mobile/YYYY/MM/random.ext
    const baseFolder =
      typeof folder === "string" && folder.trim()
        ? folder.trim().replace(/^\/+/, "")
        : "mobile/";
    const key = `${baseFolder}${folderByDate()}${rand}.${ext}`;

    // IMPORTANT: lock ContentType so the client must send it exactly (prevents content-type spoofing)
    const putCmd = new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: mime,
      // If you need the object publicly readable without CloudFront, uncomment the ACL:
      // ACL: "public-read",
      // You can also add CacheControl / Metadata here if you need:
      // CacheControl: "public, max-age=31536000, immutable",
      // Metadata: { uploadedBy: "api" },
    });

    const put_url = await getSignedUrl(s3, putCmd, { expiresIn: 600 }); // 10 minutes

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
 * GET /s3/get-url?key=path/to/object
 * For private buckets: returns a short-lived GET URL to read the file.
 */
router.get("/get-url", async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: "missing_key" });

    const getCmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const url = await getSignedUrl(s3, getCmd, { expiresIn: 300 }); // 5 minutes
    return res.json({ url });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "geturl_failed", message: e.message });
  }
});

module.exports = router;
