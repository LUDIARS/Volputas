const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { Readable } = require('node:stream');
const { UploadSpool } = require('./uploadSpool');

function limits(byteLength, signal = new AbortController().signal) {
  return { maximumBytes: 2 * 1024 ** 3, byteLength, timeoutSeconds: 5,
    expiresAt: new Date(Date.now() + 4_000).toISOString(), signal };
}
async function fixture(exercise) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'voluptas-spool-test-'));
  try { await exercise(new UploadSpool(root), root); }
  finally {
    if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('voluptas-spool-test-')) throw new Error('Unexpected fixture cleanup path');
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('private capture preserves binary bytes and can be adopted only once', async () => {
  await fixture(async (spool, root) => {
    const bytes = Buffer.from([0, 255, 128, 13, 10]);
    const captured = await spool.capture(Readable.from([bytes]), limits(bytes.length));
    assert.deepEqual(Buffer.from(await captured.body.arrayBuffer()), bytes);
    const destination = path.join(root, 'protected-file');
    const adopting = captured.adopt(destination);
    assert.throws(() => captured.adopt(destination), /cannot be adopted/);
    await adopting;
    await captured.dispose(); await captured.dispose();
    assert.deepEqual(await fs.readFile(destination), bytes);
    assert.deepEqual(await fs.readdir(root), ['protected-file']);
    assert.equal(spool.leases, 0); assert.equal(spool.bytes, 0);
  });
});

for (const actual of [2, 4]) test(`reserved byte count3 rejects actual${actual} and releases its file/lease`, async () => {
  await fixture(async (spool, root) => {
    await assert.rejects(spool.capture(Readable.from([Buffer.alloc(actual)]), limits(3)));
    assert.deepEqual(await fs.readdir(root), []);
    assert.equal(spool.leases, 0); assert.equal(spool.bytes, 0);
  });
});

test('abort of a stalled reader prevents adoption and releases capacity', async () => {
  await fixture(async (spool, root) => {
    const controller = new AbortController();
    let started;
    const reading = new Promise(resolve => { started = resolve; });
    const stream = new Readable({ read() { started(); } });
    const result = spool.capture(stream, limits(1, controller.signal));
    await reading; controller.abort();
    await assert.rejects(result);
    assert.equal(stream.destroyed, true);
    assert.deepEqual(await fs.readdir(root), []);
    assert.equal(spool.leases, 0); assert.equal(spool.bytes, 0);
  });
});

test('a completed capture still rejects adoption after revocation/owner abort', async () => {
  await fixture(async (spool, root) => {
    const controller = new AbortController();
    const captured = await spool.capture(Readable.from([Buffer.from('x')]), limits(1, controller.signal));
    controller.abort();
    assert.throws(() => captured.adopt(path.join(root, 'must-not-exist')), /owner ended/);
    await captured.dispose();
    assert.deepEqual(await fs.readdir(root), []);
  });
});

test('aggregate quota is enforced before reading bytes', async () => {
  await fixture(async (spool, root) => {
    const a = new AbortController(), b = new AbortController();
    const first = spool.capture(new Readable({ read() {} }), limits(2 * 1024 ** 3, a.signal));
    const second = spool.capture(new Readable({ read() {} }), limits(2 * 1024 ** 3, b.signal));
    try {
      await assert.rejects(spool.capture(new Readable({ read() { assert.fail('Must not read'); } }), limits(1)),
        error => error.code === 'UPLOAD_CAPACITY_UNAVAILABLE');
    } finally { a.abort(); b.abort(); await Promise.allSettled([first, second]); }
    assert.deepEqual(await fs.readdir(root), []);
    assert.equal(spool.leases, 0); assert.equal(spool.bytes, 0);
  });
});
