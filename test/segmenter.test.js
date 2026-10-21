import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { rasterize } from '../src/rasterize.js';
import { displayWidth } from '../src/text.js';

const Native = Intl.Segmenter;
const lines = ['hello', '中文', '👩‍💻', '👨‍👩‍👧‍👦', 'e\u0301', 'a'];
function draw(values = lines) {
  const width = Math.max(...values.map(displayWidth)) + 4;
  return rasterize({ width, height: values.length + 2, boxes: [{ id: 'a', kind: 'node', shape: 'rect', x: 0, y: 0, width, height: values.length + 2, lines: values }], edges: [] });
}

test('native grapheme reuse preserves repeated and interleaved Unicode drawings', () => {
  const expected = draw();
  for (let i = 0; i < 20; i++) {
    assert.equal(draw(), expected);
    assert.match(draw(['other', '中']), /other/);
  }
  for (const line of lines) assert.ok(expected.includes(line));
});

test('replaced, missing, throwing and restored Segmenter retain their behavior', () => {
  const expected = draw();
  try {
    let constructions = 0;
    Intl.Segmenter = class Stateful {
      constructor() { constructions++; this.used = false; }
      segment(value) {
        assert.equal(this.used, false, 'custom instances are not reused');
        this.used = true;
        return new Native(undefined, { granularity: 'grapheme' }).segment(value);
      }
    };
    assert.equal(draw(), expected);
    assert.equal(constructions, lines.length);
    let reads = 0;
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, get() { reads++; return Native; } });
    assert.equal(draw(), expected);
    assert.equal(reads, lines.length * 2);
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, writable: true, value: undefined });
    assert.match(draw(['abc']), /abc/);
    Intl.Segmenter = class { constructor() { throw new Error('constructor sentinel'); } };
    assert.throws(() => draw(['abc']), /constructor sentinel/);
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, get() { throw new Error('getter sentinel'); } });
    assert.throws(() => draw(['abc']), /getter sentinel/);
  } finally {
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, writable: true, value: Native });
  }
  assert.equal(draw(), expected);
});

test('a replacement native constructor and independent iterators work across realms', () => {
  const expected = draw();
  try {
    Intl.Segmenter = vm.runInNewContext('Intl.Segmenter');
    assert.notEqual(Intl.Segmenter, Native);
    for (let i = 0; i < 5; i++) assert.equal(draw(), expected);
  } finally { Intl.Segmenter = Native; }
  assert.equal(draw(), expected);
});

test('native calls reuse one instance but create independent segments', () => {
  const original = Native.prototype.segment;
  const receivers = new Set();
  const segments = new Set();
  try {
    Native.prototype.segment = function(value) {
      receivers.add(this);
      const result = original.call(this, value);
      assert.ok(!segments.has(result));
      segments.add(result);
      return result;
    };
    draw(['abc', 'xyz']);
    draw(['abc', 'xyz']);
    // string-width has its own native instance; rasterization adds only one.
    assert.equal(receivers.size, 2);
    assert.ok(segments.size >= 4);
  } finally { Native.prototype.segment = original; }
});
