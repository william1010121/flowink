import test from 'node:test';
import assert from 'node:assert/strict';
import { labelLines } from '../src/text.js';
import { labelLines as legacy } from './fixtures/text/legacy-text.js';

test('tab-free preparation preserves Unicode, surrogates, newlines and coercion', () => {
  for (const value of ['', null, undefined, 123, false, {toString:()=> '中文'}, 'a\r\nb\rc\n', '👩‍💻 é 🇹🇼', '\ud800\udfff\ud800', '<b>Hello</b>', '&Tab;', '&#9;', 'a\tb', '\t中文\t👩‍💻\t', '```\ncode\n```']) {
    for (const type of ['text', 'markdown']) assert.deepEqual(labelLines(value,type),legacy(value,type));
  }
});

test('seeded mixed tab and tab-free labels match the pre-optimization implementation', () => {
  let state=0x12345678;
  const next=()=> {state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
  const alphabet=['a','中','👩‍💻','é','\ud800','\udfff','\n','\r','\t','&amp;','<','>','"',' ','*','\\'];
  for(let i=0;i<1000;i++){
    let value='';for(let n=next()%30;n>0;n--)value+=alphabet[next()%alphabet.length];
    for(const type of ['text','markdown'])assert.deepEqual(labelLines(value,type),legacy(value,type));
  }
});
