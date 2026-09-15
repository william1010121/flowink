import { FlowInkError } from './errors.js';
import { displayWidth } from './text.js';

/** @typedef {import('./types.js').LayoutGraph} LayoutGraph */

/*
 * Place labels after ELK has produced routes.  ELK's label coordinates are
 * useful for a graphical renderer, but they are not character-cell safe: a
 * rounded coordinate can put a label on a border, an arrow, or another
 * route.  This module intentionally works only with the public integer
 * LayoutGraph contract, so it can also be used by callers that provide their
 * own layout.
 */

/**
 * Reposition every edge label around its own orthogonal route.
 *
 * The input graph is updated in place and returned for convenient piping.
 * Boxes and routes are never rerouted.  If a label (or supplied geometry)
 * reaches a negative coordinate, the complete graph is translated and the
 * advertised canvas is expanded accordingly.
 *
 * @param {LayoutGraph} layout
 * @returns {LayoutGraph}
 */
export function placeLabels(layout) {
  validateInput(layout);

  const boxes = layout.boxes;
  const edges = layout.edges;
  const obstacles = buildBoxObstacles(boxes);
  const routeCells = new Map();
  const arrowCells = new Set();

  for (const edge of edges) {
    validateRoute(edge);
    const cells = segmentCellsForRoute(edge.points);
    for (const cell of cells) {
      const cellKey = key(cell.x, cell.y);
      if (!routeCells.has(cellKey)) routeCells.set(cellKey, new Set());
      routeCells.get(cellKey).add(edge.id);
    }
    deriveArrowCells(edge, arrowCells);
  }

  const placed = [];
  for (const edge of edges) {
    if (!edge.label) continue;
    const label = normalizeLabel(edge.label, edge.id);
    const route = edge.points;
    const candidate = findPlacement({
      edge,
      label,
      route,
      obstacles,
      routeCells,
      arrowCells,
      placed,
      bounds: layoutBounds(layout, boxes, edges),
    });
    if (!candidate) {
      throw new FlowInkError(`Cannot place label for edge ${edge.id} without hiding graph geometry.`, {
        code: 'LABEL_PLACEMENT_ERROR',
      });
    }
    edge.label = { ...edge.label, ...label, x: candidate.x, y: candidate.y };
    placed.push({ edgeId: edge.id, ...label, x: candidate.x, y: candidate.y });
  }

  translateAndExpand(layout);
  return layout;
}

function validateInput(layout) {
  if (!layout || typeof layout !== 'object' || !Array.isArray(layout.boxes) || !Array.isArray(layout.edges)) {
    fail('Layout must contain boxes and edges arrays.', 'INVALID_LAYOUT');
  }
  for (const box of layout.boxes) {
    if (!box || typeof box.id !== 'string' || !Number.isInteger(box.x) || !Number.isInteger(box.y)
      || !Number.isInteger(box.width) || !Number.isInteger(box.height)
      || box.width < 1 || box.height < 1 || !Array.isArray(box.lines)) {
      fail(`Layout box ${box?.id ?? '<unknown>'} is invalid.`, 'INVALID_LAYOUT');
    }
  }
  const ids = new Set();
  for (const edge of layout.edges) {
    if (!edge || typeof edge.id !== 'string' || ids.has(edge.id)) fail(`Layout edge id is missing or duplicated: ${edge?.id ?? '<unknown>'}.`, 'INVALID_LAYOUT');
    ids.add(edge.id);
    if (!Array.isArray(edge.points) || edge.points.length < 1) fail(`Layout edge ${edge.id} must have at least one point.`, 'INVALID_LAYOUT');
  }
}

function validateRoute(edge) {
  for (const point of edge.points) {
    if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y)) {
      fail(`Layout edge ${edge.id} has an invalid route point.`, 'INVALID_LAYOUT');
    }
  }
  for (let i = 1; i < edge.points.length; i += 1) {
    const a = edge.points[i - 1];
    const b = edge.points[i];
    if (a.x !== b.x && a.y !== b.y) fail(`Layout edge ${edge.id} is not orthogonal.`, 'NON_ORTHOGONAL_EDGE');
  }
}

function normalizeLabel(source, edgeId) {
  if (!source || !Array.isArray(source.lines)) fail(`Label for edge ${edgeId} must provide lines.`, 'INVALID_LAYOUT');
  // LayoutGraph normally already stores one string per terminal row.  Split
  // embedded newlines as well so callers constructing a graph by hand get the
  // same reservation semantics as parser-produced labels.
  const lines = source.lines.flatMap((line) => String(line).replace(/\r\n?/g, '\n').split('\n'));
  const measuredWidth = Math.max(0, ...lines.map((line) => displayWidth(line)));
  const suppliedWidth = Number.isInteger(source.width) && source.width > 0 ? source.width : 0;
  const suppliedHeight = Number.isInteger(source.height) && source.height > 0 ? source.height : 0;
  return {
    lines: lines.length ? lines : [''],
    width: Math.max(1, measuredWidth, suppliedWidth),
    height: Math.max(1, lines.length, suppliedHeight),
  };
}

function buildBoxObstacles(boxes) {
  const obstacles = new Set();
  for (const box of boxes) {
    const isGroup = box.kind === 'subgraph';
    for (let y = box.y; y < box.y + box.height; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) {
        const border = x === box.x || x === box.x + box.width - 1 || y === box.y || y === box.y + box.height - 1;
        // A group body is available for labels, but its border and title
        // strip are not.  Reserve the complete strip because the title is
        // centered by the rasterizer and may occupy any interior columns.
        const title = isGroup && y >= box.y + 1 && y < box.y + 1 + box.lines.length;
        if (!isGroup || border || title) obstacles.add(key(x, y));
      }
    }
  }
  return obstacles;
}

function findPlacement({ edge, label, route, obstacles, routeCells, arrowCells, placed, bounds }) {
  const segments = routeSegments(route)
    .filter((segment) => segment.length > 0)
    .sort((a, b) => b.length - a.length || a.index - b.index);
  const maxGap = Math.max(8, bounds.width + bounds.height + label.width + label.height + 4);

  // Long segments get first choice and labels remain visually attached to the
  // route.  The side order is fixed to make output stable across runs.
  for (let gap = 1; gap <= maxGap; gap += 1) {
    for (const segment of segments) {
      const candidates = adjacentCandidates(segment, label, gap);
      for (const candidate of candidates) {
        if (clear(candidate, label, edge.id, false, obstacles, routeCells, arrowCells, placed)) return candidate;
      }
    }
  }

  // A one-point route is unusual but still has a useful local neighborhood.
  // This also makes self-loop labels robust when every side of the loop is
  // short.  The search is bounded only by the finite input geometry.
  const anchor = route[0];
  const ringLimit = Math.max(8, bounds.width + bounds.height + label.width + label.height + 4);
  for (let radius = 1; radius <= ringLimit; radius += 1) {
    const ring = [
      { x: anchor.x - Math.floor(label.width / 2), y: anchor.y - label.height - radius },
      { x: anchor.x - Math.floor(label.width / 2), y: anchor.y + radius },
      { x: anchor.x - label.width - radius, y: anchor.y - Math.floor(label.height / 2) },
      { x: anchor.x + radius, y: anchor.y - Math.floor(label.height / 2) },
    ];
    for (const candidate of ring) {
      if (clear(candidate, label, edge.id, false, obstacles, routeCells, arrowCells, placed)) return candidate;
    }
  }

  // Inline text is a last resort.  It is allowed only when the label is a
  // single terminal row, lies on this edge's route, and leaves route cells on
  // both sides so the line remains visibly connected.
  if (label.height === 1) {
    for (const segment of segments) {
      const candidate = inlineCandidate(segment, label);
      if (candidate && clear(candidate, label, edge.id, true, obstacles, routeCells, arrowCells, placed)
        && connectedInline(candidate, label, edge.id, segment, routeCells)) return candidate;
    }
  }
  return null;
}

function routeSegments(points) {
  const result = [];
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    result.push({ index: i - 1, a, b, horizontal: a.y === b.y, length: Math.abs(b.x - a.x) + Math.abs(b.y - a.y) });
  }
  return result;
}

function adjacentCandidates(segment, label, gap) {
  const { a, b } = segment;
  const midX = Math.floor((a.x + b.x) / 2);
  const midY = Math.floor((a.y + b.y) / 2);
  const candidates = [];
  if (segment.horizontal) {
    const x = midX - Math.floor(label.width / 2);
    candidates.push({ x, y: a.y - label.height - gap });
    candidates.push({ x, y: a.y + gap });
  } else {
    const y = midY - Math.floor(label.height / 2);
    candidates.push({ x: a.x - label.width - gap, y });
    candidates.push({ x: a.x + gap, y });
  }
  return candidates;
}

function inlineCandidate(segment, label) {
  const { a, b } = segment;
  if (segment.horizontal) return { x: Math.floor((a.x + b.x - label.width) / 2), y: a.y };
  return { x: a.x, y: Math.floor((a.y + b.y - label.height) / 2) };
}

function clear(candidate, label, edgeId, inline, obstacles, routeCells, arrowCells, placed) {
  for (let y = candidate.y; y < candidate.y + label.height; y += 1) {
    for (let x = candidate.x; x < candidate.x + label.width; x += 1) {
      const cellKey = key(x, y);
      if (obstacles.has(cellKey) || arrowCells.has(cellKey)) return false;
      const owners = routeCells.get(cellKey);
      if (owners && (!inline || owners.size !== 1 || !owners.has(edgeId))) return false;
      if (placed.some((other) => intersects(candidate, label, other))) return false;
    }
  }
  // Leave one empty character cell between a label and every unrelated route.
  // Without this buffer a label that technically does not overlap can still
  // read as attached to a neighboring vertical/return edge in a terminal.
  for (let y = candidate.y - 1; y <= candidate.y + label.height; y += 1) {
    for (let x = candidate.x - 1; x <= candidate.x + label.width; x += 1) {
      const owners = routeCells.get(key(x, y));
      if (owners && [...owners].some((owner) => owner !== edgeId)) return false;
    }
  }
  // A geometrically clear position can still look attached to a neighboring
  // return edge when two routes run in parallel.  Keep only candidates whose
  // rectangle is strictly nearer to this edge than to every other edge.  A
  // tie is deliberately rejected: terminal diagrams have no line weights or
  // color to disambiguate it.  Inline text has distance zero to its own route
  // and therefore naturally wins when it is the only unambiguous option.
  const ownDistance = distanceToRoute(candidate, label, routeCells, edgeId, true);
  const unrelatedDistance = distanceToRoute(candidate, label, routeCells, edgeId, false);
  if (ownDistance >= unrelatedDistance) return false;
  return true;
}

function distanceToRoute(candidate, label, routeCells, edgeId, own) {
  let distance = Infinity;
  for (const [cellKey, owners] of routeCells) {
    const isOwn = owners.size === 1 && owners.has(edgeId);
    if (isOwn !== own) continue;
    const [x, y] = cellKey.split(',').map(Number);
    distance = Math.min(distance, pointToRectDistance(x, y, candidate, label));
    if (distance === 0) return 0;
  }
  return distance;
}

function pointToRectDistance(x, y, candidate, label) {
  const dx = x < candidate.x ? candidate.x - x : x >= candidate.x + label.width ? x - (candidate.x + label.width - 1) : 0;
  const dy = y < candidate.y ? candidate.y - y : y >= candidate.y + label.height ? y - (candidate.y + label.height - 1) : 0;
  return dx + dy;
}

function connectedInline(candidate, label, edgeId, segment, routeCells) {
  let inside = false;
  let outsideBefore = false;
  let outsideAfter = false;
  for (const cell of segmentCells(segment.a, segment.b)) {
    if (cell.x >= candidate.x && cell.x < candidate.x + label.width && cell.y >= candidate.y && cell.y < candidate.y + label.height) {
      inside = true;
      const before = { x: cell.x - Math.sign(segment.b.x - segment.a.x), y: cell.y - Math.sign(segment.b.y - segment.a.y) };
      const after = { x: cell.x + Math.sign(segment.b.x - segment.a.x), y: cell.y + Math.sign(segment.b.y - segment.a.y) };
      if (routeCells.get(key(before.x, before.y))?.has(edgeId)) outsideBefore = true;
      if (routeCells.get(key(after.x, after.y))?.has(edgeId)) outsideAfter = true;
    }
  }
  return inside && outsideBefore && outsideAfter;
}

function intersects(a, aSize, b) {
  return a.x < b.x + b.width && b.x < a.x + aSize.width && a.y < b.y + b.height && b.y < a.y + aSize.height;
}

function deriveArrowCells(edge, output) {
  if (edge.points.length < 2) return;
  const first = distinctPair(edge.points, true);
  const last = distinctPair(edge.points, false);
  if (edge.arrowStart && edge.arrowStart !== 'none' && first) output.add(key(first.next.x, first.next.y));
  if (edge.arrowEnd && edge.arrowEnd !== 'none' && last) output.add(key(last.previous.x, last.previous.y));
}

function distinctPair(points, start) {
  if (start) {
    for (let i = 1; i < points.length; i += 1) {
      if (points[i].x !== points[0].x || points[i].y !== points[0].y) return { next: oneStep(points[0], points[i]) };
    }
  } else {
    for (let i = points.length - 2; i >= 0; i -= 1) {
      if (points[i].x !== points.at(-1).x || points[i].y !== points.at(-1).y) return { previous: oneStep(points.at(-1), points[i]) };
    }
  }
  return null;
}

function oneStep(from, toward) {
  return { x: from.x + Math.sign(toward.x - from.x), y: from.y + Math.sign(toward.y - from.y) };
}

function segmentCells(a, b) {
  const cells = [];
  const dx = Math.sign(b.x - a.x);
  const dy = Math.sign(b.y - a.y);
  let x = a.x;
  let y = a.y;
  cells.push({ x, y });
  while (x !== b.x || y !== b.y) {
    x += dx;
    y += dy;
    cells.push({ x, y });
  }
  return cells;
}

function segmentCellsForRoute(points) {
  const result = [];
  const seen = new Set();
  for (let i = 1; i < points.length; i += 1) {
    for (const cell of segmentCells(points[i - 1], points[i])) {
      const cellKey = key(cell.x, cell.y);
      if (!seen.has(cellKey)) { seen.add(cellKey); result.push(cell); }
    }
  }
  if (points.length === 1) result.push(points[0]);
  return result;
}

function layoutBounds(layout, boxes, edges) {
  const xs = [0];
  const ys = [0];
  for (const box of boxes) { xs.push(box.x, box.x + box.width); ys.push(box.y, box.y + box.height); }
  for (const edge of edges) for (const point of edge.points) { xs.push(point.x); ys.push(point.y); }
  return { width: Math.max(1, (Math.max(...xs) - Math.min(...xs)) + (layout.width || 0)), height: Math.max(1, (Math.max(...ys) - Math.min(...ys)) + (layout.height || 0)) };
}

function translateAndExpand(layout) {
  const labels = layout.edges.flatMap((edge) => edge.label ? [edge.label] : []);
  const xValues = [0];
  const yValues = [0];
  for (const box of layout.boxes) { xValues.push(box.x); yValues.push(box.y); }
  for (const edge of layout.edges) for (const point of edge.points) { xValues.push(point.x); yValues.push(point.y); }
  for (const label of labels) { xValues.push(label.x); yValues.push(label.y); }
  const shiftX = Math.max(0, -Math.min(...xValues));
  const shiftY = Math.max(0, -Math.min(...yValues));
  if (shiftX || shiftY) {
    for (const box of layout.boxes) { box.x += shiftX; box.y += shiftY; }
    for (const edge of layout.edges) {
      for (const point of edge.points) { point.x += shiftX; point.y += shiftY; }
      if (edge.label) { edge.label.x += shiftX; edge.label.y += shiftY; }
    }
  }
  const width = Math.max(0, Number.isInteger(layout.width) ? layout.width + shiftX : 0);
  const height = Math.max(0, Number.isInteger(layout.height) ? layout.height + shiftY : 0);
  layout.width = width;
  layout.height = height;
  for (const box of layout.boxes) { layout.width = Math.max(layout.width, box.x + box.width); layout.height = Math.max(layout.height, box.y + box.height); }
  for (const edge of layout.edges) {
    for (const point of edge.points) { layout.width = Math.max(layout.width, point.x + 1); layout.height = Math.max(layout.height, point.y + 1); }
    if (edge.label) { layout.width = Math.max(layout.width, edge.label.x + edge.label.width); layout.height = Math.max(layout.height, edge.label.y + edge.label.height); }
  }
}

function key(x, y) { return `${x},${y}`; }

function fail(message, code) { throw new FlowInkError(message, { code }); }

export default placeLabels;
