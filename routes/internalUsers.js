const express = require("express");
const router = express.Router();

const internalServiceAuth = require("../middlewares/internalServiceAuth");
const { getUsersByIds } = require("../services/userService");

const firstText = (...values) =>
  values
    .map((value) => String(value || "").trim())
    .find((value) => value.length > 0) || "";

const displayNameForUser = (user) => {
  const metadata = user?.metadata || {};
  const joinedName = [metadata.first_name, metadata.last_name]
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .join(" ");

  return firstText(
    metadata.full_name,
    metadata.name,
    joinedName,
    metadata.first_name,
    metadata.last_name,
    user?.phone,
  );
};

router.use(
  internalServiceAuth({
    secrets: {
      "chat-socket": process.env.INTERNAL_SECRET_CHAT_SOCKET,
    },
    perms: {
      "chat-socket": { allow: ["users"] },
    },
    resolveAction: () => "users",
  }),
);

router.post("/by-ids", async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.user_ids)
      ? req.body.user_ids
          .map((id) => Number.parseInt(String(id), 10))
          .filter(Number.isFinite)
      : [];

    if (ids.length === 0) {
      return res.json({ users: [] });
    }

    const users = await getUsersByIds(ids);
    return res.json({
      users: users.map((user) => ({
        id: user.id,
        role: user.role,
        phone: user.phone,
        displayName: displayNameForUser(user),
        avatar:
          user.metadata?.profile_pic_url ||
          user.metadata?.profile_pic_url_hidden ||
          null,
        metadata: {
          first_name: user.metadata?.first_name,
          last_name: user.metadata?.last_name,
          full_name: user.metadata?.full_name,
          name: user.metadata?.name,
        },
      })),
    });
  } catch (err) {
    const status = err.statusCode || 500;
    return res.status(status).json({ error: err.message || "Server error" });
  }
});

module.exports = router;
