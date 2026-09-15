import stringWidth from 'string-width';
import { decodeHTML } from 'entities';
import { marked } from 'marked';

/**
 * Return the number of terminal character cells occupied by a string.
 *
 * `string-width` counts grapheme clusters and East Asian wide characters,
 * which is the same unit used by the text rasterizer.  A label can contain
 * newlines, so this function returns the width of its widest line.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function displayWidth(value) {
  if (value === null || value === undefined) return 0;
  const text = String(value).replace(/\r\n?/g, '\n');
  return Math.max(0, ...text.split('\n').map((line) => stringWidth(line)));
}

const graphemeSegmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

/** Expand tabs to four-column tab stops so terminal labels occupy known cells. */
function expandTabs(value) {
  return value.split('\n').map((line) => {
    let column = 0;
    let result = '';
    const graphemes = graphemeSegmenter
      ? [...graphemeSegmenter.segment(line)].map(({ segment }) => segment)
      : [...line];
    for (const grapheme of graphemes) {
      if (grapheme === '\t') {
        const spaces = 4 - (column % 4);
        result += ' '.repeat(spaces);
        column += spaces;
      } else {
        result += grapheme;
        column += stringWidth(grapheme);
      }
    }
    return result;
  }).join('\n');
}

const BLOCK_TAGS = /^(?:address|article|aside|blockquote|br|caption|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul)$/i;

/**
 * Decode Mermaid's entity notation as well as normal HTML entities. Mermaid's
 * flow parser accepts forms such as `#quot;`, `#9829;`, and `#amp;` in labels.
 * @param {string} value
 * @returns {string}
 */
function decodeLabelEntities(value) {
  // Decode normal HTML entities once. In particular, `&amp;lt;` means the
  // literal text `&lt;`; decoding repeatedly would incorrectly turn that into
  // `<` and lose the author's intent.
  let result = decodeHTML(value);
  // Mermaid's notation is deliberately decoded in one pass as well. The
  // negative lookbehind prevents the `#` in a native `&#9829;` reference from
  // being treated as a second, Mermaid-specific entity.
  return result.replace(/(?<!&)#(x[0-9a-f]+|[0-9]+|[a-z][a-z0-9]+);/gi, (match, name) => {
    const entity = /^x/i.test(name)
      ? `&#${name};`
      : /^[0-9]/.test(name)
        ? `&#${name};`
        : `&${name};`;
    const decoded = decodeHTML(entity);
    return decoded === entity ? match : decoded;
  });
}

/** Remove markup from a raw HTML token without evaluating it. */
function htmlTokenText(value) {
  const source = String(value);
  let result = '';
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      index = end < 0 ? source.length : end + 3;
      continue;
    }
    if (source[index] !== '<') {
      result += source[index];
      index += 1;
      continue;
    }

    // Find the tag terminator while respecting quoted `>` characters in
    // attributes. If this is not a valid tag (for example `A < B > C` or an
    // escaped `\>`), retain the angle bracket as ordinary label text.
    let end = index + 1;
    let quote = '';
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (quote) {
        if (character === quote) quote = '';
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === '>') {
        break;
      }
    }
    if (end >= source.length) {
      result += '<';
      index += 1;
      continue;
    }
    const rawTag = source.slice(index, end + 1);
    const match = rawTag.match(/^<(\/?[a-z][a-z0-9-]*)(?=\s|\/?>)[\s\S]*>$/i);
    if (!match) {
      result += '<';
      index += 1;
      continue;
    }
    const closing = match[1].startsWith('/');
    const tag = match[1].replace(/^\//, '').toLowerCase();
    if (tag === 'img') {
      const alt = rawTag.match(/\balt\s*=\s*(['"])([\s\S]*?)\1/i);
      if (alt) result += alt[2];
    } else if (tag === 'br') {
      result += '\n';
    } else if (BLOCK_TAGS.test(tag) && (closing || tag === 'hr')) {
      // A closing block tag terminates its content. Opening tags do not add a
      // line of their own, avoiding an empty line between adjacent paragraphs.
      result += '\n';
    }
    index = end + 1;
  }
  return result;
}

/** @param {any} token @returns {string} */
function tokenText(token) {
  if (!token) return '';
  const type = token.type;

  if (type === 'html') return htmlTokenText(token.text ?? token.raw ?? '');
  if (type === 'image') {
    // Marked keeps image alt text in `text`; retaining it prevents an image
    // label from silently becoming empty in a terminal diagram.
    return token.tokens ? tokensText(token.tokens) : (token.text ?? '');
  }
  if (type === 'br') return '\n';
  if (type === 'codespan' || type === 'code' || type === 'text' || type === 'escape') {
    if (type === 'code' || type === 'codespan') return token.text ?? '';
    if (token.tokens) return tokensText(token.tokens);
    return token.text ?? '';
  }
  if (type === 'hr') return '\n';
  if (type === 'space') return '\n';

  if (type === 'table') {
    const header = (token.header ?? []).map(tokenText).join(' | ');
    const rows = (token.rows ?? []).map((row) => row.map(tokenText).join(' | '));
    return [header, ...rows].filter((line) => line !== '').join('\n') + '\n';
  }

  if (type === 'list_item') {
    const body = token.tokens ? tokensText(token.tokens) : (token.text ?? '');
    // Task markers are meaningful label content even though marked stores
    // them as token metadata rather than child tokens.
    const marker = token.task ? `[${token.checked ? 'x' : ' '}] ` : '';
    return marker + body + '\n';
  }

  if (token.tokens) return tokensText(token.tokens) + (type === 'paragraph' || type === 'heading' ? '\n' : '');
  if (token.items) return token.items.map(tokenText).join('') + '\n';
  if (token.text !== undefined) return String(token.text);
  return '';
}

/** @param {any[]} tokens @returns {string} */
function tokensText(tokens) {
  return (tokens ?? []).map(tokenText).join('');
}

/**
 * Convert a Mermaid label to plain, displayable lines. Markdown and HTML are
 * parsed with marked only; no generated markup is inserted into a DOM or
 * otherwise executed.
 *
 * @param {unknown} label
 * @param {unknown} [labelType]
 * @returns {string[]}
 */
export function labelLines(label, labelType = 'text') {
  const source = label === null || label === undefined ? '' : String(label);
  if (source === '') return [''];

  let plain;
  const markdown = /^(?:markdown|md)$/i.test(String(labelType ?? ''));
  if (!markdown) {
    plain = htmlTokenText(source);
  } else {
    try {
      plain = tokensText(marked.lexer(source));
    } catch {
      // A malformed markdown extension should not make an otherwise printable
      // Mermaid node disappear. Entity decoding still applies in this fallback.
      plain = htmlTokenText(source);
    }
  }

  plain = expandTabs(decodeLabelEntities(plain).replace(/\r\n?/g, '\n'));
  // Lexer block tokens add a terminal newline. It is layout punctuation rather
  // than an additional empty line in the node label.
  plain = plain.replace(/^\n+|\n+$/g, '');
  return plain === '' ? [''] : plain.split('\n');
}

const SHAPE_ALIASES = new Map([
  ['rect', 'rect'], ['rectangle', 'rect'], ['square', 'rect'], ['proc', 'rect'], ['process', 'rect'], ['f_rect', 'rect'],
  ['fr_rect', 'rect'], ['subroutine', 'rect'], ['subproc', 'rect'],
  ['lined_square', 'rect'], ['notch_rect', 'rect'], ['div_rect', 'rect'],
  ['tag', 'rect'], ['fork', 'rect'], ['join', 'rect'],
  ['round', 'round'], ['rounded', 'round'], ['stadium', 'round'], ['pill', 'round'],
  ['event', 'round'], ['f_round', 'round'], ['fr_round', 'round'],
  ['circle', 'circle'], ['circ', 'circle'], ['doublecircle', 'circle'], ['dbl_circ', 'circle'], ['sm_circ', 'circle'], ['fr_circ', 'circle'], ['f_circ', 'circle'], ['state', 'circle'],
  ['diamond', 'diamond'], ['diam', 'diamond'], ['rhombus', 'diamond'], ['decision', 'diamond'], ['question', 'diamond'],
  ['image', 'image'], ['img', 'image'], ['icon', 'icon'],
]);

function shapeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function metadataField(metadata, name) {
  return metadata[name];
}

function shapeForNode(node) {
  const metadata = node && node.metadata && typeof node.metadata === 'object' ? node.metadata : {};
  const primary = node?.shape;
  const metadataShape = metadataField(metadata, 'shape');
  const iconValue = metadataField(metadata, 'icon');
  const imgValue = metadataField(metadata, 'img');
  const mediaKind = iconValue !== undefined && iconValue !== null
    ? 'icon'
    : imgValue !== undefined && imgValue !== null
      ? 'image'
      : undefined;
  const form = metadataField(metadata, 'form');
  const formShape = mediaKind && SHAPE_ALIASES.has(shapeKey(form)) ? form : undefined;
  const typeShape = SHAPE_ALIASES.has(shapeKey(node?.type)) ? node?.type : undefined;
  // Semantic parsing initializes legacy vertices to `rect`; an explicit
  // shape in the newer `@{ shape: ... }` form is kept in metadata. Let that
  // metadata replace only the default rectangle, while an explicit non-rect
  // node shape remains authoritative.
  const mediaUsesDefaultShape = mediaKind && metadataShape === undefined
    && (primary === undefined || shapeKey(primary) === 'rect');
  const candidates = mediaUsesDefaultShape
    ? [formShape]
    : shapeKey(primary) === 'rect' && metadataShape !== undefined
      ? [metadataShape, primary, node?.shapeType, typeShape]
      : [primary, node?.shapeType, metadataShape, typeShape];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const key = shapeKey(candidate);
    return { original: String(candidate), canonical: SHAPE_ALIASES.get(key) ?? 'rect', placeholderKind: mediaKind };
  }
  if (mediaKind) {
    return formShape
      ? { original: String(formShape), canonical: SHAPE_ALIASES.get(shapeKey(formShape)), placeholderKind: mediaKind }
      : { original: mediaKind, canonical: mediaKind, placeholderKind: mediaKind };
  }
  return { original: 'rect', canonical: 'rect' };
}

/**
 * Prepare a graph node for character-cell layout.
 *
 * @param {import('./types.js').FlowNode|Record<string, any>} node
 * @returns {{lines:string[],shape:string,width:number,height:number,metadata:Record<string, any>,originalShape:string}}
 */
export function prepareNode(node = {}) {
  const input = node && typeof node === 'object' ? node : {};
  const metadataInput = input.metadata && typeof input.metadata === 'object' ? input.metadata : {};
  const { original, canonical, placeholderKind } = shapeForNode(input);
  // Shape-data declarations (`A@{label: ...}`) are stored by the semantic
  // parser in metadata, while legacy nodes expose their label directly.
  const label = metadataField(metadataInput, 'label') ?? input.label ?? input.text ?? input.value ?? '';
  let lines = labelLines(label, input.labelType ?? metadataInput.labelType ?? 'text');
  const shapePlaceholder = shapeKey(original) !== 'rect' && !SHAPE_ALIASES.has(shapeKey(original));
  const prefixes = [];
  if (shapePlaceholder) prefixes.push(`[${original}]`);
  if (placeholderKind) prefixes.push(`[${placeholderKind}]`);
  else if (canonical === 'image' || canonical === 'icon') prefixes.push(`[${canonical}]`);
  if (prefixes.length) {
    lines = lines.length === 1 && lines[0] === '' ? prefixes : [...prefixes, ...lines];
  }

  const widest = Math.max(0, ...lines.map(displayWidth));
  // Two horizontal border cells plus one padding cell on each side.
  const padding = 1;
  const borderWidth = 2;
  const borderHeight = 2;
  const minimumWidth = canonical === 'circle' || canonical === 'diamond' ? 5 : canonical === 'image' || canonical === 'icon' ? 7 : 5;
  const minimumHeight = canonical === 'circle' || canonical === 'diamond' ? 5 : 3;
  let width = Math.max(minimumWidth, widest + padding * 2 + borderWidth);
  let height = Math.max(minimumHeight, lines.length + borderHeight);
  // The rasterizer draws circles as rounded boxes. Keeping independent width
  // and height avoids making a long label unnecessarily wide or tall.

  const originalProperties = { ...input };
  delete originalProperties.metadata;
  const metadata = { ...metadataInput };
  if (metadata.originalShape === undefined) metadata.originalShape = original;
  if (metadata.originalProperties === undefined) metadata.originalProperties = originalProperties;
  if (shapePlaceholder || placeholderKind) {
    metadata.placeholder = true;
    if (shapePlaceholder) metadata.placeholderFor = original;
    if (placeholderKind) metadata.placeholderKind = placeholderKind;
  }

  return { lines, shape: canonical, width, height, metadata, originalShape: original };
}

export { SHAPE_ALIASES };
