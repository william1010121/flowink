import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parse.js';
import { render } from '../src/index.js';

function location(source, line, column) {
  assert.throws(() => parse(source), error => {
    assert.equal(error.code, 'PARSE_ERROR');
    assert.equal(error.line, line);
    assert.equal(error.column, column);
    return true;
  });
}

test('syntax errors point at the unexpected token, not the previous label', () => {
  location('flowchart LR\n A[ok)\n', 2, 6);
  location('flowchart LR\n  end\n', 2, 3);
  location('flowchart LR\n A --> "first\nsecond"\n', 2, 9);
  location('flowchart LR\n A[中文🙂)\n', 2, 8);
});

test('lookahead locations retain original lines through preprocessing', () => {
  location('---\ntitle: example\n---\n%%{wrap}%%\nflowchart LR\n A[ok)\n', 6, 6);
  location('flowchart LR\r\n%% comment\r\n\r\n A[ok)\r\n', 4, 6);
  location('flowchart LR\n A["first\nsecond"]\n  end\n', 4, 3);
});

test('EOF and lexical errors retain their existing fallback behavior', () => {
  location('flowchart LR\n A[', 2, 4);
  location('flowchart LR\n A -->', 2, 3);
  location('flowchart LR\n A -->\n', 2, 3);
  location('flowchart LR\n click A', 2, 8);
  assert.throws(() => parse('flowchart LR\n A --> ]'), error => {
    assert.equal(error.code, 'PARSE_ERROR');
    assert.equal(error.line, undefined);
    assert.equal(error.column, undefined);
    return true;
  });
});

test('error capture stays isolated across failures and successful parses', () => {
  for (let i = 0; i < 10; i++) {
    location('flowchart LR\n A[ok)\n', 2, 6);
    assert.equal(parse('flowchart LR\n A --> B').edges.length, 1);
    location('flowchart LR\n\n  end\n', 3, 3);
  }
});

test('concurrent render failures do not affect successful parses or each other', async () => {
  const sources = ['flowchart LR\n A[ok)\n', 'flowchart LR\n A --> B', 'flowchart LR\n\n  end\n'];
  for (let i = 0; i < 3; i++) {
    const results = await Promise.allSettled(sources.map(source => render(source)));
    assert.equal(results[0].status, 'rejected');
    assert.equal(results[0].reason.line, 2);
    assert.equal(results[0].reason.column, 6);
    assert.equal(results[1].status, 'fulfilled');
    assert.match(results[1].value, /A/);
    assert.equal(results[2].status, 'rejected');
    assert.equal(results[2].reason.line, 3);
    assert.equal(results[2].reason.column, 3);
  }
});

test('the stable adapter captures separate working clones without modifying the base', async () => {
  const { default: parser } = await import('../src/parser/generated.js');
  const { captureLexer } = await import('../src/parser/lexer-capture.js');
  const before = Object.getOwnPropertyDescriptors(parser.lexer);
  const adapter = captureLexer(parser.lexer);
  assert.ok(Object.isFrozen(adapter));
  const first = Object.create(adapter);
  const second = Object.create(adapter);
  let firstCapture, secondCapture;
  first.setInput('flowchart LR\n A --> B\n', { lex: { firstGraph: () => true }, captureLexer: lexer => { firstCapture = lexer; } });
  second.setInput('flowchart TB\n X --> Y\n', { lex: { firstGraph: () => true }, captureLexer: lexer => { secondCapture = lexer; } });
  assert.equal(firstCapture, first);
  assert.equal(secondCapture, second);
  assert.notEqual(first.yy, second.yy);
  assert.notEqual(first.conditionStack, second.conditionStack);
  first.lex();
  assert.equal(second.offset, 0);
  second.lex();
  assert.equal(firstCapture, first);
  assert.deepEqual(Object.getOwnPropertyDescriptors(parser.lexer), before);
  assert.equal(Object.hasOwn(parse('flowchart LR\n A --> B'), 'captureLexer'), false);
  assert.equal(Object.hasOwn(parse('flowchart LR\n A --> B').metadata, 'captureLexer'), false);
});
