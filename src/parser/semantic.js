import { FlowInkError } from '../errors.js';
import yaml from 'js-yaml';

const VALID_SHAPES = new Set(`join rounded state anchor db summary database start document event stop console process text circle rect display prepare squareRect choice note composite rectWithTitle labelRect block_arrow collapsedGroup iconSquare iconCircle icon iconRounded imageSquare kanbanItem proc rectangle roundedRect stadium terminal pill fr-rect subprocess subproc framed-rectangle subroutine cyl cylinder datastore data-store folder directory bucket browser person circ bang cloud diam decision diamond question hex hexagon lean-r lean-right in-out lean_right lean-l lean-left out-in lean_left trap-b priority trapezoid-bottom trapezoid trap-t manual trapezoid-top inv-trapezoid inv_trapezoid dbl-circ double-circle doublecircle notch-rect card notched-rectangle lin-rect lined-rectangle lined-process lin-proc shaded-process sm-circ small-circle stateStart fr-circ framed-circle stateEnd fork forkJoin hourglass collate brace comment brace-l brace-r braces bolt com-link lightning-bolt doc delay half-rounded-rectangle h-cyl das horizontal-cylinder lin-cyl disk lined-cylinder curv-trap curved-trapezoid div-rect div-proc divided-rectangle divided-process tri extract triangle win-pane internal-storage window-pane f-circ junction filled-circle notch-pent loop-limit notched-pentagon flip-tri manual-file flipped-triangle sl-rect manual-input sloped-rectangle docs documents st-doc stacked-document st-rect procs processes stacked-rectangle bow-rect stored-data bow-tie-rectangle cross-circ crossed-circle tag-doc tagged-document tag-rect tagged-rectangle tag-proc tagged-process flag paper-tape odd rect_left_inv_arrow lin-doc lined-document`.split(/\s+/));

function textValue(value) {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' && 'text' in value ? String(value.text) : String(value);
}

function labelType(value) {
  return value?.type === 'markdown' || value?.type === 'string' ? value.type : 'text';
}

function parseShapeData(raw) {
  const metadata = {};
  if (!raw) return metadata;
  const body = String(raw).trim();
  // Shape data is indented relative to the node. YAML block scalars require
  // that common indentation to be removed before parsing.
  const lines = body.split('\n');
  // The first key is trimmed to column zero. Subsequent keys retain the
  // node's indentation, while block scalar content is further indented.
  const indents = lines.slice(1).filter((line) => line.trim()).map((line) => line.match(/^\s*/)[0].length);
  const indent = indents.length ? Math.min(...indents) : 0;
  const normalized = lines.map((line, index) => index === 0 ? line : line.slice(Math.min(indent, line.length))).join('\n');
  try {
    const parsed = yaml.load(normalized.includes('\n') ? normalized : `{${normalized}}`, { schema: yaml.JSON_SCHEMA });
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(metadata, parsed);
  } catch (error) {
    throw new FlowInkError(error?.message ?? 'Invalid shape data.', { code: 'SHAPE_DATA_ERROR', cause: error });
  }
  metadata.raw = body;
  return metadata;
}

export class FlowSemanticDB {
  constructor(source) {
    this.source = source;
    this.direction = 'TB';
    this.vertices = new Map();
    this.edges = [];
    this.classes = new Map();
    this.classTextStyles = new Map();
    this.subGraphs = [];
    this.subGraphLookup = new Map();
    this.tooltips = new Map();
    this.interactions = new Map();
    this.defaultStyles = [];
    this.defaultInterpolate = undefined;
    this.vertexCounter = 0;
    this.firstGraphFlag = true;
    this.lex = { firstGraph: () => this.firstGraph() };
    this.title = undefined;
    this.description = undefined;
    for (const name of [
      'firstGraph', 'setDirection', 'addVertex', 'addSingleLink', 'addLink', 'destructLink',
      'addSubGraph', 'addClass', 'setClass', 'updateLink', 'updateLinkInterpolate', 'setTooltip',
      'setLink', 'setClickEvent', 'setAccTitle', 'setAccDescription',
    ]) this[name] = this[name].bind(this);
  }

  firstGraph() {
    if (this.firstGraphFlag) { this.firstGraphFlag = false; return true; }
    return false;
  }

  clear() {}

  setDirection(direction) {
    const value = String(direction).trim();
    this.direction = value === 'TD' || value.includes('v') ? 'TB' : value.includes('>') ? 'LR' : value.includes('<') ? 'RL' : value.includes('^') ? 'BT' : value;
  }

  addVertex(id, textObj, type, styles, classes, dir, props, rawShapeData) {
    if (!id || !String(id).trim()) return;
    id = String(id);
    const shapeData = rawShapeData !== undefined ? parseShapeData(rawShapeData) : undefined;
    const subGraph = this.subGraphLookup.get(id);
    if (subGraph && shapeData) {
      Object.assign(subGraph.metadata, shapeData);
      return;
    }
    const edge = this.edges.find((item) => item.id === id.replace(/^@|@$/g, ''));
    if (edge && rawShapeData !== undefined) {
      // Edge property declarations use the same vertex production in the
      // upstream grammar. Do not expose its temporary vertex as a node.
      const placeholder = this.vertices.get(id);
      if (placeholder && placeholder.label === id && placeholder.shape === 'rect' && !placeholder.styles.length && !placeholder.classes.length) this.vertices.delete(id);
      Object.assign(edge.metadata, shapeData);
      const shape = edge.metadata;
      if (shape.animate !== undefined) edge.animate = Boolean(shape.animate);
      if (shape.animation !== undefined) edge.animation = String(shape.animation);
      if (shape.curve !== undefined) {
        edge.curve = String(shape.curve);
        edge.interpolate = String(shape.curve);
        edge.metadata.interpolate = String(shape.curve);
      }
      return;
    }
    let vertex = this.vertices.get(id);
    if (!vertex) {
      vertex = { id, label: id, labelType: 'text', shape: 'rect', styles: [], classes: [], metadata: {} };
      this.vertices.set(id, vertex);
    }
    this.vertexCounter += 1;
    if (textObj !== undefined) {
      vertex.label = textValue(textObj).trim().replace(/^"|"$/g, '');
      vertex.labelType = labelType(textObj);
    }
    if (type) vertex.shape = type;
    if (Array.isArray(styles)) vertex.styles.push(...styles);
    if (Array.isArray(classes)) vertex.classes.push(...classes);
    if (dir) vertex.direction = dir;
    if (props && typeof props === 'object') Object.assign(vertex.metadata, props);
    if (rawShapeData !== undefined) Object.assign(vertex.metadata, shapeData);
    if (rawShapeData !== undefined) {
      const shapeData = vertex.metadata;
      if (shapeData.shape !== undefined) {
        const shape = String(shapeData.shape);
        if (shape !== shape.toLowerCase() || shape.includes('_') || !VALID_SHAPES.has(shape)) {
          throw new FlowInkError(`No such shape: ${shape}.`, { code: 'INVALID_SHAPE' });
        }
        vertex.shape = shape;
      }
      if (shapeData.label !== undefined) {
        vertex.label = String(shapeData.label);
        vertex.labelType = shapeData.labelType === undefined ? 'markdown' : labelType({ type: shapeData.labelType });
      } else if (shapeData.labelType !== undefined) vertex.labelType = labelType({ type: shapeData.labelType });
      else if ((shapeData.icon || shapeData.img) && vertex.label === id) vertex.label = '';
    }
  }

  addSingleLink(start, end, type = {}, id) {
    const cleanId = id ? String(id).replace(/^@|@$/g, '') : undefined;
    const existingUserId = cleanId && this.edges.find((item) => item.id === cleanId);
    if (existingUserId && !existingUserId.isUserDefinedId) {
      let replacement = `L${this.edges.length}`;
      while (this.edges.some((item) => item.id === replacement) || replacement === cleanId) replacement = `L${Number(replacement.slice(1)) + 1}`;
      existingUserId.id = replacement;
    }
    let generatedId = `L${this.edges.length}`;
    while (this.edges.some((item) => item.id === generatedId) || generatedId === cleanId) {
      generatedId = `L${Number(generatedId.slice(1)) + 1}`;
    }
    const useUserId = Boolean(cleanId && !this.edges.some((item) => item.id === cleanId));
    const edge = {
      id: useUserId ? cleanId : generatedId,
      source: String(start), target: String(end), label: textValue(type.text), labelType: labelType(type.text),
      arrowStart: 'none', arrowEnd: 'none', stroke: type.stroke ?? 'normal', length: Math.min(type.length ?? 1, 10),
      styles: [], classes: [], metadata: this.defaultInterpolate === undefined ? {} : { interpolate: this.defaultInterpolate },
    };
    if (this.defaultInterpolate !== undefined) edge.interpolate = this.defaultInterpolate;
    if (useUserId) edge.isUserDefinedId = true;
    if (useUserId) edge.metadata.isUserDefinedId = true;
    const map = {
      arrow_open: ['none', 'none'], arrow_point: ['none', 'point'], arrow_circle: ['none', 'circle'], arrow_cross: ['none', 'cross'],
      double_arrow_point: ['point', 'point'], double_arrow_circle: ['circle', 'circle'], double_arrow_cross: ['cross', 'cross'],
    };
    [edge.arrowStart, edge.arrowEnd] = map[type.type] ?? ['none', 'none'];
    this.edges.push(edge);
  }

  addLink(starts, ends, linkData = {}) {
    const id = linkData?.id ? String(linkData.id).replace(/^@|@$/g, '') : undefined;
    for (const start of starts) for (const end of ends) this.addSingleLink(start, end, linkData, start === starts.at(-1) && end === ends[0] ? id : undefined);
  }

  destructLink(value, startValue) {
    const end = String(value).trim();
    let type = end.endsWith('>') ? 'arrow_point' : end.endsWith('o') ? 'arrow_circle' : end.endsWith('x') ? 'arrow_cross' : 'arrow_open';
    let line = end.slice(0, -1);
    let stroke = 'normal';
    const startMarker = line[0];
    const endMarker = end.at(-1);
    if (!startValue && ((startMarker === '<' && endMarker === '>') || (startMarker === 'o' && endMarker === 'o') || (startMarker === 'x' && endMarker === 'x'))) {
      type = `double_${type}`;
      line = line.slice(1);
    }
    stroke = line.startsWith('=') ? 'thick' : line.startsWith('~') ? 'invisible' : line.includes('.') ? 'dotted' : 'normal';
    let length = line.length - 1;
    if (stroke === 'dotted') length = (line.match(/\./g) || []).length;
    if (startValue) {
      const start = String(startValue).trim();
      const startType = start[0] === '<' ? 'arrow_point' : start[0] === 'o' ? 'arrow_circle' : start[0] === 'x' ? 'arrow_cross' : 'arrow_open';
      if (startType !== 'arrow_open' && startType !== type) return { type: 'INVALID', stroke: 'INVALID' };
      if (startType !== 'arrow_open') type = `double_${type.replace('arrow_', 'arrow_')}`;
      if (type === 'double_arrow_arrow_point') type = 'double_arrow_point';
    }
    return { type, stroke, length };
  }

  addSubGraph(idObj, list, titleObj) {
    const title = textValue(titleObj ?? idObj).trim();
    const sameText = idObj && titleObj && idObj === titleObj;
    const id = idObj?.text && (!sameText || !/\s/.test(idObj.text)) ? idObj.text.trim() : `subGraph${this.subGraphs.length}`;
    const flat = (list ?? []).flat(Infinity);
    const directions = flat.filter((item) => item?.stmt === 'dir');
    const direction = directions.at(-1)?.value;
    const nodeIds = [...new Set(flat.flatMap((item) => {
      if (typeof item === 'string' && item.trim()) return [item];
      if (item && typeof item === 'object' && typeof item.id === 'string') return [item.id];
      return [];
    }))];
    const occupied = new Set(this.subGraphs.flatMap((group) => group.nodeIds));
    const uniqueNodeIds = nodeIds.filter((nodeId) => !occupied.has(nodeId));
    const subgraph = { id, label: title, nodeIds: uniqueNodeIds, ...(direction ? { direction: direction === 'TD' ? 'TB' : direction } : {}), styles: [], classes: [], metadata: { labelType: labelType(titleObj ?? idObj) } };
    this.subGraphs.push(subgraph); this.subGraphLookup.set(id, subgraph);
    for (const nodeId of nodeIds) {
      const node = this.vertices.get(nodeId);
      if (node && !node.parentId) node.parentId = id;
      const child = this.subGraphLookup.get(nodeId);
      if (child && !child.parentId) child.parentId = id;
    }
    return subgraph;
  }

  addClass(ids, styles) {
    const values = String(styles?.join?.() ?? styles ?? '')
      .replace(/\\,/g, '§§§').replace(/,/g, ';').replace(/§§§/g, ',')
      .split(';').map((style) => style.trim()).filter(Boolean);
    for (const id of String(ids).split(',')) {
      this.classes.set(id, [...(this.classes.get(id) ?? []), ...values]);
      const textStyles = values.filter((style) => /color/.test(style)).map((style) => style.replace('fill', 'bgFill'));
      if (textStyles.length) this.classTextStyles.set(id, [...(this.classTextStyles.get(id) ?? []), ...textStyles]);
    }
  }

  setClass(ids, className) {
    for (const id of String(ids).split(',')) {
      const node = this.vertices.get(id); if (node) node.classes.push(String(className));
      const edge = this.edges.find((item) => item.id === id); if (edge) edge.classes.push(String(className));
      const group = this.subGraphLookup.get(id); if (group) group.classes.push(String(className));
    }
  }

  updateLink(positions, styles) {
    for (const position of positions) {
      if (position === 'default') this.defaultStyles = styles.slice();
      else if (this.edges[position]) {
        this.edges[position].styles = styles.slice();
        if (styles.length && !styles.some((style) => String(style).startsWith('fill'))) this.edges[position].styles.push('fill:none');
      } else throw new FlowInkError(`The link index ${position} is out of bounds.`, { code: 'INVALID_LINK_INDEX' });
    }
  }

  updateLinkInterpolate(positions, value) {
    const interpolate = String(value);
    for (const position of positions) {
      if (position === 'default') {
        this.defaultInterpolate = interpolate;
      } else if (this.edges[position]) {
        this.edges[position].metadata.interpolate = interpolate;
        this.edges[position].interpolate = interpolate;
      }
      else throw new FlowInkError(`The link index ${position} is out of bounds.`, { code: 'INVALID_LINK_INDEX' });
    }
  }

  setTooltip(ids, tooltip) { for (const id of String(ids).split(',')) this.tooltips.set(id, String(tooltip)); }
  setLink(ids, link, target) {
    for (const id of String(ids).split(',')) {
      if (!this.vertices.has(id) && !this.edges.some((edge) => edge.id === id) && !this.subGraphLookup.has(id)) continue;
      this.interactions.set(id, { href: String(link), target });
      this.setClass(id, 'clickable');
    }
  }
  setClickEvent(ids, callback, args) {
    for (const id of String(ids).split(',')) {
      if (!this.vertices.has(id) && !this.edges.some((edge) => edge.id === id) && !this.subGraphLookup.has(id)) continue;
      this.interactions.set(id, { callback: String(callback), args: args ? String(args) : undefined });
      this.setClass(id, 'clickable');
    }
  }
  setAccTitle(value) { this.title = String(value); }
  setAccDescription(value) { this.description = String(value); }

  finalize() {
    for (const group of this.subGraphs) {
      const synthetic = this.vertices.get(group.id);
      if (synthetic) {
        group.styles.push(...synthetic.styles);
        group.classes.push(...synthetic.classes);
        Object.assign(group.metadata, synthetic.metadata);
      }
      if (this.tooltips.has(group.id)) group.metadata.tooltip = this.tooltips.get(group.id);
      if (this.interactions.has(group.id)) group.metadata.interaction = this.interactions.get(group.id);
    }
    for (const node of this.vertices.values()) {
      for (const className of node.classes) node.styles.push(...(this.classes.get(className) ?? []));
      if (this.tooltips.has(node.id)) node.metadata.tooltip = this.tooltips.get(node.id);
      if (this.interactions.has(node.id)) node.metadata.interaction = this.interactions.get(node.id);
    }
    for (const edge of this.edges) {
      if (edge.interpolate === undefined && this.defaultInterpolate !== undefined) {
        edge.interpolate = this.defaultInterpolate;
        edge.metadata.interpolate = this.defaultInterpolate;
      }
      edge.styles = [...this.defaultStyles, ...edge.styles];
      for (const className of edge.classes) edge.styles.push(...(this.classes.get(className) ?? []));
      if (this.interactions.has(edge.id)) edge.metadata.interaction = this.interactions.get(edge.id);
    }
    const metadata = {};
    if (this.title !== undefined) metadata.title = this.title;
    if (this.description !== undefined) metadata.description = this.description;
    if (this.title !== undefined) metadata.accessibilityTitle = this.title;
    if (this.description !== undefined) metadata.accessibilityDescription = this.description;
    if (this.defaultStyles.length) metadata.defaultStyle = [...this.defaultStyles];
    if (this.defaultInterpolate !== undefined) metadata.defaultInterpolate = this.defaultInterpolate;
    if (this.classTextStyles.size) metadata.classTextStyles = Object.fromEntries(this.classTextStyles);
    return { source: this.source, direction: this.direction, nodes: [...this.vertices.values()], edges: this.edges, subgraphs: this.subGraphs, classes: Object.fromEntries(this.classes), metadata };
  }
}

export function parserError(error, source) {
  const line = error?.hash?.loc?.first_line ?? error?.lineNumber;
  const firstColumn = error?.hash?.loc?.first_column;
  const column = firstColumn === undefined ? undefined : firstColumn + 1;
  return new FlowInkError(error?.message ?? 'Invalid Mermaid flowchart', { code: 'PARSE_ERROR', line, column, cause: error });
}
