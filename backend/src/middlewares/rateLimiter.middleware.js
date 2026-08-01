import rateLimit from 'express-rate-limit';

// General safety net for the whole /api surface.
// Defaults to safe IP-based rate limiting (handles IPv4 + IPv6 out-of-the-box)
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests/minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'too many requests, slow down' },
});

// Strict limiter for heavy torrent lookups and streams
export const torrentLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5, // 5 torrent requests per 5 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'too many torrent requests, please wait before trying again' },
});