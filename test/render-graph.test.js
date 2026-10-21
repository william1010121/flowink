import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { snapshotGraph } from '../src/graph.js';
import * as api from '../src/index.js';

const source = 'flowchart LR\nA[Start] -->|next| B[Done]';
const examples = [source,
  'flowchart TB\nA --> B{Ready?}\nB -->|yes| C\nB -->|no| D',
  'flowchart LR\nsubgraph Outer\nsubgraph Inner\nA --> B\nend\nC\nend\nB --> C\nC --> D',
  'flowchart RL\nA["開始 👩‍💻"] --> B["完成<br/>下一步"]',
  'flowchart LR\nA@{ shape: cloud, label: "Cloud" } --> B',
  'flowchart LR\nA["`**Bold** and _italic_`"] --> B',
];

test('renderGraph is a named public function and matches source rendering/JSON roundtrips', async () => {
  assert.equal(typeof api.renderGraph, 'function');
  for (const input of examples) for (const charset of ['ascii', 'unicode']) {
    const graph = api.parse(input);
    const expected = await api.render(input, { charset });
    assert.equal(await api.renderGraph(graph, { charset }), expected);
    assert.equal(await api.renderGraph(JSON.parse(JSON.stringify(graph)), { charset }), expected);
  }
});

test('renderGraph preserves existing layout failures without importing routing repairs', async () => {
  const input = 'flowchart BT\nB --> A\nA --- A\nA --- A\nA --- A';
  for (const charset of ['ascii', 'unicode']) {
    const graph = api.parse(input);
    let expected;
    await assert.rejects(api.render(input, { charset }), error => {
      assert.equal(error.code, 'LAYOUT_EMPTY_EDGE');
      expected = error;
      return true;
    });
    for (const data of [graph, JSON.parse(JSON.stringify(graph))]) {
      await assert.rejects(api.renderGraph(data, { charset }), error => {
        assert.equal(error.name, expected.name);
        assert.equal(error.code, expected.code);
        assert.equal(error.message, expected.message);
        return true;
      });
    }
    assert.equal(await api.renderGraph(api.parse(source), { charset }), await api.render(source, { charset }));
  }
});

test('renderGraph uses edited graph data, not the original source', async () => {
  const graph = api.parse(source);
  graph.nodes[0].label = 'Edited';
  graph.source = 'not Mermaid';
  const output = await api.renderGraph(graph);
  assert.match(output, /Edited/);
  assert.doesNotMatch(output, /Start/);
});

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

test('frozen input is unchanged and concurrent/repeated calls are isolated', async () => {
  const graph = freeze(api.parse(source));
  const original = JSON.stringify(graph);
  const expected = await api.render(source);
  const outputs = await Promise.all(Array.from({ length: 4 }, () => api.renderGraph(graph)));
  assert.ok(outputs.every(output => output === expected));
  assert.equal(await api.renderGraph(graph), expected);
  assert.equal(JSON.stringify(graph), original);
});

test('snapshot isolation includes labels, metadata, edge endpoints, and membership', async () => {
  const input = 'flowchart LR\nsubgraph G\nA@{shape: cloud, label: "Before"} --> B\nend';
  const graph = api.parse(input);
  const expected = await api.render(input);
  const pending = api.renderGraph(graph);
  graph.nodes[0].label = 'After';
  graph.nodes[0].metadata.label = 'After';
  graph.edges[0].target = 'missing';
  graph.subgraphs[0].nodeIds.push('missing');
  graph.direction = 'BT';
  assert.equal(await pending, expected);
});

const invalid = predicate => error => error instanceof api.FlowInkError
  && error.code === 'INVALID_GRAPH' && error.line === undefined && (!predicate || predicate(error));

test('reject malformed graphs and recover without leaking state', async () => {
  const changes = [
    graph => { graph.direction = 'toString'; },
    graph => { graph.direction = '__proto__'; },
    graph => { graph.nodes = {}; },
    graph => { graph.nodes[0] = null; },
    graph => { graph.nodes[0].id = ''; },
    graph => { graph.nodes.push({ ...graph.nodes[0] }); },
    graph => { graph.edges.push({ ...graph.edges[0] }); },
    graph => { graph.edges[0].target = 'missing'; },
    graph => { graph.edges[0].arrowEnd = 'banana'; },
    graph => { graph.edges[0].stroke = 'banana'; },
    graph => { graph.edges[0].arrowEnd = null; },
    graph => { graph.edges[0].stroke = null; },
    graph => { graph.nodes[0].parentId = 'missing'; },
    graph => { graph.nodes[0].label = { toString() { throw new Error('must not run'); } }; },
    graph => { graph.subgraphs = [{ id: 'G', label: 'G', nodeIds: 'A', metadata: {} }]; },
    graph => { graph.subgraphs = [{ id: 'G', label: 'G', nodeIds: ['A'], direction: 'constructor', metadata: {} }]; },
    graph => { graph.subgraphs = [{ id: 'G', label: 'G', nodeIds: [], parentId: 'G', metadata: {} }]; },
  ];
  for (const value of [null, undefined, 'source', [], 12]) await assert.rejects(api.renderGraph(value), invalid());
  for (const change of changes) {
    const graph = api.parse(source); change(graph);
    await assert.rejects(api.renderGraph(graph), invalid());
  }
  assert.equal(await api.renderGraph(api.parse(source)), await api.render(source));
});

test('own data fields only: rendered accessors are rejected without execution', async () => {
  for (const location of ['graph', 'node', 'array', 'metadata', 'icon']) {
    const graph = api.parse(source);
    let calls = 0;
    const getter = { get() { calls++; throw new Error('must not run'); }, enumerable: true };
    if (location === 'graph') Object.defineProperty(graph, 'direction', getter);
    if (location === 'node') Object.defineProperty(graph.nodes[0], 'label', getter);
    if (location === 'array') Object.defineProperty(graph.nodes, '0', getter);
    if (location === 'icon') Object.defineProperty(graph.nodes[0].metadata, 'icon', getter);
    if (location === 'metadata') Object.defineProperty(graph.nodes[0].metadata, 'shape', getter);
    await assert.rejects(api.renderGraph(graph), invalid());
    assert.equal(calls, 0);
  }
  const inherited = Object.create({ ...api.parse(source) });
  await assert.rejects(api.renderGraph(inherited), invalid());
});

test('unused metadata is not evaluated, and null-prototype graphs/hostile-looking IDs are safe', async () => {
  const graph = api.parse(source);
  let calls = 0;
  Object.defineProperty(graph, 'source', { get() { calls++; throw new Error('unused'); } });
  Object.defineProperty(graph.nodes[0].metadata, 'unused', { get() { calls++; throw new Error('unused'); } });
  graph.metadata.circular = graph.metadata;
  const plain = Object.assign(Object.create(null), { direction: graph.direction, nodes: graph.nodes, edges: graph.edges, subgraphs: graph.subgraphs });
  assert.equal(await api.renderGraph(plain), await api.render(source));
  assert.equal(calls, 0);
  const hostile = api.parse('flowchart LR\nconstructor[First] --> toString[Second]');
  hostile.nodes[0].id = '__proto__'; hostile.edges[0].source = '__proto__';
  assert.match(await api.renderGraph(hostile), /First/);
  assert.equal({}.polluted, undefined);
});

test('renderGraph preserves charset validation and source-only render signature', async () => {
  for (const options of [null, 'unicode', { charset: 'svg' }]) {
    await assert.rejects(api.renderGraph(api.parse(source), options), { code: 'INVALID_OPTIONS' });
  }
  await assert.rejects(api.render(api.parse(source)), { code: 'INVALID_INPUT' });
  await assert.rejects(api.render('flowchart LR\nA -->'), { code: 'PARSE_ERROR' });
});


test('drawing metadata rejects cycles and executable values without invoking coercion', async () => {
  for (const make of [
    () => { const value = {}; value.self = value; return value; },
    () => ({ toString() { throw new Error('must not execute'); } }),
    () => ({ toJSON() { throw new Error('must not execute'); } }),
    () => ({ toString: 'not callable' }),
    () => [{ toString: 'not callable' }],
    () => Symbol('label'),
    () => 1n,
  ]) {
    const graph = api.parse(source);
    graph.nodes[0].metadata.label = make();
    await assert.rejects(api.renderGraph(graph), invalid());
  }
  const graph = api.parse(source);
  const nested = ['First', ['Second']];
  graph.nodes[0].metadata.label = nested;
  const pending = api.renderGraph(graph);
  nested[1][0] = 'Mutated';
  const output = await pending;
  assert.match(output, /First/);
  assert.match(output, /Second/);
  assert.doesNotMatch(output, /Mutated/);
});


test('parser-origin cyclic drawing metadata is explicitly outside the data API contract', async () => {
  for (const input of [
    'flowchart TB\nA@{ label: &a [one, *a] }',
  ]) {
    assert.ok((await api.render(input)).length > 0);
    await assert.rejects(api.renderGraph(api.parse(input)), invalid());
  }
});

test('cross-realm plain graph data renders without serialization in the caller', async () => {
  const graph = api.parse(source);
  const foreign = runInNewContext(`JSON.parse(${JSON.stringify(JSON.stringify(graph))})`);
  for (const charset of ['ascii', 'unicode']) {
    assert.equal(await api.renderGraph(foreign, { charset }), await api.render(source, { charset }));
  }
  assert.equal(await api.renderGraph(JSON.parse(JSON.stringify(foreign))), await api.render(source));
});


test('media presence does not traverse or execute ignored icon/image payloads', async () => {
  const input = 'flowchart TB\nA@{ icon: &a [*a] }';
  assert.equal(await api.renderGraph(api.parse(input)), await api.render(input));
  for (const key of ['icon', 'img']) {
    for (const value of ['null', 'false', '""']) {
      const mediaSource = `flowchart TB\nA@{ ${key}: ${value} }`;
      assert.equal(await api.renderGraph(api.parse(mediaSource)), await api.render(mediaSource));
    }
    const graph = api.parse(source);
    let calls = 0;
    graph.nodes[0].metadata[key] = { get unused() { calls++; throw new Error('must not run'); } };
    assert.match(await api.renderGraph(graph), key === 'icon' ? /icon/ : /image/);
    assert.equal(calls, 0);
  }
});


test('deep acyclic drawing metadata is bounded without stack overflow or input mutation', async () => {
  const nest = (depth, leaf, arrays = true) => {
    let result = leaf;
    for (let i = 0; i < depth; i++) result = arrays ? [result] : { nested: result };
    return result;
  };
  for (const arrays of [true, false]) {
    const graph = api.parse(source);
    graph.nodes[0].metadata.label = nest(256, 'Deep', arrays);
    const output = await api.renderGraph(graph);
    assert.match(output, arrays ? /Deep/ : /object Object/);
  }
  for (const key of ['label', 'shape', 'form', 'labelType']) {
    for (const depth of [257, 6000]) {
      const graph = api.parse(source);
      const leaf = Object.freeze({ marker: 'unchanged' });
      const value = nest(depth, leaf);
      graph.nodes[0].metadata[key] = value;
      await assert.rejects(api.renderGraph(graph), invalid(error => /depth limit/.test(error.message)));
      assert.equal(graph.nodes[0].metadata[key], value);
      let cursor = value;
      for (let i = 0; i < depth; i++) { assert.equal(cursor.length, 1); cursor = cursor[0]; }
      assert.equal(cursor, leaf);
    }
  }
  const grouped = api.parse('flowchart TB\nsubgraph G\nA\nend');
  grouped.subgraphs[0].metadata.labelType = nest(6000, 'text', false);
  await assert.rejects(api.renderGraph(grouped), invalid(error => /depth limit/.test(error.message)));
  assert.equal(await api.renderGraph(api.parse(source)), await api.render(source));
});


test('shared acyclic metadata is copied once per object without aliasing caller data', () => {
  for (const arrays of [true, false]) {
    const graph = api.parse(source);
    const leaf = { marker: 'original' };
    let diamond = leaf;
    for (let i = 0; i < 18; i++) diamond = arrays ? [diamond, diamond] : { left: diamond, right: diamond };
    // shape/form coercion can expand array DAGs, so inspect the snapshot directly
    // using a non-text media-independent object wrapper.
    graph.nodes[0].metadata.label = { diamond };
    const snapshot = snapshotGraph(graph).nodes[0].metadata.label;
    const seen = new Set(); const pending = [snapshot];
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value); pending.push(...Object.values(value));
    }
    assert.equal(seen.size, 20); // wrapper + 18 diamond levels + leaf
    let cursor = snapshot.diamond;
    for (let i = 0; i < 18; i++) {
      assert.equal(arrays ? cursor[0] : cursor.left, arrays ? cursor[1] : cursor.right);
      cursor = arrays ? cursor[0] : cursor.left;
    }
    assert.notEqual(cursor, leaf);
    leaf.marker = 'mutated';
    assert.equal(cursor.marker, 'original');
  }
});

test('memoized metadata subtrees cannot bypass depth or cycle validation', async () => {
  const graph = api.parse(source);
  const shared = { value: 'text' };
  let deep = shared;
  for (let i = 0; i < 255; i++) deep = { child: deep };
  graph.nodes[0].metadata.label = { shallow: shared, deep };
  await assert.rejects(api.renderGraph(graph), invalid(error => /depth limit/.test(error.message)));
  const cyclic = { shared }; cyclic.self = cyclic;
  graph.nodes[0].metadata.label = { shallow: shared, cyclic };
  await assert.rejects(api.renderGraph(graph), invalid(error => /cycle/.test(error.message)));
});
