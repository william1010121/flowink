import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';

test('blank lines around comments keep original syntax error locations', () => {
  const source = 'flowchart LR\n\n%% note\n\n A[';
  assert.throws(() => parse(source), error => error.code === 'PARSE_ERROR' && error.line === 5);
});
test('multiple removed directives and CRLF comments keep original lines', () => {
  const source = '%%{init: {"theme":"dark"}}%%\r\nflowchart LR\r\n\r\n%% note\r\n%%{wrap}%%\r\n\r\n A[';
  assert.throws(() => parse(source), error => error.line === 7);
});
test('YAML error columns are one-based', () => {
  assert.throws(() => parse('---\ntitle: [bad\n---\nflowchart LR\n A-->B'), error => error.code === 'FRONTMATTER_ERROR' && error.line === 3 && error.column === 1);
});
