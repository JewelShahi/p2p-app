import rateLimit from 'express-rate-limit';

// Multiple phones on the same wifi/NAT share one public IP, so IP-based limits
// would throttle everyone in that house/office together. Instead we key off a
// client-generated id the frontend sends in this header — e.g. a UUID it
// creates once and keeps in localStorage per device/browser.
//
// Frontend requirement: send `X-Client-Id: <uuid>` on every request to /api/*.
// Requests missing it all share a single 'anonymous' bucket, so make sure the
// frontend always sets it once this is wired up.
const CLIENT_HEADER = 'x-client-id';

function clientKey(req) {
  return req.headers[CLIENT_HEADER] || 'anonymous';
}

// General safety net for the whole /api surface.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests/minute per client
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  validate: false, // we're intentionally not using req.ip, silence the IP-based validation checks
  message: { ok: false, error: 'too many requests, slow down' },
});

// Torrent info/download spins up a real WebTorrent swarm connection and can
// stream large amounts of data through the server — needs a much tighter cap
// than everyday REST calls like room lookups.
export const torrentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // 5 torrent requests per client per 5 minutes
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: clientKey,
  validate: false,
  message: { ok: false, error: 'too many torrent requests, please wait before trying again' },
});