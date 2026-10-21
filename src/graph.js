import { FlowInkError } from './errors.js';

const directions = new Set(['TB', 'BT', 'LR', 'RL']);
const arrows = new Set(['none', 'point', 'circle', 'cross']);
const strokes = new Set(['normal', 'thick', 'dotted', 'invisible']);
const MAX_METADATA_DEPTH = 256;
const nodeMetadata = ['label', 'shape', 'labelType', 'icon', 'img', 'form'];

/**
 * Snapshot only data consumed by the renderer, before any asynchronous work.
 * Unknown properties and inert metadata are deliberately neither read nor
 * traversed. This is a data boundary, not a sandbox for arbitrary JS Proxies.
 * @param {import('./types.js').FlowGraph} input
 * @returns {import('./types.js').FlowGraph}
 */
export function snapshotGraph(input) {
  record(input, 'graph');
  const direction = choice(field(input, 'direction', 'graph'), directions, 'graph.direction');
  const nodes = list(field(input, 'nodes', 'graph'), 'graph.nodes').map((node, index) => {
    const path = `graph.nodes[${index}]`;
    record(node, path);
    const id = identifier(field(node, 'id', path), `${path}.id`);
    return {
      id,
      label: text(field(node, 'label', path), `${path}.label`, id),
      labelType: text(field(node, 'labelType', path), `${path}.labelType`, 'text'),
      shape: text(field(node, 'shape', path), `${path}.shape`, 'rect'),
      ...parent(node, path),
      metadata: metadata(field(node, 'metadata', path), path, nodeMetadata),
      styles: [], classes: [],
    };
  });
  const edgeIds = new Set();
  const edges = list(field(input, 'edges', 'graph'), 'graph.edges').map((edge, index) => {
    const path = `graph.edges[${index}]`;
    record(edge, path);
    const id = identifier(field(edge, 'id', path), `${path}.id`);
    if (edgeIds.has(id)) fail(`Duplicate edge id: ${id}.`);
    edgeIds.add(id);
    return {
      id,
      source: identifier(field(edge, 'source', path), `${path}.source`),
      target: identifier(field(edge, 'target', path), `${path}.target`),
      label: text(field(edge, 'label', path), `${path}.label`, ''),
      labelType: text(field(edge, 'labelType', path), `${path}.labelType`, 'text'),
      arrowStart: choice(field(edge, 'arrowStart', path), arrows, `${path}.arrowStart`, 'none'),
      arrowEnd: choice(field(edge, 'arrowEnd', path), arrows, `${path}.arrowEnd`, 'none'),
      stroke: choice(field(edge, 'stroke', path), strokes, `${path}.stroke`, 'normal'),
      length: 1, styles: [], classes: [], metadata: {},
    };
  });
  const subgraphs = list(field(input, 'subgraphs', 'graph'), 'graph.subgraphs').map((group, index) => {
    const path = `graph.subgraphs[${index}]`;
    record(group, path);
    const id = identifier(field(group, 'id', path), `${path}.id`);
    const localDirection = field(group, 'direction', path);
    const members = field(group, 'nodeIds', path);
    return {
      id,
      label: text(field(group, 'label', path), `${path}.label`, id),
      nodeIds: members === undefined ? [] : list(members, `${path}.nodeIds`).map((child, i) => identifier(child, `${path}.nodeIds[${i}]`)),
      ...parent(group, path),
      ...(localDirection === undefined ? {} : { direction: choice(localDirection, directions, `${path}.direction`) }),
      metadata: metadata(field(group, 'metadata', path), path, ['labelType']),
      styles: [], classes: [],
    };
  });
  // makeContext validates IDs, endpoint/parent references, and containment
  // cycles synchronously before invoking ELK. It receives only this snapshot.
  return { source: '', direction, nodes, edges, subgraphs, classes: {}, metadata: {} };
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be a plain data object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(`${path} must be a plain data object.`);
}

function field(value, key, path) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return undefined;
  if (!Object.hasOwn(descriptor, 'value')) fail(`${path}.${key} must be a data property, not an accessor.`);
  return descriptor.value;
}

function list(value, path) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail(`${path} must be an array.`);
  const result = [];
  for (let i = 0; i < value.length; i++) {
    if (!Object.hasOwn(value, i)) fail(`${path} must not contain empty slots.`);
    result.push(field(value, String(i), path));
  }
  return result;
}

function identifier(value, path) {
  if (typeof value !== 'string' || value.length === 0) fail(`${path} must be a non-empty string.`);
  return value;
}

function text(value, path, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') fail(`${path} must be a string.`);
  return value;
}

function choice(value, allowed, path, fallback) {
  if (value === undefined) value = fallback;
  if (!allowed.has(value)) fail(`${path} has an unsupported value.`);
  return value;
}

function parent(value, path) {
  const parentId = field(value, 'parentId', path);
  return parentId === undefined ? {} : { parentId: identifier(parentId, `${path}.parentId`) };
}

function metadata(value, path, keys) {
  if (value === undefined) return {};
  record(value, `${path}.metadata`);
  const result = {};
  for (const key of keys) {
    const item = field(value, key, `${path}.metadata`);
    if (item !== undefined) {
      // Media contents are not read or loaded: prepareNode uses only presence.
      // Do not traverse unused payloads (including aliases or accessors).
      if (key === 'icon' || key === 'img') {
        result[key] = item === null ? null : true;
        continue;
      }
      const copy = data(item, `${path}.metadata.${key}`, new Set());
      // These fields are later coerced to text by shape/label preparation.
      // Validate the inert copy, never the caller's object or its hooks.
      if (['label', 'shape', 'form', 'labelType'].includes(key)) {
        try { String(copy); } catch { fail(`${path}.metadata.${key} must be convertible to text.`); }
      }
      result[key] = copy;
    }
  }
  return result;
}

// Rendering metadata can contain JSON arrays/objects (for example shape-data
// labels). Copy data descriptors without invoking getters, toJSON, or coercion.
function data(value, path, ancestors, depth = 0, memo = new WeakMap()) {
  if (depth > MAX_METADATA_DEPTH) fail(`${path} exceeds the drawing-metadata depth limit of ${MAX_METADATA_DEPTH}.`);
  if (value === null || value === undefined || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value !== 'object') fail(`${path} must contain data, not executable values.`);
  if (ancestors.has(value)) fail(`${path} must not contain a cycle.`);
  const cached = memo.get(value);
  if (cached) {
    // A subtree first visited near the root may later appear much deeper.
    if (depth + cached.height > MAX_METADATA_DEPTH) fail(`${path} exceeds the drawing-metadata depth limit of ${MAX_METADATA_DEPTH}.`);
    return cached.copy;
  }
  ancestors.add(value);
  let height = 0;
  const child = (item, childPath) => {
    const copy = data(item, childPath, ancestors, depth + 1, memo);
    const childHeight = item !== null && typeof item === 'object' ? memo.get(item).height : 0;
    height = Math.max(height, childHeight + 1);
    return copy;
  };
  let result;
  if (Array.isArray(value)) {
    result = list(value, path).map((item, index) => child(item, `${path}[${index}]`));
  } else {
    record(value, path);
    result = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') fail(`${path} must not contain symbol properties.`);
      Object.defineProperty(result, key, { value: child(field(value, key, path), `${path}.${key}`), enumerable: true, writable: true, configurable: true });
    }
  }
  ancestors.delete(value);
  memo.set(value, { copy: result, height });
  return result;
}

function fail(message) { throw new FlowInkError(message, { code: 'INVALID_GRAPH' }); }
