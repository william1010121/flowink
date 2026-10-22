import test from 'node:test';
import assert from 'node:assert/strict';
import { labelLines } from '../src/text.js';
import { labelLines as legacy } from './fixtures/text/legacy-text.js';

test('unterminated plausible tag suffixes retain their literal text', () => {
  for (const value of ['<a'.repeat(2000), '</b'.repeat(1000), '<br/>done' + '<a'.repeat(1000), '<a>'.repeat(20) + '<b'.repeat(1000)]) {
    const expected = legacy(value);
    for (let repeat = 0; repeat < 3; repeat++) assert.deepEqual(labelLines(value), expected);
  }
});

test('comments remain authoritative even after the last literal tag terminator', () => {
  for (const value of ['<!-- unclosed<a<a', '<b>x</b><!-- <a<a', '<!-- closed --><a<a', '<a<!-- unclosed', '<a<!-- done -->tail<a']) {
    for (const mode of ['text', 'markdown']) assert.deepEqual(labelLines(value, mode), legacy(value, mode));
  }
});

test('quoted terminators, Unicode, escaping and entities keep legacy interpretation', () => {
  const cases = ['<a title=">">x</a><b', "<a title='>'>x</a><b", '<a title="unclosed> <b', '<img alt="中文🙂 > x"><a', '<br/>\n<a', '&lt;a', '<a&gt;', '<a#gt;', '\\<a\\>', '<a\n中文🙂é<a', '<a\ud800', '<a\udc00', '\r\n<a\t<a', '<a/>x<!-- no end'];
  for (const value of cases) for (const mode of ['text', 'markdown']) assert.deepEqual(labelLines(value, mode), legacy(value, mode), JSON.stringify({ value, mode }));
});
