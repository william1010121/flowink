import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse, render, renderGraph } from '../src/index.js';
import { layout } from '../src/layout.js';

const fixture = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const missingIds = new Set(['flow-direction.spec.js:66:35', 'subgraph.spec.js:243:35', 'subgraph.spec.js:266:35', 'subgraph.spec.js:291:35']);

test('nested cross-level edges retain all routes in the four pinned upstream regressions', async () => {
  const { cases } = await fixture('./fixtures/upstream/cases.json');
  const selected = cases.filter(item => missingIds.has(item.id));
  assert.equal(selected.length, 4);
  for (const { source } of selected) {
    const graph = parse(source); const result = await layout(graph);
    assert.equal(result.edges.length, graph.edges.length);
    assert.deepEqual(new Set(result.boxes.map(box => box.id)), new Set([...graph.nodes, ...graph.subgraphs].map(item => item.id)));
    for (const edge of result.edges) assert.ok(edge.points.length >= 2);
    for (const charset of ['ascii', 'unicode']) {
      const output = await render(source, { charset });
      assert.ok(output.length > 0);
      assert.equal(await renderGraph(graph, { charset }), output);
      assert.equal(await renderGraph(JSON.parse(JSON.stringify(graph)), { charset }), output);
    }
  }
});

test('cross-level routing respects isolated local directions in every root/local combination', async () => {
  for (const root of ['TB', 'BT', 'LR', 'RL']) for (const local of ['TB', 'BT', 'LR', 'RL']) {
    const source = `flowchart ${root}\nsubgraph A\ndirection ${local}\na\nsubgraph B\nc-->d\nend\na-->c\nend`;
    const result = await layout(parse(source));
    const box = id => result.boxes.find(item => item.id === id);
    for (const [from, to] of [['a', 'c'], ['c', 'd']]) {
      const axis = local === 'TB' || local === 'BT' ? 'y' : 'x';
      const sign = local === 'BT' || local === 'RL' ? -1 : 1;
      assert.ok(sign * (box(to)[axis] - box(from)[axis]) > 0, `${root}/${local} ${from}->${to}`);
    }
    assert.equal(result.edges.length, 2);
    assert.equal(result.boxes.length, 5); // no internal helper frames exposed
    assert.ok((await render(source)).length > 0);
  }
});

test('known valid local directions and external group/node endpoints keep exact output', async () => {
  for (const item of await fixture('./fixtures/nested-edges/baseline.json')) {
    for (const charset of ['ascii', 'unicode']) assert.equal(await render(item.source, { charset }), item[charset], `${item.name}/${charset}`);
  }
});


test('repaired containers inherit the nearest graph direction when not explicit', async () => {
  for (const direction of ['TB', 'BT', 'LR', 'RL']) {
    const source = `flowchart ${direction}\nsubgraph A\na\nsubgraph B\nc\nend\na-->c\nend`;
    const result = await layout(parse(source));
    const a = result.boxes.find(box => box.id === 'a');
    const c = result.boxes.find(box => box.id === 'c');
    const axis = direction === 'TB' || direction === 'BT' ? 'y' : 'x';
    const sign = direction === 'BT' || direction === 'RL' ? -1 : 1;
    assert.ok(sign * (c[axis] - a[axis]) > 0, direction);
    assert.ok((await render(source)).length > 0);
  }
});

test('nested repair is repeatable, concurrent, and recovers after rejected inputs', async () => {
  const source = 'flowchart TB\nsubgraph A\ndirection LR\na\nsubgraph B\nc\nend\na-->c\nend\nA-->z';
  const expected = await render(source);
  await assert.rejects(render('flowchart TB\nA -->'), { code: 'PARSE_ERROR' });
  const results = await Promise.all(Array.from({ length: 4 }, () => render(source)));
  assert.ok(results.every(result => result === expected));
  assert.equal(await render(source), expected);
});


test('nested helper graphs preserve public identities, input data, and compound endpoints', async () => {
  const sources = [
    'flowchart TB\nsubgraph Outer\ndirection LR\nsubgraph A\ndirection TB\na\nsubgraph B\nc\nend\na-->c\nend\nx\nsubgraph D\ny\nend\nx -->y\nend',
    'flowchart TB\nsubgraph Outer\ndirection LR\nx\nsubgraph A\na\nsubgraph B\nc\nend\na-->c\nend\nx -->A\nend\nOuter-->z',
    'flowchart TB\nsubgraph A\nhg0[Helper-like user ID]\nsubgraph B\n__proto__[Prototype-like user ID]\nend\nhg0-->__proto__\nend\nA-->constructor[Constructor]',
    'flowchart TB\nsubgraph A\na\nsubgraph B\nc\nend\na-->|first|c\na-.->|second|c\na~~~c\nend\nA-->A',
  ];
  for (const source of sources) {
    const graph = parse(source); const original = JSON.stringify(graph);
    const result = await layout(graph);
    assert.equal(JSON.stringify(graph), original);
    assert.deepEqual(new Set(result.boxes.map(box => box.id)), new Set([...graph.nodes, ...graph.subgraphs].map(item => item.id)));
    assert.equal(result.edges.length, graph.edges.length);
    for (const charset of ['ascii', 'unicode']) assert.ok((await render(source, { charset })).length > 0);
  }
});

test('nested helpers inherit the nearest explicit ancestor and preserve public parents', async () => {
  for (const direction of ['TB', 'BT', 'LR', 'RL']) {
    const source = `flowchart TB\nsubgraph Outer\ndirection ${direction}\nsubgraph A\na\nsubgraph B\nc\nend\na-->c\nend\nx\nend`;
    const result = await layout(parse(source));
    const box = id => result.boxes.find(item => item.id === id);
    const axis = direction === 'TB' || direction === 'BT' ? 'y' : 'x';
    const sign = direction === 'BT' || direction === 'RL' ? -1 : 1;
    assert.ok(sign * (box('c')[axis] - box('a')[axis]) > 0, direction);
    for (const [id, parentId] of [['a', 'A'], ['c', 'B'], ['B', 'A'], ['A', 'Outer'], ['x', 'Outer']]) {
      assert.equal(box(id).parentId, parentId);
    }
  }
});

test('compound bidirectional arrows avoid enclosing box borders', async () => {
  const source = 'flowchart TB\nsubgraph A\nsubgraph B\nc\nend\nend\nA<-->B';
  const graph = parse(source);
  for (const charset of ['ascii', 'unicode']) {
    const output = await render(source, { charset });
    assert.ok(output.length > 0);
    assert.equal(await renderGraph(JSON.parse(JSON.stringify(graph)), { charset }), output);
  }
});
