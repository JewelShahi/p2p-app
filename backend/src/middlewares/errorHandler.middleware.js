// Centralized error handler
const errorHandler = (err, req, res, next) => {
  console.error(err);

  if (res.headersSent) {
    // Response already started streaming - can't send a fresh JSON body, just hand off to express's default handler.
    return next(err);
  }

  res.status(err.status || 500).json({
    ok: false,
    error: err.message || 'internal server error',
  });
}

export default errorHandler;
