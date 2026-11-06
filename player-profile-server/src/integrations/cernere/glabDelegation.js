const path = require('node:path');
const config = require('../../config');
const { AppError } = require('../../middleware/errorHandler');
const { UploadSpool } = require('./uploadSpool');

const MAXIMUM_JSON_BYTES = 1024 * 1024;
let client;

async function getComposite() {
  if (!client) {
    const settings = config.cernere;
    if (!settings.baseUrl || !settings.projectClientId || !settings.projectClientSecret) {
      throw new AppError(503, 'CERNERE_CONFIGURATION_REQUIRED', 'Scoped Cernere integration is not configured');
    }
    const { CernereComposite } = await import('../../../vendor/cernere-composite/dist/composite.js');
    client ??= new CernereComposite({ cernereUrl: settings.baseUrl, projectKey: 'volputas',
      clientId: settings.projectClientId, clientSecret: settings.projectClientSecret });
  }
  return client;
}

function requestOwner(req, res) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => { if (!res.writableEnded) abort(); };
  req.once('aborted', abort); res.once('close', close);
  return { signal: controller.signal, isCurrent: () => !controller.signal.aborted,
    abort,
    dispose() { req.off('aborted', abort); res.off('close', close); controller.abort(); } };
}

function incoming(req, action, scheme) {
  const authorization = req.headers.authorization;
  const requestId = req.headers['x-cernere-request-id'];
  if (typeof authorization !== 'string' || !authorization.startsWith(`${scheme} `)
    || !/^[A-Za-z0-9_-]{43}$/.test(authorization.slice(scheme.length + 1))
    || typeof requestId !== 'string' || !requestId || requestId.length > 128) {
    throw new AppError(401, 'SCOPED_DELEGATION_REQUIRED', 'A current scoped delegation is required');
  }
  for (const name of ['authorization', 'x-cernere-request-id']) {
    if (req.rawHeaders.filter((_value, index) => index % 2 === 0 && req.rawHeaders[index].toLowerCase() === name).length !== 1) {
      throw new AppError(400, 'AMBIGUOUS_DELEGATION', 'Duplicate delegation headers are invalid');
    }
  }
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(', '));
  }
  return { token: authorization.slice(scheme.length + 1), operation: {
    action, method: req.method, path: req.originalUrl, resource: req.originalUrl, requestId, headers,
  } };
}

async function readBody(req, signal) {
  const chunks = []; let length = 0;
  const abort = () => req.destroy();
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted || req.readableEnded || req.body !== undefined) throw new AppError(400, 'RAW_BODY_REQUIRED', 'Unparsed request bytes are required');
    for await (const chunk of req) {
      if (signal.aborted) throw new AppError(408, 'REQUEST_ENDED', 'Request ended');
      length += chunk.length;
      if (length > MAXIMUM_JSON_BYTES) throw new AppError(413, 'BODY_TOO_LARGE', 'Request body is too large');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, length);
  } finally { signal.removeEventListener('abort', abort); }
}

/** Explicit integration operations only; authority proofs never replace data ACL.
 * @implements SPEC-GLAB-SCOPED-EVIDENCE-UPLOAD
 */
function createGlabDelegation({ composite = getComposite, spool = new UploadSpool(path.join(config.profileMedia.root, '.upload-spool')) } = {}) {
  return {
    async run(req, res, { action, risk, authorizeResource, execute }) {
      const owner = requestOwner(req, res);
      const timeout = setTimeout(() => { owner.abort(); if (!req.complete) req.destroy(); }, 30_000); timeout.unref?.();
      let executing = false;
      try {
        const { token, operation } = incoming(req, action, 'Cernere-Delegation');
        const body = await readBody(req, owner.signal);
        if (['GET', 'HEAD'].includes(req.method) && body.length) throw new AppError(400, 'UNEXPECTED_BODY', 'Read operations cannot carry a body');
        const sdk = await composite();
        return await sdk.delegations.run(token, { ...operation, body }, { risk,
          authorizeResource: decision => owner.isCurrent() && decision.sourceProject === 'glab' && authorizeResource(decision),
          execute: decision => { if (!owner.isCurrent()) throw new AppError(408, 'REQUEST_ENDED', 'Request ended'); executing = true; return execute(body, decision); },
        });
      } catch (error) {
        if (executing || error instanceof AppError) throw error;
        throw new AppError(503, 'SCOPED_AUTHORITY_UNAVAILABLE', 'Current authority could not be confirmed');
      } finally { clearTimeout(timeout); owner.dispose(); }
    },
    async upload(req, res, { limits, authorizeResource, execute }) {
      const owner = requestOwner(req, res);
      let captured, executing = false;
      try {
        const { token, operation } = incoming(req, 'evidence.media.write', 'Cernere-Upload');
        const sdk = await composite();
        return await sdk.uploads.run(token, operation, { risk: 'important', limits,
          signal: owner.signal, isCurrent: owner.isCurrent,
          capture: async reserved => { captured = await spool.capture(req, reserved); return captured; },
          authorizeResource: decision => owner.isCurrent() && decision.sourceProject === 'glab' && authorizeResource(decision),
          execute: (_body, decision) => { executing = true; return execute(captured, decision, owner); },
        });
      } catch (error) {
        if (executing || error instanceof AppError) throw error;
        if (error.code === 'MEDIA_TOO_LARGE') throw new AppError(413, error.code, 'Upload exceeds its reserved size');
        if (error.code === 'UPLOAD_CAPACITY_UNAVAILABLE') throw new AppError(503, error.code, 'Private upload capacity is unavailable');
        if (error.code === 'UPLOAD_EXPIRED') throw new AppError(408, error.code, 'Upload ended');
        throw new AppError(503, 'SCOPED_AUTHORITY_UNAVAILABLE', 'Current authority could not be confirmed');
      } finally { owner.dispose(); }
    },
  };
}

function closeGlabDelegation() { client?.dispose(); client = undefined; }
module.exports = { createGlabDelegation, closeGlabDelegation };
