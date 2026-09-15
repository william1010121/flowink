import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterize, validateLayout } from '../src/rasterize.js';
import { FlowInkError } from '../src/errors.js';

const box = (id, x, y, width, height, lines = [id], shape = 'rect') => ({
  id, kind: 'node', x, y, width, height, lines, shape,
});

test('draws boxes, an orthogonal route, and an arrow outside the target border', () => {
  const output = rasterize({
    width: 12,
    height: 5,
    boxes: [box('a', 0, 1, 3, 3), box('b', 9, 1, 3, 3)],
    edges: [{ id: 'e', points: [{ x: 2, y: 2 }, { x: 9, y: 2 }], arrowStart: 'none', arrowEnd: 'point', stroke: 'normal' }],
  });
  const lines = output.split('\n');
  assert.ok(lines.includes('+-+      +-+'));
  const middle = lines.find((line) => line.includes('|a|'));
  assert.match(middle, /\|a\|.*>\|b\|/);
  assert.equal(middle.at(-1), '|', 'the arrow leaves the target border intact');
});

test('supports Unicode strokes, rounded and diamond approximations, and wide labels', () => {
  const output = rasterize({
    width: 24,
    height: 11,
    boxes: [
      box('round', 0, 1, 8, 3, ['開始'], 'round'),
      box('diamond', 12, 1, 7, 5, ['是？'], 'diamond'),
      box('circle', 0, 7, 8, 3, ['好'], 'circle'),
    ],
    edges: [{ id: 'e', points: [{ x: 7, y: 2 }, { x: 9, y: 2 }, { x: 9, y: 3 }, { x: 12, y: 3 }], arrowStart: 'none', arrowEnd: 'circle', stroke: 'thick' }],
  }, { charset: 'unicode' });
  assert.match(output, /開始/);
  assert.match(output, /是？/);
  assert.match(output, /╭|╮/);
  assert.match(output, /╱|╲/);
  assert.match(output, /○/);
  assert.match(output, /━/);
});

test('marks a nonjoining crossing distinctly from a turn', () => {
  const output = rasterize({
    width: 9,
    height: 5,
    boxes: [],
    edges: [
      { id: 'horizontal', points: [{ x: 0, y: 2 }, { x: 8, y: 2 }], stroke: 'normal' },
      { id: 'vertical', points: [{ x: 4, y: 0 }, { x: 4, y: 4 }], stroke: 'normal' },
    ],
  });
  assert.equal(output.split('\n')[2][4], '#');
  const turn = rasterize({ width: 3, height: 3, boxes: [], edges: [{ id: 'turn', points: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }] }] });
  assert.equal(turn.split('\n').find((line) => line.includes('+'))?.at(1), '+');
  assert.equal(rasterize({
    width: 5,
    height: 5,
    boxes: [],
    edges: [
      { id: 'h', points: [{ x: 0, y: 2 }, { x: 4, y: 2 }] },
      { id: 'v', points: [{ x: 2, y: 0 }, { x: 2, y: 4 }] },
    ],
  }, { charset: 'unicode' }).split('\n')[2][2], '╳');
});

test('rejects routes that would be silently hidden by a node or a partially overlapping box', () => {
  assert.throws(() => rasterize({
    width: 9,
    height: 5,
    boxes: [box('node', 3, 1, 3, 3)],
    edges: [{ id: 'e', points: [{ x: 0, y: 2 }, { x: 8, y: 2 }] }],
  }), (error) => error instanceof FlowInkError && error.code === 'EDGE_BOX_COLLISION');
  assert.throws(() => validateLayout({
    width: 8,
    height: 8,
    boxes: [box('a', 0, 0, 5, 5), box('b', 3, 3, 4, 4)],
    edges: [],
  }), (error) => error instanceof FlowInkError && error.code === 'BOX_OVERLAP');
  assert.throws(() => validateLayout({
    width: 8,
    height: 8,
    boxes: [box('outer-node', 0, 0, 7, 7), box('inner-node', 2, 2, 3, 3)],
    edges: [],
  }), (error) => error instanceof FlowInkError && error.code === 'BOX_OVERLAP');
});

test('strips trailing blanks while preserving labels and multiline edge labels', () => {
  const output = rasterize({
    width: 16,
    height: 6,
    boxes: [box('a', 0, 0, 5, 4, ['A'])],
    edges: [{ id: 'e', points: [{ x: 4, y: 2 }, { x: 8, y: 2 }], label: { x: 6, y: 2, lines: ['go', 'now'], width: 3, height: 2 } }],
  });
  assert.ok(output.includes('go'));
  assert.ok(output.includes('now'));
  assert.ok(output.split('\n').every((line) => !/[ \t]$/.test(line)));
});

test('does not let a label or group title hide another route', () => {
  assert.throws(() => rasterize({
    width: 5,
    height: 5,
    boxes: [],
    edges: [
      { id: 'h', points: [{ x: 0, y: 2 }, { x: 4, y: 2 }], label: { x: 2, y: 2, lines: ['h'], width: 1, height: 1 } },
      { id: 'v', points: [{ x: 2, y: 0 }, { x: 2, y: 4 }] },
    ],
  }), (error) => error instanceof FlowInkError && error.code === 'LABEL_COLLISION');
  assert.throws(() => rasterize({
    width: 9,
    height: 5,
    boxes: [{ id: 'group', kind: 'subgraph', x: 1, y: 1, width: 7, height: 3, lines: ['Group'], shape: 'subgraph' }],
    edges: [{ id: 'route', points: [{ x: 0, y: 2 }, { x: 8, y: 2 }] }],
  }), (error) => error instanceof FlowInkError && error.code === 'LABEL_COLLISION');
});

test('does not let an arrow hide another edge route', () => {
  assert.throws(() => rasterize({
    width: 5,
    height: 4,
    boxes: [],
    edges: [
      { id: 'arrowed', points: [{ x: 0, y: 1 }, { x: 4, y: 1 }], arrowEnd: 'point' },
      { id: 'through', points: [{ x: 4, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 1 }, { x: 3, y: 2 }] },
    ],
  }), (error) => error instanceof FlowInkError && error.code === 'ARROW_COLLISION');
});

test('rejects ambiguous self-crossings, collinear overlaps, and co-located bends', () => {
  assert.throws(() => rasterize({
    width: 7,
    height: 6,
    boxes: [],
    edges: [{ id: 'self', points: [{ x: 0, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 5 }, { x: 2, y: 5 }, { x: 2, y: 0 }, { x: 6, y: 0 }] }],
  }), (error) => error instanceof FlowInkError && error.code === 'ROUTE_COLLISION');
  assert.throws(() => rasterize({
    width: 9,
    height: 4,
    boxes: [],
    edges: [
      { id: 'left', points: [{ x: 0, y: 2 }, { x: 5, y: 2 }] },
      { id: 'right', points: [{ x: 3, y: 2 }, { x: 8, y: 2 }] },
    ],
  }), (error) => error instanceof FlowInkError && error.code === 'ROUTE_COLLISION');
  assert.throws(() => rasterize({
    width: 5,
    height: 6,
    boxes: [],
    edges: [
      { id: 'a', points: [{ x: 0, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 5 }] },
      { id: 'b', points: [{ x: 4, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 1 }] },
    ],
  }), (error) => error instanceof FlowInkError && error.code === 'ROUTE_COLLISION');
});
