import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';

test('retains default link styling even when there are no edges', () => {
  const graph = parse('flowchart TB\nlinkStyle default stroke:red');
  assert.deepEqual(graph.metadata.defaultStyle, ['stroke:red']);
  assert.deepEqual(graph.edges, []);
});

test('keeps upstream subgraph ownership when a node is listed twice', () => {
  const graph = parse('flowchart TB\nsubgraph one\nA\nend\nsubgraph two\nA\nB\nend');
  assert.deepEqual(graph.subgraphs.map(({ id, nodeIds }) => ({ id, nodeIds })), [
    { id: 'one', nodeIds: ['A'] },
    { id: 'two', nodeIds: ['B'] },
  ]);
  assert.equal(graph.nodes.find((node) => node.id === 'A').parentId, 'one');
});

test('applies interaction declarations only to already declared elements', () => {
  const graph = parse('flowchart TB\nclick A callback\nA-->B\nclick B callback2');
  assert.equal(graph.nodes.find((node) => node.id === 'A').metadata.interaction, undefined);
  assert.equal(graph.nodes.find((node) => node.id === 'B').metadata.interaction.callback, 'callback2');
});

test('retains text styles and synthetic subgraph styles', () => {
  const graph = parse([
    'flowchart TB',
    'subgraph one [Group]',
    'A',
    'end',
    'style one fill:#eee',
    'classDef hot color:red,fill:#f00',
  ].join('\n'));
  assert.deepEqual(graph.subgraphs[0].styles, ['fill:#eee']);
  assert.deepEqual(graph.metadata.classTextStyles.hot, ['color:red']);
});

test('preserves link interpolation and avoids generated ID collisions', () => {
  const graph = parse('flowchart TB\nA-->B\nB L0@-->C\nlinkStyle default interpolate basis\nlinkStyle 1 interpolate cardinal\nlinkStyle 1 stroke:red\nlinkStyle 1 stroke:blue');
  assert.deepEqual(graph.edges.map((edge) => edge.id), ['L1', 'L0']);
  assert.equal(graph.edges[0].metadata.interpolate, 'basis');
  assert.equal(graph.edges[1].metadata.interpolate, 'cardinal');
  assert.deepEqual(graph.edges[1].styles, ['stroke:blue', 'fill:none']);
  assert.equal(graph.edges[1].metadata.isUserDefinedId, true);
});
