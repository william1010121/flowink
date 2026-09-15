import test from 'node:test';
import assert from 'node:assert/strict';
import { placeLabels } from '../src/place-labels.js';
import { FlowInkError } from '../src/errors.js';

const box = (id, x, y, width, height, kind = 'node', lines = [id]) => ({ id, kind, x, y, width, height, lines, shape: 'rect' });
const edge = (id, points, label, extra = {}) => ({ id, points, arrowStart: 'none', arrowEnd: 'none', stroke: 'normal', ...(label ? { label } : {}), ...extra });

test('moves a bad label beside its route and expands the canvas', () => {
  const layout = {
    width: 6, height: 3,
    boxes: [box('a', 0, 0, 2, 3), box('b', 5, 0, 2, 3)],
    edges: [edge('ab', [{ x: 1, y: 1 }, { x: 5, y: 1 }], { x: -50, y: -20, lines: ['go'], width: 1, height: 1 })],
  };
  placeLabels(layout);
  const label = layout.edges[0].label;
  assert.ok(label.x >= 0 && label.y >= 0);
  assert.equal(label.width, 2);
  assert.ok(layout.width >= label.x + label.width);
  assert.ok(layout.height >= label.y + label.height);
  assert.notDeepEqual(label, { x: -50, y: -20, lines: ['go'], width: 1, height: 1 });
});

test('reserves group title strips, arrows, routes, and wide CJK cells', () => {
  const layout = {
    width: 15, height: 8,
    boxes: [box('group', 2, 1, 11, 6, 'subgraph', ['Group']), box('a', 4, 3, 3, 3)],
    edges: [
      edge('one', [{ x: 0, y: 4 }, { x: 4, y: 4 }], { x: 0, y: 4, lines: ['中文'], width: 1, height: 1 }, { arrowEnd: 'point' }),
      edge('two', [{ x: 4, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 7 }], { x: 0, y: 5, lines: ['other'], width: 5, height: 1 }),
    ],
  };
  placeLabels(layout);
  const first = layout.edges[0].label;
  assert.equal(first.width, 4);
  assert.ok(first.x >= 0 && first.y >= 0);
  assert.ok(first.x + first.width <= layout.width);
  const group = layout.boxes.find((item) => item.id === 'group');
  const titleCells = new Set();
  for (let x = group.x; x < group.x + group.width; x += 1) titleCells.add(`${x},${group.y + 1}`);
  for (const label of layout.edges.map((item) => item.label)) {
    for (let y = label.y; y < label.y + label.height; y += 1) for (let x = label.x; x < label.x + label.width; x += 1) {
      assert.equal(titleCells.has(`${x},${y}`), false);
    }
  }
});

test('keeps parallel labels distinct and does not use another edge route', () => {
  const layout = {
    width: 14, height: 8, boxes: [], edges: [
      edge('a', [{ x: 0, y: 2 }, { x: 13, y: 2 }], { lines: ['first'], width: 5, height: 1 }),
      edge('b', [{ x: 0, y: 5 }, { x: 13, y: 5 }], { lines: ['second'], width: 6, height: 1 }),
    ],
  };
  placeLabels(layout);
  const [a, b] = layout.edges.map((item) => item.label);
  assert.equal(a.y === 2, false);
  assert.equal(b.y === 5, false);
  assert.equal(a.y < b.y || b.y < a.y, true);
  assert.equal(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height, false);
});

test('leaves a blank cell between a label and a neighboring return route', () => {
  const layout = {
    width: 18, height: 14, boxes: [], edges: [
      // The label belongs to the horizontal route.  The nearby vertical
      // route must not become the apparent attachment point.
      edge('out', [{ x: 1, y: 8 }, { x: 12, y: 8 }], { lines: ['out'], width: 3, height: 1 }),
      edge('return', [{ x: 13, y: 2 }, { x: 13, y: 12 }], { lines: ['return'], width: 6, height: 1 }),
    ],
  };
  placeLabels(layout);
  const label = layout.edges[0].label;
  const vertical = layout.edges[1].points;
  assert.equal(label.y === 8, false);
  for (let y = label.y - 1; y <= label.y + label.height; y += 1) {
    for (let x = label.x - 1; x <= label.x + label.width; x += 1) {
      assert.equal(vertical.some((point) => point.x === x && point.y === y), false);
    }
  }
});

test('chooses a position strictly nearer its own route in a three-edge return graph', () => {
  const layout = {
    width: 35, height: 19,
    boxes: [box('A', 2, 11, 5, 8), box('B', 30, 6, 5, 7)],
    edges: [
      edge('first', [{ x: 6, y: 12 }, { x: 29, y: 12 }, { x: 29, y: 7 }, { x: 30, y: 7 }], { lines: ['first'], width: 5, height: 1 }, { arrowEnd: 'point' }),
      edge('second', [{ x: 6, y: 14 }, { x: 28, y: 14 }, { x: 28, y: 6 }, { x: 30, y: 6 }], { lines: ['second'], width: 6, height: 1 }, { arrowEnd: 'point' }),
      edge('return', [{ x: 30, y: 11 }, { x: 7, y: 11 }, { x: 7, y: 16 }, { x: 6, y: 16 }], { lines: ['return'], width: 6, height: 1 }, { arrowEnd: 'point' }),
    ],
  };
  placeLabels(layout);
  const routeCells = layout.edges.map((item) => new Set(routeCellsForTest(item.points).map(({ x, y }) => `${x},${y}`)));
  const distance = (label, cells) => Math.min(...[...cells].map((cell) => {
    const [x, y] = cell.split(',').map(Number);
    const dx = x < label.x ? label.x - x : x >= label.x + label.width ? x - (label.x + label.width - 1) : 0;
    const dy = y < label.y ? label.y - y : y >= label.y + label.height ? y - (label.y + label.height - 1) : 0;
    return dx + dy;
  }));
  for (let index = 0; index < layout.edges.length; index += 1) {
    const own = distance(layout.edges[index].label, routeCells[index]);
    const other = Math.min(...routeCells.filter((_, candidate) => candidate !== index).map((cells) => distance(layout.edges[index].label, cells)));
    assert.ok(own < other, `${layout.edges[index].id} is ambiguous: ${own} >= ${other}`);
  }
  assert.ok(layout.edges[1].label.y > 14, 'second label should remain below its own outbound line');
});

function routeCellsForTest(points) {
  const cells = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    let x = a.x;
    let y = a.y;
    cells.push({ x, y });
    while (x !== b.x || y !== b.y) {
      x += dx;
      y += dy;
      cells.push({ x, y });
    }
  }
  return cells;
}

test('places a labelled self-loop in adjacent whitespace', () => {
  const layout = {
    width: 8, height: 6, boxes: [box('a', 3, 2, 3, 2)],
    edges: [edge('loop', [{ x: 3, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 3, y: 3 }], { lines: ['retry'], width: 5, height: 1 }, { arrowEnd: 'point' })],
  };
  placeLabels(layout);
  const label = layout.edges[0].label;
  assert.ok(label.x >= 0 && label.y >= 0);
  assert.equal(label.x >= 3 && label.x < 6 && label.y >= 2 && label.y < 4, false);
});

test('rejects malformed diagonal routes with FlowInkError', () => {
  assert.throws(() => placeLabels({ width: 2, height: 2, boxes: [], edges: [edge('bad', [{ x: 0, y: 0 }, { x: 1, y: 1 }], { lines: ['x'] })] }), (error) => error instanceof FlowInkError && error.code === 'NON_ORTHOGONAL_EDGE');
});

test('positions a label at the middle of a long segment, not its first cell', () => {
  const graph = { boxes: [], width: 21, height: 3, edges: [{
    id: 'long', points: [{ x: 0, y: 2 }, { x: 20, y: 2 }],
    arrowStart: 'none', arrowEnd: 'none', stroke: 'normal',
    label: { x: 0, y: 0, width: 4, height: 1, lines: ['word'] },
  }] };
  placeLabels(graph);
  assert.equal(graph.edges[0].label.x, 8);
});
