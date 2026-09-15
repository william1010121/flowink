import yaml from 'js-yaml';
import { FlowInkError } from '../errors.js';

const FRONT_MATTER = /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/s;

/** Keep Mermaid's parser-facing cleanup small and source-position preserving. */
function cleanupText(value) {
  return value.replace(/\r\n?/g, '\n').replace(
    /<(\w+)([^>]*)>/g,
    (match, tag, attributes) => `<${tag}${attributes.replace(/="([^"]*)"/g, "='$1'")}>`,
  );
}

function sourceLineAt(source, index) {
  return source.slice(0, index).split(/\r\n?|\n/).length;
}

export function preprocess(source) {
  const original = String(source);
  let text = cleanupText(original.replace(/^\uFEFF/, ''));
  let frontmatter;
  let lineOffset = 0;
  const match = text.match(FRONT_MATTER);
  if (match) {
    const prefix = match[0];
    lineOffset = prefix.split(/\r?\n/).length - (prefix.endsWith('\n') ? 1 : 0);
    try {
      frontmatter = yaml.load(match[2], { schema: yaml.JSON_SCHEMA }) ?? {};
      if (!frontmatter || typeof frontmatter !== 'object' || Array.isArray(frontmatter)) frontmatter = {};
    } catch (error) {
      const mark = error?.mark;
      throw new FlowInkError(error?.message ?? 'Invalid Mermaid frontmatter', {
        code: 'FRONTMATTER_ERROR',
        line: sourceLineAt(text, match.index + match[0].indexOf(match[2])) + (mark?.line ?? 0),
        column: mark ? mark.column + 1 : undefined,
        cause: error,
      });
    }
    text = text.slice(prefix.length);
  }
  const directives = [];
  text = text.replace(/^\s*%%\{([\s\S]*?)\}%%\s*(?:\r?\n|$)/gm, (match, value) => {
    directives.push(value.trim());
    // Keep the removed directive's newline(s) for Jison source locations.
    return match.replace(/[^\n]/g, '');
  });
  // Inline %% is syntax in the flow grammar and remains invalid there. Only
  // full-line comments are removed by Mermaid's flow preprocessor.
  text = text.replace(/^[^\S\n]*%%(?!\{)[^\n]*/gm, '');
  const metadata = {};
  if (frontmatter) {
    metadata.frontmatter = frontmatter;
    if (frontmatter.title !== undefined) metadata.title = String(frontmatter.title);
    if (frontmatter.config !== undefined) metadata.config = frontmatter.config;
    if (frontmatter.displayMode !== undefined) metadata.displayMode = String(frontmatter.displayMode);
  }
  if (directives.length) metadata.directives = directives;
  return { text, metadata, lineOffset };
}
