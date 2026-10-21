import test from 'node:test';
import assert from 'node:assert/strict';
import { labelLines } from '../src/text.js';
import { labelLines as legacy } from './fixtures/text/legacy-text.js';

test('impossible HTML openers stay literal across repeated and mixed markup', () => {
  for (const value of ['<'.repeat(4000), '</'.repeat(2000), '< '.repeat(2000), '<'.repeat(2000)+'<b>text</b>']) {
    const expected=legacy(value);
    for(let i=0;i<3;i++)assert.deepEqual(labelLines(value),expected);
  }
});

test('HTML opener rejection preserves comments, tags, quotes, case and escaping', () => {
  const cases = ['', '<', '</', '<!-- comment -->after', '<!-- unclosed', '<!DOCTYPE html>', '<![CDATA[text]]>', '<?xml?>', '< br>', '<//b>', '<1b>', '<é>', '<B>x</B>', '<br/>', '<BR />', '<a-b x="a > b">text</a-b>', '<img alt="A > B">', '<span title="<b>">text</span>', '<span title="unclosed> <b>x</b>', '\\<literal\\>', 'A < B > C', '<\n<tag>x</tag>', '<\r\n>', '</ b>', '<b\tattr="x">y</b>', '<!-- <b> -->x', '<<b>text</b>', '<"<b>">text', '<\u0000>'];
  for (const value of cases) for(const mode of ['text','markdown']) assert.deepEqual(labelLines(value,mode),legacy(value,mode),JSON.stringify({value,mode}));
});

test('seeded malformed HTML and Unicode labels exactly match the legacy normalizer', () => {
  let seed=0xa7129;
  const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  const pieces=['<','>','/','!','?','-',' ','\t','\n','\r','"',"'",'a','B','1','é','中文','🙂','&lt;','#amp;','<!--','-->','<b>','</b>','<img alt="x">','\\'];
  for(let i=0;i<2000;i++) {
    const value=Array.from({length:random(70)},()=>pieces[random(pieces.length)]).join('');
    for(const mode of ['text','markdown']) assert.deepEqual(labelLines(value,mode),legacy(value,mode),`trial ${i}/${mode}`);
  }
});
