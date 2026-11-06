const { AppError } = require('../middleware/errorHandler');
const { createGlabDelegation } = require('../integrations/cernere/glabDelegation');

function requestJson(body) {
  if (!body.length) return undefined;
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
    if (value === null || typeof value !== 'object') throw new Error('A JSON object or array is required');
    return value;
  }
  catch { throw new AppError(400, 'INVALID_JSON', 'Malformed JSON request body'); }
}

function dispatch(req, res, next) {
  return new Promise((resolve, reject) => {
    const done = () => { res.off('finish', done); res.off('close', done); resolve(); };
    res.once('finish', done); res.once('close', done);
    try { next(); }
    catch (error) { res.off('finish', done); res.off('close', done); reject(error); }
  });
}

/** Run downstream Express handlers only inside the SDK's classified operation.
 * The router must be mounted before any body parser.
 * @implements SPEC-GLAB-SCOPED-CATALOG-DELEGATION
 */
function operationGate(operation, delegation, verified) {
  return async (req, res, next) => {
    // Express GET also matches HEAD; this contract requires an exact method.
    if (verified.has(req) || req.method !== operation.method) return next();
    try {
      const params = Object.freeze({ ...req.params });
      await delegation.run(req, res, {
        action: operation.action, risk: operation.risk,
        authorizeResource: decision => operation.authorizeResource(decision, params),
        execute: async (body, decision) => {
          // Identity is from current Cr authority, never a supplied owner/role.
          req.cernereUser = { ...decision.user };
          if (body.length && !req.is('application/json')) throw new AppError(415, 'JSON_CONTENT_TYPE_REQUIRED', 'A JSON content type is required');
          req.body = requestJson(body);
          verified.add(req);
          await dispatch(req, res, next);
        },
      });
    } catch (error) { return next(error); }
  };
}

/** Route declarations use the same Express matcher and params as the handlers,
 * eliminating a second, independently parsed request-path classifier.
 * @implements SPEC-GLAB-SCOPED-CATALOG-DELEGATION
 */
function installGlabRequestGates(router, operations, { delegation = createGlabDelegation() } = {}) {
  const verified = new WeakSet();
  const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
  for (const declaration of operations) {
    if (!methods.has(declaration.method) || typeof declaration.path !== 'string' || !declaration.path.startsWith('/')
      || typeof declaration.authorizeResource !== 'function') throw new TypeError('Explicit destination operation declarations are required');
    const operation = Object.freeze({ ...declaration });
    router[operation.method.toLowerCase()](operation.path, operationGate(operation, delegation, verified));
  }
  router.use((req, _res, next) => verified.has(req) ? next()
    : next(new AppError(403, 'UNCLASSIFIED_GLAB_OPERATION', 'This integration operation is not classified')));
}

module.exports = { installGlabRequestGates };
