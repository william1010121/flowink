import { readFile, writeFile } from 'node:fs/promises';
import jison from 'jison';

const grammar = await readFile(new URL('../vendor/mermaid/flow.jison', import.meta.url), 'utf8');
const parser = new jison.Parser(grammar);
const output = parser.generate({ moduleType: 'commonjs' });
const commonJsFooter = output.indexOf('\nif (typeof require !==');
const body = commonJsFooter >= 0 ? output.slice(0, commonJsFooter) : output;
const typed = body.replace('var parser = (function(){', '/** @type {any} */\nvar parser = (function(){');
const esm = `${typed}\n/** @type {any} */\nconst generatedParser = parser;\nexport default generatedParser;\n`;
await writeFile(new URL('../src/parser/generated.js', import.meta.url), esm);
