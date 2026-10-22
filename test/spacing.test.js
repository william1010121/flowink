import test from 'node:test';
import assert from 'node:assert/strict';
import * as current from '../src/spacing.js';
import * as legacy from './helpers/legacy-spacing.js';

function randomGraph(seed) {
  let state = seed;
  const random = max => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) % max);
  const boxes = Array.from({ length: random(12) }, (_, i) => ({
    id: `b${i}`, x: random(60) - 10, y: random(150) - 20,
    width: random(10) + 1, height: random(12) + 1,
    kind: random(2) ? 'node' : 'subgraph', lines: ['title'],
  }));
  const edges = Array.from({ length: random(35) }, (_, i) => {
    let x = random(60) - 10; let y = random(150) - 20;
    const points = [{ x, y }];
    for (let j = random(8); j >= 0; j--) {
      if (random(2)) x += random(21) - 10;
      else y += random(21) - 10;
      points.push({ x, y });
    }
    return { id: `e${i}`, points, stroke: random(4) ? 'solid' : 'invisible',
      arrowStart: random(2) ? 'none' : 'arrow', arrowEnd: random(2) ? 'none' : 'arrow',
      ...(random(2) ? { label: { x: random(80) - 20, y: random(200) - 40 } } : {}),
    };
  });
  return { boxes, edges, width: 90, height: 200 };
}

for (const operation of ['compactVerticalChannels', 'separateAdjacentRoutes']) {
  test(`${operation} matches original coordinates for 500 seeded mixed graphs`, () => {
    for (let seed = 1; seed <= 500; seed++) {
      const actual = randomGraph(seed); const expected = structuredClone(actual);
      current[operation](actual); legacy[operation](expected);
      assert.deepEqual(actual, expected, `seed ${seed}`);
      // Repeat on the already transformed graph, not just a fresh input.
      current[operation](actual); legacy[operation](expected);
      assert.deepEqual(actual, expected, `second pass seed ${seed}`);
    }
  });
}

test('optimized compaction matches legacy for 500 normalized graphs and repeated transforms', () => {
  const assertDomain = graph => {
    const row = value => assert.ok(Number.isSafeInteger(value) && value >= 0);
    row(graph.height);
    for (const box of graph.boxes) {
      row(box.y); row(box.height); row(box.y + box.height); row(box.y + box.height - 1);
      if (box.kind === 'subgraph') row(box.y + 1 + box.lines.length);
    }
    for (const edge of graph.edges) {
      for (const point of edge.points) row(point.y);
      if (edge.label) row(edge.label.y);
    }
  };
  for (let seed = 1; seed <= 500; seed++) {
    const actual = randomGraph(seed);
    let minY = 0;
    for (const box of actual.boxes) minY = Math.min(minY, box.y);
    for (const edge of actual.edges) {
      for (const point of edge.points) minY = Math.min(minY, point.y);
      if (edge.label) minY = Math.min(minY, edge.label.y);
    }
    actual.height -= minY;
    for (const box of actual.boxes) box.y -= minY;
    for (const edge of actual.edges) {
      for (const point of edge.points) point.y -= minY;
      if (edge.label) edge.label.y -= minY;
    }
    const expected = structuredClone(actual);
    for (let pass = 1; pass <= 2; pass++) {
      // Match every production guard input, so this corpus cannot silently
      // become only a legacy-fallback comparison as the mixed corpus can.
      assertDomain(actual);
      current.compactVerticalChannels(actual); legacy.compactVerticalChannels(expected);
      assert.deepEqual(actual, expected, `normalized seed ${seed}, pass ${pass}`);
    }
  }
});

test('spacing transforms have no shared state after failure or empty inputs', () => {
  for (const operation of Object.keys(current)) {
    assert.throws(() => current[operation]({}));
    const empty = { boxes: [], edges: [], width: 0, height: 0 };
    current[operation](empty);
    assert.deepEqual(empty, { boxes: [], edges: [], width: 0, height: 0 });
    const actual = randomGraph(78); const expected = structuredClone(actual);
    current[operation](actual); legacy[operation](expected);
    assert.deepEqual(actual, expected);
  }
});

test('compaction handles billion-row empty channels without per-row allocation', () => {
  const graph = { boxes: [], edges: [{ id: 'a', arrowStart: 'none', arrowEnd: 'none', points: [{ x: 0, y: 0 }, { x: 0, y: 1_000_000_000 }], label: { x: 0, y: 500_000_000 } }], width: 1, height: 1_000_000_001 };
  current.compactVerticalChannels(graph);
  assert.deepEqual(graph.edges[0].points, [{ x: 0, y: 0 }, { x: 0, y: 2 }]);
  assert.equal(graph.edges[0].label.y, 2);
  assert.equal(graph.height, 3);
});

test('neighbor sweep excludes own edge, zero-length, touching and invisible segments', () => {
  const edge = (id, y, a, b, stroke = 'solid') => ({ id, stroke, points: [{ x: a, y }, { x: b, y }] });
  const cases = [
    [edge('same', 0, 0, 5), edge('same', 1, 0, 5)],
    [edge('a', 0, 0, 5), edge('b', 1, 5, 9)],
    [edge('a', 0, 0, 5), edge('b', 1, 3, 3)],
    [edge('a', 0, 0, 5), edge('b', 1, 0, 5, 'invisible')],
    [edge('a', 0, 0, 9), edge('a', 1, 0, 10), edge('b', 1, 1, 8)],
    [edge('a', 0, 0, 9), edge('b', 0, 0, 8), edge('a', 1, 2, 7)],
  ];
  for (const edges of cases) {
    const actual = { boxes: [], edges, width: 12, height: 4 };
    const expected = structuredClone(actual);
    current.separateAdjacentRoutes(actual); legacy.separateAdjacentRoutes(expected);
    assert.deepEqual(actual, expected);
  }
});

test('realistic, large, deep and degenerate renders preserve current main output exactly', async () => {
  const { readFile } = await import('node:fs/promises');
  const { render } = await import('../src/index.js');
  const fixtures = JSON.parse(await readFile(new URL('./fixtures/spacing/render-main-23fee6a.json', import.meta.url), 'utf8'));
  for (const fixture of fixtures) {
    if (fixture.errorCode) {
      await assert.rejects(render(fixture.source), { code: fixture.errorCode });
      continue;
    }
    for (const charset of ['ascii', 'unicode']) {
      assert.equal(await render(fixture.source, { charset }), fixture[charset], `${fixture.name}/${charset}`);
    }
  }
  await assert.rejects(render('flowchart TB\nA -->'), { code: 'PARSE_ERROR' });
  const fixture = fixtures[0];
  const repeated = await Promise.all(Array.from({ length: 4 }, () => render(fixture.source)));
  assert.ok(repeated.every(output => output === fixture.ascii));
});

// Layout currently emits integer cells, but preserve the previous helper's
// discrete removed-row count for fractional inputs too.
test('compaction preserves fractional-coordinate discrete counts', () => {
  for (const end of [5, 5.5, 100.1]) for (const labelY of [2, 2.5, 4.8, 5.5, 200]) {
    const actual = { boxes: [], edges: [{ id: 'e', arrowStart: 'none', arrowEnd: 'none', points: [{ x: 0, y: 0 }, { x: 0, y: end }], label: { x: 0, y: labelY } }], width: 1, height: end + 1 };
    const expected = structuredClone(actual);
    current.compactVerticalChannels(actual); legacy.compactVerticalChannels(expected);
    assert.deepEqual(actual, expected);
  }
});


test('fractional coordinates and repeated edge IDs preserve both transforms twice', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const graph = randomGraph(seed);
    for (const box of graph.boxes) for (const key of ['x', 'y', 'width', 'height']) box[key] /= 4;
    for (const [index, edge] of graph.edges.entries()) {
      edge.id = `shared${index % 4}`;
      for (const point of edge.points) { point.x /= 4; point.y /= 4; }
      if (edge.label) { edge.label.x /= 4; edge.label.y /= 4; }
    }
    for (const operation of ['compactVerticalChannels', 'separateAdjacentRoutes']) {
      const actual = structuredClone(graph); const expected = structuredClone(graph);
      for (let pass = 0; pass < 2; pass++) {
        current[operation](actual); legacy[operation](expected);
        assert.deepEqual(actual, expected, `${operation}, seed ${seed}, pass ${pass}`);
      }
    }
  }
});


test('separation preserves legacy floating-point and unsafe-integer predicates', () => {
  const edge = (id, y, start = 0, end = 5) => ({ id, stroke: 'solid', points: [{ x: start, y }, { x: end, y }] });
  const cases = [
    [edge('a', 1.0000000000000002), edge('b', 2)],
    [edge('a', -1.0000000000000002), edge('b', -1.5e-16)],
    [edge('a', 0, 0, 2), edge('b', 1, 1.0000000000000002, 3)],
    [edge('a', 2 ** 53), edge('b', 2 ** 53), edge('c', 2 ** 53 + 2)],
    [edge('a', Number.MAX_SAFE_INTEGER - 1), edge('b', Number.MAX_SAFE_INTEGER)],
    [edge('a', -Number.MAX_SAFE_INTEGER), edge('b', -Number.MAX_SAFE_INTEGER + 1)],
    [edge('a', 0.25), edge('b', 1.25)],
  ];
  for (const [index, edges] of cases.entries()) {
    const actual = { boxes: [], edges, width: 8, height: 8 };
    const expected = structuredClone(actual);
    current.separateAdjacentRoutes(actual); legacy.separateAdjacentRoutes(expected);
    assert.deepEqual(actual, expected, `boundary case ${index}`);
  }
  const actual = randomGraph(19); const expected = structuredClone(actual);
  current.separateAdjacentRoutes(actual); legacy.separateAdjacentRoutes(expected);
  assert.deepEqual(actual, expected, 'ordinary integer input after fallback');
});

test('compaction preserves legacy arithmetic outside normalized integer rows', () => {
  const edge = (start, end, label) => ({ id: 'e', stroke: 'solid', arrowStart: 'none', arrowEnd: 'none',
    points: [{ x: 0, y: start }, { x: 0, y: end }], ...(label === undefined ? {} : { label: { x: 0, y: label } }) });
  const cases = [
    { boxes: [], edges: [edge(0.3, 8.3)], width: 1, height: 10.3 },
    { boxes: [], edges: [edge(0, 8, 3.3)], width: 1, height: 10 },
    { boxes: [], edges: [edge(0, 8)], width: 1, height: 10.3 },
    ...[
      { y: 0.3, height: 1, kind: 'node', lines: [] },
      { y: 0, height: 1.3, kind: 'node', lines: [] },
      { y: 0.3, height: 10, kind: 'subgraph', lines: ['header'] },
    ].map(box => ({ boxes: [{ x: 0, width: 2, ...box }], edges: [edge(0, 12.3)], width: 2, height: 14 })),
    { boxes: [], edges: [edge(-4, 8)], width: 1, height: 10 },
    { boxes: [{ x: 0, y: Number.MAX_SAFE_INTEGER, width: 1, height: 1, kind: 'node', lines: [] }],
      edges: [], width: 1, height: Number.MAX_SAFE_INTEGER },
  ];
  for (const [index, graph] of cases.entries()) {
    const actual = structuredClone(graph); const expected = structuredClone(graph);
    current.compactVerticalChannels(actual); legacy.compactVerticalChannels(expected);
    assert.deepEqual(actual, expected, `case ${index}`);
  }
  const expected = structuredClone(cases[0]); legacy.compactVerticalChannels(expected);
  assert.equal(expected.edges[0].points[1].y, 2.3000000000000007);
  assert.equal(expected.height, 4.300000000000001);
});
