import test from 'node:test';
import assert from 'node:assert/strict';
import { layout } from '../src/layout.js';
import { parse, render } from '../src/index.js';

/**
 * These are deliberately small, hand-written cases.  They are all accepted
 * by Mermaid 12.0.0 and exercise graph shapes that are easy to lose while
 * converting ELK's floating-point routes to terminal cells.
 */
const cases = {
  denseCycle: `flowchart LR
 A[Alpha] --> B[Beta]
 B --> C[Gamma]
 C --> D[Delta]
 D --> A
 A --> C
 C --> A
 B --> D
 D --> B
 A --> D
 B --> A`,

  k33: `flowchart LR
 S1[Source one] --> T1[Target one]
 S1 --> T2[Target two]
 S1 --> T3[Target three]
 S2[Source two] --> T1
 S2 --> T2
 S2 --> T3
 S3[Source three] --> T1
 S3 --> T2
 S3 --> T3`,

  parallelEdges: `flowchart LR
 A[Alpha] e1@-->|first path| B[Beta]
 A e2@-->|second path| B
 A e3@-.->|dotted path| B
 A e4@==>|thick path| B
 A e5@--o|circle path| B
 A e6@--x|cross path| B
 e1@{ animate: true }
 e2@{ animation: fast }`,

  selfLoops: `flowchart LR
 A[Alpha] e1@-->|retry one| A
 A e2@-.->|retry two| A
 A e3@--o|retry three| A
 A e4@--x|retry four| A`,

  groupEndpoint: `flowchart TB
 subgraph Group[Group]
  A[Alpha]
 end
 Group --> A
 Group --> Group`,

  nestedEndpoint: `flowchart TB
 subgraph Outer[Outer]
  subgraph Inner[Inner]
   A[Alpha] --> B[Beta]
  end
  C[Gamma]
 end
 Outer --> Inner
 Inner --> Inner
 Outer --> A`,

  rootId: `flowchart LR
 __flowink_root__[Root] --> B[Beta]
 B --> __flowink_root__`,

  edgeAndNodeId: `flowchart LR
 e1[Edge node] e1@--> B[Beta]
 B --> e1`,

  emptyGroup: `flowchart LR
 subgraph Empty[An unusually wide empty title]
 end`,

  wideGroupTitle: `flowchart TB
 subgraph G[This is a very wide title]
  A[X]
 end`,

  stylesAndInvisible: `flowchart LR
 A[Alpha] ~~~ B[Beta]
 A --> C[Gamma]
 B --> D[Delta]
 style A fill:transparent,stroke:transparent
 style B fill:none,stroke:none
 classDef hidden fill:none,stroke:none
 class C hidden`,

  metadataAndMarkdown: [
    '---',
    'title: Stress graph',
    'config:',
    '  theme: dark',
    '---',
    '%%{init: {"flowchart": {"curve": "linear"}}}%%',
    'flowchart TB',
    'A["第一行<br/>第二行"] -->|`**go**\\nnext`| B((Done))',
    'click A "https://example.com" "Tooltip"',
  ].join('\n'),
};

function segmentCells(a, b) {
  assert.ok(a.x === b.x || a.y === b.y, `non-orthogonal route segment: ${JSON.stringify({ a, b })}`);
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  const result = [];
  let x = a.x;
  let y = a.y;
  result.push({ x, y });
  while (x !== b.x || y !== b.y) {
    x += dx;
    y += dy;
    result.push({ x, y });
  }
  return result;
}

function onBorder(point, box) {
  const horizontal = (point.y === box.y || point.y === box.y + box.height - 1)
    && point.x >= box.x && point.x < box.x + box.width;
  const vertical = (point.x === box.x || point.x === box.x + box.width - 1)
    && point.y >= box.y && point.y < box.y + box.height;
  return horizontal || vertical;
}

function inNodeInterior(point, box) {
  return box.kind === 'node'
    && point.x > box.x && point.x < box.x + box.width - 1
    && point.y > box.y && point.y < box.y + box.height - 1;
}

function assertGeometry(graph, result) {
  assert.equal(new Set(result.boxes.map((box) => box.id)).size, result.boxes.length, 'layout box IDs must be unique');
  assert.equal(result.edges.length, graph.edges.length, 'layout must retain every original edge');
  const boxes = new Map(result.boxes.map((box) => [box.id, box]));
  for (const edge of graph.edges) {
    const routed = result.edges.find((candidate) => candidate.id === edge.id);
    assert.ok(routed, `missing route for ${edge.id}`);
    assert.ok(routed.points.length >= 2, `empty route for ${edge.id}`);
    assert.ok(boxes.has(edge.source), `missing layout box for ${edge.source}`);
    assert.ok(boxes.has(edge.target), `missing layout box for ${edge.target}`);
    assert.ok(onBorder(routed.points[0], boxes.get(edge.source)), `${edge.id} starts away from ${edge.source} border`);
    assert.ok(onBorder(routed.points.at(-1), boxes.get(edge.target)), `${edge.id} ends away from ${edge.target} border`);
    for (let i = 1; i < routed.points.length; i += 1) {
      for (const point of segmentCells(routed.points[i - 1], routed.points[i])) {
        for (const box of result.boxes) {
          assert.equal(inNodeInterior(point, box), false, `${edge.id} traverses ${box.id} interior at ${point.x},${point.y}`);
        }
      }
    }
  }
}

async function assertRendered(source, labels) {
  const graph = parse(source);
  const laidOut = await layout(graph);
  assertGeometry(graph, laidOut);
  const [ascii, unicode] = await Promise.all([
    render(source, { charset: 'ascii' }),
    render(source, { charset: 'unicode' }),
  ]);
  assert.ok(ascii.length > 0);
  assert.ok(unicode.length > 0);
  for (const label of labels) {
    assert.ok(ascii.includes(label), `ASCII output is missing ${label}:\n${ascii}`);
    assert.ok(unicode.includes(label), `Unicode output is missing ${label}:\n${unicode}`);
  }
  assert.ok(ascii.split('\n').every((line) => !/[ \t]$/.test(line)), 'ASCII output has trailing whitespace');
  assert.ok(unicode.split('\n').every((line) => !/[ \t]$/.test(line)), 'Unicode output has trailing whitespace');
  assert.equal(ascii, await render(source, { charset: 'ascii' }), 'ASCII rendering must be deterministic');
  return graph;
}

test('keeps every route in a dense cyclic graph', async () => {
  const graph = await assertRendered(cases.denseCycle, ['Alpha', 'Beta', 'Gamma', 'Delta']);
  assert.equal(graph.edges.length, 10);
});

test('routes the bounded directed K3,3 crossing case', async () => {
  const graph = await assertRendered(cases.k33, [
    'Source one', 'Source two', 'Source three',
    'Target one', 'Target two', 'Target three',
  ]);
  assert.equal(graph.nodes.length, 6);
  assert.equal(graph.edges.length, 9);
});

test('keeps parallel edge labels, arrowheads, IDs, and animation metadata', async () => {
  const graph = await assertRendered(cases.parallelEdges, [
    'first path', 'second path', 'dotted path', 'thick path', 'circle path', 'cross path',
  ]);
  assert.deepEqual(graph.edges.map((edge) => edge.id), ['e1', 'e2', 'e3', 'e4', 'e5', 'e6']);
  assert.equal(graph.edges[0].animate, true);
  assert.equal(graph.edges[1].animation, 'fast');
  assert.deepEqual(graph.nodes.map((node) => node.id), ['A', 'B']);
});

test('keeps four labeled self loops distinct', async () => {
  const graph = await assertRendered(cases.selfLoops, ['retry one', 'retry two', 'retry three', 'retry four']);
  assert.equal(graph.edges.length, 4);
  assert.ok(graph.edges.every((edge) => edge.source === 'A' && edge.target === 'A'));
});

test('supports a group endpoint to its own child and a group self-loop', async () => {
  const graph = await assertRendered(cases.groupEndpoint, ['Group', 'Alpha']);
  assert.deepEqual(graph.subgraphs[0].nodeIds, ['A']);
  assert.deepEqual(graph.edges.map((edge) => [edge.source, edge.target]), [['Group', 'A'], ['Group', 'Group']]);
});

test('supports nested group endpoints and cross-hierarchy routes', async () => {
  const graph = await assertRendered(cases.nestedEndpoint, ['Outer', 'Inner', 'Alpha', 'Beta', 'Gamma']);
  assert.equal(graph.subgraphs.length, 2);
  assert.equal(graph.subgraphs.find((group) => group.id === 'Inner').parentId, 'Outer');
  assert.deepEqual(graph.edges.map((edge) => [edge.source, edge.target]), [
    ['A', 'B'], ['Outer', 'Inner'], ['Inner', 'Inner'], ['Outer', 'A'],
  ]);
});

test('does not confuse a legal node ID with the internal ELK root ID', async () => {
  const graph = await assertRendered(cases.rootId, ['Root', 'Beta']);
  assert.ok(graph.nodes.some((node) => node.id === '__flowink_root__'));
});

test('preserves a node ID that is also used as a user edge ID', async () => {
  const graph = await assertRendered(cases.edgeAndNodeId, ['Edge node', 'Beta']);
  assert.ok(graph.nodes.some((node) => node.id === 'e1'));
  assert.ok(graph.edges.some((edge) => edge.id === 'e1' && edge.source === 'e1'));
});

test('renders an empty group with a title wider than its contents', async () => {
  const graph = await assertRendered(cases.emptyGroup, ['An unusually wide empty title']);
  assert.equal(graph.subgraphs[0].nodeIds.length, 0);
});

test('keeps a wide group title and its child inside one non-overlapping box', async () => {
  const graph = await assertRendered(cases.wideGroupTitle, ['This is a very wide title', 'X']);
  assert.equal(graph.subgraphs[0].nodeIds[0], 'A');
});

test('retains invisible edges and style/class metadata without hiding visible labels', async () => {
  const graph = await assertRendered(cases.stylesAndInvisible, ['Alpha', 'Beta', 'Gamma', 'Delta']);
  assert.equal(graph.edges.find((edge) => edge.source === 'A' && edge.target === 'B').stroke, 'invisible');
  assert.deepEqual(graph.nodes.find((node) => node.id === 'A').classes, []);
  assert.ok(graph.nodes.find((node) => node.id === 'C').classes.includes('hidden'));
  assert.ok(graph.nodes.find((node) => node.id === 'A').styles.includes('fill:transparent'));
});

test('preserves frontmatter, directives, interactions, and multiline labels while rendering', async () => {
  const graph = await assertRendered(cases.metadataAndMarkdown, ['第一行', '第二行', 'Done', '**go**\\nnext']);
  assert.equal(graph.metadata.frontmatter.title, 'Stress graph');
  assert.equal(graph.metadata.directives.length, 1);
  assert.equal(graph.nodes.find((node) => node.id === 'A').metadata.tooltip, 'Tooltip');
  assert.equal(graph.nodes.find((node) => node.id === 'A').metadata.interaction.href, 'https://example.com');
});
