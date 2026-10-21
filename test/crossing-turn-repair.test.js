import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parse, render } from '../src/index.js';
import { layout } from '../src/layout.js';
import { rasterize } from '../src/rasterize.js';

const repaired = 'flowchart BT\nB --> A\nA --- A\nA --- A\nA --- A';

test('grid repair does not turn onto an occupied crossing cell', async () => {
  const graph = await layout(parse(repaired));
  assert.equal(graph.edges.length, 4);
  for (const charset of ['ascii', 'unicode']) {
    const text = rasterize(graph, { charset });
    assert.ok(text.includes('A') && text.includes('B'));
  }
});

test('perpendicular nonjoining crossings remain allowed and render identically', async () => {
  const source = 'flowchart LR\n' + [1, 2, 3].flatMap(s => [1, 2, 3].map(t => `S${s} --> T${t}`)).join('\n');
  const graph = await layout(parse(source));
  assert.equal(graph.edges.length, 9);
  const ascii = rasterize(graph, { charset: 'ascii' });
  const unicode = rasterize(graph, { charset: 'unicode' });
  assert.ok(ascii.includes('#'));
  assert.ok(unicode.includes('╳'));
  // Exact hashes captured from original parent14f9abcd42a8 and reconfirmed on main e98be50 before extraction.
  assert.equal(createHash('sha256').update(ascii).digest('hex'), '061c728ad459ebf2c106c430527f0d620ee56bb00ea34bf595c3d9072b9f41c8');
  assert.equal(createHash('sha256').update(unicode).digest('hex'), '190e6b1711039f49df0984e44ebe4cb4d0dad7c1005f7ca3286d736a82ae06f6');
  assert.equal((ascii.match(/#/g) ?? []).length, (unicode.match(/╳/g) ?? []).length);
  assert.equal(await render(source), ascii);
});

test('crossing repair remains repeatable across failed and concurrent renders', async () => {
  const expected = await render(repaired);
  await assert.rejects(render('flowchart BT\nA -->'), { code: 'PARSE_ERROR' });
  const results = await Promise.all(Array.from({ length: 4 }, () => render(repaired)));
  assert.ok(results.every(output => output === expected));
});
