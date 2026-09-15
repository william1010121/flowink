import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../src/layout.js';
import { FlowInkError } from '../src/errors.js';

const node = (id, label = id, parentId) => ({ id, label, labelType: 'text', shape: 'rect', parentId, styles: [], classes: [], metadata: {} });
const group = (id, nodeIds, parentId, direction) => ({ id, label: id, nodeIds, parentId, direction, styles: [], classes: [], metadata: {} });
const edge = (id, source, target, extras = {}) => ({ id, source, target, label: '', labelType: 'text', arrowStart: 'none', arrowEnd: 'point', stroke: 'normal', length: 1, styles: [], classes: [], metadata: {}, ...extras });

function graph(direction = 'TB') {
  return { source: 'test', direction, nodes: [node('a'), node('b')], edges: [edge('ab', 'a', 'b')], subgraphs: [], classes: {}, metadata: {} };
}

test('returns integer boxes and orthogonal border-to-border routes in every direction', async () => {
  for (const direction of ['TB', 'BT', 'LR', 'RL']) {
    const result = await layout(graph(direction));
    assert.equal(result.boxes.length, 2);
    assert.equal(result.edges.length, 1);
    for (const box of result.boxes) {
      for (const key of ['x', 'y', 'width', 'height']) assert.equal(Number.isInteger(box[key]), true);
    }
    const route = result.edges[0].points;
    assert.ok(route.length >= 2);
    for (let i = 1; i < route.length; i += 1) assert.equal(route[i - 1].x === route[i].x || route[i - 1].y === route[i].y, true);
    const byId = new Map(result.boxes.map((box) => [box.id, box]));
    const border = (point, box) => point.x === box.x || point.x === box.x + box.width - 1 || point.y === box.y || point.y === box.y + box.height - 1;
    assert.equal(border(route[0], byId.get('a')), true);
    assert.equal(border(route.at(-1), byId.get('b')), true);
  }
});

test('keeps nested groups, compound endpoints, loops, and parallel edges', async () => {
  const input = {
    source: 'test', direction: 'LR',
    nodes: [node('a', 'A', 'outer'), node('b', 'B', 'inner'), node('c', 'C', 'inner'), node('d')],
    subgraphs: [group('outer', ['a', 'inner']), group('inner', ['b', 'c'], 'outer', 'TB')],
    edges: [edge('ab', 'a', 'b'), edge('to-group', 'd', 'outer'), edge('from-group', 'outer', 'd'), edge('self-group', 'outer', 'outer'), edge('self-node', 'c', 'c'), edge('parallel-1', 'a', 'd'), edge('parallel-2', 'a', 'd')],
    classes: {}, metadata: {},
  };
  const result = await layout(input);
  assert.deepEqual(new Set(result.boxes.map((box) => box.id)), new Set(['a', 'b', 'c', 'd', 'outer', 'inner']));
  assert.deepEqual(new Set(result.edges.map((item) => item.id)), new Set(input.edges.map((item) => item.id)));
  assert.ok(result.boxes.find((box) => box.id === 'inner').parentId === 'outer');
  for (const item of result.edges) assert.ok(item.points.length >= 2, item.id);
});

test('rejects malformed containment and missing edge endpoints explicitly', async () => {
  await assert.rejects(layout({ ...graph(), nodes: [node('a', 'a', 'missing'), node('b')] }), (error) => error instanceof FlowInkError && error.code === 'INVALID_GRAPH');
  await assert.rejects(layout({ ...graph(), edges: [edge('bad', 'a', 'missing')] }), (error) => error instanceof FlowInkError && error.code === 'INVALID_GRAPH');
});

test('layout calls are deterministic and isolated', async () => {
  const input = graph('LR');
  const [first, second] = await Promise.all([layout(input), layout(input)]);
  assert.deepEqual(second, first);
});
