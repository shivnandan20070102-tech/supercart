export const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`);
  res.status(404);
  next(error);
};

export const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
  // Production: internal error details kabhi client ko mat bhejo — sirf
  // generic message. Asli wajah console.error par log hoti hai.
  if (process.env.NODE_ENV !== 'development') {
    console.error('❌ [errorHandler]', err?.message || err);
    return res.status(statusCode).json({
      success: false,
      message: 'Something went wrong.',
    });
  }
  res.status(statusCode).json({
    success: false,
    message: err.message,
    stack: err.stack,
  });
};
