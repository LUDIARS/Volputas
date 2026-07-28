const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Writable } = require('node:stream');
const { ClaudeCliTextClient } = require('./claudeCliTextClient');
const { createLlmTextClient } = require('./createLlmTextClient');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdout.setEncoding = () => {};
  child.stderr = new EventEmitter();
  child.stderr.setEncoding = () => {};
  child.stdin = new Writable({ write(_c, _e, cb) { cb(); } });
  child.stdin.written = '';
  child.stdin._write = (chunk, _encoding, callback) => {
    child.stdin.written += chunk.toString();
    callback();
  };
  child.kill = () => {};
  return child;
}

test('claude-cli client streams the prompt over stdin and returns trimmed stdout', async () => {
  let spawned = null;
  const child = fakeChild();
  const client = new ClaudeCliTextClient({
    command: 'claude',
    model: 'claude-opus-5',
    spawnImpl: (command, args, options) => {
      spawned = { command, args, options };
      return child;
    },
  });

  const pending = client.generate({ system: 'SYS', prompt: 'PROMPT' });
  child.stdout.emit('data', '  評価テキスト\n');
  child.emit('close', 0);
  const result = await pending;

  assert.deepEqual(result, { text: '評価テキスト', model: 'claude-opus-5' });
  assert.equal(spawned.command, 'claude');
  assert.deepEqual(spawned.args, ['-p', '--output-format', 'text', '--model', 'claude-opus-5']);
  assert.equal(child.stdin.written, 'SYS\n\nPROMPT');
});

test('claude-cli client fails fast when the CLI binary is missing', async () => {
  const child = fakeChild();
  const client = new ClaudeCliTextClient({ spawnImpl: () => child });
  const pending = client.generate({ system: 's', prompt: 'p' });
  child.emit('error', Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }));
  await assert.rejects(pending, (error) => error.code === 'LLM_NOT_CONFIGURED');
});

test('claude-cli client surfaces non-zero exits and empty output as errors', async () => {
  const failing = fakeChild();
  const client = new ClaudeCliTextClient({ spawnImpl: () => failing });
  const failingRun = client.generate({ system: 's', prompt: 'p' });
  failing.stderr.emit('data', 'boom');
  failing.emit('close', 1);
  await assert.rejects(failingRun, (error) => error.code === 'LLM_CLI_FAILED' && /boom/.test(error.message));

  const empty = fakeChild();
  const emptyClient = new ClaudeCliTextClient({ spawnImpl: () => empty });
  const emptyRun = emptyClient.generate({ system: 's', prompt: 'p' });
  empty.stdout.emit('data', '   \n');
  empty.emit('close', 0);
  await assert.rejects(emptyRun, (error) => error.code === 'LLM_EMPTY_RESPONSE');
});

test('claude-cli client rejects unsafe command or model configuration', () => {
  assert.throws(
    () => new ClaudeCliTextClient({ command: 'claude; rm -rf /' }),
    (error) => error.code === 'LLM_NOT_CONFIGURED'
  );
  assert.throws(
    () => new ClaudeCliTextClient({ model: 'opus "x"' }),
    (error) => error.code === 'LLM_NOT_CONFIGURED'
  );
});

test('createLlmTextClient defaults to claude-cli and rejects unknown backends', () => {
  const defaultClient = createLlmTextClient({ env: {} });
  assert.equal(defaultClient.constructor.name, 'ClaudeCliTextClient');

  const anthropic = createLlmTextClient({ env: { VOLPUTAS_LLM_BACKEND: 'anthropic' } });
  assert.equal(anthropic.constructor.name, 'AnthropicTextClient');

  assert.throws(
    () => createLlmTextClient({ env: { VOLPUTAS_LLM_BACKEND: 'mock' } }),
    (error) => error.code === 'LLM_CONFIG_INVALID'
  );
});
