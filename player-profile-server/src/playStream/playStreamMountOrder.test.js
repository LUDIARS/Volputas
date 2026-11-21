const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// 統計 API (SPEC-VO-PLAY-STREAM-STATS) は認証を求めない (到達判定は loopback と Origin)。
// '/api/v1' 直下の認証付きルータ (timeline / tuning / ability / impression*) より後ろに付けると、
// それらの router.use(authenticate) が先に 401 を返して届かない (2026-11-21 の反映時に実測)。
test('play-stream router is mounted before the authenticated /api/v1 routers', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const playStream = source.indexOf("app.use('/api/v1/play-stream'");
  const firstGeneric = source.indexOf("app.use('/api/v1',");
  assert.ok(playStream > 0, 'play-stream router is mounted');
  assert.ok(firstGeneric > 0, 'generic /api/v1 routers exist');
  assert.ok(playStream < firstGeneric, 'play-stream must come before app.use(\'/api/v1\', ...)');
});
