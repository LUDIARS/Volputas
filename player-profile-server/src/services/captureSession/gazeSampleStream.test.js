const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { parseGazeSampleLines } = require('./gazeSampleStream');

async function collect(iterable) {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
}

test('NDJSON samples are parsed across chunk boundaries and validated', async () => {
  const body = [
    '{"sessionMs":0,"x":0.5,"y":0.5}',
    '{"sessionMs":33,"x":0.51,"y":0.49,"valid":true}',
    '',
    '{"sessionMs":66,"x":1.4,"y":0.2,"valid":false}',
  ].join('\n');
  // Split mid-line to prove the parser reassembles partial lines.
  const stream = Readable.from([body.slice(0, 20), body.slice(20, 61), body.slice(61)]);
  const samples = await collect(parseGazeSampleLines(stream));
  assert.deepEqual(samples, [
    { sessionMs: 0, x: 0.5, y: 0.5, valid: true },
    { sessionMs: 33, x: 0.51, y: 0.49, valid: true },
    { sessionMs: 66, x: 1.4, y: 0.2, valid: false },
  ]);
});

test('malformed lines, out-of-range samples and oversized uploads are rejected', async () => {
  await assert.rejects(
    collect(parseGazeSampleLines(Readable.from(['{"sessionMs":0,"x":0.5\n']))),
    /line 1 is not valid JSON/
  );
  await assert.rejects(
    collect(parseGazeSampleLines(Readable.from(['{"sessionMs":-5,"x":0.5,"y":0.5}\n']))),
    /sessionMs is out of range/
  );
  await assert.rejects(
    collect(parseGazeSampleLines(
      Readable.from(['{"sessionMs":0,"x":0,"y":0}\n{"sessionMs":1,"x":0,"y":0}\n']),
      { maximumSamples: 1 }
    )),
    /exceeds 1 samples/
  );
  await assert.rejects(
    collect(parseGazeSampleLines(Readable.from([`{"pad":"${'x'.repeat(4000)}"`]))),
    /newline-delimited/
  );
});
