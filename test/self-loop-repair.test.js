import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, render } from '../src/index.js';
import { layout } from '../src/layout.js';
import { rasterize } from '../src/rasterize.js';

for (const direction of ['TB', 'BT', 'LR', 'RL']) {
  test(`${direction}: self-loops survive neighboring visible and invisible edges`, async () => {
    for (const count of [1, 2, 3]) {
      for (const outgoing of ['', '\nA --> B', '\nA ~~~ B']) {
        const source = `flowchart ${direction}\n${'A --> A\n'.repeat(count)}${outgoing}`;
        const graph = parse(source);
        const result = await layout(graph);
        assert.deepEqual(result.edges.map(edge => edge.id), graph.edges.map(edge => edge.id));
        const box = result.boxes.find(box => box.id === 'A');
        for (const edge of result.edges.slice(0, count)) {
          assert.ok(edge.points.length >= 3, `${edge.id}: loop needs a real route`);
          const first = edge.points[0]; const last = edge.points.at(-1);
          assert.ok(Math.abs(first.x - last.x) + Math.abs(first.y - last.y) > 1);
          for (let i = 1; i < edge.points.length - 1; i++) {
            const [a, b, c] = edge.points.slice(i - 1, i + 2);
            assert.ok((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0, 'loop must not retrace itself');
          }
          // Every interior route cell must be outside the endpoint box.
          for (let i = 1; i < edge.points.length; i++) {
            const a = edge.points[i - 1]; const b = edge.points[i];
            assert.ok(a.x === b.x || a.y === b.y);
            const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
            for (let j = 0; j <= length; j++) {
              const x = a.x + Math.sign(b.x - a.x) * j;
              const y = a.y + Math.sign(b.y - a.y) * j;
              if ((x === first.x && y === first.y) || (x === last.x && y === last.y)) continue;
              assert.ok(x < box.x || x >= box.x + box.width || y < box.y || y >= box.y + box.height);
            }
          }
        }
        for (const charset of ['ascii', 'unicode']) {
          const output = rasterize(result, { charset });
          assert.ok(output.includes('A'));
          if (outgoing) assert.ok(output.includes('B'));
          // One visible arrow for each loop and visible outgoing edge.
          const arrows = charset === 'ascii' ? /[<>^v]/g : /[◀▶▲▼]/g;
          assert.equal((output.match(arrows) ?? []).length, count + Number(outgoing.includes('-->')));
        }
      }
    }
  });
}

test('repaired self-loop renders remain deterministic after errors and concurrent calls', async () => {
  const source = 'flowchart LR\nA --> A\nA --> A\nA ~~~ B';
  const expected = await render(source);
  await assert.rejects(render('flowchart LR\nA -->'), { code: 'PARSE_ERROR' });
  const outputs = await Promise.all(Array.from({ length: 6 }, () => render(source)));
  assert.ok(outputs.every(output => output === expected));
});

test('horizontal repaired loops support bidirectional and alternate stroke endpoints', async () => {
  for (const direction of ['LR', 'RL']) {
    for (const arrow of ['<-->', 'o--o', 'x--x', '---', '-.->', '==>']) {
      const source = `flowchart ${direction}\nA ${arrow} A\nA ${arrow} A\nA --> B`;
      const result = await layout(parse(source));
      assert.equal(result.edges.length, 3);
      for (const charset of ['ascii', 'unicode']) {
        const output = rasterize(result, { charset });
        assert.ok(output.includes('A') && output.includes('B'));
      }
    }
  }
});

test('tall horizontal nodes keep four actual loops, not retraced sticks', async () => {
  const source = 'flowchart LR\nA["One<br/>Two<br/>Three<br/>Four<br/>Five"]\n' + 'A --> A\n'.repeat(4) + 'A --> B';
  const result = await layout(parse(source));
  assert.equal(result.edges.length, 5);
  for (const edge of result.edges.slice(0, 4)) {
    assert.notDeepEqual(edge.points[0], edge.points.at(-1));
    for (let i = 1; i < edge.points.length - 1; i++) {
      const [a, b, c] = edge.points.slice(i - 1, i + 2);
      assert.ok((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= 0);
    }
  }
  for (const charset of ['ascii', 'unicode']) assert.ok(rasterize(result, { charset }).includes('Five'));
});
