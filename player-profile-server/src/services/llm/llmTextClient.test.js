const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Writable } = require('node:stream');
const { AnthropicTextClient } = require('./anthropicTextClient');
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

test('claude-cli client limits Read access to the supplied temporary frames', async () => {
  let spawned = null;
  const child = fakeChild();
  const frameDirectory = path.resolve('temporary-frames');
  const framePath = path.join(frameDirectory, 'frame-01.jpg');
  const client = new ClaudeCliTextClient({
    spawnImpl: (command, args, options) => {
      spawned = { command, args, options };
      return child;
    },
  });

  const pending = client.generate({ system: 'SYS', prompt: `画像: ${framePath}`, imagePaths: [framePath] });
  child.stdout.emit('data', 'ok');
  child.emit('close', 0);
  await pending;

  assert.deepEqual(spawned.args, [
    '-p', '--output-format', 'text', '--allowedTools', 'Read(./frame-01.jpg)',
  ]);
  assert.equal(spawned.options.cwd, frameDirectory);
  assert.equal(child.stdin.written, 'SYS\n\n画像: ./frame-01.jpg');
  assert.doesNotMatch(child.stdin.written, new RegExp(frameDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  await assert.rejects(
    client.generate({ system: 's', prompt: 'p', imagePaths: [path.join(frameDirectory, 'secret.txt')] }),
    (error) => error.code === 'LLM_IMAGE_PATH_INVALID' && error.statusCode === 400
  );
});

test('anthropic client sends supplied frames as image blocks', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'volputas-llm-image-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const framePath = path.join(directory, 'frame-01.jpg');
  await fs.writeFile(framePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  let request = null;
  const client = new AnthropicTextClient({ apiKey: 'test-key', model: 'test-model' });
  client.client = {
    beta: {
      messages: {
        create: async (input) => {
          request = input;
          return { model: 'test-model', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
        },
      },
    },
  };

  assert.deepEqual(await client.generate({ system: 's', prompt: 'p', imagePaths: [framePath] }), {
    text: 'ok', model: 'test-model',
  });
  assert.equal(request.messages[0].content[0].type, 'image');
  assert.equal(request.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.equal(request.messages[0].content[0].source.data, '/9j/2Q==');
  assert.deepEqual(request.messages[0].content[1], { type: 'text', text: 'p' });

  await client.generate({ system: 's', prompt: `frame: ${framePath}`, imagePaths: [framePath] });
  assert.equal(request.messages[0].content[1].text, 'frame: [attached image 1]');
  assert.doesNotMatch(request.messages[0].content[1].text, /volputas-llm-image-/);
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
