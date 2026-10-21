import test from 'node:test';
import assert from 'node:assert/strict';
import { labelLines, prepareNode } from '../src/text.js';
import { render } from '../src/index.js';
const unsafe = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

test('unsafe raw C0/C1 label controls become visible replacements', () => {
  for (let code=0;code<=0x9f;code++) {
    if (!unsafe.test(String.fromCharCode(code))) continue;
    assert.deepEqual(labelLines('A'+String.fromCharCode(code)+'B'), ['A�B'], `code ${code}`);
  }
  assert.deepEqual(labelLines('A\r\nB\rC\tD\n中文🙂 e\u0301 👨‍👩‍👧‍👦'), ['A','B','C   D','中文🙂 e\u0301 👨‍👩‍👧‍👦']);
});

test('entity-decoded controls and Markdown labels use the same terminal-safe boundary', () => {
  for(const encoded of ['&#27;', '&#x1b;', '#27;', '#x1b;', '&#7;', '&#x7f;']) {
    for(const mode of ['text','markdown']) assert.deepEqual(labelLines('A'+encoded+'B',mode),['A�B']);
  }
  assert.deepEqual(labelLines('A&#9;B&NewLine;C'),['A   B','C']);
  assert.deepEqual(labelLines('A\u001b[31mB\u0007'),['A�[31mB�']);
  assert.deepEqual(labelLines('A\u001b\tB'),['A�  B']);
});

test('node, edge, and group labels cannot emit raw terminal control bytes', async () => {
  const labels=['A\u001b[31mB','A\u001b]0;demo\u0007B','A\bB','A&#27;B'];
  for(const label of labels) {
    const sources=[
      `flowchart TB\nA["${label}<br/>padding padding padding"]`,
      `flowchart LR\nA-->|"${label}"|B`,
      `flowchart TB\nsubgraph G["${label}"]\nA-->B\nend`,
    ];
    for(const source of sources) for(const charset of ['ascii','unicode']) {
      const result=await render(source,{charset});
      assert.doesNotMatch(result,unsafe,JSON.stringify(result));
      assert.ok(result.includes('�'),JSON.stringify(result));
    }
  }
});

test('safe label rendering is deterministic and recovers after rejected input', async () => {
  const source='flowchart TB\nA["A&#27;B"]';
  const expected=await render(source);
  await assert.rejects(render('flowchart TB\nA['),{code:'PARSE_ERROR'});
  assert.deepEqual(await Promise.all(Array.from({length:4},()=>render(source))),Array(4).fill(expected));
});


test('generated shape placeholders also neutralize controls without parsing literal markup', () => {
  const node=prepareNode({shape:'<odd>\u001b]0;demo\u0007\r\nnext\tpart',label:'safe'});
  assert.deepEqual(node.lines,['[<odd>�]0;demo�','next    part]','safe']);
  assert.ok(node.lines.every(line=>!unsafe.test(line)));
});


test('many-line generated placeholders avoid argument-count limits during preparation', () => {
  const node=prepareNode({shape:'x\n'.repeat(150_000)+'x',label:''});
  assert.equal(node.lines.length,150_001);
  assert.equal(node.lines[0],'[x');
  assert.equal(node.lines.at(-1),'x]');
  assert.equal(node.height,150_003);
  assert.equal(node.width,6);
});
