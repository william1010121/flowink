import { build } from 'esbuild';
import { mkdir, rm, readFile, writeFile, chmod } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
// Keep normal npm dependencies external. Browser bundlers consume the same ESM entry.
await build({ entryPoints: ['src/index.js'], outfile: 'dist/index.js', bundle: true,
  format: 'esm', platform: 'neutral', packages: 'external', target: 'es2022', sourcemap: true });
const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--project', 'tsconfig.types.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);

// Do not bundle Node-only CLI code into the browser/library entry or declarations.
const cli = await readFile('cli/flowink.js', 'utf8');
await writeFile('dist/cli.js', cli.replace("import('../src/index.js')", "import('./index.js')"));
await chmod('dist/cli.js', 0o755);
