import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';

function failure(source) {
  try { parse(source); } catch (error) { return error; }
  assert.fail('Expected a parse failure');
}

test('removed leading BOM is included in first-line token UTF-16 columns', () => {
  for (const label of ['ok', '中文🙂', 'e\u0301', '']) {
    const source = `flowchart LR; A[${label})`;
    const baseline = failure(source);
    const actual = failure(`\uFEFF${source}`);
    assert.equal(actual.code, 'PARSE_ERROR');
    assert.equal(actual.line, 1);
    assert.equal(actual.column, source.indexOf(')') + 2);
    assert.equal(actual.column, baseline.column + 1);
    assert.equal(actual.message, baseline.message);
    assert.deepEqual(actual.cause.hash, baseline.cause.hash);
  }
});

test('BOM correction does not alter later lines, frontmatter, CRLF, or fallback locations', () => {
  for (const source of [
    'flowchart LR\n A[ok)',
    'flowchart LR\r\n A[ok)',
    '---\r\ntitle: example\r\n---\r\nflowchart LR; A[ok)',
    '%% comment\nflowchart LR; A[ok)',
    '%%{wrap}%%\nflowchart LR; A[ok)',
    'flowchart LR; A[',
    'flowchart LR; A -->',
    'flowchart LR; A --> ]',
  ]) {
    const baseline = failure(source);
    const actual = failure(`\uFEFF${source}`);
    assert.equal(actual.line, baseline.line, source);
    assert.equal(actual.column, baseline.column, source);
    assert.equal(actual.message, baseline.message, source);
  }
});

test('BOM token locations stay isolated through repeated failure and valid parses', () => {
  for (let i = 0; i < 10; i++) {
    assert.equal(failure('\uFEFFflowchart LR; A[ok)').column, 20);
    assert.equal(failure('flowchart LR; A[ok)').column, 19);
    assert.equal(parse('\uFEFFflowchart LR; A --> B').edges.length, 1);
  }
});
