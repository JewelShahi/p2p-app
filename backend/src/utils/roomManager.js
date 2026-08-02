// roomManager.js
import { v4 as uuidv4 } from 'uuid';

const MIN_DURATION = 10;
const MAX_DURATION = 60;
const STEP = 5;
const DEFAULT_DURATION = 20;

// 5 minutes — if host or peer is disconnected longer than this, clean up
const DISCONNECT_GRACE_MS = 5 * 60 * 1000;

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

  /**
   * Remove ALL member entries for a given userId (there can be stale ones
   * from previous socket ids if the peer reconnected but we didn't clean up).
   * Returns the list of removed socketIds.
   */
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

  extendOrSetOffer(roomId, offer) {
    const room = this.getRoom(roomId);
    if (!room) return null;
    room.currentOffer = offer;
    return room;
  }

  /**
   * Return only members whose socket is actually connected right now.
   * This filters out ghost entries left from peers that reconnected under
   * a new socket id before we cleaned up the old one.
   */
  getLiveMembers(roomId) {
    const room = this.getRoom(roomId);
    if (!room) return [];
    return Array.from(room.members.values())
      .filter((m) => this.io.sockets.sockets.has(m.socketId))
      .map((m) => ({ socketId: m.socketId, userId: m.userId }));
  }

  // ---------- Grace-period disconnect handling ----------

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
      // Remove by userId to catch any duplicate entries too
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