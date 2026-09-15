#!/usr/bin/env node
/**
 * Refresh the offline Mermaid flowchart parser corpus.
 *
 * This script intentionally uses the pinned commit instead of a moving branch.
 * The generated files are checked in so compatibility tests never need network
 * access. Run it manually when upgrading the compatibility baseline.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const COMMIT = '98a0945418c76238f15df2afaddbba4272656c3b';
const TAG = 'mermaid@12.0.0';
const BASE = `https://raw.githubusercontent.com/mermaid-js/mermaid/${COMMIT}`;
const RELATIVE = [
  'packages/mermaid/src/diagrams/flowchart/parser/flow-arrows.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow-comments.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow-direction.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow-edges.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow-huge.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow-interactions.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow-lines.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow-md-string.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow-node-data.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow-singlenode.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow-style.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow-text.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow-vertice-chaining.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/flow.spec.js',
  'packages/mermaid/src/diagrams/flowchart/parser/subgraph.spec.js',
];
const OUT = join(ROOT, 'test/fixtures/upstream');
const SPEC_OUT = join(OUT, 'specs');
const CASE_OUT = join(OUT, 'cases.json');

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

// Decode the static string forms used by the upstream parser tests. Dynamic
// template expressions are deliberately skipped: silently guessing their
// value would turn an oracle fixture into a hand-authored test.
function decodeStaticString(source, start) {
  const quote = source[start];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;
  let i = start + 1;
  let value = '';
  while (i < source.length) {
    const ch = source[i++];
    if (ch === quote) return { value, end: i };
    if (ch === '\\') {
      const next = source[i++];
      if (next === 'n') value += '\n';
      else if (next === 'r') value += '\r';
      else if (next === 't') value += '\t';
      else if (next === 'b') value += '\b';
      else if (next === 'f') value += '\f';
      else if (next === 'v') value += '\v';
      else if (next === '0') value += '\0';
      else if (next === 'x') {
        const hex = source.slice(i, i + 2);
        if (!/^[0-9a-f]{2}$/i.test(hex)) return null;
        value += String.fromCharCode(parseInt(hex, 16)); i += 2;
      } else if (next === 'u') {
        const hex = source[i] === '{' ? source.slice(i + 1, source.indexOf('}', i)) : source.slice(i, i + 4);
        if (!/^(?:[0-9a-f]{4}|[0-9a-f]{6})$/i.test(hex)) return null;
        value += String.fromCodePoint(parseInt(hex, 16)); i += source[i] === '{' ? hex.length + 2 : 4;
      } else value += next;
      continue;
    }
    // A template interpolation is not a static fixture.
    if (quote === '`' && ch === '$' && source[i] === '{') return null;
    value += ch;
  }
  return null;
}

// Evaluate the small expression subset used by the parser specs without
// executing upstream JavaScript. Most specs build a source from adjacent
// string literals (`'graph TD\\n' + 'A-->B'`).
function decodeStaticExpression(source, start) {
  let i = start;
  while (/\s/.test(source[i] ?? '')) i += 1;
  const first = decodeStaticString(source, i);
  if (!first) return null;
  let value = first.value;
  i = first.end;
  while (true) {
    const beforeOperator = i;
    while (/\s/.test(source[i] ?? '')) i += 1;
    if (source[i] !== '+') {
      i = beforeOperator;
      break;
    }
    i += 1;
    while (/\s/.test(source[i] ?? '')) i += 1;
    const next = decodeStaticString(source, i);
    if (!next) return null;
    value += next.value;
    i = next.end;
  }
  return { value, end: i };
}

function cleanupComments(value) {
  return value.replace(/^\s*%%(?!{)[^\n]+\n?/gm, '').trimStart();
}

function readTemplate(source, start) {
  if (source[start] !== '`') return null;
  let i = start + 1;
  let body = '';
  while (i < source.length) {
    const ch = source[i++];
    if (ch === '\\') {
      body += ch + (source[i++] ?? '');
    } else if (ch === '`') {
      return { body, end: i };
    } else {
      body += ch;
    }
  }
  return null;
}

function stringArray(source, name) {
  const match = source.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) return [];
  const values = [];
  const bodyStart = match.index + match[0].indexOf('[') + 1;
  let offset = 0;
  while (offset < match[1].length) {
    const relative = match[1].slice(offset).search(/['"`]/);
    if (relative < 0) break;
    const start = offset + relative;
    const decoded = decodeStaticString(source, bodyStart + start);
    if (decoded) {
      values.push(decoded.value);
      offset = start + (decoded.end - (bodyStart + start));
    } else {
      offset = start + 1;
    }
  }
  return values;
}

function objectArray(source, name) {
  const match = source.match(new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
  if (!match) return [];
  return [...match[1].matchAll(/\{([\s\S]*?)\}/g)].map((item) => {
    const value = {};
    for (const field of ['edgeStart', 'edgeEnd', 'stroke', 'type']) {
      const found = item[1].match(new RegExp(`${field}\\s*:\\s*(['"])(.*?)\\1`));
      if (found) value[field] = found[2];
    }
    return value;
  }).filter((item) => item.edgeStart && item.edgeEnd);
}

function expandedTemplate(body, replacements) {
  let result = body;
  for (const [expression, value] of Object.entries(replacements)) {
    const escaped = String(value).replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
    result = result.replaceAll(`\${${expression}}`, escaped);
  }
  if (result.includes('${')) return null;
  return decodeStaticString(`\`${result}\``, 0)?.value ?? null;
}

function addDerivedCase(cases, source, file, offset, suffix, value) {
  if (value === null || value === undefined) return;
  const location = lineColumn(source, offset);
  cases.push({
    id: `${file}:${location.line}:${location.column}:derived:${suffix}`,
    source: value,
    upstream: file,
    line: location.line,
    column: location.column,
    derived: true,
  });
}

// Expand bounded, data-only templates from the upstream tests. This handles
// parameter tables and repeat(length) loops without evaluating arbitrary test
// code. The source expressions are retained verbatim in specs/ for provenance.
function extractDerivedCases(source, file) {
  const cases = [];
  const searchable = maskJavaScriptComments(source);
  const call = /(?:flow\.parser\.parse|parseDiagram|parser\.parse)\s*\(/g;
  const arrays = new Map();
  for (const name of ['keywords', 'errorKeywords', 'workingKeywords', 'specialChars']) {
    arrays.set(name, stringArray(source, name));
  }
  const objectArrays = new Map([
    ['regularEdges', objectArray(source, 'regularEdges')],
    ['doubleEndedEdges', objectArray(source, 'doubleEndedEdges')],
  ]);
  let match;
  while ((match = call.exec(searchable))) {
    const prefix = searchable.slice(0, match.index);
    const disabled = [...prefix.matchAll(/\b(?:it|test|specify)\.(?:skip)\s*\(/g)].at(-1);
    const enabled = [...prefix.matchAll(/\b(?:it|test|specify)(?:\.only)?\s*\(/g)].at(-1);
    if (disabled && (!enabled || disabled.index > enabled.index)) continue;
    let start = match.index + match[0].length;
    while (/\s/.test(source[start] ?? '')) start += 1;
    if (source[start] !== '`') continue;
    const template = readTemplate(source, start);
    if (!template) continue;

    const each = [...prefix.matchAll(/\bit\.each\(\s*([A-Za-z_$][\w$]*)\s*\)/g)].at(-1);
    if (each && arrays.get(each[1])?.length) {
      for (const value of arrays.get(each[1])) {
        const expanded = expandedTemplate(template.body, { keyword: value, specialChar: value });
        addDerivedCase(cases, source, file, start, `${each[1]}=${value}`, expanded);
      }
    }

    const loop = [...prefix.matchAll(/\b([A-Za-z_$][\w$]*)\.forEach\(\s*\(\s*([A-Za-z_$][\w$]*)/g)].at(-1);
    if (loop && objectArrays.get(loop[1])?.length) {
      for (const value of objectArrays.get(loop[1])) {
        const replacements = Object.fromEntries(Object.entries(value).map(([key, item]) => [`${loop[2]}.${key}`, item]));
        addDerivedCase(cases, source, file, start, `${loop[1]}=${value.type ?? 'edge'}`, expandedTemplate(template.body, replacements));
      }
    }

    if (/\$\{\s*['"][^'"]*['"]\.repeat\(\s*length\s*\)\s*\}/.test(template.body)) {
      for (let length = 1; length <= 3; length += 1) {
        const expanded = template.body.replace(/\$\{\s*(['"])(.*?)\1\.repeat\(\s*length\s*\)\s*\}/g, (_all, _quote, value) => value.repeat(length));
        addDerivedCase(cases, source, file, start, `length=${length}`, expandedTemplate(expanded, {}));
      }
    }
  }
  return cases;
}

function lineColumn(source, offset) {
  const before = source.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
}

function maskJavaScriptComments(source) {
  // split('') preserves UTF-16 code-unit offsets, matching source[i] and the
  // locations recorded in the fixture manifest even when specs contain emoji.
  const chars = source.split('');
  let quote = null;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '/' && source[i + 1] === '/') {
      chars[i] = ' '; chars[i + 1] = ' '; i += 2;
      while (i < source.length && source[i] !== '\n') { chars[i] = ' '; i += 1; }
      i -= 1;
    } else if (ch === '/' && source[i + 1] === '*') {
      chars[i] = ' '; chars[i + 1] = ' '; i += 2;
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] !== '\n' && source[i] !== '\r') chars[i] = ' ';
        i += 1;
      }
      if (i < source.length) { chars[i] = ' '; chars[i + 1] = ' '; i += 1; }
    }
  }
  return chars.join('');
}

function extractCases(source, file) {
  const cases = [];
  const call = /(?:flow\.parser\.parse|parseDiagram|parser\.parse)\s*\(/g;
  const searchable = maskJavaScriptComments(source);
  const testDeclaration = /\b(?:it|test|specify)(?:\.(?:skip|only))?\s*\(/g;
  let match;
  while ((match = call.exec(searchable))) {
    // Disabled upstream tests are evidence in the vendored source, but they
    // are not executed parser cases and must not become compatibility claims.
    testDeclaration.lastIndex = 0;
    let declaration;
    let current;
    while ((current = testDeclaration.exec(searchable)) && current.index < match.index) {
      declaration = current;
    }
    if (declaration?.[0].includes('.skip')) continue;
    let i = match.index + match[0].length;
    while (/\s/.test(source[i] ?? '')) i += 1;
    let expressionStart = i;
    let wrappedByCommentCleanup = false;
    if (source.startsWith('cleanupComments', i)) {
      const open = source.indexOf('(', i + 'cleanupComments'.length);
      if (open < 0) continue;
      expressionStart = open + 1;
      wrappedByCommentCleanup = true;
    }
    const decoded = decodeStaticExpression(source, expressionStart);
    if (!decoded) continue;
    const location = lineColumn(source, i);
    cases.push({
      id: `${file}:${location.line}:${location.column}`,
      source: wrappedByCommentCleanup ? cleanupComments(decoded.value) : decoded.value,
      upstream: file,
      line: location.line,
      column: location.column,
    });
    call.lastIndex = decoded.end;
  }
  return cases;
}

await mkdir(SPEC_OUT, { recursive: true });
const manifest = [];
const cases = [];
for (const relative of RELATIVE) {
  const response = await fetch(`${BASE}/${relative}`);
  if (!response.ok) throw new Error(`Unable to fetch ${relative}: ${response.status}`);
  const text = await response.text();
  const name = relative.split('/').at(-1);
  await writeFile(join(SPEC_OUT, name), text);
  manifest.push({ path: relative, file: `specs/${name}`, sha256: sha256(text), bytes: Buffer.byteLength(text) });
  cases.push(...extractCases(text, name), ...extractDerivedCases(text, name));
}

const unique = [];
const seen = new Set();
for (const item of cases) {
  const key = item.source;
  if (seen.has(key)) continue;
  seen.add(key);
  item.index = unique.length;
  unique.push(item);
}
await writeFile(CASE_OUT, `${JSON.stringify({ baseline: { tag: TAG, commit: COMMIT }, cases: unique }, null, 2)}\n`);
const readme = `# Mermaid flowchart compatibility corpus\n\n` +
  `These files are copied from Mermaid ${TAG} at commit ${COMMIT}.\n` +
  `The parser tests are retained verbatim under \`specs/\`; \`cases.json\` contains\n` +
  `deduplicated static arguments passed to the upstream parser in those tests.\n` +
  `Unbounded/generated and explicitly skipped test inputs are intentionally excluded;\n` +
  `bounded data-only templates are expanded into derived cases with provenance.\n` +
  `The compatibility harness uses Mermaid's raw flowchart parser and FlowDB for\n` +
  `these cases, matching the upstream tests. Focused preprocessing cases use\n` +
  `the public \`mermaidAPI.getDiagramFromText()\` frontend separately.\n\n` +
  `Source: https://github.com/mermaid-js/mermaid/tree/${COMMIT}/packages/mermaid/src/diagrams/flowchart/parser\n` +
  `License: Mermaid is MIT licensed; see \`vendor/mermaid/LICENSE\`.\n\n` +
  `## Integrity\n\n` + manifest.map((item) => `- \`${item.file}\`: ${item.sha256}`).join('\n') + '\n';
await writeFile(join(OUT, 'README.md'), readme);
await writeFile(join(OUT, 'manifest.json'), `${JSON.stringify({ baseline: { tag: TAG, commit: COMMIT }, files: manifest, caseCount: unique.length }, null, 2)}\n`);
console.log(`Downloaded ${manifest.length} upstream specs and extracted ${unique.length} static cases.`);
