import { MIN_DURATION, MAX_DURATION, STEP, DEFAULT_DURATION } from '../utils/roomManager.js';

// GET /api/rooms/config
function getConfig(req, res) {
  res.json({ min: MIN_DURATION, max: MAX_DURATION, step: STEP, default: DEFAULT_DURATION });
}

// GET /api/rooms/:roomId
// Used when someone opens the shared link, before the socket connection is made,
// so the frontend can show "this room expired" instead of attempting to join.
function getRoom(req, res) {
  const roomManager = req.app.locals.roomManager;
  const room = roomManager.getRoom(req.params.roomId);

  if (!room) {
    return res.status(404).json({ ok: false, error: 'room-not-found' });
  }

  res.json({
    ok: true,
    joinable: roomManager.isJoinable(room),
    status: room.status,
    remainingSeconds: roomManager.remainingSeconds(room.id),
    memberCount: room.members.size,
  });
}

export { getConfig, getRoom };