import stringWidth from 'string-width';
import { displayWidth } from '../src/text.js';
import assert from 'node:assert/strict';

function baseline(value) {
  if (value === null || value === undefined) return 0;
  const text = String(value).replace(/\r\n?/g, '\n');
  return Math.max(0, ...text.split('\n').map(line => stringWidth(line)));
}
const cases = [
  ['short-ascii', 'A short node label', 10000],
  ['short-unicode', '中文🙂\r\ne\u0301 and 👨‍👩‍👧‍👦', 3000],
  ['1000-lines', '中文🙂\r\n'.repeat(1000), 10],
  ['10000-lines', 'x\n'.repeat(10000) + '中文', 3],
  ['150000-lines', 'x\n'.repeat(150000) + '中文', 1],
];
function sample(fn, value, iterations) {
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn(value);
  return (performance.now() - start) / iterations;
}
for (const [name, value, iterations] of cases) {
  let baselineError;
  let baselineWidth;
  try { baselineWidth = baseline(value); }
  catch (error) { if (!(error instanceof RangeError)) throw error; baselineError = error.name; }
  if (!baselineError) assert.equal(displayWidth(value), baselineWidth);
  const before = [], after = [];
  for (let i = 0; i < 3; i++) { if (!baselineError) baseline(value); displayWidth(value); }
  for (let round = 0; round < 7; round++) {
    const run = () => { if (!baselineError) before.push(sample(baseline, value, iterations)); };
    const next = () => after.push(sample(displayWidth, value, iterations));
    if (round % 2) { next(); run(); } else { run(); next(); }
  }
  const median = values => values.length ? values.sort((a,b) => a-b)[Math.floor(values.length/2)] : null;
  console.log(JSON.stringify({name, baselineMs: median(before), candidateMs: median(after), ...(baselineError ? {baselineError} : {})}));
}
