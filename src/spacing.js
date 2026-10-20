// Rows containing only straight vertical routes need at most one cell of
// separation. Keep all node rows, group headers/borders and route bends fixed
// relative to one another; labels are placed after this coordinate transform.
export function compactVerticalChannels(layoutGraph) {
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
  // Prefix counts describe removed intervals without allocating one entry per
  // empty row. Coordinates inside an interval retain the old strict < rule.
  const starts = [];
  const ends = [];
  const totals = [0];
  for (let i = 1; i < rows.length; i += 1) {
    const start = rows[i - 1] + 2;
    if (start >= rows[i]) continue;
    starts.push(start);
    ends.push(rows[i]);
    totals.push(totals.at(-1) + Math.ceil(rows[i] - start));
  }
  const map = value => {
    const count = lowerBound(starts, value);
    if (!count) return value;
    const last = count - 1;
    return value - totals[last] - Math.ceil(Math.min(value, ends[last]) - starts[last]);
  };
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
export function separateAdjacentRoutes(layoutGraph) {
  const buckets = { x: new Map(), y: new Map() };
  for (const edge of layoutGraph.edges) {
    if (edge.stroke === 'invisible') continue;
    for (let i = 1; i < edge.points.length; i += 1) {
      const a = edge.points[i - 1];
      const b = edge.points[i];
      const horizontal = a.y === b.y;
      const axis = horizontal ? 'y' : 'x';
      const varying = horizontal ? 'x' : 'y';
      const start = Math.min(a[varying], b[varying]);
      const end = Math.max(a[varying], b[varying]);
      // A point cannot overlap another segment by one cell.
      if (end - start < 1) continue;
      if (!buckets[axis].has(a[axis])) buckets[axis].set(a[axis], []);
      buckets[axis].get(a[axis]).push({ id: edge.id, start, end });
    }
  }
  const gaps = { x: [], y: [] };
  for (const axis of ['x', 'y']) {
    for (const [coordinate, segments] of buckets[axis]) {
      const neighbor = buckets[axis].get(coordinate + 1);
      if (neighbor && overlapsOtherEdge(segments, neighbor)) gaps[axis].push(coordinate);
    }
    gaps[axis].sort((a, b) => a - b);
  }
  const map = (axis, value) => value + lowerBound(gaps[axis], value);
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

// Number of sorted entries strictly less than value.
function lowerBound(values, value) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (values[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Sweep both neighboring lanes by interval start. Only the two greatest ends
// with distinct edge IDs are needed: at most one ID is excluded by the query.
// Each lane participates in at most two sweeps, avoiding all-pairs scanning.
function overlapsOtherEdge(left, right) {
  const intervals = [
    ...left.map(segment => ({ ...segment, side: 0 })),
    ...right.map(segment => ({ ...segment, side: 1 })),
  ].sort((a, b) => a.start - b.start);
  const longest = [[], []];
  for (const segment of intervals) {
    const other = longest[1 - segment.side];
    if (other.some(previous => previous.id !== segment.id && previous.end >= segment.start + 1)) return true;
    const own = longest[segment.side];
    const same = own.find(previous => previous.id === segment.id);
    if (same) same.end = Math.max(same.end, segment.end);
    else own.push({ id: segment.id, end: segment.end });
    own.sort((a, b) => b.end - a.end);
    if (own.length > 2) own.pop();
  }
  return false;
}
