import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';
import { FlowInkError } from '../src/errors.js';

test('parses nodes, labels, directions, and edge labels', () => {
  const graph = parse('flowchart LR\n  A[Start] -->|next| B{Ready?}');
  assert.equal(graph.direction, 'LR');
  assert.deepEqual(graph.nodes.map(({ id, label, shape }) => ({ id, label, shape })), [
    { id: 'A', label: 'Start', shape: 'square' },
    { id: 'B', label: 'Ready?', shape: 'diamond' },
  ]);
  assert.deepEqual(graph.edges[0], {
    id: 'L0', source: 'A', target: 'B', label: 'next', labelType: 'text',
    arrowStart: 'none', arrowEnd: 'point', stroke: 'normal', length: 1,
    styles: [], classes: [], metadata: {},
  });
});

test('preserves edge IDs and edge shape metadata', () => {
  const graph = parse('flowchart LR\n A e1@==> B\n e1@{ animate: true, animation: fast }');
  assert.equal(graph.edges[0].id, 'e1');
  assert.equal(graph.edges[0].stroke, 'thick');
  assert.equal(graph.edges[0].animate, true);
  assert.equal(graph.edges[0].metadata.animation, 'fast');
  assert.equal(graph.nodes.some(({ id }) => id === 'e1'), false);
});

test('retains subgraph membership, local direction, classes, and links', () => {
  const graph = parse([
    'flowchart TB',
    ' subgraph one [Group]',
    ' direction LR',
    ' A --> B',
    ' end',
    ' classDef hot fill:#f00,stroke:#000',
    ' class A hot',
    ' click A href "https://example.com" "tip" _blank',
  ].join('\n'));
  assert.equal(graph.subgraphs[0].id, 'one');
  assert.equal(graph.subgraphs[0].direction, 'LR');
  assert.deepEqual(new Set(graph.subgraphs[0].nodeIds), new Set(['A', 'B']));
  assert.deepEqual(graph.nodes.find(({ id }) => id === 'A').styles, ['fill:#f00', 'stroke:#000']);
  assert.equal(graph.nodes.find(({ id }) => id === 'A').metadata.interaction.href, 'https://example.com');
});

test('preprocesses comments and frontmatter while retaining original source', () => {
  const source = '---\ntitle: demo\n---\nflowchart TB\n%% ignored\nA --> B';
  const graph = parse(source);
  assert.equal(graph.source, source);
  assert.equal(graph.metadata.frontmatter.title, 'demo');
  assert.deepEqual(graph.edges.map(({ source, target }) => ({ source, target })), [{ source: 'A', target: 'B' }]);
});

test('wraps invalid syntax in FlowInkError', () => {
  assert.throws(() => parse('flowchart LR\n A -->'), (error) => {
    assert.ok(error instanceof FlowInkError);
    assert.equal(error.code, 'PARSE_ERROR');
    return true;
  });
});
