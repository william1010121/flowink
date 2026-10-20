// Reference implementation from FlowInk 0.1.1 for differential tests.
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
export function separateAdjacentRoutes(layoutGraph) {
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

