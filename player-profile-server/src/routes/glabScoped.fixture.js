// Test transport only; the real shared SDK/host parser and gate are exercised.
const { createGlabDelegation } = require('../integrations/cernere/glabDelegation');
const REQUEST_ID = '22222222-2222-4222-8222-222222222222';
function fixtureDelegation(user, authority) {
  return createGlabDelegation({ composite: async () => {
    const { CompositeDelegations } = await import('../../vendor/cernere-composite/dist/delegation.js');
    return { delegations: new CompositeDelegations(authority ?? (async (_action, operation) => ({
      allowed: true, projectKey: 'voluptas', sourceProject: 'glab',
      user: { displayName: 'Fixture', email: null, role: 'general', ...user }, requestId: operation.requestId,
      risk: operation.action === 'review.analysis.catalog' ? 'read' : operation.method === 'GET' ? 'sensitive_read' : 'important',
      expiresAt: new Date(Date.now() + 4_000).toISOString(),
    })), 'voluptas') };
  } });
}
function scopedFetch(url, init = {}) {
  return fetch(url, { ...init, headers: { authorization: `Cernere-Delegation ${'a'.repeat(43)}`,
    'x-cernere-request-id': REQUEST_ID, ...init.headers } });
}
module.exports = { fixtureDelegation, scopedFetch };
