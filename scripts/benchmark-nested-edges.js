import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { render } from '../src/index.js';
const baseline = process.argv[2] ? (await import(pathToFileURL(resolve(process.argv[2])).href)).render : null;
if (!baseline) throw new Error('Pass the baseline src/index.js path.');
const cases = [
  ['small', 'flowchart TB\nA-->B'],
  ['decision', 'flowchart TB\nA-->B{Ready?}\nB-->|yes|C\nB-->|no|D\nC-->E\nD-->E'],
  ['chain100', 'flowchart TB\n' + Array.from({ length: 99 }, (_, i) => `N${i}-->N${i+1}`).join('\n')],
  ['deepGroups', 'flowchart TB\n' + Array.from({ length: 15 }, (_, i) => `subgraph G${i}`).join('\n') + '\na-->b\n' + 'end\n'.repeat(15)],
  ['repairedNested', 'flowchart TB\nsubgraph A\na\nsubgraph B\nc\nend\na-->c\nend'],
  ['repairedCompound', 'flowchart TB\nsubgraph A\na\nsubgraph B\nc\nend\na-->c\nend\nA-->z'],
];
async function measure(fn, source) {
  for (let i = 0; i < 3; i++) await fn(source);
  const samples = [];
  for (let i = 0; i < 9; i++) { const start = performance.now(); await fn(source); samples.push(performance.now() - start); }
  return samples.sort((a,b) => a-b)[4];
}
for (const [name, source] of cases) {
  const output = await render(source); let baselineMs = null; let baselineError;
  try { if (await baseline(source) !== output) throw new Error(`Output changed: ${name}`); baselineMs = await measure(baseline, source); }
  catch (error) { if (error.code !== 'LAYOUT_MISSING_EDGE') throw error; baselineError = error.code; }
  console.log(JSON.stringify({name, baselineMs, candidateMs: await measure(render, source), ...(baselineError ? {baselineError} : {})}));
}
