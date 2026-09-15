import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import yaml from 'js-yaml';
import parse from '../src/parse.js';

const fixture = JSON.parse(await readFile(new URL('./fixtures/upstream/cases.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('./fixtures/upstream/manifest.json', import.meta.url), 'utf8'));
assert.equal(fixture.baseline.commit, '98a0945418c76238f15df2afaddbba4272656c3b');
assert.ok(fixture.cases.length >= 150, `expected a broad upstream corpus, got ${fixture.cases.length}`);

// Mermaid's parser is usable in Node, but markdown labels and shape metadata
// call DOMPurify. Keep this DOM confined to this dev-only oracle harness.
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://flowink.test/' });
const DOM_GLOBALS = ['window', 'document', 'DOMParser', 'Node', 'navigator', 'Element', 'SVGElement', 'HTMLElement'];
const previousGlobals = new Map();
for (const name of DOM_GLOBALS) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
}

const mermaid = (await import('mermaid')).default;
mermaid.mermaidAPI.initialize({ startOnLoad: false, securityLevel: 'strict' });

// The upstream parser specs instantiate FlowDB and call flow.parser.parse
// directly.  Keep that distinction here: getDiagramFromText() is Mermaid's
// public frontend (which performs preprocessing and selects a diagram), while
// this parser/DB pair is the raw flowchart grammar and semantic oracle used by
// the vendored .spec files.
const rawSeed = await mermaid.mermaidAPI.getDiagramFromText('flowchart TD\nA-->B');
const rawParser = rawSeed.getParser();
const rawDb = rawSeed.db;

after(() => {
  for (const name of DOM_GLOBALS) {
    const descriptor = previousGlobals.get(name);
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  dom.window.close();
});

const edgeArrows = {
  arrow_open: ['none', 'none'],
  arrow_point: ['none', 'point'],
  arrow_circle: ['none', 'circle'],
  arrow_cross: ['none', 'cross'],
  double_arrow_point: ['point', 'point'],
  double_arrow_circle: ['circle', 'circle'],
  double_arrow_cross: ['cross', 'cross'],
};

function valueOrEmpty(value) {
  return value === undefined || value === null ? '' : String(value);
}

function sortStrings(values) {
  return [...new Set(values ?? [])].map(String).sort();
}

function subtractMaterialisedStyles(styles, classes, classDefinitions) {
  const counts = new Map();
  for (const className of classes ?? []) {
    for (const style of classDefinitions.get(String(className)) ?? []) {
      const key = String(style);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return (styles ?? []).filter((style) => {
    const key = String(style);
    const count = counts.get(key) ?? 0;
    if (count > 0) {
      counts.set(key, count - 1);
      return false;
    }
    return true;
  });
}

function normaliseSubgraphMetadata(metadata) {
  return Object.fromEntries(Object.entries(metadata ?? {}).filter(([key]) => key !== 'labelType' && key !== 'raw'));
}

function normaliseDirection(value) {
  return value === 'TD' ? 'TB' : (value ?? 'TB');
}

function normaliseHref(value) {
  if (value === undefined || value === null) return undefined;
  return String(value).replace(/\/$/, '');
}

function canonicalInteraction(vertex, tooltip, parsedMetadata) {
  const interaction = parsedMetadata?.interaction ?? {};
  const clickable = vertex?.classes?.includes('clickable') || Boolean(interaction && Object.keys(interaction).length);
  const result = {};
  if (clickable) result.clickable = true;
  const href = normaliseHref(vertex?.link ?? interaction.href);
  if (href) result.href = href;
  const target = vertex?.linkTarget ?? interaction.target;
  if (target) result.target = String(target);
  const tip = tooltip ?? parsedMetadata?.tooltip;
  if (tip !== undefined) result.tooltip = String(tip);
  return result;
}

function frontmatterTitle(source) {
  const match = String(source).match(/^\s*---\s*\r?\n([\s\S]*?)(?:\r?\n---\s*(?:\r?\n|$))/);
  if (!match) return undefined;
  try {
    const value = yaml.load(match[1]);
    return value && typeof value === 'object' ? value.title : undefined;
  } catch {
    return undefined;
  }
}

function normaliseOfficial(diagram, source) {
  const db = diagram.db;
  const subgraphs = db.getSubGraphs?.() ?? [];
  const subgraphIds = new Set(subgraphs.map((group) => String(group.id)));
  const tooltipMap = db.tooltips ?? new Map();
  const rawEdges = db.getEdges?.() ?? [];
  const defaultEdgeStyles = rawEdges.defaultStyle ?? [];
  const defaultInterpolate = rawEdges.defaultInterpolate;
  const nodes = [...(db.getVertices?.() ?? new Map()).values()]
    // Mermaid's DB creates a vertex for a subgraph reference in a few nested
    // cases. FlowInk represents that reference as the subgraph itself, so it
    // must not be compared as a second ordinary node.
    .filter((vertex) => !subgraphIds.has(String(vertex.id)))
    .map((vertex) => ({
      id: String(vertex.id),
      label: valueOrEmpty(vertex.text ?? vertex.id),
      labelType: vertex.labelType ?? 'text',
      shape: vertex.type ?? 'rect',
      styles: sortStrings(vertex.styles),
      classes: sortStrings(vertex.classes),
      shapeData: Object.fromEntries([
        ['icon', vertex.icon], ['form', vertex.form], ['pos', vertex.pos], ['img', vertex.img],
        ['assetWidth', vertex.assetWidth], ['assetHeight', vertex.assetHeight], ['constraint', vertex.constraint],
      ].filter(([, value]) => value !== undefined)),
      interaction: canonicalInteraction(vertex, tooltipMap.get(vertex.id)),
      // Membership is authoritative for Mermaid's DB; it is not stored on a
      // vertex object in the upstream implementation.
      parentId: subgraphs.find((group) => (group.nodes ?? []).includes(vertex.id))?.id,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const edges = rawEdges.map((edge) => {
    const [arrowStart, arrowEnd] = edgeArrows[edge.type] ?? ['none', 'none'];
    return {
      source: String(edge.start),
      target: String(edge.end),
      label: valueOrEmpty(edge.text),
      labelType: edge.labelType ?? 'text',
      arrowStart,
      arrowEnd,
      stroke: edge.stroke ?? 'normal',
      length: edge.length ?? 1,
      interpolate: edge.interpolate ?? defaultInterpolate,
      animate: edge.animate,
      animation: edge.animation,
      // Mermaid adds fill:none as an SVG rendering default; it is not a
      // source-level linkStyle and therefore is omitted from the semantic
      // comparison.
      styles: sortStrings([...defaultEdgeStyles, ...(edge.style ?? [])].filter((style) => String(style) !== 'fill:none')),
      classes: sortStrings(edge.classes),
      id: edge.isUserDefinedId ? String(edge.id) : undefined,
    };
  });
  const classes = [...(db.getClasses?.() ?? new Map())]
    .map(([id, value]) => [String(id), sortStrings(value?.styles ?? value)])
    .sort(([a], [b]) => a.localeCompare(b));
  return {
    direction: normaliseDirection(db.getDirection?.() ?? db.direction),
    nodes,
    edges,
    subgraphs: subgraphs.map((group) => ({
      id: String(group.id),
      label: valueOrEmpty(group.title ?? group.id),
      nodeIds: sortStrings(group.nodes),
      direction: normaliseDirection(group.dir),
      classes: sortStrings(group.classes),
      labelType: group.labelType ?? 'text',
      metadata: normaliseSubgraphMetadata(group.metadata),
    })),
    classes,
    metadata: {
      // getDiagramFromText strips frontmatter before exposing FlowDB, while
      // FlowInk deliberately preserves its title in graph.metadata. Apply
      // the documented source-level title to the oracle projection so the
      // semantic comparison remains about the same graph contract.
      title: db.getAccTitle?.() || frontmatterTitle(source),
      description: db.getAccDescription?.() || undefined,
    },
  };
}

function normaliseFlowInk(graph) {
  const classDefinitions = new Map(Object.entries(graph.classes ?? {}).map(([id, styles]) => [id, styles]));
  const subgraphIds = new Set((graph.subgraphs ?? []).map((group) => String(group.id)));
  const nodes = (graph.nodes ?? []).map((node) => ({
    id: String(node.id),
    label: valueOrEmpty(node.label ?? node.id),
    labelType: node.labelType ?? 'text',
    shape: node.shape ?? 'rect',
    // FlowInk materialises class declarations into styles. Subtract exactly
    // the styles contributed by this node's classes, preserving an explicit
    // source style that happens to have the same value.
    styles: sortStrings(subtractMaterialisedStyles(node.styles, node.classes, classDefinitions)),
    classes: sortStrings(node.classes),
    shapeData: Object.fromEntries([
      ['icon', node.metadata?.icon], ['form', node.metadata?.form], ['pos', node.metadata?.pos], ['img', node.metadata?.img],
      ['assetWidth', node.metadata?.assetWidth ?? node.metadata?.w],
      ['assetHeight', node.metadata?.assetHeight ?? node.metadata?.h],
      ['constraint', node.metadata?.constraint],
    ].filter(([, value]) => value !== undefined)),
    interaction: canonicalInteraction({ classes: node.metadata?.interaction ? ['clickable'] : [], link: node.metadata?.interaction?.href, linkTarget: node.metadata?.interaction?.target }, undefined, node.metadata),
    parentId: node.parentId,
  })).filter((node) => !subgraphIds.has(node.id)).sort((a, b) => a.id.localeCompare(b.id));
  const edges = (graph.edges ?? []).map((edge) => ({
    source: String(edge.source),
    target: String(edge.target),
    label: valueOrEmpty(edge.label),
    labelType: edge.labelType ?? 'text',
    arrowStart: edge.arrowStart ?? 'none',
    arrowEnd: edge.arrowEnd ?? 'none',
    stroke: edge.stroke ?? 'normal',
    length: edge.length ?? 1,
    interpolate: edge.curve ?? edge.metadata?.interpolate,
    animate: edge.animate ?? edge.metadata?.animate,
    animation: edge.animation ?? edge.metadata?.animation,
    styles: sortStrings(subtractMaterialisedStyles(edge.styles, edge.classes, classDefinitions).filter((style) => String(style) !== 'fill:none')),
    classes: sortStrings(edge.classes),
    id: /^(?:L\d+|L_[^\n]*_\d+)$/.test(String(edge.id)) ? undefined : String(edge.id),
  }));
  const subgraphs = (graph.subgraphs ?? []).map((group) => ({
    id: String(group.id),
    label: valueOrEmpty(group.label ?? group.id),
    nodeIds: sortStrings(group.nodeIds),
    direction: normaliseDirection(group.direction),
    classes: sortStrings(group.classes),
    labelType: group.metadata?.labelType ?? 'text',
    metadata: normaliseSubgraphMetadata(group.metadata),
  }));
  return {
    direction: normaliseDirection(graph.direction),
    nodes,
    edges,
    subgraphs,
    classes: Object.entries(graph.classes ?? {})
      .map(([id, styles]) => [String(id), sortStrings(styles)])
      .sort(([a], [b]) => a.localeCompare(b)),
    metadata: {
      title: graph.metadata?.title,
      description: graph.metadata?.description,
    },
  };
}

async function oracle(source) {
  try {
    // Frontmatter and Mermaid directives may alter global configuration;
    // reset before every independent fixture so order cannot affect results.
    mermaid.mermaidAPI.globalReset();
    mermaid.mermaidAPI.initialize({ startOnLoad: false, securityLevel: 'strict' });
    return { value: normaliseOfficial(await mermaid.mermaidAPI.getDiagramFromText(source), source) };
  } catch (error) {
    return { error };
  }
}

function rawOracle(source) {
  try {
    // This mirrors the upstream beforeEach: every parser invocation gets a
    // cleared FlowDB, while the parser itself remains the Mermaid-generated
    // parser object. Calls are intentionally serial because parser.yy is
    // mutable in Mermaid 12.0.0.
    rawDb.clear();
    rawParser.parser.yy = rawDb;
    rawParser.parse(source);
    return { value: normaliseOfficial({ db: rawDb }, source) };
  } catch (error) {
    return { error };
  }
}

function local(source) {
  try {
    return { value: normaliseFlowInk(parse(source)) };
  } catch (error) {
    return { error };
  }
}

const outcomes = [];
for (const fixtureCase of fixture.cases) {
  // Keep the oracle calls serial: Mermaid owns mutable parser/config state.
  const expected = rawOracle(fixtureCase.source);
  outcomes.push({ fixtureCase, expected, actual: local(fixtureCase.source) });
}

const focusedCases = [
  {
    name: 'frontmatter preserves config metadata',
    source: `---
title: Front title
config:
  flowchart:
    nodeSpacing: 77
---
flowchart LR
A-->B`,
    check(graph) {
      assert.equal(graph.metadata?.frontmatter?.title, 'Front title');
      assert.equal(graph.metadata?.frontmatter?.config?.flowchart?.nodeSpacing, 77);
    },
  },
  {
    name: 'init directive is retained as metadata',
    source: `%%{init: {"flowchart": {"nodeSpacing": 77}}}%%
flowchart LR
A-->B`,
    check(graph) {
      assert.deepEqual(graph.metadata?.directives, ['init: {"flowchart": {"nodeSpacing": 77}}']);
    },
  },
  {
    name: 'full-line comments and CRLF are accepted',
    source: 'flowchart LR\r\n%% full-line comment\r\nA-->B\r\nB-->C\r\n',
  },
  {
    name: 'comments without a separating space are accepted',
    source: 'flowchart LR\n%%comment no space\nA-->B\n%%tail',
  },
  {
    name: 'trailing inline comment follows Mermaid validity',
    source: 'flowchart LR\nA-->B %% trailing comment\nB-->C',
  },
  {
    name: 'shape data retains semantic keys',
    source: `flowchart TB
A@{ shape: circle, label: "Clock", other: "clock" }`,
    check(graph) {
      const node = graph.nodes.find((item) => item.id === 'A');
      assert.equal(node?.shape, 'circle');
      assert.equal(node?.label, 'Clock');
      assert.equal(node?.labelType, 'markdown');
      assert.equal(node?.metadata?.shape, 'circle');
      assert.equal(node?.metadata?.label, 'Clock');
      assert.equal(node?.metadata?.other, 'clock');
    },
  },
  {
    name: 'HTML attributes in quoted labels remain valid',
    source: `flowchart TB
A["<b title='hi'>bold</b>"] --> B`,
  },
  {
    name: 'callback retains interaction arguments',
    source: `flowchart TB
A-->B
click A call callback("x", y) "tooltip"`,
    check(graph) {
      const node = graph.nodes.find((item) => item.id === 'A');
      assert.deepEqual(node?.metadata?.interaction, { callback: 'callback', args: '"x", y' });
      assert.equal(node?.metadata?.tooltip, 'tooltip');
      assert.ok(node?.classes?.includes('clickable'));
    },
  },
  {
    name: 'syntax errors retain original line after removed headers',
    source: `---
config:
  flowchart:
    nodeSpacing: 77
---
%%{init: {"flowchart": {"nodeSpacing": 77}}}%%
flowchart TB
A(`,
    errorLine: 8,
  },
  {
    name: 'syntax errors retain original line after directive',
    source: `%%{init: {"flowchart": {"nodeSpacing": 77}}}%%
flowchart TB
A(`,
    errorLine: 3,
  },
  {
    name: 'malformed frontmatter is rejected',
    source: `---
config: [
---
flowchart TB
A-->B`,
  },
];
const focusedOutcomes = [];
for (const focusedCase of focusedCases) {
  const expected = await oracle(focusedCase.source);
  const actual = local(focusedCase.source);
  focusedOutcomes.push({ focusedCase, expected, actual });
}

describe('Mermaid 12.0.0 flowchart parser compatibility', () => {
  test('fixture corpus contains independent cases from every upstream parser spec', () => {
    assert.equal(manifest.files.length, 15);
    const files = new Set(fixture.cases.map((item) => item.upstream));
    const manifestNames = new Set(manifest.files.map((item) => item.file.replace(/^specs\//, '')));
    assert.ok([...files].every((file) => manifestNames.has(file)));
    // flow-huge.spec.js builds its input dynamically and remains verbatim in
    // specs/ without a bounded static parser argument to compare. Every other
    // upstream spec must contribute at least one extracted case, so a broken
    // extractor cannot silently turn an entire file into a no-op.
    const dynamicOnly = new Set(['flow-huge.spec.js']);
    assert.deepEqual(
      [...manifestNames].filter((file) => !dynamicOnly.has(file)).filter((file) => !files.has(file)),
      [],
    );
    assert.equal(outcomes.length, fixture.cases.length);
  });

  for (const { fixtureCase, expected, actual } of outcomes) {
    const label = `${fixtureCase.upstream}:${fixtureCase.line} (${fixtureCase.id})`;
    if (expected.error) {
      test(`${label} remains rejected by FlowInk`, () => {
        assert.ok(actual.error, `Mermaid rejects this case but FlowInk accepted it: ${JSON.stringify(fixtureCase.source)}`);
      });
    } else {
      test(`${label} matches Mermaid's semantic graph`, () => {
        if (actual.error) {
          assert.fail(`Mermaid accepts this case but FlowInk rejected it: ${actual.error.message}`);
        }
        assert.deepEqual(actual.value, expected.value);
      });
    }
  }

  for (const { focusedCase, expected, actual } of focusedOutcomes) {
    test(`focused ${focusedCase.name} matches Mermaid acceptance`, () => {
      assert.equal(Boolean(actual.error), Boolean(expected.error));
      if (expected.error) assert.ok(actual.error, expected.error.message);
      else assert.deepEqual(actual.value, expected.value);
    });
    if (focusedCase.check && !actual.error) {
      test(`focused ${focusedCase.name} retains FlowInk metadata`, () => focusedCase.check(parse(focusedCase.source)));
    }
    if (focusedCase.errorLine) {
      test(`focused ${focusedCase.name} reports original line`, () => {
        assert.equal(actual.error?.line, focusedCase.errorLine);
      });
    }
  }
});
