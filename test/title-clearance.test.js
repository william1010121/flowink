import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rasterize } from '../src/rasterize.js';
import { render } from '../src/index.js';

function drawing(lines = ['Title'], width = 13, routeX = 8, extraBoxes = []) {
  return { width, height: 7, boxes: [
    { id: 'g', kind: 'subgraph', x: 0, y: 0, width, height: 7, lines, shape: 'rect' }, ...extraBoxes,
  ], edges: [{ id: 'e', points: [{ x: routeX, y: 0 }, { x: routeX, y: 6 }], arrowStart: 'none', arrowEnd: 'none', stroke: 'normal' }] };
}

test('obstructed group title moves to the nearest free header interval', () => {
  for (const charset of ['ascii', 'unicode']) {
    const input = drawing();
    const before = structuredClone(input);
    const output = rasterize(input, { charset });
    assert.equal(output.split('\n')[1].indexOf('Title'), 3);
    assert.deepEqual(input, before);
    assert.ok(output.split('\n')[1][8] === (charset === 'ascii' ? '|' : '│'));
  }
});

test('title ties choose left and multiline relative alignment is retained', () => {
  assert.equal(rasterize(drawing(['A'], 13, 6)).split('\n')[1].indexOf('A'), 5);
  const rows = rasterize(drawing(['Wide', 'x'], 13, 7)).split('\n');
  assert.equal(rows[1].indexOf('Wide'), 3);
  assert.equal(rows[2].indexOf('x'), 5);
});

test('pending node geometry is excluded from a moved title interval', () => {
  const node = { id: 'n', kind: 'node', x: 4, y: 1, width: 3, height: 3, lines: ['n'], shape: 'rect' };
  const output = rasterize(drawing(['Title'], 17, 10, [node]));
  assert.equal(output.split('\n')[1].indexOf('Title'), 11);
  assert.match(output, /n/);
});

test('no-fit group titles and ordinary node collisions still fail explicitly', () => {
  assert.throws(() => rasterize(drawing(['Title'], 7, 3)), error => error.code === 'LABEL_COLLISION');
  const input = drawing(); input.boxes[0].kind = 'node';
  assert.throws(() => rasterize(input));
});

test('nested cycle keeps every title after route spacing changes parity', async () => {
  const source = readFileSync(new URL('./fixtures/title-clearance.mmd', import.meta.url), 'utf8');
  for (const charset of ['ascii', 'unicode']) {
    const output = await render(source, { charset });
    for (const label of ['Outer', 'Inner', 'Start', 'Review', '終点', '処理 🐈', 'Alpha', 'Beta']) assert.ok(output.includes(label), label);
    assert.equal(await render(source, { charset }), output);
  }
});

test('wide Unicode and combining labels retain display-cell alignment across parity changes', () => {
  for (const width of [12, 13, 14, 15]) for (const charset of ['ascii', 'unicode']) {
    const center = 1 + Math.floor((width - 2 - 4) / 2);
    const rows = rasterize(drawing(['中🙂', 'é'], width, center + 3), { charset }).split('\n');
    assert.equal(rows[1].indexOf('中🙂'), center - 1);
    assert.equal(rows[2].indexOf('é'), Math.floor((width - 3) / 2));
  }
});

test('pending edge labels and nested group borders remain reserved', () => {
  const edgeLabel = drawing(['Title'], 17, 10);
  edgeLabel.edges[0].label = { x: 4, y: 1, width: 3, height: 1, lines: ['lbl'] };
  assert.equal(rasterize(edgeLabel).split('\n')[1].indexOf('Title'), 11);
  const group = { id: 'child', kind: 'subgraph', x: 4, y: 1, width: 3, height: 3, lines: [], shape: 'rect' };
  assert.equal(rasterize(drawing(['Title'], 17, 10, [group])).split('\n')[1].indexOf('Title'), 11);
});

test('unobstructed and invisible-route titles retain their centered position', () => {
  for (const width of [12, 13, 14, 15]) {
    const expected = 1 + Math.floor((width - 2 - 5) / 2);
    const plain = drawing(['Title'], width, width - 2);
    assert.equal(rasterize(plain).split('\n')[1].indexOf('Title'), expected);
    const invisible = drawing(['Title'], width, expected);
    invisible.edges[0].stroke = 'invisible';
    assert.equal(rasterize(invisible).split('\n')[1].indexOf('Title'), expected);
  }
});
