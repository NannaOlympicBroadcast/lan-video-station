'use strict';
module.exports = function errorHandler(err, _req, res, _next) {
  console.error('[error]', err.stack || err.message);
  if (res.headersSent) return;
  res.status(err.status || 500).json({ error: err.message || 'internal error' });
};
