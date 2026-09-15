import { FlowInkError } from './errors.js';
import { displayWidth } from './text.js';

/**
 * Turn an integer, orthogonally-routed layout into a terminal drawing.
 *
 * The rasterizer deliberately keeps a cell model until the very last step.
 * This is what lets a wide character reserve its second cell and lets us
 * detect a route that would otherwise disappear behind a node.
 *
 * @param {import('./types.js').LayoutGraph} layout
 * @param {import('./types.js').RenderOptions} [options]
 * @returns {string}
 */
export function rasterize(layout, options = {}) {
  const charset = options?.charset ?? 'ascii';
  if (charset !== 'ascii' && charset !== 'unicode') {
    throw new FlowInkError('charset must be "ascii" or "unicode".', { code: 'INVALID_OPTIONS' });
  }
  const checked = validateLayout(layout);
  const { boxes, edges, labels, width, height } = checked;
  const grid = makeGrid(width, height);
  const interior = buildInteriorMap(boxes, width, height);
  const nodeBorders = buildNodeBorderMap(boxes, width, height);
  const boxBorders = buildBoxBorderMap(boxes, width, height);
  const endpointOwners = buildEndpointOwners(edges);

  // Routes are drawn first.  A later box border can therefore cover the
  // endpoint cell while retaining the line up to the border.
  for (const edge of edges) drawEdge(grid, edge, interior, nodeBorders, boxBorders, endpointOwners, labels, charset);
  for (const box of boxes) drawBox(grid, box, charset);

  // Edge labels are intentionally applied after routes and boxes.  A label
  // collision is an impossible layout and must be visible to the caller.
  for (const edge of edges) {
    if (edge.label) drawLabel(grid, edge.label, `edge ${edge.id}`, edge.id);
  }
  for (const edge of edges) drawArrows(grid, edge, boxes, charset);

  return stringifyGrid(grid);
}

/** @param {import('./types.js').LayoutGraph} layout */
export function validateLayout(layout) {
  if (!layout || typeof layout !== 'object') fail('Layout must be an object.', 'INVALID_LAYOUT');
  if (!Array.isArray(layout.boxes) || !Array.isArray(layout.edges)) {
    fail('Layout must contain boxes and edges arrays.', 'INVALID_LAYOUT');
  }
  if (!Number.isInteger(layout.width) || !Number.isInteger(layout.height) || layout.width < 0 || layout.height < 0) {
    fail('Layout width and height must be non-negative integers.', 'INVALID_LAYOUT');
  }

  const boxIds = new Set();
  const boxes = layout.boxes.map((box, index) => {
    if (!box || typeof box !== 'object') fail(`Layout box ${index} is invalid.`, 'INVALID_LAYOUT');
    if (typeof box.id !== 'string' || boxIds.has(box.id)) fail(`Layout box id is missing or duplicated: ${box.id ?? index}.`, 'INVALID_LAYOUT');
    boxIds.add(box.id);
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!Number.isInteger(box[key])) fail(`Layout box ${box.id} has a non-integer ${key}.`, 'INVALID_LAYOUT');
    }
    if (box.x < 0 || box.y < 0 || box.width < 1 || box.height < 1) fail(`Layout box ${box.id} has invalid geometry.`, 'INVALID_LAYOUT');
    if (!Array.isArray(box.lines)) fail(`Layout box ${box.id} must provide lines.`, 'INVALID_LAYOUT');
    if (box.lines.some((line) => typeof line !== 'string')) fail(`Layout box ${box.id} has a non-string label line.`, 'INVALID_LAYOUT');
    return { ...box, shape: String(box.shape ?? 'rect') };
  });

  // A partial overlap cannot be represented without destroying one of the
  // two borders.  Containment is valid because subgraphs contain nodes.
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      if (partialBoxOverlap(boxes[i], boxes[j])) {
        fail(`Layout boxes ${boxes[i].id} and ${boxes[j].id} overlap.`, 'BOX_OVERLAP');
      }
    }
  }

  const edgeIds = new Set();
  const edges = layout.edges.map((edge, index) => {
    if (!edge || typeof edge !== 'object') fail(`Layout edge ${index} is invalid.`, 'INVALID_LAYOUT');
    if (typeof edge.id !== 'string' || edgeIds.has(edge.id)) fail(`Layout edge id is missing or duplicated: ${edge.id ?? index}.`, 'INVALID_LAYOUT');
    edgeIds.add(edge.id);
    if (!Array.isArray(edge.points) || edge.points.length < 1) fail(`Layout edge ${edge.id} must have at least one point.`, 'INVALID_LAYOUT');
    const points = edge.points.map((point, pointIndex) => {
      if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y) || point.x < 0 || point.y < 0) {
        fail(`Layout edge ${edge.id} has an invalid point at ${pointIndex}.`, 'INVALID_LAYOUT');
      }
      return { x: point.x, y: point.y };
    });
    for (let i = 1; i < points.length; i += 1) {
      if (points[i - 1].x !== points[i].x && points[i - 1].y !== points[i].y) {
        fail(`Layout edge ${edge.id} is not orthogonal.`, 'NON_ORTHOGONAL_EDGE');
      }
    }
    for (const arrow of [edge.arrowStart, edge.arrowEnd].filter((value) => value !== undefined)) {
      if (!['none', 'point', 'circle', 'cross'].includes(arrow)) fail(`Layout edge ${edge.id} has an invalid arrow type.`, 'INVALID_LAYOUT');
    }
    if (edge.stroke !== undefined && !['normal', 'thick', 'dotted', 'invisible'].includes(edge.stroke)) {
      fail(`Layout edge ${edge.id} has an invalid stroke.`, 'INVALID_LAYOUT');
    }
    return {
      ...edge,
      points,
      arrowStart: edge.arrowStart ?? 'none',
      arrowEnd: edge.arrowEnd ?? 'none',
      stroke: edge.stroke ?? 'normal',
    };
  });
  const labels = [];
  for (const edge of edges) {
    if (!edge.label) continue;
    const label = normalizeLabel(edge.label, `edge ${edge.id}`);
    labels.push(label);
  }

  // Layout coordinates are normally already translated to (0, 0).  Expand
  // dimensions when a caller supplies a valid route beyond the advertised
  // extent; silently clipping that route would be much worse than expansion.
  let width = layout.width;
  let height = layout.height;
  for (const box of boxes) { width = Math.max(width, box.x + box.width); height = Math.max(height, box.y + box.height); }
  for (const edge of edges) for (const point of edge.points) { width = Math.max(width, point.x + 1); height = Math.max(height, point.y + 1); }
  for (const label of labels) { width = Math.max(width, label.x + label.width); height = Math.max(height, label.y + label.height); }
  return { boxes, edges, labels, width, height };
}

function normalizeLabel(label, owner) {
  if (!label || !Number.isInteger(label.x) || !Number.isInteger(label.y) || label.x < 0 || label.y < 0 || !Array.isArray(label.lines)) {
    fail(`Label for ${owner} is invalid.`, 'INVALID_LAYOUT');
  }
  if (label.lines.some((line) => typeof line !== 'string')) fail(`Label for ${owner} has a non-string line.`, 'INVALID_LAYOUT');
  const measured = Math.max(0, ...label.lines.map((line) => displayWidth(line)));
  const width = Number.isInteger(label.width) && label.width >= measured ? label.width : measured;
  const height = Number.isInteger(label.height) && label.height >= label.lines.length ? label.height : label.lines.length;
  return { ...label, width, height };
}

function partialBoxOverlap(a, b) {
  const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  if (!overlap) return false;
  const contains = (outer, inner) => outer.kind === 'subgraph' && outer.x <= inner.x && outer.y <= inner.y && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;
  return !contains(a, b) && !contains(b, a);
}

function makeGrid(width, height) {
  return Array.from({ length: height }, () => Array.from({ length: width }, () => ({ glyph: ' ', kind: 'empty', wide: false, edge: null })));
}

function buildInteriorMap(boxes, width, height) {
  const map = new Map();
  const add = (x, y, box) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const key = `${x},${y}`;
    const old = map.get(key);
    if (old && old !== box.id) fail(`Nested box interiors overlap at (${x},${y}).`, 'BOX_OVERLAP');
    map.set(key, box.id);
  };
  for (const box of boxes) {
    // A subgraph is a container; routes between its children legitimately
    // occupy its interior. Node interiors remain obstacles.
    if (box.kind === 'subgraph') continue;
    for (let y = box.y + 1; y < box.y + box.height - 1; y += 1) {
      for (let x = box.x + 1; x < box.x + box.width - 1; x += 1) add(x, y, box);
    }
  }
  return map;
}

function buildNodeBorderMap(boxes, width, height) {
  const map = new Map();
  for (const box of boxes) {
    if (box.kind === 'subgraph') continue;
    for (const { x, y } of boxBorderCells(box, 'ascii')) {
      if (x >= 0 && y >= 0 && x < width && y < height) map.set(`${x},${y}`, box.id);
    }
  }
  return map;
}

function buildBoxBorderMap(boxes, width, height) {
  const map = new Map();
  for (const box of boxes) {
    for (const { x, y } of boxBorderCells(box, 'ascii')) {
      if (x >= 0 && y >= 0 && x < width && y < height) map.set(`${x},${y}`, box.id);
    }
  }
  return map;
}

function buildEndpointOwners(edges) {
  const map = new Map();
  for (const edge of edges) {
    for (const point of [edge.points[0], edge.points.at(-1)]) {
      const key = `${point.x},${point.y}`;
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(edge.id);
    }
  }
  return map;
}

function drawEdge(grid, edge, interior, nodeBorders, boxBorders, endpointOwners, labels, charset) {
  if (edge.stroke === 'invisible') return;
  const points = edge.points;
  const endpoints = new Set([`${points[0].x},${points[0].y}`, `${points[points.length - 1].x},${points[points.length - 1].y}`]);
  const legitimateSelfLoop = points[0].x === points.at(-1).x && points[0].y === points.at(-1).y
    && boxBorders.has(`${points[0].x},${points[0].y}`);
  const cells = new Map();
  const add = (x, y, directions, segmentIndex = -1) => {
    const cell = grid[y]?.[x];
    if (!cell) fail(`Edge ${edge.id} lies outside the layout.`, 'LAYOUT_CLIP');
    if (interior.has(`${x},${y}`)) fail(`Edge ${edge.id} passes through a box interior at (${x},${y}).`, 'EDGE_BOX_COLLISION');
    if (nodeBorders.has(`${x},${y}`) && !endpoints.has(`${x},${y}`)) fail(`Edge ${edge.id} crosses a non-endpoint node border at (${x},${y}).`, 'EDGE_BOX_COLLISION');
    const key = `${x},${y}`;
    let route = cells.get(key);
    if (!route) { route = { dirs: new Set(), edgeIds: new Set(), stroke: edge.stroke, segmentIndices: new Set() }; cells.set(key, route); }
    for (const direction of directions) route.dirs.add(direction);
    route.edgeIds.add(edge.id);
    route.segmentIndices.add(segmentIndex);
    if (strokeRank(edge.stroke) > strokeRank(route.stroke)) route.stroke = edge.stroke;
  };
  if (points.length === 1) add(points[0].x, points[0].y, []);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    const direction = dx ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    const reverse = opposite(direction);
    const count = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let step = 0; step <= count; step += 1) {
      const x = a.x + dx * step;
      const y = a.y + dy * step;
      add(x, y, step === 0 ? [direction] : step === count ? [reverse] : [direction, reverse], i - 1);
    }
  }
  for (const [key, route] of cells) {
    const segments = [...route.segmentIndices].filter((index) => index >= 0).sort((a, b) => a - b);
    const endpointBorder = endpointOwners.get(key)?.has(edge.id) && boxBorders.has(key);
    if (segments.length > 1 && segments.at(-1) - segments[0] > 1 && !endpointBorder && !legitimateSelfLoop) {
      fail(`Edge ${edge.id} crosses itself at (${key.replace(',', ',')}).`, 'ROUTE_COLLISION');
    }
  }
  for (const [key, route] of cells) {
    const [x, y] = key.split(',').map(Number);
    const cell = grid[y][x];
    if (cell.kind === 'label' || cell.kind === 'box-label') fail(`Edge ${edge.id} overwrites a label at (${x},${y}).`, 'EDGE_LABEL_COLLISION');
    if (!cell.edge) cell.edge = { dirs: new Set(), edgeIds: new Set(), stroke: route.stroke, edgeRoutes: new Map() };
    for (const [otherId, otherRoute] of cell.edge.edgeRoutes) {
      const allowed = sharedIntersection(key, edge.id, otherId, boxBorders, endpointOwners);
      if (!allowed && !compatibleCrossing(route.dirs, otherRoute.dirs)) {
        fail(`Edges ${otherId} and ${edge.id} overlap ambiguously at (${x},${y}).`, 'ROUTE_COLLISION');
      }
    }
    cell.edge.edgeRoutes.set(edge.id, { dirs: new Set(route.dirs), segmentIndices: new Set(route.segmentIndices) });
    for (const d of route.dirs) cell.edge.dirs.add(d);
    for (const id of route.edgeIds) cell.edge.edgeIds.add(id);
    if (strokeRank(route.stroke) > strokeRank(cell.edge.stroke)) cell.edge.stroke = route.stroke;
    cell.kind = 'edge';
    cell.glyph = edgeGlyph(cell.edge.dirs, cell.edge.edgeIds, cell.edge.stroke, charset);
  }
  // A route may intentionally run through another edge label.  The label is
  // rendered later and remains authoritative; its cells are reserved here so
  // box drawing cannot erase it.
  for (const label of labels) {
    for (let y = label.y; y < label.y + label.height; y += 1) for (let x = label.x; x < label.x + label.width; x += 1) {
      if (grid[y]?.[x]?.kind === 'box-label') fail(`Edge label overlaps a box label at (${x},${y}).`, 'LABEL_COLLISION');
    }
  }
}

function sharedIntersection(key, firstId, secondId, boxBorders, endpointOwners) {
  const owners = endpointOwners.get(key);
  if (owners?.has(firstId) && owners.has(secondId)) return true;
  // A single shared border cell is a valid place for a compound edge to
  // enter/leave a subgraph. Longer collinear overlaps are still rejected by
  // the direction check at their subsequent cells.
  return boxBorders.has(key) && (!owners || owners.size === 0);
}

function compatibleCrossing(first, second) {
  const firstHorizontal = first.has('left') && first.has('right') && !first.has('up') && !first.has('down');
  const firstVertical = first.has('up') && first.has('down') && !first.has('left') && !first.has('right');
  const secondHorizontal = second.has('left') && second.has('right') && !second.has('up') && !second.has('down');
  const secondVertical = second.has('up') && second.has('down') && !second.has('left') && !second.has('right');
  return (firstHorizontal && secondVertical) || (firstVertical && secondHorizontal);
}

function drawBox(grid, box, charset) {
  const cells = boxBorderCells(box, charset);
  for (const { x, y, glyph } of cells) {
    const cell = grid[y]?.[x];
    if (!cell) fail(`Box ${box.id} lies outside the layout.`, 'LAYOUT_CLIP');
    if (cell.kind === 'box-label' || cell.kind === 'label') fail(`Box ${box.id} overwrites a label at (${x},${y}).`, 'BOX_LABEL_COLLISION');
    const route = cell.edge;
    if (route && box.kind !== 'subgraph') {
      // Node endpoints retain their border glyph. Intermediate node-border
      // crossings are rejected while the edge is rasterized.
      cell.edge = null;
    }
    cell.kind = 'box';
    cell.glyph = route && box.kind === 'subgraph' ? borderWithRoute(glyph, route, charset) : glyph;
  }
  const innerWidth = Math.max(0, box.width - 2);
  const innerHeight = Math.max(0, box.height - 2);
  const lines = box.lines;
  if (lines.length > innerHeight) fail(`Box ${box.id} does not have enough height for its label.`, 'BOX_LABEL_COLLISION');
  // Mermaid puts a container title in the header row.  Centering a very tall
  // subgraph title would place it directly on a child route.
  const top = box.kind === 'subgraph'
    ? box.y + 1
    : box.y + 1 + Math.floor((innerHeight - lines.length) / 2);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineWidth = displayWidth(line);
    if (lineWidth > innerWidth) fail(`Box ${box.id} does not have enough width for its label.`, 'BOX_LABEL_COLLISION');
    const left = box.x + 1 + Math.floor((innerWidth - lineWidth) / 2);
    putText(grid, left, top + i, line, 'box-label', `box ${box.id}`);
  }
}

function boxBorderCells(box, charset) {
  const out = [];
  const { x, y, width: w, height: h } = box;
  const shape = String(box.shape ?? 'rect').toLowerCase();
  const glyphs = charset === 'unicode';
  const put = (xx, yy, glyph) => out.push({ x: xx, y: yy, glyph });
  if (w === 1 || h === 1) {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) put(xx, yy, glyphs ? '│' : '|');
    return out;
  }
  const rounded = shape === 'round' || shape === 'rounded' || shape === 'stadium' || shape === 'circle';
  if (rounded) {
    const c = glyphs ? ['╭', '╮', '╰', '╯'] : ['/', '\\', '\\', '/'];
    put(x, y, c[0]); put(x + w - 1, y, c[1]); put(x, y + h - 1, c[2]); put(x + w - 1, y + h - 1, c[3]);
    for (let xx = x + 1; xx < x + w - 1; xx += 1) { put(xx, y, glyphs ? '─' : '-'); put(xx, y + h - 1, glyphs ? '─' : '-'); }
    for (let yy = y + 1; yy < y + h - 1; yy += 1) { put(x, yy, glyphs ? '│' : '|'); put(x + w - 1, yy, glyphs ? '│' : '|'); }
    return out;
  }
  if (shape === 'diamond' || shape === 'rhombus') {
    // A terminal has no diagonal drawing primitive.  This slanted-corner
    // approximation keeps a complete bounding border, so ELK ports landing
    // on any side remain visibly connected.
    const slash = glyphs ? '╱' : '/';
    const back = glyphs ? '╲' : '\\';
    const vertical = glyphs ? '│' : '|';
    for (let xx = x + 1; xx < x + w - 1; xx += 1) { put(xx, y, glyphs ? '─' : '-'); put(xx, y + h - 1, glyphs ? '─' : '-'); }
    put(x, y, slash); put(x + w - 1, y, back); put(x, y + h - 1, back); put(x + w - 1, y + h - 1, slash);
    for (let yy = y + 1; yy < y + h - 1; yy += 1) {
      const left = yy === y + Math.floor((h - 1) / 2) ? (glyphs ? '◁' : '<') : vertical;
      const right = yy === y + Math.floor((h - 1) / 2) ? (glyphs ? '▷' : '>') : vertical;
      put(x, yy, left); put(x + w - 1, yy, right);
    }
    return out;
  }
  const corner = glyphs ? ['┌', '┐', '└', '┘'] : ['+', '+', '+', '+'];
  put(x, y, corner[0]); put(x + w - 1, y, corner[1]); put(x, y + h - 1, corner[2]); put(x + w - 1, y + h - 1, corner[3]);
  for (let xx = x + 1; xx < x + w - 1; xx += 1) { put(xx, y, glyphs ? '─' : '-'); put(xx, y + h - 1, glyphs ? '─' : '-'); }
  for (let yy = y + 1; yy < y + h - 1; yy += 1) { put(x, yy, glyphs ? '│' : '|'); put(x + w - 1, yy, glyphs ? '│' : '|'); }
  return out;
}

function borderWithRoute(border, route, charset) {
  const horizontal = route.dirs.has('left') || route.dirs.has('right');
  const vertical = route.dirs.has('up') || route.dirs.has('down');
  // Preserve ordinary endpoint borders. A route that passes through a
  // container border in both directions gets an explicit junction glyph so
  // the connection cannot disappear behind the border.
  if (horizontal && vertical) return charset === 'unicode' ? '┼' : '+';
  if (horizontal && route.dirs.has('left') && route.dirs.has('right')) return charset === 'unicode' ? '─' : '-';
  if (vertical && route.dirs.has('up') && route.dirs.has('down')) return charset === 'unicode' ? '│' : '|';
  return border;
}

function drawLabel(grid, label, owner, edgeId) {
  for (let i = 0; i < label.lines.length; i += 1) putText(grid, label.x, label.y + i, label.lines[i], 'label', owner, false, edgeId);
}

function putText(grid, x, y, text, kind, owner, allowRoute = false, allowedEdgeId = undefined) {
  if (!grid[y]) fail(`${owner} lies outside the layout.`, 'LAYOUT_CLIP');
  let column = x;
  let previous = null;
  for (const grapheme of segment(text)) {
    const w = Math.max(0, displayWidth(grapheme));
    if (w === 0) {
      if (previous) previous.glyph += grapheme;
      continue;
    }
    if (column < 0 || column + w > grid[y].length) fail(`${owner} lies outside the layout.`, 'LAYOUT_CLIP');
    for (let offset = 0; offset < w; offset += 1) {
      const cell = grid[y][column + offset];
      // Edge labels are allowed to occupy the route's cells: the label is
      // the visible representation there. Node and box labels, borders, and
      // arrows cannot be overwritten.
      const routeLabel = (kind === 'label' || allowRoute) && cell.kind === 'edge'
        && (!allowedEdgeId || (cell.edge?.edgeIds.size === 1 && cell.edge.edgeIds.has(allowedEdgeId)));
      if (!routeLabel && (cell.kind === 'box' || cell.kind === 'edge' || cell.kind === 'arrow' || cell.kind === 'label' || cell.kind === 'box-label')) {
        fail(`${owner} collides at (${column + offset},${y}).`, 'LABEL_COLLISION');
      }
      cell.kind = kind; cell.glyph = offset === 0 ? grapheme : ''; cell.wide = offset === 0 && w > 1;
    }
    previous = grid[y][column];
    column += w;
  }
}

function drawArrows(grid, edge, boxes, charset) {
  if (edge.stroke === 'invisible' || edge.points.length < 2) return;
  const place = (kind, arrow, at, toward) => {
    if (!arrow || arrow === 'none') return;
    const cell = grid[at.y]?.[at.x];
    if (!cell) fail(`Arrow for edge ${edge.id} lies outside the layout.`, 'LAYOUT_CLIP');
    if (cell.kind === 'box-label' || cell.kind === 'label') fail(`Arrow for edge ${edge.id} overwrites a label.`, 'EDGE_LABEL_COLLISION');
    if (cell.kind === 'box') fail(`Arrow for edge ${edge.id} overwrites a box border.`, 'EDGE_BOX_COLLISION');
    if (cell.kind === 'arrow') fail(`Arrow for edge ${edge.id} overlaps another arrow.`, 'ARROW_COLLISION');
    if (cell.kind === 'edge' && cell.edge && [...cell.edge.edgeIds].some((id) => id !== edge.id)) {
      fail(`Arrow for edge ${edge.id} hides another route.`, 'ARROW_COLLISION');
    }
    const glyph = arrowGlyph(arrow, toward, charset);
    cell.kind = 'arrow'; cell.glyph = glyph; cell.wide = false;
  };
  const first = distinctPair(edge.points, true);
  const last = distinctPair(edge.points, false);
  if (first) place('start', edge.arrowStart, first.next, opposite(directionBetween(first.current, first.next)));
  if (last) place('end', edge.arrowEnd, last.previous, directionBetween(last.previous, last.current));
}

function distinctPair(points, start) {
  if (start) {
    for (let i = 1; i < points.length; i += 1) if (points[i].x !== points[0].x || points[i].y !== points[0].y) return { current: points[0], next: oneStep(points[0], points[i]) };
  } else {
    for (let i = points.length - 2; i >= 0; i -= 1) if (points[i].x !== points[points.length - 1].x || points[i].y !== points[points.length - 1].y) return { previous: oneStep(points[points.length - 1], points[i]), current: points[points.length - 1] };
  }
  return null;
}

function oneStep(end, toward) {
  return { x: end.x + Math.sign(toward.x - end.x), y: end.y + Math.sign(toward.y - end.y) };
}

function directionBetween(a, b) {
  if (b.x > a.x) return 'right'; if (b.x < a.x) return 'left'; if (b.y > a.y) return 'down'; return 'up';
}

function edgeGlyph(dirs, edgeIds, stroke, charset) {
  if (dirs.size === 0) return charset === 'unicode' ? '·' : '.';
  const has = (d) => dirs.has(d);
  if (dirs.size >= 4) return charset === 'unicode' ? (edgeIds.size > 1 ? '╳' : '┼') : (edgeIds.size > 1 ? '#' : '+');
  if (dirs.size === 3) return charset === 'unicode' ? '┼' : '+';
  if (dirs.size === 2 && has('left') && has('right')) return charset === 'unicode' ? unicodeStroke(stroke, 'h') : asciiStroke(stroke, 'h');
  if (dirs.size === 2 && has('up') && has('down')) return charset === 'unicode' ? unicodeStroke(stroke, 'v') : asciiStroke(stroke, 'v');
  if (dirs.size === 2) {
    if (charset === 'ascii') return '+';
    if (has('right') && has('down')) return '┌'; if (has('left') && has('down')) return '┐'; if (has('right') && has('up')) return '└'; return '┘';
  }
  return charset === 'unicode' ? (has('left') || has('right') ? unicodeStroke(stroke, 'h') : unicodeStroke(stroke, 'v')) : (has('left') || has('right') ? asciiStroke(stroke, 'h') : asciiStroke(stroke, 'v'));
}

function asciiStroke(stroke, axis) { return stroke === 'thick' ? (axis === 'h' ? '=' : '#') : stroke === 'dotted' ? (axis === 'h' ? ':' : ':') : (axis === 'h' ? '-' : '|'); }
function unicodeStroke(stroke, axis) { return stroke === 'thick' ? (axis === 'h' ? '━' : '┃') : stroke === 'dotted' ? (axis === 'h' ? '┄' : '┆') : (axis === 'h' ? '─' : '│'); }
function strokeRank(stroke) { return stroke === 'thick' ? 3 : stroke === 'normal' ? 2 : stroke === 'dotted' ? 1 : 0; }
function opposite(direction) { return ({ left: 'right', right: 'left', up: 'down', down: 'up' })[direction]; }

function arrowGlyph(arrow, direction, charset) {
  if (arrow === 'circle') return charset === 'unicode' ? '○' : 'o';
  if (arrow === 'cross') return charset === 'unicode' ? '×' : 'x';
  if (charset === 'unicode') return ({ left: '◀', right: '▶', up: '▲', down: '▼' })[direction] ?? '▶';
  return ({ left: '<', right: '>', up: '^', down: 'v' })[direction] ?? '>';
}

function stringifyGrid(grid) {
  if (!grid.length) return '';
  let left = Infinity;
  let right = -1;
  for (const row of grid) {
    for (let x = 0; x < row.length; x += 1) {
      if (row[x].glyph && row[x].glyph !== ' ') { left = Math.min(left, x); right = Math.max(right, x); }
    }
  }
  if (right < 0) return '';
  // An empty glyph is a continuation cell reserved by a wide grapheme; it
  // contributes no extra character. Ordinary empty cells contain a literal
  // space and must remain available for routing and alignment.
  const lines = grid.slice().map((row) => row.slice(left, right + 1).map((cell) => cell.glyph === '' ? '' : (cell.glyph || ' ')).join('').replace(/[ \t]+$/u, ''));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  while (lines.length && lines[0] === '') lines.shift();
  return lines.join('\n');
}

function segment(value) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (item) => item.segment);
  return Array.from(value);
}

function fail(message, code) { throw new FlowInkError(message, { code }); }

export default rasterize;
