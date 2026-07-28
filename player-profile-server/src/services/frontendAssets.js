const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

function frontendIndexPath(frontendDirectory) {
  return path.join(frontendDirectory, 'index.html');
}

function assertFrontendBuild(frontendDirectory) {
  if (!fs.existsSync(frontendIndexPath(frontendDirectory))) {
    throw Object.assign(new Error('Frontend build is missing; run the start script through npm'), {
      code: 'FRONTEND_BUILD_MISSING',
    });
  }
}

function isBackendPath(requestPath) {
  return requestPath === '/api'
    || requestPath.startsWith('/api/')
    || requestPath === '/auth'
    || requestPath.startsWith('/auth/')
    || requestPath === '/health'
    || requestPath.startsWith('/health/');
}

function mountFrontend(app, frontendDirectory) {
  assertFrontendBuild(frontendDirectory);
  app.use(express.static(frontendDirectory));
  app.get('*', (req, res, next) => {
    if (isBackendPath(req.path) || !req.accepts('html')) return next();
    return res.sendFile(frontendIndexPath(frontendDirectory));
  });
}

module.exports = {
  assertFrontendBuild,
  frontendIndexPath,
  isBackendPath,
  mountFrontend,
};
