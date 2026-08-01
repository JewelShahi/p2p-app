// Centralized error handler — must be registered after all routes in server.js.
// Catches anything passed to next(err) or thrown synchronously in a route/controller.
const errorHandler = (err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    // Response already started streaming (e.g. mid-download) — can't send a
    // fresh JSON body, just hand off to Express's default handler.
    return next(err);
  }

  res.status(err.status || 500).json({
    ok: false,
    error: err.message || 'internal server error',
  });
}

export default errorHandler;