import test from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { parse, render } from '../src/index.js';

const sourceFor = raw => `flowchart TB\n A@{${raw}}`;
const metadataFor = raw => parse(sourceFor(raw)).nodes[0].metadata;

test('raw multiline shape YAML follows literal, folded, indent and chomp semantics', () => {
  for (const header of ['|', '>', '|-', '>-', '|+', '>+', '|2', '>2', '|2-', '|-2', '>2+', '>+2']) {
    for (const rootIndent of ['', '  ', '    ']) {
      const raw = `\n${rootIndent}label: ${header}\n${rootIndent}  one  \n${rootIndent}  two\n\n`;
      const expected = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
      assert.deepEqual(metadataFor(raw), { ...expected, raw: raw.replace(/\r\n?/g, '\n').trim() });
    }
  }
});

test('scalar key-like content, comments, sibling keys and nested mappings retain their meaning', () => {
  const fixtures = [
    'label: |\n  shape: rect\n  # literal comment\n',
    'label: >\n  one\n  two\nshape: rect\n',
    'shape: rect\nlabel: |\n  one\n  two\n',
    '\n  # root comment\n  label: |\n    one\n\n    two\n  shape: rect\n',
    'settings:\n  color: blue\n  values:\n    - one\n    - two\nlabel: Hello\n',
    'label: |-\r\n  one\r\n  two\r\n',
  ];
  for (const raw of fixtures) {
    assert.deepEqual(metadataFor(raw), { ...yaml.load(raw, { schema: yaml.JSON_SCHEMA }), raw: raw.replace(/\r\n?/g, '\n').trim() });
  }
  const literal = metadataFor(fixtures[0]);
  assert.equal(literal.label, 'shape: rect\n# literal comment\n');
  assert.equal(Object.hasOwn(literal, 'shape'), false);
});

test('inline flow mappings stay compatible and empty block scalars parse', () => {
  for (const raw of ['shape: rect, label: Hello', '\n shape: rect,\n', ' label: "Hello", shape: rect ']) {
    assert.deepEqual(metadataFor(raw), { ...yaml.load(`{${raw.trim()}}`, { schema: yaml.JSON_SCHEMA }), raw: raw.replace(/\r\n?/g, '\n').trim() });
  }
  for (const raw of ['label: |+\n\n', 'label: >+2 # empty\n\n', 'label: |-\n\n']) {
    assert.equal(metadataFor(raw).label, yaml.load(raw, { schema: yaml.JSON_SCHEMA }).label);
  }
  for (const header of ['|', '>', '|-', '|+', '|2']) {
    const raw = `label: ${header}\n`;
    assert.equal(metadataFor(raw).label, '');
  }
});

test('ambiguous indentation errors remain explicit and successful rendering recovers', async () => {
  // Previously dedenting made these non-YAML mappings appear valid.
  for (const raw of ['label: Hello\n  shape: rect\n', ' label: |\n  one\nshape: rect\n', 'label: |\n one\nshape: [\n']) {
    assert.throws(() => metadataFor(raw), error => error.code === 'SHAPE_DATA_ERROR');
  }
  const scalar = sourceFor('label: |\n  one\n  two\n');
  const equivalent = 'flowchart TB\n A["one<br/>two<br/>"]';
  for (const charset of ['ascii', 'unicode']) {
    const expected = await render(equivalent, { charset });
    assert.equal(await render(scalar, { charset }), expected);
    assert.equal(await render(scalar, { charset }), expected);
  }
});
