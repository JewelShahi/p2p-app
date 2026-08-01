import { v4 as uuidv4 } from 'uuid';

// Allowed session durations in minutes: 10, 15, 20 ... 60 (5 min steps)
const MIN_DURATION = 10;
const MAX_DURATION = 60;
const STEP = 5;
const DEFAULT_DURATION = 20;

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

  closeRoom(roomId, reason = 'terminated') {
    const room = this.getRoom(roomId);
    if (!room) return;
    if (room.expiryTimer) clearTimeout(room.expiryTimer);
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