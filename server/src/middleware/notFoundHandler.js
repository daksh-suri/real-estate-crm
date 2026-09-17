function notFoundHandler(req, res) {
  res.status(404).json({
    error: {
      message: `Cannot ${req.method} ${req.originalUrl}`,
      status: 404,
    },
  });
}

module.exports = notFoundHandler;
