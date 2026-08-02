import { v4 as uuidv4 } from 'uuid';

// Allowed session durations in minutes: 10, 15, 20 ... 60 (5 min steps)
const MIN_DURATION = 10;
const MAX_DURATION = 60;
const STEP = 5;
const DEFAULT_DURATION = 20;

// How long to keep a room alive after the host or a peer disconnects
// (backgrounded tab, brief network drop, phone lock, etc.) before actually
// tearing things down. If they reconnect via 'rejoin-room' within this
// window, nothing is lost.
const DISCONNECT_GRACE_MS = 5 * 60 * 1000;

const isValidDuration = (minutes) => {
  if (typeof minutes !== 'number') return false;
  if (minutes < MIN_DURATION || minutes > MAX_DURATION) return false;
  return (minutes - MIN_DURATION) % STEP === 0;
}

/**
 * In-memory room store.
 * For production with multiple server instances, swap this Map for Redis.
 */
class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map(); // roomId -> room object
  }

  createRoom({ hostSocketId, durationMinutes }) {
    const duration = isValidDuration(durationMinutes) ? durationMinutes : DEFAULT_DURATION;
    const roomId = uuidv4();
    const now = Date.now();
    const expiresAt = now + duration * 60 * 1000;

    const room = {
      id: roomId,
      hostSocketId,
      hostUserId: uuidv4(), // stable id so host can reconnect and be recognized
      createdAt: now,
      durationMinutes: duration,
      expiresAt,
      status: 'open', // open | closed | expired
      members: new Map(), // socketId -> { socketId, userId, joinedAt, downloading: Set<fileId> }
      currentOffer: null, // { offerId, files: [{id,name,size}], totalSize, createdAt }
      expiryTimer: null,
      hostDisconnectTimer: null, // pending "close room" timer while host is temporarily disconnected
      pendingLeaves: new Map(), // userId -> { timer, socketId } for peers temporarily disconnected
    };

    room.expiryTimer = setTimeout(() => this.closeRoom(roomId, 'expired'), expiresAt - now);
    this.rooms.set(roomId, room);
    return room;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  isJoinable(room) {
    return room && room.status === 'open' && Date.now() < room.expiresAt;
  }

  addMember(roomId, socketId) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    const userId = uuidv4();
    const member = { socketId, userId, joinedAt: Date.now(), downloading: new Set() };
    room.members.set(socketId, member);
    return member;
  }

  removeMember(roomId, socketId) {
    const room = this.getRoom(roomId);
    if (!room) return;
    room.members.delete(socketId);
  }

  extendOrSetOffer(roomId, offer) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    room.currentOffer = offer;
    return room;
  }

  // ---------- Grace-period disconnect handling ----------

  // Host's socket dropped (backgrounded tab, network blip, phone lock).
  // Don't close the room yet — give them DISCONNECT_GRACE_MS to reconnect
  // via 'rejoin-room'. Only actually close if that window passes.
  scheduleHostDisconnect(roomId, graceMs = DISCONNECT_GRACE_MS) {
    const room = this.getRoom(roomId);
    if (!room) return;
    if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
    room.hostDisconnectTimer = setTimeout(() => {
      room.hostDisconnectTimer = null;
      this.closeRoom(roomId, 'host-disconnected');
    }, graceMs);
  }

  // Host reconnected in time — cancel the pending close.
  cancelHostDisconnect(roomId) {
    const room = this.getRoom(roomId);
    if (!room || !room.hostDisconnectTimer) return;
    clearTimeout(room.hostDisconnectTimer);
    room.hostDisconnectTimer = null;
  }

  // A peer's socket dropped. Don't remove them / tell the host they left
  // yet — give them the same grace period to reconnect.
  schedulePeerDisconnect(roomId, socketId, userId, graceMs = DISCONNECT_GRACE_MS) {
    const room = this.getRoom(roomId);
    if (!room || !userId) return;

    const existing = room.pendingLeaves.get(userId);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      room.pendingLeaves.delete(userId);
      room.members.delete(socketId);
      this.io.to(room.hostSocketId).emit('peer-left', {
        peerSocketId: socketId,
        peerUserId: userId,
        disconnected: true,
      });
    }, graceMs);

    room.pendingLeaves.set(userId, { timer, socketId });
  }

  // Peer reconnected in time — cancel the pending removal.
  cancelPeerDisconnect(roomId, userId) {
    const room = this.getRoom(roomId);
    if (!room) return;
    const pending = room.pendingLeaves.get(userId);
    if (!pending) return;
    clearTimeout(pending.timer);
    room.pendingLeaves.delete(userId);
  }

  closeRoom(roomId, reason = 'terminated') {
    const room = this.getRoom(roomId);
    if (!room) return;
    if (room.expiryTimer) clearTimeout(room.expiryTimer);
    if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
    for (const { timer } of room.pendingLeaves.values()) clearTimeout(timer);
    room.pendingLeaves.clear();

    room.status = reason === 'expired' ? 'expired' : 'closed';

    // Notify everyone in the room (host + peers) so clients can cancel in-flight transfers
    this.io.to(roomId).emit('room-closed', { roomId, reason });
    // Give clients a moment to receive the event, then clean up
    setTimeout(() => this.rooms.delete(roomId), 5000);
  }

  remainingSeconds(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return 0;
    return Math.max(0, Math.floor((room.expiresAt - Date.now()) / 1000));
  }

  // Housekeeping: sweep expired rooms in case timers were lost (e.g. server restart mid-flight)
  sweep() {
    const now = Date.now();
    for (const [roomId, room] of this.rooms.entries()) {
      if (room.status === 'open' && now >= room.expiresAt) {
        this.closeRoom(roomId, 'expired');
      }
    }
  }
}

export { RoomManager, isValidDuration, MIN_DURATION, MAX_DURATION, STEP, DEFAULT_DURATION };