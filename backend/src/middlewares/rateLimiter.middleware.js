import rateLimit from 'express-rate-limit';

// General safety net for the whole /api surface
// Defaults to safe IP-based rate limiting
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests/minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'too many requests, slow down' },
});
