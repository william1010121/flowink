import test from 'node:test';
import stringWidth from 'string-width';
import assert from 'node:assert/strict';
import { displayWidth, labelLines, prepareNode } from '../src/text.js';
import { parse } from '../src/parse.js';

test('displayWidth counts wide graphemes and multiline labels', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('中文🙂'), 6);
  assert.equal(displayWidth('short\nlonger'), 6);
});

test('labelLines expands tabs at four-column stops and normalizes CRLF', () => {
  assert.deepEqual(labelLines('中\tA\r\nB\t🙂'), ['中  A', 'B   🙂']);
  assert.equal(displayWidth(labelLines('中\tA')[0]), 5);
});

test('labelLines decodes Mermaid and HTML entities', () => {
  assert.deepEqual(labelLines('#quot;Hi#quot; #9829; #amp;'), ['"Hi" ♥ &']);
  assert.deepEqual(labelLines('A &lt; B &amp;&amp; C &#x1F642;'), ['A < B && C 🙂']);
  assert.deepEqual(labelLines('&#9829; #9829; &#x1F600; #x1F600;'), ['♥ ♥ 😀 😀']);
  assert.deepEqual(labelLines('&amp;lt;'), ['&lt;']);
});

test('labelLines preserves text while removing markdown and HTML formatting', () => {
  assert.deepEqual(labelLines('**bold** *em* [link](https://example.test) `code`', 'markdown'), ['bold em link code']);
  assert.deepEqual(labelLines('first<br>second\n\n<div>third</div>'), ['first', 'second', '', 'third']);
  assert.deepEqual(labelLines('![diagram alt](diagram.png)', 'markdown'), ['diagram alt']);
  assert.deepEqual(labelLines('<script>this remains text</script>'), ['this remains text']);
  assert.deepEqual(labelLines('\\<literal\\>', 'markdown'), ['<literal>']);
  assert.deepEqual(labelLines('A < B > C'), ['A < B > C']);
  assert.deepEqual(labelLines('A <span title="a > b">x</span> C'), ['A x C']);
  assert.deepEqual(labelLines('#lt;b#gt; remains literal'), ['<b> remains literal']);
  assert.deepEqual(labelLines('`_code_` _em_', 'markdown'), ['_code_ em']);
  assert.deepEqual(labelLines('line 1\n  line 2', 'markdown'), ['line 1', '  line 2']);
});

test('prepareNode computes padded dimensions and keeps original shape metadata', () => {
  const node = prepareNode({
    id: 'decision',
    label: '中文\n🙂',
    labelType: 'markdown',
    shape: 'hexagon',
    classes: ['important'],
    metadata: { source: 'fixture' },
  });

  assert.equal(node.shape, 'rect');
  assert.equal(node.width, 13);
  assert.equal(node.height, 5);
  assert.deepEqual(node.lines, ['[hexagon]', '中文', '🙂']);
  assert.equal(node.metadata.source, 'fixture');
  assert.equal(node.metadata.originalShape, 'hexagon');
  assert.equal(node.metadata.originalProperties.id, 'decision');
  assert.equal(node.metadata.placeholder, true);
});

test('prepareNode maps common shapes and creates image/icon placeholders', () => {
  assert.deepEqual(
    (({ width, height }) => ({ width, height }))(prepareNode({ label: 'A', shape: 'rect' })),
    { width: 5, height: 3 },
  );
  assert.equal(prepareNode({ label: 'A', shape: 'rounded' }).shape, 'round');
  assert.equal(prepareNode({ label: 'A', shape: 'circle' }).shape, 'circle');
  assert.equal(prepareNode({ label: 'A', shape: 'diamond' }).shape, 'diamond');
  const longCircle = prepareNode({ label: 'a very long circle label', shape: 'circle' });
  assert.equal(longCircle.height, 5);
  assert.ok(longCircle.width > longCircle.height);
  assert.equal(prepareNode({ label: 'A', shape: 'proc' }).shape, 'rect');
  assert.equal(prepareNode({ label: 'A', shape: 'diam' }).shape, 'diamond');
  assert.equal(prepareNode({ label: 'A', shape: 'dbl-circ' }).shape, 'circle');
  assert.equal(prepareNode({ label: 'A', shape: 'rect', metadata: { shape: 'diamond' } }).shape, 'diamond');
  assert.equal(prepareNode({ label: 'A', shape: 'circle', metadata: { shape: 'diamond' } }).shape, 'circle');
  assert.deepEqual(prepareNode({ label: 'A', metadata: { shape: 'rect', label: 'metadata label' } }).lines, ['metadata label']);
  assert.deepEqual(prepareNode({ shape: 'image' }).lines, ['[image]']);
  assert.deepEqual(prepareNode({ shape: 'icon' }).lines, ['[icon]']);
  const iconData = prepareNode({ label: '', shape: 'rect', metadata: { icon: 'fa:home', form: 'circle', pos: 'b' } });
  assert.equal(iconData.shape, 'circle');
  assert.deepEqual(iconData.lines, ['[icon]']);
  assert.equal(iconData.metadata.placeholderKind, 'icon');
  const parserShapeData = prepareNode(parse('flowchart TD\n A@{ icon: "fa:home", form: circle }').nodes[0]);
  assert.equal(parserShapeData.shape, 'circle');
  assert.deepEqual(parserShapeData.lines, ['[icon]']);
  const imageData = prepareNode(parse('flowchart TD\n A@{ img: "https://example.test/x.png", w: 60 }').nodes[0]);
  assert.equal(imageData.shape, 'image');
  assert.deepEqual(imageData.lines, ['[image]']);
  assert.equal(imageData.metadata.img, 'https://example.test/x.png');
});

test('displayWidth handles many lines without an argument-count limit', () => {
  const text = 'x\n'.repeat(150_000) + '中文';
  for (let i = 0; i < 3; i++) assert.equal(displayWidth(text), 4);
  assert.equal(displayWidth('\n'.repeat(150_000)), 0);
});

test('displayWidth preserves normalization, coercion, and recovery after errors', () => {
  for (const [value, width] of [[null, 0], [undefined, 0], ['', 0], ['\r\n\r\n', 0], ['中文\rA\r\n🙂\n', 4], [42, 2], [false, 5], [Symbol('x'), 9]]) {
    assert.equal(displayWidth(value), width);
  }
  const failure = new Error('coercion failed');
  assert.throws(() => displayWidth({ toString() { throw failure; } }), error => error === failure);
  assert.equal(displayWidth('e\u0301\n👨‍👩‍👧‍👦\n中'), 2);
});


test('displayWidth matches the original algorithm for seeded Unicode multiline inputs', () => {
  let seed = 0x4f10a;
  const random = limit => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % limit; };
  const fragments = ['', 'abc', '中文', '🙂', 'e\u0301', '👨‍👩‍👧‍👦', '\t', '\n', '\r', '\r\n', '\u001b[31mred\u001b[0m', '🏳️‍🌈'];
  for (let trial = 0; trial < 1000; trial++) {
    const value = Array.from({ length: random(80) }, () => fragments[random(fragments.length)]).join('');
    const expected = Math.max(0, ...value.replace(/\r\n?/g, '\n').split('\n').map(line => stringWidth(line)));
    assert.equal(displayWidth(value), expected, `trial ${trial}`);
  }
});
