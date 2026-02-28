// sockets/socketHub.js
let io = null;

function setIO(instance) {
  io = instance;
}

function roomForUser(userId) {
  return `user:${Number(userId)}`;
}

function emitToUser(userId, event, payload) {
  if (!io) return;
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid < 1) return;
  io.to(roomForUser(uid)).emit(event, payload);
}

module.exports = {
  setIO,
  roomForUser,
  emitToUser,
};
