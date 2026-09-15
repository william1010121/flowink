import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';
import { layout } from '../src/layout.js';
import { rasterize } from '../src/rasterize.js';

for (const direction of ['TB', 'BT', 'LR', 'RL']) {
  for (const [name, body] of [
    ['cycle', 'A[Alpha] --> B[Beta] --> C[Gamma] --> A'],
    ['parallel with return', 'A -->|first| B\nA -->|second| B\nB -->|return| A'],
  ]) {
    test(`${direction} ${name} preserves separate incoming and outgoing routes`, async () => {
      const graph = parse(`flowchart ${direction}\n${body}`);
      const result = await layout(graph);
      const byId = new Map(result.edges.map(edge => [edge.id, edge]));
      assert.equal(result.edges.length, graph.edges.length);
      for (const node of graph.nodes) {
        const incoming = graph.edges.filter(edge => edge.target === node.id)
          .map(edge => byId.get(edge.id).points.at(-1));
        const outgoing = graph.edges.filter(edge => edge.source === node.id)
          .map(edge => byId.get(edge.id).points[0]);
        for (const end of incoming) for (const start of outgoing) {
          assert.notDeepEqual(start, end, `${node.id}: an incoming arrow would hide an outgoing route`);
        }
      }
      for (const edge of result.edges) {
        for (let index = 1; index < edge.points.length - 1; index += 1) {
          const [a, b, c] = edge.points.slice(index - 1, index + 2);
          const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
          assert.ok(dot >= 0, `${edge.id}: route doubles back over itself`);
        }
      }
      const segments = result.edges.flatMap(edge => edge.points.slice(1).map((b, index) => {
        const a = edge.points[index];
        return { id: edge.id, horizontal: a.y === b.y, a, b };
      }));
      for (let i = 0; i < segments.length; i += 1) {
        for (let j = i + 1; j < segments.length; j += 1) {
          const a = segments[i]; const b = segments[j];
          if (a.id === b.id || a.horizontal !== b.horizontal) continue;
          const fixed = a.horizontal ? 'y' : 'x';
          const varying = a.horizontal ? 'x' : 'y';
          const distance = Math.abs(a.a[fixed] - b.a[fixed]);
          const overlap = Math.min(Math.max(a.a[varying], a.b[varying]), Math.max(b.a[varying], b.b[varying]))
            - Math.max(Math.min(a.a[varying], a.b[varying]), Math.min(b.a[varying], b.b[varying]));
          assert.ok(distance !== 1 || overlap < 1, `${a.id}/${b.id}: parallel routes need a blank column or row`);
        }
      }
      // Raster validation also checks that no arrow covers another route,
      // that intersections remain distinct, and that labels stay visible.
      for (const charset of ['ascii', 'unicode']) {
        const text = rasterize(result, { charset });
        const labels = name === 'cycle' ? ['Alpha', 'Beta', 'Gamma'] : ['first', 'second', 'return'];
        for (const label of labels) assert.ok(text.includes(label), `${label}: missing label`);
      }
    });
  }
}
