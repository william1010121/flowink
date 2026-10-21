import test from 'node:test';
import assert from 'node:assert/strict';
import { minimum, maximum } from '../src/extrema.js';
import { parse } from '../src/index.js';
import { prepareNode } from '../src/text.js';
import { validateLayout } from '../src/rasterize.js';
import { placeLabels } from '../src/place-labels.js';

test('bounded extrema preserve empty, seed, NaN, infinity and signed-zero semantics', () => {
  const values = [-Infinity, -3, -0, 0, 2, Infinity, NaN];
  for (const a of values) for (const b of values) for (const c of values) {
    const input = [a, b, c];
    assert.ok(Object.is(minimum(input), Math.min(...input)));
    assert.ok(Object.is(maximum(input), Math.max(...input)));
    for (const seed of [0, 1, -Infinity, Infinity]) {
      assert.ok(Object.is(minimum(input, seed), Math.min(seed, ...input)));
      assert.ok(Object.is(maximum(input, seed), Math.max(seed, ...input)));
    }
  }
  assert.equal(minimum([]), Infinity);
  assert.equal(maximum([]), -Infinity);
  assert.equal(minimum([], 0), 0);
  assert.equal(maximum([], 1), 1);
  assert.ok(Object.is(minimum([-0]), -0));
  assert.ok(Object.is(maximum([-0]), -0));
  assert.equal(maximum(Array(150001).fill(2), 0), 2);
  assert.equal(minimum(Array(150001).fill(-2), 0), -2);
});

test('large valid shape-data scalar parses repeatedly and malformed data still recovers', () => {
  // The sibling key preserves the parser's existing common-indent convention.
  const source = 'flowchart TB\n A@{ label: |\n' + '  a\n'.repeat(150001) + 'shape: rect\n}';
  for (let i = 0; i < 2; i++) {
    const graph = parse(source);
    assert.equal(graph.nodes.length, 1);
    assert.equal(graph.nodes[0].metadata.label, 'a\n'.repeat(150001));
    assert.throws(() => parse('flowchart TB\n A@{ label: [ }'));
    assert.equal(parse('flowchart TB\n A --> B').nodes.length, 2);
  }
});

test('many-line node and edge preparation avoid argument-count limits without raster allocation', () => {
  const count = 150001;
  const node = prepareNode({ label: Array(count).fill('a').join('\n') });
  assert.equal(node.lines.length, count);
  assert.equal(node.width, 5);
  const graph = {
    width: 1, height: 1, boxes: [],
    edges: [{ id: 'e', points: [{ x: 0, y: 0 }], label: { x: 0, y: 0, lines: Array(count).fill('a') } }],
  };
  const checked = validateLayout(graph);
  assert.equal(checked.labels[0].width, 1);
  assert.equal(checked.labels[0].height, count);
  assert.equal(checked.height, count);
  assert.equal(graph.height, 1, 'validation does not mutate input dimensions');
  assert.equal(validateLayout({ width: 0, height: 0, boxes: [], edges: [] }).width, 0);
});

test('many coincident route points translate without argument-count limits', () => {
  const graph = {
    width: 1, height: 1, boxes: [],
    edges: [{ id: 'e', points: Array.from({ length: 150001 }, () => ({ x: -1, y: -1 })) }],
  };
  placeLabels(graph);
  assert.ok(graph.edges[0].points.every(p => p.x === 0 && p.y === 0));
  const snapshot = JSON.stringify(graph);
  placeLabels(graph);
  assert.equal(JSON.stringify(graph), snapshot);
});
