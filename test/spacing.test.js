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

test('realistic, large, deep and degenerate renders preserve 0.1.1 output exactly', async () => {
  const { readFile } = await import('node:fs/promises');
  const { render } = await import('../src/index.js');
  const fixtures = JSON.parse(await readFile(new URL('./fixtures/spacing/render-0.1.1.json', import.meta.url), 'utf8'));
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
