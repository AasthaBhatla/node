// sockets/index.js
const { Server } = require("socket.io");
const applySocketAuth = require("./socketAuth");
const socketHub = require("./socketHub");

function initSockets(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: true, // or set your allowed domains
      credentials: true,
    },
  });

  applySocketAuth(io);

  io.on("connection", (socket) => {
    const userId = socket.user?.id;

    // One clean room scheme for everyone:
    socket.join(`user:${userId}`);

    // Optional: handshake confirmation
    socket.emit("socket:ready", { user_id: userId });
  });

  socketHub.setIO(io);
  return io;
}

module.exports = { initSockets };
