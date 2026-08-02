// signaling.js
import { v4 as uuidv4 } from 'uuid';
import { isValidDuration, DEFAULT_DURATION } from './roomManager.js';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024 * 1024;

export function registerSignaling(io, roomManager) {
  io.on('connection', (socket) => {
    socket.data.roomId = null;
    socket.data.isHost = false;
    socket.data.userId = null;

    // ---------- CREATE ROOM ----------
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

    // ---------- JOIN ROOM ----------
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
        currentOffer: room.currentOffer,
      });

      io.to(room.hostSocketId).emit('peer-joined', {
        peerSocketId: socket.id,
        peerUserId: member.userId,
        joinedAt: member.joinedAt,
      });
    });

    // ---------- REJOIN ROOM ----------
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
      if (!userId) {
        ack?.({ ok: false, error: 'missing-user-id' });
        return;
      }

      const wasHost = room.hostUserId === userId;
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.isHost = wasHost;
      socket.data.userId = userId;

      if (wasHost) {
        room.hostSocketId = socket.id;
        roomManager.cancelHostDisconnect(roomId);
      } else {
        // Remove ALL old entries for this userId before adding the new one
        roomManager.removeMemberByUserId(roomId, userId);
        room.members.set(socket.id, {
          socketId: socket.id,
          userId,
          joinedAt: Date.now(),
          downloading: new Set(),
        });
        roomManager.cancelPeerDisconnect(roomId, userId);
      }

      // Emit peer-reconnected BEFORE the ack so peers destroy their old
      // host connection BEFORE the host starts sending new signals.
      socket.to(roomId).emit('peer-reconnected', {
        userId,
        isHost: wasHost,
        socketId: socket.id,
      });

      ack?.({
        ok: true,
        roomId,
        isHost: wasHost,
        expiresAt: room.expiresAt,
        remainingSeconds: roomManager.remainingSeconds(roomId),
        currentOffer: room.currentOffer,
        members: wasHost ? roomManager.getLiveMembers(roomId) : undefined,
      });
    });

    // ---------- WEBRTC SIGNAL RELAY ----------
    socket.on('signal', (payload) => {
      const { targetSocketId, signal } = payload || {};
      if (!targetSocketId || !signal) return;

      const senderRoomId = socket.data.roomId;
      if (!senderRoomId) return;

      const targetSocket = io.sockets.sockets.get(targetSocketId);
      if (!targetSocket || targetSocket.data.roomId !== senderRoomId) return;

      io.to(targetSocketId).emit('signal', {
        fromSocketId: socket.id,
        signal,
      });
    });

    // ---------- HOST MAKES A FILE OFFER ----------
    socket.on('file-offer', (payload) => {
      const roomId = socket.data.roomId;
      const room = roomManager.getRoom(roomId);
      if (!room || socket.data.userId !== room.hostUserId) return;

      const totalSize = payload?.totalSize || 0;
      if (totalSize > MAX_UPLOAD_BYTES) {
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
      socket.to(roomId).emit('file-offer', offer);
    });

    // ---------- PEER RESPONDS TO OFFER ----------
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

    // ---------- TRANSFER STATUS RELAY ----------
    socket.on('transfer-status', (payload) => {
      const { targetSocketId, status, fileId, progress } = payload || {};
      if (!targetSocketId) return;
      io.to(targetSocketId).emit('transfer-status', {
        fromSocketId: socket.id,
        status,
        fileId,
        progress,
      });
    });

    // ---------- HOST TERMINATES ROOM ----------
    // Accepts roomId + userId in the payload so it works even right after
    // a reconnect, before rejoin-room has populated socket.data. Without
    // this, terminate fails with "room-not-found" because socket.data.roomId
    // is null on the fresh server-side socket.
    socket.on('terminate-room', (payload, ack) => {
      const roomId = payload?.roomId || socket.data.roomId;
      const userId = payload?.userId || socket.data.userId;
      const room = roomManager.getRoom(roomId);

      if (!room) {
        ack?.({ ok: false, error: 'room-not-found' });
        return;
      }
      if (!userId || userId !== room.hostUserId) {
        ack?.({ ok: false, error: 'not-host' });
        return;
      }
      roomManager.closeRoom(room.id, 'terminated');
      ack?.({ ok: true });
    });

    // ---------- LEAVE (explicit) ----------
    socket.on('leave-room', () => {
      handleLeave(socket, io, roomManager, { disconnected: false });
    });

    // ---------- DISCONNECT (unplanned) ----------
    socket.on('disconnect', () => {
      const roomId = socket.data.roomId;
      if (!roomId) return;
      const room = roomManager.getRoom(roomId);
      if (!room) return;

      if (socket.data.isHost) {
        roomManager.scheduleHostDisconnect(roomId);
        socket.to(roomId).emit('peer-disconnected-temporarily', { isHost: true });
      } else {
        roomManager.schedulePeerDisconnect(roomId, socket.id, socket.data.userId);
        io.to(room.hostSocketId).emit('peer-disconnected-temporarily', {
          peerSocketId: socket.id,
          peerUserId: socket.data.userId,
          isHost: false,
        });
      }
    });
  });
}

function handleLeave(socket, io, roomManager, { disconnected = false } = {}) {
  const roomId = socket.data.roomId;
  if (!roomId) return;
  const room = roomManager.getRoom(roomId);
  if (!room) return;

  if (socket.data.isHost) {
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