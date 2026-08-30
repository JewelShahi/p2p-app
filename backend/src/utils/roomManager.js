// roomManager.js
import { v4 as uuidv4 } from 'uuid';

const MIN_DURATION = 10;
const MAX_DURATION = 60;
const STEP = 5;
const DEFAULT_DURATION = 20;

// FIX (mobile): 2 min is plenty for a phone opening the gallery, and short
// enough to clean up genuinely-gone peers. 5 min left ghosts around too long.
const DISCONNECT_GRACE_MS = 2 * 60 * 1000;

const isValidDuration = (minutes) => {
  if (typeof minutes !== 'number') return false;
  if (minutes < MIN_DURATION || minutes > MAX_DURATION) return false;
  return (minutes - MIN_DURATION) % STEP === 0;
};

class RoomManager {
  constructor(io) {
    this.io = io;
    this.rooms = new Map();
  }

  createRoom({ hostSocketId, durationMinutes }) {
    const duration = isValidDuration(durationMinutes) ? durationMinutes : DEFAULT_DURATION;
    const roomId = uuidv4();
    const now = Date.now();
    const expiresAt = now + duration * 60 * 1000;

    const room = {
      id: roomId,
      hostSocketId,
      hostUserId: uuidv4(),
      createdAt: now,
      durationMinutes: duration,
      expiresAt,
      status: 'open',
      members: new Map(),
      currentOffer: null,
      expiryTimer: null,
      hostDisconnectTimer: null,
      pendingLeaves: new Map(),
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

  removeMemberByUserId(roomId, userId) {
    const room = this.getRoom(roomId);
    if (!room) return [];
    const removed = [];
    for (const [sid, member] of room.members.entries()) {
      if (member.userId === userId) {
        room.members.delete(sid);
        removed.push(sid);
      }
    }
    return removed;
  }

  // FIX (ghost users): remove every stale entry for this user EXCEPT the
  // socket that is (re)joining right now. Prevents the reconnect race where
  // the old socket's later disconnect wipes the fresh member.
  removeStaleUserSockets(roomId, userId, keepSocketId) {
    const room = this.getRoom(roomId);
    if (!room) return;
    for (const [sid, member] of room.members.entries()) {
      if (member.userId === userId && sid !== keepSocketId) {
        room.members.delete(sid);
      }
    }
  }

  // True if this user has at least one socket that is currently connected.
  hasLiveSocketForUser(roomId, userId) {
    const room = this.getRoom(roomId);
    if (!room) return false;
    for (const member of room.members.values()) {
      if (member.userId === userId && this.io.sockets.sockets.has(member.socketId)) {
        return true;
      }
    }
    return false;
  }

  extendOrSetOffer(roomId, offer) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    room.currentOffer = offer;
    return room;
  }

  getLiveMembers(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return [];
    // Dedupe by userId so the host never sees the same person twice.
    const byUser = new Map();
    for (const m of room.members.values()) {
      if (this.io.sockets.sockets.has(m.socketId)) {
        byUser.set(m.userId, { socketId: m.socketId, userId: m.userId });
      }
    }
    return Array.from(byUser.values());
  }

  scheduleHostDisconnect(roomId, graceMs = DISCONNECT_GRACE_MS) {
    const room = this.getRoom(roomId);
    if (!room) return;
    if (room.hostDisconnectTimer) clearTimeout(room.hostDisconnectTimer);
    room.hostDisconnectTimer = setTimeout(() => {
      room.hostDisconnectTimer = null;
      this.closeRoom(roomId, 'host-disconnected');
    }, graceMs);
  }

  cancelHostDisconnect(roomId) {
    const room = this.getRoom(roomId);
    if (!room || !room.hostDisconnectTimer) return;
    clearTimeout(room.hostDisconnectTimer);
    room.hostDisconnectTimer = null;
  }

  schedulePeerDisconnect(roomId, socketId, userId, graceMs = DISCONNECT_GRACE_MS) {
    const room = this.getRoom(roomId);
    if (!room || !userId) return;

    const existing = room.pendingLeaves.get(userId);
    if (existing) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      room.pendingLeaves.delete(userId);

      // ── THE RACE FIX ──
      // If the user already reconnected on a newer socket, do NOT remove them
      // and do NOT tell the host they left.
      if (this.hasLiveSocketForUser(roomId, userId)) return;

      this.removeMemberByUserId(roomId, userId);
      this.io.to(room.hostSocketId).emit('peer-left', {
        peerSocketId: socketId,
        peerUserId: userId,
        disconnected: true,
      });
    }, graceMs);

    room.pendingLeaves.set(userId, { timer, socketId });
  }

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
    this.io.to(roomId).emit('room-closed', { roomId, reason });
    setTimeout(() => this.rooms.delete(roomId), 5000);
  }

  remainingSeconds(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return 0;
    return Math.max(0, Math.floor((room.expiresAt - Date.now()) / 1000));
  }

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
