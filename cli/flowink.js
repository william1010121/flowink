#!/usr/bin/env node
// Node-only entry point. Keep renderer imports behind argument validation.
import { open, readFile } from 'node:fs/promises';

const help = `Usage: flowink [--charset ascii|unicode] [--] [FILE|-]

Render a UTF-8 Mermaid flowchart. FILE defaults to standard input.
  --charset ascii|unicode  Output alphabet (default: ascii)
  --help, -h               Show this help (standalone)
  --version, -v            Show version (standalone)
`;

function argumentsFor(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
  if (argv.length === 1 && ['--version', '-v'].includes(argv[0])) return { version: true };
  let charset = 'ascii';
  let charsetSeen = false;
  let file;
  let options = true;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (options && arg === '--') { options = false; continue; }
    if (options && (arg === '--charset' || arg.startsWith('--charset='))) {
      if (charsetSeen) throw new Error('Specify --charset only once.');
      charsetSeen = true;
      charset = arg === '--charset' ? argv[++i] : arg.slice('--charset='.length);
      if (charset !== 'ascii' && charset !== 'unicode') throw new Error('--charset requires ascii or unicode.');
    } else if (options && arg.startsWith('-') && arg !== '-') {
      throw new Error(`Unknown or non-standalone option: ${arg}`);
    } else {
      if (file !== undefined) throw new Error('Specify at most one input file.');
      file = arg;
    }
  }
  return { charset, file };
}

// One escaped diagnostic line, even when a filename or parser error is hostile.
function diagnostic(error) {
  const fields = [];
  if (error instanceof Error) {
    if (error.code !== undefined) fields.push(error.code);
    if (error.line !== undefined) fields.push(`${error.line}${error.column === undefined ? '' : `:${error.column}`}`);
  }
  const details = fields.join(' ');
  const message = `${details ? `[${details}] ` : ''}${error instanceof Error ? error.message : String(error)}`;
  return message.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/gu,
    character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
}
function fail(error, code = 1) {
  process.exitCode ||= code;
  // A failed diagnostic must never trigger another diagnostic.
  try { process.stderr.write(`flowink: ${diagnostic(error)}\n`); } catch { /* exit status already records failure */ }
}
process.stderr.on('error', () => { process.exitCode ||= 1; });
process.stdout.on('error', error => {
  if (error.code !== 'EPIPE') process.exitCode ||= 1;
});
function output(text) {
  return new Promise((resolve, reject) => {
    const finish = error => error && error.code !== 'EPIPE' ? reject(error) : resolve();
    try { process.stdout.write(text, finish); } catch (error) { finish(error); }
  });
}
async function input(file) {
  if (file === undefined || file === '-') {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  const handle = await open(file, 'r');
  try {
    if ((await handle.stat()).isDirectory()) throw new Error(`Input is a directory: ${file}`);
    return await handle.readFile();
  } finally { await handle.close(); }
}

let args;
try { args = argumentsFor(process.argv.slice(2)); } catch (error) { fail(error, 2); }
if (args) {
  try {
    if (args.help) await output(help);
    else if (args.version) {
      const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
      await output(`${version}\n`);
    } else {
      const bytes = await input(args.file);
      // ignoreBOM preserves U+FEFF; fatal rejects malformed UTF-8 rather than replacing it.
      const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      const { render } = await import('../src/index.js');
      await output(await render(source, { charset: args.charset }) + '\n');
    }
  } catch (error) {
    fail(error);
  }
}
