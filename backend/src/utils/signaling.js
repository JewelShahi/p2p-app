import { v4 as uuidv4 } from 'uuid';
import { isValidDuration, DEFAULT_DURATION } from './roomManager.js';

// Total size cap per offer, regardless of how many files make it up.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024; // 10GB

export function registerSignaling(io, roomManager) {
  io.on('connection', (socket) => {
    // Track which room this socket belongs to and whether it's the host
    socket.data.roomId = null;
    socket.data.isHost = false;

    // ---------- CREATE ROOM (host clicks "Start session") ----------
    socket.on('create-room', (payload, ack) => {
      const durationMinutes = isValidDuration(payload?.durationMinutes)
        ? payload.durationMinutes
        : DEFAULT_DURATION;

      const room = roomManager.createRoom({
        hostSocketId: socket.id,
        durationMinutes,
      });

      socket.join(room.id);
      socket.data.roomId = room.id;
      socket.data.isHost = true;
      socket.data.userId = room.hostUserId;

      ack?.({
        ok: true,
        roomId: room.id,
        hostUserId: room.hostUserId,
        expiresAt: room.expiresAt,
        durationMinutes: room.durationMinutes,
      });
    });

    // ---------- JOIN ROOM (peer opens the shared link) ----------
    socket.on('join-room', (payload, ack) => {
      const { roomId } = payload || {};
      const room = roomManager.getRoom(roomId);

      if (!roomManager.isJoinable(room)) {
        ack?.({ ok: false, error: room ? 'room-expired-or-closed' : 'room-not-found' });
        return;
      }

      const member = roomManager.addMember(roomId, socket.id);
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.isHost = false;
      socket.data.userId = member.userId;

      ack?.({
        ok: true,
        roomId,
        userId: member.userId,
        expiresAt: room.expiresAt,
        remainingSeconds: roomManager.remainingSeconds(roomId),
        // If host already made an offer before this peer joined, send it immediately
        currentOffer: room.currentOffer,
      });

      // Tell the host a new peer connected, so the host's UI can show them
      // and WebRTC signaling can begin (host is the "initiator" side per peer)
      io.to(room.hostSocketId).emit('peer-joined', {
        peerSocketId: socket.id,
        peerUserId: member.userId,
        joinedAt: member.joinedAt,
      });
    });

    // ---------- REJOIN (reconnect after dropped connection) ----------
    socket.on('rejoin-room', (payload, ack) => {
      const { roomId, userId } = payload || {};
      const room = roomManager.getRoom(roomId);

      if (!room) {
        ack?.({ ok: false, error: 'room-not-found' });
        return;
      }
      if (room.status !== 'open') {
        ack?.({ ok: false, error: `room-${room.status}` });
        return;
      }

      const wasHost = room.hostUserId === userId;
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.isHost = wasHost;
      socket.data.userId = userId;

      if (wasHost) {
        room.hostSocketId = socket.id; // host's new socket id after reconnect
      } else {
        // refresh member entry under the new socket id, keep same userId
        room.members.set(socket.id, { socketId: socket.id, userId, joinedAt: Date.now(), downloading: new Set() });
      }

      ack?.({
        ok: true,
        roomId,
        isHost: wasHost,
        expiresAt: room.expiresAt,
        remainingSeconds: roomManager.remainingSeconds(roomId),
        currentOffer: room.currentOffer,
      });

      socket.to(roomId).emit('peer-reconnected', { userId, isHost: wasHost });
    });

    // ---------- WEBRTC SIGNAL RELAY ----------
    // Pure relay: server never looks at the payload contents, just forwards it
    // to the intended peer so a direct WebRTC connection can be negotiated.
    socket.on('signal', (payload) => {
      const { targetSocketId, signal } = payload || {};
      if (!targetSocketId || !signal) return;
      io.to(targetSocketId).emit('signal', {
        fromSocketId: socket.id,
        signal,
      });
    });

    // ---------- HOST MAKES A FILE OFFER ----------
    // files: [{ id, name, size }], totalSize in bytes
    socket.on('file-offer', (payload) => {
      const roomId = socket.data.roomId;
      const room = roomManager.getRoom(roomId);
      if (!room || room.hostSocketId !== socket.id) return; // only host can offer

      const totalSize = payload?.totalSize || 0;
      if (totalSize > MAX_UPLOAD_BYTES) {
        // Reject before broadcasting to peers — count of files doesn't matter, only total bytes.
        socket.emit('file-offer-error', {
          error: 'upload-too-large',
          maxBytes: MAX_UPLOAD_BYTES,
          attemptedBytes: totalSize,
        });
        return;
      }

      const offer = {
        offerId: uuidv4(),
        files: Array.isArray(payload?.files) ? payload.files : [],
        totalSize: payload?.totalSize || 0,
        createdAt: Date.now(),
      };
      roomManager.extendOrSetOffer(roomId, offer);

      // Broadcast to every connected peer (not the host itself)
      socket.to(roomId).emit('file-offer', offer);
    });

    // ---------- PEER RESPONDS TO OFFER ----------
    // mode: 'individual' | 'zip'
    socket.on('file-response', (payload) => {
      const { accept, mode, offerId } = payload || {};
      const room = roomManager.getRoom(socket.data.roomId);
      if (!room) return;

      io.to(room.hostSocketId).emit('file-response', {
        fromSocketId: socket.id,
        fromUserId: socket.data.userId,
        accept: !!accept,
        mode: mode === 'zip' ? 'zip' : 'individual',
        offerId,
      });
    });

    // ---------- TRANSFER STATUS RELAY (progress / complete / error / cancel) ----------
    // Used so host <-> peer UIs can reflect state; actual bytes flow peer-to-peer directly.
    socket.on('transfer-status', (payload) => {
      const { targetSocketId, status, fileId, progress } = payload || {};
      if (!targetSocketId) return;
      io.to(targetSocketId).emit('transfer-status', {
        fromSocketId: socket.id,
        status, // 'downloading' | 'complete' | 'error' | 'cancelled'
        fileId,
        progress,
      });
    });

    // ---------- HOST TERMINATES ROOM ----------
    socket.on('terminate-room', () => {
      const room = roomManager.getRoom(socket.data.roomId);
      if (!room || room.hostSocketId !== socket.id) return;
      roomManager.closeRoom(room.id, 'terminated');
    });

    // ---------- LEAVE ----------
    socket.on('leave-room', () => {
      handleLeave(socket, io, roomManager);
    });

    // ---------- DISCONNECT ----------
    socket.on('disconnect', () => {
      handleLeave(socket, io, roomManager, { disconnected: true });
    });
  });
}

function handleLeave(socket, io, roomManager, { disconnected = false } = {}) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  if (socket.data.isHost) {
    // Host leaving/disconnecting closes the whole room for everyone.
    roomManager.closeRoom(roomId, disconnected ? 'host-disconnected' : 'terminated');
  } else {
    roomManager.removeMember(roomId, socket.id);
    io.to(room.hostSocketId).emit('peer-left', {
      peerSocketId: socket.id,
      peerUserId: socket.data.userId,
      disconnected,
    });
  }
}