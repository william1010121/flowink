import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, render, FlowInkError } from '../src/index.js';

const cases = {
  chain: 'flowchart LR\n A[Alpha] --> B[Beta] --> C[Gamma]',
  branch: 'flowchart TD\n A[Start] --> B{Ready?}\n B -->|yes| C[Work]\n B -->|no| D[Wait]\n C --> E[Done]\n D --> E',
  cycle: 'flowchart LR\n A[Alpha] --> B[Beta] --> C[Gamma] --> A',
  self: 'flowchart TB\n A[Alpha] -->|retry| A',
  parallel: 'flowchart LR\n A[Alpha] -->|first| B[Beta]\n A -->|second| B\n B -->|back| A',
  disconnected: 'flowchart TB\n A[Alpha]\n B[Beta]\n C[Gamma] --> D[Delta]',
  subgraph: 'flowchart LR\n subgraph Group[Group]\n A[Alpha] --> B[Beta]\n end\n B --> C[Gamma]',
  compound: 'flowchart LR\n subgraph Group[Group]\n A[Alpha]\n end\n Group --> B[Beta]',
  compoundTarget: 'flowchart TB\n subgraph Group[Group]\n A[Alpha]\n end\n B[Beta] --> Group',
  compounds: 'flowchart LR\n subgraph One[One]\n A[Alpha]\n end\n subgraph Two[Two]\n B[Beta]\n end\n One --> Two',
  nested: 'flowchart TB\n subgraph Outer[Outer]\n subgraph Inner[Inner]\n A[Alpha] --> B[Beta]\n end\n C[Gamma]\n end\n B --> C\n C --> D[Delta]',
  crossHierarchy: 'flowchart LR\n subgraph One[One]\n A[Alpha]\n end\n subgraph Two[Two]\n B[Beta]\n end\n A --> B',
  mixedDirection: 'flowchart TB\n subgraph Group[Group]\n direction LR\n A[Alpha] --> B[Beta]\n end\n Group --> C[Gamma]',
  arrows: 'flowchart LR\n A <--> B\n B o--o C\n C x--x D\n D -.-> E\n E ==> F',
  invisible: 'flowchart TB\n A[Alpha] ~~~ B[Beta]\n B --> C[Gamma]',
  unicode: 'flowchart LR\n A["開始 👩‍💻"] -->|確認| B["完成 é"]',
  multiline: 'flowchart LR\n A["first<br/>second"] --> B["`**strong**\nnext`"]',
  unusualShape: 'flowchart LR\n A@{shape: cloud, label: Cloud} --> B@{shape: doc, label: Document}',
  iconImage: 'flowchart LR\n A@{icon: "fa:user", label: Person} --> B@{img: "https://example.com/a.png", label: Picture}',
  decorated: '---\ntitle: Example\nconfig:\n  theme: dark\n---\nflowchart LR\n A[Alpha] e1@--> B[Beta]\n e1@{animate: true}\n classDef red fill:red\n class A red\n click A "https://example.com" "Tooltip"',
};
for (const [name, source] of Object.entries(cases)) {
  test(`renders ${name} without losing nodes or labels`, async () => {
    const graph = parse(source);
    const ascii = await render(source);
    const unicode = await render(source, { charset: 'unicode' });
    assert.equal(typeof ascii, 'string');
    assert.ok(ascii.length > 0);
    assert.ok(unicode.length > 0);
    for (const node of graph.nodes) {
      if (/^[a-zA-Z]+$/.test(node.label)) assert.ok(ascii.includes(node.label), `${name}: missing ${node.label}\n${ascii}`);
    }
    for (const edge of graph.edges) {
      if (edge.label && /^[a-zA-Z]+$/.test(edge.label) && edge.stroke !== 'invisible') assert.ok(ascii.includes(edge.label), `${name}: missing edge label ${edge.label}\n${ascii}`);
    }
    assert.ok(ascii.split('\n').every(line => !/\s$/.test(line)), 'no trailing spaces');
    if (name !== 'unicode') assert.doesNotMatch(ascii, /[^\x00-\x7f]/);
  });
}
for (const direction of ['TB', 'TD', 'BT', 'LR', 'RL']) {
  test(`renders direction ${direction}`, async () => {
    const output = await render(`flowchart ${direction}\n A[Alpha] --> B[Beta]`);
    assert.match(output, /Alpha/); assert.match(output, /Beta/);
    const lines = output.split('\n');
    const a = lines.findIndex(line => line.includes('Alpha'));
    const b = lines.findIndex(line => line.includes('Beta'));
    if (direction === 'TB' || direction === 'TD') assert.ok(a < b);
    if (direction === 'BT') assert.ok(b < a);
    if (direction === 'LR' || direction === 'RL') {
      assert.equal(a, b);
      assert.equal(lines[a].indexOf('Alpha') < lines[b].indexOf('Beta'), direction === 'LR');
    }
  });
}
test('repeated and concurrent renders are deterministic and isolated', async () => {
  const sources = [cases.branch, cases.cycle, cases.nested, cases.unicode];
  const expected = [];
  for (const source of sources) expected.push(await render(source));
  const actual = await Promise.all([...sources, ...sources].map(source => render(source)));
  assert.deepEqual(actual, [...expected, ...expected]);
});
test('rejects unsupported charset and malformed source with actionable errors', async () => {
  await assert.rejects(render('flowchart LR\n A-->B', { charset: 'svg' }), { code: 'INVALID_OPTIONS' });
  await assert.rejects(render('flowchart LR\n A['), err => err instanceof FlowInkError && Number.isInteger(err.line));
});
test('a wide label is not clipped', async () => {
  const label = 'abc'.repeat(100);
  assert.ok((await render(`flowchart LR\n A[${label}] --> B`)).includes(label));
});
