// The bundled entry has no runtime dependency on the optional `web-worker`
// package, so it works unchanged in both Node and browser consumers.
import ELK from 'elkjs/lib/elk.bundled.js';
import { FlowInkError } from './errors.js';
import { prepareNode, labelLines, displayWidth } from './text.js';
import { placeLabels } from './place-labels.js';

/** @typedef {import('./types.js').FlowGraph} FlowGraph */
/** @typedef {import('./types.js').LayoutGraph} LayoutGraph */

const elk = new ELK();

const DIRECTIONS = Object.freeze({ TB: 'DOWN', BT: 'UP', LR: 'RIGHT', RL: 'LEFT' });

/**
 * Lay out a parsed flow graph on an integer character grid.
 *
 * ELK does the global compound graph layout and orthogonal routing.  The
 * conversion at the end deliberately keeps every edge (including invisible
 * edges) in the result; the rasterizer decides which strokes to draw.
 *
 * @param {FlowGraph} graph
 * @returns {Promise<LayoutGraph>}
 */
export async function layout(graph) {
  const context = makeContext(graph);
  let laidOut;
  try {
    laidOut = await elk.layout(toElkGraph(context));
  } catch (cause) {
    throw new FlowInkError(`ELK could not lay out the flowchart: ${cause instanceof Error ? cause.message : String(cause)}`, {
      code: 'LAYOUT_ERROR',
      cause,
    });
  }
  const result = fromElkGraph(context, laidOut);
  compactVerticalChannels(result);
  separateAdjacentRoutes(result);
  return placeLabels(result);
}

// Rows containing only straight vertical routes need at most one cell of
// separation. Keep all node rows, group headers/borders and route bends fixed
// relative to one another; labels are placed after this coordinate transform.
function compactVerticalChannels(layoutGraph) {
  const fixed = new Set();
  for (const box of layoutGraph.boxes) {
    fixed.add(box.y); fixed.add(box.y + box.height - 1);
    const end = box.kind === 'subgraph' ? box.y + 1 + box.lines.length : box.y + box.height;
    for (let y = box.y; y < end; y += 1) fixed.add(y);
  }
  for (const edge of layoutGraph.edges) {
    for (const point of edge.points) fixed.add(point.y);
    // Two arrowheads on a short vertical edge still need separate cells.
    if (edge.arrowStart !== 'none' && edge.arrowEnd !== 'none') {
      const first = edge.points[0]; const last = edge.points.at(-1);
      const next = edge.points.find(point => point.x !== first.x || point.y !== first.y);
      const previous = [...edge.points].reverse().find(point => point.x !== last.x || point.y !== last.y);
      if (next) fixed.add(first.y + Math.sign(next.y - first.y));
      if (previous) fixed.add(last.y + Math.sign(previous.y - last.y));
    }
  }
  const rows = [...fixed].sort((a, b) => a - b);
  const removed = [];
  for (let i = 1; i < rows.length; i += 1) {
    for (let y = rows[i - 1] + 2; y < rows[i]; y += 1) removed.push(y);
  }
  const map = value => value - removed.filter(y => y < value).length;
  for (const box of layoutGraph.boxes) {
    const bottom = map(box.y + box.height - 1);
    box.y = map(box.y); box.height = bottom - box.y + 1;
  }
  for (const edge of layoutGraph.edges) {
    for (const point of edge.points) point.y = map(point.y);
    if (edge.label) edge.label.y = map(edge.label.y);
  }
  layoutGraph.height = map(layoutGraph.height);
}

// Insert a cell only in the row/column where parallel wires need separation.
// Scaling the whole diagram also inflated every node, label and vertical gap.
function separateAdjacentRoutes(layoutGraph) {
  const gaps = { x: new Set(), y: new Set() };
  const segments = layoutGraph.edges.filter(edge => edge.stroke !== 'invisible')
    .flatMap(edge => edge.points.slice(1).map((b, index) => ({
      id: edge.id, a: edge.points[index], b, horizontal: edge.points[index].y === b.y,
    })));
  for (let i = 0; i < segments.length; i += 1) for (let j = i + 1; j < segments.length; j += 1) {
    const a = segments[i]; const b = segments[j];
    if (a.id === b.id || a.horizontal !== b.horizontal) continue;
    const fixed = a.horizontal ? 'y' : 'x';
    const varying = a.horizontal ? 'x' : 'y';
    const distance = Math.abs(a.a[fixed] - b.a[fixed]);
    const overlap = Math.min(Math.max(a.a[varying], a.b[varying]), Math.max(b.a[varying], b.b[varying]))
      - Math.max(Math.min(a.a[varying], a.b[varying]), Math.min(b.a[varying], b.b[varying]));
    if (distance === 1 && overlap >= 1) gaps[fixed].add(Math.min(a.a[fixed], b.a[fixed]));
  }
  const map = (axis, value) => value + [...gaps[axis]].filter(gap => gap < value).length;
  for (const box of layoutGraph.boxes) {
    const right = map('x', box.x + box.width - 1);
    const bottom = map('y', box.y + box.height - 1);
    box.x = map('x', box.x); box.y = map('y', box.y);
    box.width = right - box.x + 1; box.height = bottom - box.y + 1;
  }
  for (const edge of layoutGraph.edges) {
    for (const point of edge.points) { point.x = map('x', point.x); point.y = map('y', point.y); }
    if (edge.label) { edge.label.x = map('x', edge.label.x); edge.label.y = map('y', edge.label.y); }
  }
  layoutGraph.width = map('x', layoutGraph.width);
  layoutGraph.height = map('y', layoutGraph.height);
}

function makeContext(graph) {
  if (!graph || typeof graph !== 'object') invalid('A FlowGraph object is required.');
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges) || !Array.isArray(graph.subgraphs)) {
    invalid('FlowGraph must contain nodes, edges, and subgraphs arrays.');
  }
  if (!DIRECTIONS[graph.direction]) invalid(`Unsupported flow direction: ${String(graph.direction)}.`);

  const subgraphs = new Map();
  // A subgraph used as an edge endpoint is sometimes also materialized as a
  // synthetic node by Mermaid's semantic DB.  The subgraph is the canonical
  // element and must not be sent to ELK twice with the same id.
  for (const subgraph of graph.subgraphs) {
    requireId(subgraph, 'subgraph');
    if (subgraphs.has(subgraph.id)) invalid(`Duplicate graph element id: ${subgraph.id}.`);
    subgraphs.set(subgraph.id, subgraph);
  }
  const nodes = new Map();
  for (const node of graph.nodes) {
    requireId(node, 'node');
    if (subgraphs.has(node.id)) continue;
    if (nodes.has(node.id)) invalid(`Duplicate graph element id: ${node.id}.`);
    nodes.set(node.id, node);
  }

  const parent = new Map();
  for (const node of nodes.values()) {
    if (node.parentId !== undefined && !subgraphs.has(node.parentId)) {
      invalid(`Node ${node.id} refers to missing subgraph ${node.parentId}.`);
    }
    if (node.parentId !== undefined) parent.set(node.id, node.parentId);
  }
  for (const subgraph of subgraphs.values()) {
    if (subgraph.parentId !== undefined && !subgraphs.has(subgraph.parentId)) {
      invalid(`Subgraph ${subgraph.id} refers to missing parent ${subgraph.parentId}.`);
    }
    if (subgraph.parentId !== undefined) parent.set(subgraph.id, subgraph.parentId);
    for (const childId of subgraph.nodeIds ?? []) {
      if (!nodes.has(childId) && !subgraphs.has(childId)) invalid(`Subgraph ${subgraph.id} refers to missing child ${childId}.`);
      const previous = parent.get(childId);
      if (previous !== undefined && previous !== subgraph.id) {
        invalid(`Graph element ${childId} has conflicting subgraph parents.`);
      }
      parent.set(childId, subgraph.id);
    }
  }

  // Detect malformed containment before handing it to ELK.  A cycle here
  // otherwise tends to produce an opaque ELK exception.
  for (const id of [...nodes.keys(), ...subgraphs.keys()]) {
    const seen = new Set([id]);
    let current = parent.get(id);
    while (current !== undefined) {
      if (seen.has(current)) invalid(`Cyclic subgraph containment involving ${id}.`);
      seen.add(current);
      current = parent.get(current);
    }
  }

  for (const edge of graph.edges) {
    requireId(edge, 'edge');
    if (!nodes.has(edge.source) && !subgraphs.has(edge.source)) invalid(`Edge ${edge.id} has missing source ${edge.source}.`);
    if (!nodes.has(edge.target) && !subgraphs.has(edge.target)) invalid(`Edge ${edge.id} has missing target ${edge.target}.`);
  }

  const children = new Map();
  const order = new Map();
  const put = (id, index) => {
    const p = parent.get(id);
    const key = p ?? null;
    if (!children.has(key)) children.set(key, []);
    if (!children.get(key).includes(id)) children.get(key).push(id);
    order.set(id, index);
  };
  // There is no shared source order between FlowNode and FlowSubgraph, so the
  // two arrays are used as the deterministic model order and ties use id.
  graph.nodes.forEach((n, i) => put(n.id, i));
  graph.subgraphs.forEach((s, i) => put(s.id, graph.nodes.length + i));
  for (const list of children.values()) list.sort((a, b) => order.get(a) - order.get(b) || a.localeCompare(b));

  const element = new Map([...nodes, ...subgraphs]);
  const elkIds = new Map();
  let nodeIndex = 0; let groupIndex = 0;
  for (const id of nodes.keys()) elkIds.set(id, `n${nodeIndex++}`);
  for (const id of subgraphs.keys()) elkIds.set(id, `g${groupIndex++}`);
  const edgeElkIds = new Map(graph.edges.map((edge, index) => [edge.id, `e${index}`]));
  const dimensions = new Map();
  for (const node of nodes.values()) {
    const prepared = prepareNode(node);
    const lines = Array.isArray(prepared.lines) ? prepared.lines.map(String) : [String(node.label ?? node.id)];
    dimensions.set(node.id, {
      lines,
      shape: prepared.shape ?? node.shape ?? 'rect',
      width: positiveSize(prepared.width, maxWidth(lines, node.label)),
      height: positiveSize(prepared.height, Math.max(3, lines.length + 2)),
    });
  }
  for (const subgraph of subgraphs.values()) {
    const text = String(subgraph.label ?? subgraph.id);
    const lines = labelLines(text, subgraph.metadata?.labelType ?? 'text').map(String);
    dimensions.set(subgraph.id, {
      lines,
      shape: 'subgraph',
      width: Math.max(3, maxWidth(lines, text) + 2),
      height: Math.max(3, lines.length + 2),
    });
  }

  // ELK may assign several incident edges to the same fractional port on a
  // small box. Reserve enough character cells before snapping to the grid so
  // every arrow can receive a distinct adjacent cell.
  const incident = new Map();
  for (const edge of graph.edges) {
    incident.set(edge.source, (incident.get(edge.source) ?? 0) + 1);
    incident.set(edge.target, (incident.get(edge.target) ?? 0) + 1);
  }
  for (const [id, count] of incident) {
    const dim = dimensions.get(id);
    if (!dim) continue;
    const direction = contextDirection(graph, parent, subgraphs, id);
    if (direction === 'LR' || direction === 'RL') dim.height = Math.max(dim.height, count * 2 + 1);
    else dim.width = Math.max(dim.width, count * 2 + 1);
  }

  return { graph, nodes, subgraphs, element, parent, children, dimensions, order, elkIds, edgeElkIds };
}

function contextDirection(graph, parent, subgraphs, id) {
  let current = id;
  while (current !== undefined) {
    const direction = subgraphs.get(current)?.direction;
    if (direction) return direction;
    current = parent.get(current);
  }
  return graph.direction;
}

function toElkGraph(context) {
  const { graph } = context;
  const root = {
    id: 'r0',
    layoutOptions: commonLayoutOptions(DIRECTIONS[graph.direction]),
    children: containerChildren(context, null),
    edges: containerEdges(context, null),
  };
  return root;
}

function containerChildren(context, containerId) {
  const ids = context.children.get(containerId) ?? [];
  return ids.map((id) => {
    const dim = context.dimensions.get(id);
    if (context.subgraphs.has(id)) {
      const subgraph = context.subgraphs.get(id);
      const children = containerChildren(context, id);
      const result = {
        id: context.elkIds.get(id),
        labels: [{ id: `l${context.elkIds.get(id)}`, text: subgraph.label ?? id, width: dim.width - 2, height: Math.max(1, dim.lines.length) }],
        layoutOptions: commonLayoutOptions(subgraph.direction ? DIRECTIONS[subgraph.direction] : undefined, true, !hasExternalConnection(context, id)),
        children,
        edges: containerEdges(context, id),
      };
      if (children.length === 0) {
        result.width = elkSize(dim.width);
        result.height = elkSize(dim.height);
      }
      if (!result.layoutOptions['elk.direction']) delete result.layoutOptions['elk.direction'];
      return result;
    }
    return { id: context.elkIds.get(id), width: elkSize(dim.width), height: elkSize(dim.height), labels: [] };
  });
}

function commonLayoutOptions(direction, nested = false, separateChildren = false) {
  const options = {
    'elk.algorithm': 'layered',
    ...(direction ? { 'elk.direction': direction } : {}),
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': separateChildren ? 'SEPARATE_CHILDREN' : 'INCLUDE_CHILDREN',
    'elk.json.shapeCoords': 'ROOT',
    'elk.json.edgeCoords': 'ROOT',
    ...(nested ? {} : { 'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES' }),
    'elk.layered.considerModelOrder.portModelOrder': 'true',
    'elk.layered.mergeEdges': 'false',
    'elk.layered.mergeHierarchyEdges': 'false',
    'elk.spacing.nodeNode': '2',
    'elk.layered.spacing.nodeNodeBetweenLayers': '3',
    'elk.layered.spacing.edgeNodeBetweenLayers': '2',
    'elk.spacing.edgeEdge': '2',
    'elk.spacing.edgeNode': '2',
    'elk.spacing.nodeSelfLoop': '2',
    'elk.padding': '[top=2,left=2,bottom=2,right=2]',
  };
  return options;
}

function hasExternalConnection(context, subgraphId) {
  return context.graph.edges.some((edge) => {
    // A group endpoint itself can still be laid out locally. A connection
    // involving one of its children forces the compound graph to stay in the
    // parent's hierarchy so ELK can resolve the cross-level edge.
    const sourceInside = isDescendant(context, edge.source, subgraphId);
    const targetInside = isDescendant(context, edge.target, subgraphId);
    return sourceInside !== targetInside;
  });
}

function isDescendant(context, id, ancestor) {
  let current = context.parent.get(id);
  while (current !== undefined) {
    if (current === ancestor) return true;
    current = context.parent.get(current);
  }
  return false;
}

function containerEdges(context, containerId) {
  return context.graph.edges
    .filter((edge) => lowestCommonContainer(context, edge.source, edge.target) === containerId)
    .map((edge) => {
      const dim = context.dimensions.get(edge.id);
      const result = {
        id: context.edgeElkIds.get(edge.id),
        sources: [context.elkIds.get(edge.source)],
        targets: [context.elkIds.get(edge.target)],
      };
      if (edge.label) {
        const lines = labelLines(edge.label, edge.labelType).map(String);
        result.labels = [{ id: `l${context.edgeElkIds.get(edge.id)}`, text: lines.join('\n'), width: Math.max(1, maxWidth(lines, edge.label)), height: Math.max(1, lines.length) }];
      }
      return result;
    });
}

function lowestCommonContainer(context, source, target) {
  // A self-loop is contained by the endpoint's parent graph.  Returning the
  // endpoint itself would leave the edge unreachable for a leaf node and
  // would place a compound self-loop in a non-existent child graph.
  if (source === target) return context.parent.get(source) ?? null;
  const ancestors = new Set();
  let current = source;
  while (current !== undefined) {
    ancestors.add(current);
    current = context.parent.get(current);
  }
  ancestors.add(null);
  current = target;
  while (current !== undefined && !ancestors.has(current)) current = context.parent.get(current);
  const common = ancestors.has(current) ? current : null;
  // Edges are stored in graphs, while node ids are elements of those graphs.
  // If the LCA is a leaf node (only possible for an ancestor endpoint), use
  // its parent graph.
  if (common !== null && !context.subgraphs.has(common)) return context.parent.get(common) ?? null;
  return common;
}

function fromElkGraph(context, result) {
  const internalElements = new Map();
  const internalFloatBoxes = new Map();
  walkOutput(result, internalElements, internalFloatBoxes, true);
  const outputElements = new Map();
  const floatBoxes = new Map();
  for (const [publicId, internalId] of context.elkIds) {
    const element = internalElements.get(internalId);
    if (element) outputElements.set(publicId, element);
    const float = internalFloatBoxes.get(internalId);
    if (float) floatBoxes.set(publicId, float);
  }
  const boxes = [];
  for (const [id, element] of context.element) {
    const laid = outputElements.get(id);
    if (!laid || !Number.isFinite(laid.x) || !Number.isFinite(laid.y)) {
      invalid(`ELK returned no position for ${id}.`, 'LAYOUT_MISSING_BOX');
    }
    const dim = context.dimensions.get(id);
    const x = Math.floor(laid.x);
    const y = Math.floor(laid.y);
    // ELK coordinates describe the interval between character centers.  A
    // cell box with N border cells therefore has an ELK extent of N - 1;
    // convert the resulting extent back to inclusive cell dimensions here.
    const width = Math.max(dim.width, Math.ceil(laid.x + (laid.width ?? elkSize(dim.width))) - x + 1);
    const height = Math.max(dim.height, Math.ceil(laid.y + (laid.height ?? elkSize(dim.height))) - y + 1);
    boxes.push({ id, kind: context.subgraphs.has(id) ? 'subgraph' : 'node', x, y, width, height, lines: dim.lines, shape: dim.shape, ...(context.parent.has(id) ? { parentId: context.parent.get(id) } : {}) });
  }
  const boxById = new Map(boxes.map((box) => [box.id, box]));
  context.__boxById = boxById;
  const edgeOutputs = new Map();
  const internalEdges = new Map();
  walkEdges(result, internalEdges);
  for (const [publicId, internalId] of context.edgeElkIds) {
    const edge = internalEdges.get(internalId);
    if (edge) edgeOutputs.set(publicId, edge);
  }
  const occupied = new Map();
  const placedLabels = [];
  const routes = new Map();
  const endpointCounts = new Map();
  for (const item of context.graph.edges) {
    endpointCounts.set(item.source, (endpointCounts.get(item.source) ?? 0) + 1);
    endpointCounts.set(item.target, (endpointCounts.get(item.target) ?? 0) + 1);
  }
  const endpointRanks = new Map();
  for (const sourceEdge of context.graph.edges) {
    const output = edgeOutputs.get(sourceEdge.id);
    if (!output || !Array.isArray(output.sections) || output.sections.length === 0) {
      invalid(`ELK returned no route for edge ${sourceEdge.id}.`, 'LAYOUT_MISSING_EDGE');
    }
    const sourceBox = boxById.get(sourceEdge.source);
    const targetBox = boxById.get(sourceEdge.target);
    const sourceRank = endpointRanks.get(sourceEdge.source) ?? 0;
    const targetRank = endpointRanks.get(sourceEdge.target) ?? 0;
    endpointRanks.set(sourceEdge.source, sourceRank + 1);
    endpointRanks.set(sourceEdge.target, targetRank + 1);
    const sourceOffset = 2 * (sourceRank - Math.floor((endpointCounts.get(sourceEdge.source) ?? 1) / 2));
    const targetOffset = 2 * (targetRank - Math.floor((endpointCounts.get(sourceEdge.target) ?? 1) / 2));
    const route = routePoints(output, sourceBox, targetBox, floatBoxes, context, occupied, { sourceOffset, targetOffset }, sourceEdge.source === sourceEdge.target ? { rank: targetRank, count: endpointCounts.get(sourceEdge.target) ?? 1 } : undefined, sourceEdge.arrowStart, sourceEdge.arrowEnd);
    if (route.length < 2) invalid(`ELK returned an empty route for edge ${sourceEdge.id}.`, 'LAYOUT_EMPTY_EDGE');
    routes.set(sourceEdge.id, route);
    if (sourceEdge.stroke !== 'invisible') addRouteToOccupied(occupied, route, sourceEdge, boxById);
  }
  const edges = [];
  for (const sourceEdge of context.graph.edges) {
    const output = edgeOutputs.get(sourceEdge.id);
    const sourceBox = boxById.get(sourceEdge.source);
    const route = routes.get(sourceEdge.id);
    const label = sourceEdge.label ? edgeLabel(output, sourceEdge, route, sourceBox, boxById, placedLabels, routes) : undefined;
    if (label) placedLabels.push({ ...label, route });
    edges.push({ id: sourceEdge.id, points: route, arrowStart: sourceEdge.arrowStart ?? 'none', arrowEnd: sourceEdge.arrowEnd ?? 'none', stroke: sourceEdge.stroke ?? 'normal', ...(label ? { label } : {}) });
  }

  const minX = Math.min(0, ...boxes.map((box) => box.x), ...edges.flatMap((edge) => edge.points.map((point) => point.x)));
  const minY = Math.min(0, ...boxes.map((box) => box.y), ...edges.flatMap((edge) => edge.points.map((point) => point.y)));
  if (minX !== 0 || minY !== 0) {
    for (const box of boxes) { box.x -= minX; box.y -= minY; }
    for (const edge of edges) for (const point of edge.points) { point.x -= minX; point.y -= minY; }
    for (const edge of edges) if (edge.label) { edge.label.x -= minX; edge.label.y -= minY; }
  }
  const width = Math.max(1, ...boxes.map((box) => box.x + box.width), ...edges.flatMap((edge) => edge.points.map((point) => point.x + 1)));
  const height = Math.max(1, ...boxes.map((box) => box.y + box.height), ...edges.flatMap((edge) => edge.points.map((point) => point.y + 1)));
  return { boxes, edges, width, height };
}

function walkOutput(node, elements, floatBoxes, isRoot = false) {
  if (node?.id && !isRoot) {
    elements.set(node.id, node);
    if (Number.isFinite(node.x) && Number.isFinite(node.y)) floatBoxes.set(node.id, { x: node.x, y: node.y, width: node.width ?? 0, height: node.height ?? 0 });
  }
  for (const child of node?.children ?? []) walkOutput(child, elements, floatBoxes, false);
}

function walkEdges(node, edges) {
  for (const edge of node?.edges ?? []) edges.set(edge.id, edge);
  for (const child of node?.children ?? []) walkEdges(child, edges);
}

function routePoints(edge, sourceBox, targetBox, floatBoxes, context, occupied, endpointOffsets = {}, selfLoop, arrowStart = 'none', arrowEnd = 'none') {
  if (!sourceBox || !targetBox) invalid(`An edge endpoint has no layout box.`, 'LAYOUT_MISSING_BOX');
  const sections = edge.sections;
  if (selfLoop && sourceBox.id === targetBox.id) {
    const custom = selfLoopRoute(sourceBox, selfLoop.rank, selfLoop.count);
    if (!routeBlocked(custom, context.__boxById, allowedBoxes(context, sourceBox.id, targetBox.id), occupied, sourceBox.id, targetBox.id, arrowStart, arrowEnd)) return custom;
  }
  const raw = [];
  for (const section of sections) {
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].filter(Boolean);
    for (const point of points) {
      if (!raw.length || raw[raw.length - 1].x !== point.x || raw[raw.length - 1].y !== point.y) raw.push({ x: point.x, y: point.y });
    }
  }
  if (raw.length < 2) return [];
  const sourceFloat = floatBoxes.get(sourceBox.id);
  const targetFloat = floatBoxes.get(targetBox.id);
  const sourceAnchor = anchor(raw[0], raw[1], sourceFloat, sourceBox, endpointOffsets.sourceOffset ?? 0);
  const targetAnchor = anchor(raw[raw.length - 1], raw[raw.length - 2], targetFloat, targetBox, endpointOffsets.targetOffset ?? 0);
  raw[0] = sourceAnchor;
  raw[raw.length - 1] = targetAnchor;
  const points = orthogonalRound(raw);
  // Rounding an ELK bend can otherwise move an endpoint one cell off its
  // border. Restore the anchors, then make the first/last segment orthogonal.
  points[0] = { ...sourceAnchor };
  points[points.length - 1] = { ...targetAnchor };
  restoreEndpointSegment(points, 0, 1);
  restoreEndpointSegment(points, points.length - 1, -1);
  nudgeRouteEndpoint(points, sourceBox, 0, 1, 0);
  nudgeRouteEndpoint(points, targetBox, points.length - 1, -1, 0);
  simplifyRoute(points);
  const allowed = allowedBoxes(context, sourceBox.id, targetBox.id);
  if (routeBlocked(points, context.__boxById, allowed, occupied, sourceBox.id, targetBox.id, arrowStart, arrowEnd)) {
    const repaired = gridRepair(points[0], points[points.length - 1], context, sourceBox, targetBox, occupied, arrowStart, arrowEnd);
    if (!repaired) invalid(`Integer grid routing collided while placing edge ${edge.id}.`, 'LAYOUT_ROUTE_COLLISION');
    return repaired;
  }
  return points;
}

function restoreEndpointSegment(points, index, neighborStep) {
  const point = points[index];
  const neighbor = points[index + neighborStep];
  if (!point || !neighbor || point.x === neighbor.x || point.y === neighbor.y) return;
  // Keep the already rounded neighbor coordinate which changes least from
  // the anchor; the other coordinate becomes the anchor's coordinate.
  if (Math.abs(neighbor.x - point.x) >= Math.abs(neighbor.y - point.y)) neighbor.y = point.y;
  else neighbor.x = point.x;
}

function selfLoopRoute(box, rank, count) {
  const side = rank % 4;
  const ring = Math.floor(rank / 4) + 2;
  const left = box.x; const right = box.x + box.width - 1;
  const top = box.y; const bottom = box.y + box.height - 1;
  if (side === 0) {
    const x = left - ring;
    return [{ x: left, y: top + 1 }, { x, y: top + 1 }, { x, y: bottom - 1 }, { x: left, y: bottom - 1 }];
  }
  if (side === 1) {
    const x = right + ring;
    return [{ x: right, y: bottom - 1 }, { x, y: bottom - 1 }, { x, y: top + 1 }, { x: right, y: top + 1 }];
  }
  if (side === 2) {
    const y = top - ring;
    return [{ x: left + 1, y: top }, { x: left + 1, y }, { x: right - 1, y }, { x: right - 1, y: top }];
  }
  const y = bottom + ring;
  return [{ x: right - 1, y: bottom }, { x: right - 1, y }, { x: left + 1, y }, { x: left + 1, y: bottom }];
}

function nudgeRouteEndpoint(points, box, index, neighborStep, offset) {
  if (!offset || points.length < 2) return;
  const point = points[index];
  const neighbor = points[index + neighborStep];
  if (!neighbor) return;
  if (point.x === box.x || point.x === box.x + box.width - 1) {
    point.y = Math.max(box.y, Math.min(box.y + box.height - 1, point.y + offset));
    neighbor.y = point.y;
  } else if (point.y === box.y || point.y === box.y + box.height - 1) {
    point.x = Math.max(box.x, Math.min(box.x + box.width - 1, point.x + offset));
    neighbor.x = point.x;
  }
}

function anchor(point, neighbor, floatBox, box, offset = 0) {
  const left = floatBox?.x ?? box.x;
  const right = left + (floatBox?.width ?? box.width);
  const top = floatBox?.y ?? box.y;
  const bottom = top + (floatBox?.height ?? box.height);
  const distances = [{ side: 'left', value: Math.abs(point.x - left) }, { side: 'right', value: Math.abs(point.x - right) }, { side: 'top', value: Math.abs(point.y - top) }, { side: 'bottom', value: Math.abs(point.y - bottom) }];
  distances.sort((a, b) => a.value - b.value);
  const side = distances[0].side;
  if (side === 'left' || side === 'right') {
    const center = box.y + Math.floor((box.height - 1) / 2);
    const y = Math.max(box.y, Math.min(box.y + box.height - 1, center + offset));
    return { x: side === 'left' ? box.x : box.x + box.width - 1, y };
  }
  const center = box.x + Math.floor((box.width - 1) / 2);
  const x = Math.max(box.x, Math.min(box.x + box.width - 1, center + offset));
  return { x, y: side === 'top' ? box.y : box.y + box.height - 1 };
}

function orthogonalRound(raw) {
  const result = [{ x: Math.round(raw[0].x), y: Math.round(raw[0].y) }];
  for (let i = 1; i < raw.length; i += 1) {
    const current = { x: Math.round(raw[i].x), y: Math.round(raw[i].y) };
    const previous = result[result.length - 1];
    if (current.x === previous.x || current.y === previous.y) {
      result.push(current);
      continue;
    }
    // A rounded bend can become diagonal even when the original bend was
    // orthogonal. Insert a deterministic Manhattan corner in that case.
    if (Math.abs(current.x - previous.x) >= Math.abs(current.y - previous.y)) {
      result.push({ x: current.x, y: previous.y });
    } else {
      result.push({ x: previous.x, y: current.y });
    }
    result.push(current);
  }
  return result;
}

function simplifyRoute(points) {
  for (let i = points.length - 2; i > 0; i -= 1) {
    const a = points[i - 1];
    const b = points[i];
    const c = points[i + 1];
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) points.splice(i, 1);
  }
  return points;
}

function allowedBoxes(context, sourceId, targetId) {
  const allowed = new Set([sourceId, targetId]);
  for (const id of context.element.keys()) {
    if (isAncestor(context, id, sourceId) || isAncestor(context, id, targetId)) allowed.add(id);
  }
  return allowed;
}

function isAncestor(context, candidate, id) {
  let current = context.parent.get(id);
  while (current !== undefined) {
    if (current === candidate) return true;
    current = context.parent.get(current);
  }
  return false;
}

function routeBlocked(points, boxes, allowed, occupied, sourceId, targetId, arrowStart = 'none', arrowEnd = 'none') {
  const pair = pairKey(sourceId, targetId);
  const arrowCells = routeArrowKeys(points, arrowStart, arrowEnd);
  for (let i = 1; i < points.length; i += 1) {
    const orientation = points[i - 1].x === points[i].x ? 'v' : 'h';
    for (const cell of segmentCells(points[i - 1], points[i])) {
      const existing = occupied.get(key(cell.x, cell.y));
      if (existing?.arrow || (existing && arrowCells.has(key(cell.x, cell.y))) || existing?.orientations.has(orientation)) return true;
      for (const [id, box] of boxes) {
        if (!box || (!inside(cell, box) && !(box.kind === 'node' && !allowed.has(id) && insideExpanded(cell, box, 1)))) continue;
        if (box.kind === 'subgraph' && headerCell(cell, box)) return true;
        if (box.kind === 'node' && allowed.has(id)) {
          // A route may leave or enter an endpoint on exactly one border
          // cell, but cannot travel along the endpoint's border or interior.
          const endpoint = key(cell.x, cell.y) === key(points[0].x, points[0].y) || key(cell.x, cell.y) === key(points.at(-1).x, points.at(-1).y);
          if (!endpoint) return true;
        } else if (!allowed.has(id)) return true;
      }
    }
  }
  return false;
}

function gridRepair(start, end, context, sourceBox, targetBox, occupied, arrowStart = 'none', arrowEnd = 'none') {
  const boxes = context.__boxById;
  if (!boxes) return null;
  const sourceId = sourceBox.id;
  const targetId = targetBox.id;
  const pair = pairKey(sourceId, targetId);
  const allowed = allowedBoxes(context, sourceId, targetId);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const all = [...boxes.values()];
  // Expand the search corridor geometrically. A fixed small window can fail
  // on dense/cross-hierarchy graphs even though an unobstructed route exists.
  const starts = endpointCandidates(sourceBox, start);
  const ends = endpointCandidates(targetBox, end);
  for (const candidateStart of starts) for (const candidateEnd of ends) {
    if (candidateStart.x === candidateEnd.x && candidateStart.y === candidateEnd.y && sourceId !== targetId) continue;
    const startPoint = candidateStart;
    const endPoint = candidateEnd;
    for (const margin of [8, 16, 32, 64]) {
    const minX = Math.min(startPoint.x, endPoint.x, ...all.map((b) => b.x)) - margin;
    const maxX = Math.max(startPoint.x, endPoint.x, ...all.map((b) => b.x + b.width - 1)) + margin;
    const minY = Math.min(startPoint.y, endPoint.y, ...all.map((b) => b.y)) - margin;
    const maxY = Math.max(startPoint.y, endPoint.y, ...all.map((b) => b.y + b.height - 1)) + margin;
    const queue = [startPoint];
    const previous = new Map([[key(startPoint.x, startPoint.y), null]]);
    const currentArrows = endpointArrowNeighborhood(startPoint, endPoint, arrowStart, arrowEnd);
    const blocked = (x, y, orientation) => {
      const cell = { x, y };
      const existing = occupied.get(key(x, y));
      // Crossings are representable, but reusing a collinear segment from an
      // unrelated edge (or its arrow-adjacent cell) would erase topology.
      if (existing?.arrow || (existing && currentArrows.has(key(x, y))) || existing?.orientations.has(orientation)) return true;
      for (const [id, box] of boxes) {
        if (!inside(cell, box) && !(box.kind === 'node' && !allowed.has(id) && insideExpanded(cell, box, 1))) continue;
        if (box.kind === 'subgraph' && headerCell(cell, box)) return true;
        if (box.kind === 'node' && allowed.has(id)) {
          if (!(x === startPoint.x && y === startPoint.y) && !(x === endPoint.x && y === endPoint.y)) return true;
        } else if (!allowed.has(id)) return true;
      }
      return false;
    };
    let head = 0;
    while (head < queue.length) {
      const current = queue[head++];
      if (current.x === endPoint.x && current.y === endPoint.y) {
        const path = [];
        let cursor = current;
        while (cursor) { path.push(cursor); cursor = previous.get(key(cursor.x, cursor.y)); }
        path.reverse();
        return compress(path);
      }
      for (const [dx, dy] of directions) {
        const x = current.x + dx; const y = current.y + dy;
        if (x < minX || x > maxX || y < minY || y > maxY || blocked(x, y, dx ? 'h' : 'v')) continue;
        const k = key(x, y);
        if (previous.has(k)) continue;
        previous.set(k, current); queue.push({ x, y });
      }
      }
    }
  }
  return null;
}

function endpointCandidates(box, preferred) {
  const points = [];
  for (let y = box.y; y < box.y + box.height; y += 1) {
    for (let x = box.x; x < box.x + box.width; x += 1) {
      if (x !== box.x && x !== box.x + box.width - 1 && y !== box.y && y !== box.y + box.height - 1) continue;
      points.push({ x, y });
    }
  }
  points.sort((a, b) => Math.abs(a.x - preferred.x) + Math.abs(a.y - preferred.y) - (Math.abs(b.x - preferred.x) + Math.abs(b.y - preferred.y)) || a.y - b.y || a.x - b.x);
  return points.slice(0, 32);
}

function endpointArrowNeighborhood(start, end, arrowStart, arrowEnd) {
  const cells = new Set();
  const add = (point) => {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) cells.add(key(point.x + dx, point.y + dy));
  };
  if (arrowStart !== 'none' && arrowStart !== undefined) add(start);
  if (arrowEnd !== 'none' && arrowEnd !== undefined) add(end);
  return cells;
}

function headerCell(point, box) {
  if (box.kind !== 'subgraph' || point.y < box.y + 1 || point.y >= box.y + 1 + box.lines.length) return false;
  const line = box.lines[point.y - box.y - 1] ?? '';
  const left = box.x + 1 + Math.floor((Math.max(0, box.width - 2) - displayWidth(line)) / 2);
  return point.x >= left && point.x < left + displayWidth(line);
}

function compress(points) {
  if (points.length < 2) return points;
  const result = [points[0]];
  let dx = points[1].x - points[0].x;
  let dy = points[1].y - points[0].y;
  for (let i = 1; i < points.length - 1; i += 1) {
    const ndx = points[i + 1].x - points[i].x;
    const ndy = points[i + 1].y - points[i].y;
    if ((dx === 0) !== (ndx === 0)) result.push(points[i]);
    dx = ndx; dy = ndy;
  }
  result.push(points[points.length - 1]);
  return result;
}

function addRouteToOccupied(occupied, points, edge, boxes) {
  const sourceId = edge.source;
  const targetId = edge.target;
  for (let i = 1; i < points.length; i += 1) {
    const orientation = points[i - 1].x === points[i].x ? 'v' : 'h';
    for (const cell of segmentCells(points[i - 1], points[i])) {
      if ((inside(cell, boxes.get(sourceId)) && cell !== points[0]) || (inside(cell, boxes.get(targetId)) && cell !== points.at(-1))) continue;
      const cellKey = key(cell.x, cell.y);
      if (!occupied.has(cellKey)) occupied.set(cellKey, { orientations: new Set(), pairs: new Set() });
      const entry = occupied.get(cellKey);
      entry.orientations.add(orientation);
      entry.pairs.add(pairKey(sourceId, targetId));
      if (!entry.sources) entry.sources = new Set();
      entry.sources.add(sourceId);
    }
  }
  markArrowOccupancy(occupied, points, edge.arrowStart, edge.arrowEnd);
}

function markArrowOccupancy(occupied, points, arrowStart, arrowEnd) {
  const first = distinctRoutePair(points, true);
  const last = distinctRoutePair(points, false);
  for (const pair of [arrowStart !== 'none' && arrowStart !== undefined ? first : null, arrowEnd !== 'none' && arrowEnd !== undefined ? last : null]) {
    if (!pair) continue;
    const cell = key(pair.next.x, pair.next.y);
    if (!occupied.has(cell)) occupied.set(cell, { orientations: new Set(), pairs: new Set(), sources: new Set() });
    occupied.get(cell).arrow = true;
  }
}

function distinctRoutePair(points, start) {
  if (start) {
    for (let i = 1; i < points.length; i += 1) if (points[i].x !== points[0].x || points[i].y !== points[0].y) return { next: oneStep(points[0], points[i]) };
  } else {
    for (let i = points.length - 2; i >= 0; i -= 1) if (points[i].x !== points.at(-1).x || points[i].y !== points.at(-1).y) return { next: oneStep(points.at(-1), points[i]) };
  }
  return null;
}

function oneStep(end, toward) {
  const dx = toward.x - end.x;
  const dy = toward.y - end.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: end.x + Math.sign(dx), y: end.y }
    : { x: end.x, y: end.y + Math.sign(dy) };
}

function routeArrowKeys(points, arrowStart = 'none', arrowEnd = 'none') {
  const keys = new Set();
  const first = distinctRoutePair(points, true);
  const last = distinctRoutePair(points, false);
  if (arrowStart !== 'none' && arrowStart !== undefined && first) keys.add(key(first.next.x, first.next.y));
  if (arrowEnd !== 'none' && arrowEnd !== undefined && last) keys.add(key(last.next.x, last.next.y));
  return keys;
}

function segmentCells(a, b) {
  if (a.x !== b.x && a.y !== b.y) {
    throw new FlowInkError(`Non-orthogonal segment from (${a.x},${a.y}) to (${b.x},${b.y}).`, { code: 'NON_ORTHOGONAL_EDGE' });
  }
  const cells = [];
  const dx = Math.sign(b.x - a.x); const dy = Math.sign(b.y - a.y);
  let x = a.x; let y = a.y;
  cells.push({ x, y });
  while (x !== b.x || y !== b.y) { x += dx; y += dy; cells.push({ x, y }); }
  return cells;
}

function inside(point, box) {
  return box && point.x >= box.x && point.x < box.x + box.width && point.y >= box.y && point.y < box.y + box.height;
}

function insideExpanded(point, box, margin) {
  return point.x >= box.x - margin && point.x <= box.x + box.width - 1 + margin
    && point.y >= box.y - margin && point.y <= box.y + box.height - 1 + margin;
}

function edgeLabel(output, edge, route, sourceBox, boxes, placedLabels, routes) {
  const source = output.labels?.[0];
  const lines = labelLines(edge.label, edge.labelType).map(String);
  const width = Math.max(1, Math.ceil(source?.width ?? maxWidth(lines, edge.label)));
  const height = Math.max(1, Math.ceil(source?.height ?? lines.length));
  // ELK's label coordinates are useful to graphical renderers, but after
  // snapping to character cells they can end up at the side of a vertical
  // route.  Center the label on the longest route segment instead.
  let best = [route[0], route[1]];
  let bestLength = -1;
  for (let i = 1; i < route.length; i += 1) {
    const length = Math.abs(route[i].x - route[i - 1].x) + Math.abs(route[i].y - route[i - 1].y);
    if (length > bestLength) { best = [route[i - 1], route[i]]; bestLength = length; }
  }
  const [a, b] = best;
  const midX = Math.floor((a.x + b.x) / 2);
  const midY = Math.floor((a.y + b.y) / 2);
  if (edge.source === edge.target && sourceBox) {
    const routeMinX = Math.min(...route.map((point) => point.x));
    const routeMaxX = Math.max(...route.map((point) => point.x));
    const leftOfBox = routeMinX < sourceBox.x;
    const y = Math.max(0, midY - Math.floor(height / 2));
    const candidates = [
      { x: leftOfBox ? routeMinX - width - 1 : routeMaxX + 2, y },
      { x: leftOfBox ? routeMaxX + 2 : routeMinX - width - 1, y: y + height + 1 },
    ];
    for (const candidate of candidates) {
      if (candidate.x < 0 || labelCollides(candidate, width, height, route, boxes, placedLabels, routes)) continue;
      return { ...candidate, lines, width, height };
    }
    return { x: Math.max(0, candidates[0].x), y, lines, width, height };
  }
  const horizontal = b.y === a.y;
  const centeredX = midX - Math.floor(width / 2);
  const centeredY = midY - Math.floor(height / 2);
  const candidates = horizontal
    ? [{ x: centeredX, y: centeredY - height - 1 }, { x: centeredX, y: centeredY + height + 1 }]
    : [{ x: centeredX - width - 1, y: centeredY }, { x: centeredX + width + 1, y: centeredY }];
  candidates.push({ x: centeredX, y: centeredY });
  for (const candidate of candidates) {
    if (candidate.x < 0 || candidate.y < 0) continue;
    if (labelCollides(candidate, width, height, route, boxes, placedLabels, routes)) continue;
    return { ...candidate, lines, width, height };
  }
  return { x: Math.max(0, centeredX), y: Math.max(0, centeredY), lines, width, height };
}

function labelCollides(candidate, width, height, route, boxes, placedLabels, routes) {
  const routeCells = new Set();
  for (const candidateRoute of routes.values()) {
    for (let i = 1; i < candidateRoute.length; i += 1) for (const cell of segmentCells(candidateRoute[i - 1], candidateRoute[i])) routeCells.add(key(cell.x, cell.y));
  }
  for (let y = candidate.y; y < candidate.y + height; y += 1) {
    for (let x = candidate.x; x < candidate.x + width; x += 1) {
      if (routeCells.has(key(x, y))) return true;
      for (const box of boxes.values()) {
        // Reserve the full box rectangle.  This is conservative, but avoids
        // labels colliding with a container title or a node border after
        // rasterization.
        if (inside({ x, y }, box)) return true;
      }
    }
  }
  for (const label of placedLabels) {
    if (candidate.x < label.x + label.width && label.x < candidate.x + width && candidate.y < label.y + label.height && label.y < candidate.y + height) return true;
  }
  return false;
}

function maxWidth(lines, fallback) {
  if (lines.length > 0) return Math.max(1, ...lines.map((line) => Number(displayWidth(line))));
  return Math.max(1, Number(displayWidth(String(fallback ?? ''))));
}

function positiveSize(value, fallback) {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.ceil(value)) : Math.max(1, Math.ceil(fallback));
}

function elkSize(cells) { return Math.max(1, cells - 1); }

function requireId(value, type) {
  if (!value || typeof value.id !== 'string' || value.id.length === 0) invalid(`Every ${type} must have a non-empty string id.`);
}

function invalid(message, code = 'INVALID_GRAPH') {
  throw new FlowInkError(message, { code });
}

function key(x, y) { return `${x},${y}`; }

function pairKey(source, target) { return `${source}\u0000${target}`; }
