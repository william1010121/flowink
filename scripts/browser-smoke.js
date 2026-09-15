import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
const outdir = '.cache/browser-smoke';
await mkdir(outdir, { recursive: true });
await build({ entryPoints: ['dist/index.js'], outfile: `${outdir}/flowink.js`,
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022', sourcemap: true });
const cases = [
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
await writeFile(`${outdir}/index.html`, `<!doctype html><html lang="en"><meta charset="utf-8"><title>FlowInk browser verification</title>
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
  let located=false;try{parse('flowchart LR\\n A[')}catch(e){located=Number.isInteger(e.line)}
  if(!located)throw Error('Syntax error lacks position');
  window.__flowinkSmoke={status:'passed',results};
  document.querySelector('#status').textContent='All browser checks passed';
}catch(error){window.__flowinkSmoke={status:'failed',results,error:error.stack};document.querySelector('#status').textContent=error.stack;}
</script></html>`);
console.log(`Browser verification built in ${outdir}. Serve it locally and inspect window.__flowinkSmoke.`);
