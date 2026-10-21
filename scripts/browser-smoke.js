import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const outdir = '.cache/browser-smoke';
await mkdir(outdir, { recursive: true });
await build({ entryPoints: ['dist/index.js'], outfile: `${outdir}/flowink.js`,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', sourcemap: true });
const cases = [
  ['metadata-keys', 'flowchart TB\nA@{__proto__: kept, constructor: ctor, prototype: proto, label: Visible} --> B'],
  ['yaml-scalar', 'flowchart TB\n A@{label: |\n  shape: rect\n  # literal text\n}'],
  ['tab-label', 'flowchart LR\n A["中\t👩‍💻\té"] --> B["plain label"]'],
  ['grapheme-lines', 'flowchart TB\n A["中文<br/>👩‍💻<br/>👨‍👩‍👧‍👦<br/>é<br/>a"]'],
  ['branch', 'flowchart LR\n A[Start] --> B{Ready?}\n B -->|yes| C[Work]\n B -->|no| D[Wait]'],
  ['cycle', 'flowchart TB\n A[Alpha] --> B[Beta] --> C[Gamma] --> A'],
  ['parallel', 'flowchart LR\n A -->|first| B\n A -->|second| B\n B -->|return| A'],
  ['nested', 'flowchart TB\n subgraph Outer\n subgraph Inner\n A --> B\n end\n C\n end\n B --> C\n C --> D'],
  ['CJK', 'flowchart LR\n A["開始 👩‍💻"] -->|確認| B["完成 é"]'],
];
const { render } = await import('../dist/index.js');
const expected = await Promise.all(cases.map(async ([name, source]) => ({
  name, outputs: await Promise.all(['ascii', 'unicode'].map(charset => render(source, { charset }))),
})));
await writeFile(`${outdir}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>FlowInk browser verification</title><link rel="icon" href="data:,">
<style>body{font:16px system-ui;margin:24px;background:#fafafa;color:#222}pre{font:14px/1.25 ui-monospace,monospace;white-space:pre;overflow:auto;padding:16px;background:white;border:1px solid #ddd}h2{font-size:16px}</style>
<h1>FlowInk browser verification</h1><p id="status">Running…</p><main></main><script type="module">
import {render,parse} from './flowink.js';
const cases = ${JSON.stringify(cases)};
const expected = ${JSON.stringify(expected)};
const results=[];
try {
  for(const [name,source] of cases){
    const outputs=await Promise.all(['ascii','unicode'].map(charset=>render(source,{charset})));
    if(!outputs.every(s=>typeof s==='string'&&s.length))throw Error(name+': empty output');
    if(JSON.stringify(outputs)!==JSON.stringify(expected.find(row=>row.name===name).outputs))throw Error(name+': browser output differs from Node.js');
    const repeat=await render(source);
    if(repeat!==outputs[0])throw Error(name+': unstable output');
    const graph=parse(source);
    if(graph.source!==source)throw Error(name+': source lost');
    results.push({name,nodes:graph.nodes.length,edges:graph.edges.length,passed:true});
    for(let i=0;i<outputs.length;i++){
      const title=document.createElement('h2');title.textContent=name+' / '+['ASCII','Unicode'][i];
      const pre=document.createElement('pre');pre.textContent=outputs[i];document.querySelector('main').append(title,pre);
    }
  }
  const special=parse('flowchart TB\\nA@{__proto__: kept, constructor: ctor, prototype: proto}').nodes[0].metadata;
  if(!Object.hasOwn(special,'__proto__') || special.__proto__!=='kept' || Object.getPrototypeOf(special)!==Object.prototype)throw Error('Own metadata key lost');
  const kept=parse('flowchart TB\\n A@{label: |+\\n  one\\n\\n}').nodes[0].metadata;
  if(kept.label!=='one\\n\\n')throw Error('YAML keep chomping changed');
  const nested=parse('flowchart TB\\n A@{settings:\\n  color: blue\\nlabel: hi\\n}').nodes[0].metadata;
  if(nested.settings.color!=='blue' || Object.hasOwn(nested,'color'))throw Error('Nested YAML flattened');
  const largeShapeSource='flowchart TB\\n A@{label: |\\n'+'  a\\n'.repeat(150001)+'shape: rect\\n}';
  const largeShape=parse(largeShapeSource);
  if(largeShape.nodes.length!==1 || largeShape.nodes[0].metadata.label!=='a\\n'.repeat(150001))throw Error('Large YAML scalar failed');
  for(const [source,line,column] of [['flowchart LR\\n A[ok)\\n',2,6],['flowchart LR\\n A[中文🙂)\\n',2,8],['flowchart LR\\n  end\\n',2,3]]){
    let caught=false;try{parse(source)}catch(e){caught=true;if(e.line!==line||e.column!==column)throw Error('Wrong lookahead location');}
    if(!caught)throw Error('Invalid lookahead accepted');
  }
  let located=false;try{parse('flowchart LR\\n A[')}catch(e){located=Number.isInteger(e.line)}
  if(!located)throw Error('Syntax error lacks position');
  window.__flowinkSmoke={status:'passed',results};
  document.querySelector('#status').textContent='All browser checks passed';
}catch(error){window.__flowinkSmoke={status:'failed',results,error:error.stack};document.querySelector('#status').textContent=error.stack;}
</script></html>`);
console.log(`Browser verification built in ${outdir}. Serve it locally and inspect window.__flowinkSmoke.`);
