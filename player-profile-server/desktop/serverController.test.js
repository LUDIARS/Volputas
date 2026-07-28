const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { DesktopServerController } = require('./serverController');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killCalls = 0;
  child.kill = () => {
    child.killCalls += 1;
    return true;
  };
  return child;
}

test('resolves the local URL and kills the owned utility process on stop', async () => {
  const child = fakeChild();
  const controller = new DesktopServerController({
    forkProcess: () => child,
    startupTimeoutMs: 100,
    onDiagnostic() {},
  });

  const starting = controller.start();
  child.emit('message', { type: 'ready', url: 'http://127.0.0.1:32100' });
  assert.equal(await starting, 'http://127.0.0.1:32100');
  assert.equal(controller.stop(), true);
  assert.equal(child.killCalls, 1);
  assert.equal(controller.stop(), false);
});

test('rejects when the utility process exits before it is ready', async () => {
  const child = fakeChild();
  const controller = new DesktopServerController({
    forkProcess: () => child,
    startupTimeoutMs: 100,
    onDiagnostic() {},
  });

  const starting = controller.start();
  child.emit('exit', 1);
  await assert.rejects(starting, /exited with code 1/);
});
