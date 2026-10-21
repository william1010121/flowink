# Own metadata keys

Shape-data mappings preserve enumerable own keys, including `__proto__`,
`constructor` and `prototype`, as ordinary data properties. Previously the
intermediate `Object.assign` invoked the inherited `__proto__` setter and the
key disappeared from the returned graph. A scalar value was silently lost too.
This is a metadata completeness correction, not a claim of a demonstrated global
prototype-pollution exploit. The regression checks leave `Object.prototype`
unchanged and preserve node labels/shapes when those names occur inside a nested
`__proto__` mapping.

A small internal merge helper defines writable, configurable, enumerable own
properties on internally created mutable metadata records. It preserves own
symbols, key order, shallow value identity and one read of each enumerable source
value, and omits non-enumerable/inherited properties. Later declarations replace
previous values without changing the target prototype. Sources are not mutated.
This helper is not a general replacement for `Object.assign` on arbitrary target
descriptors or proxies, and does not validate or sanitize arbitrary metadata.

The change covers parsed shape data, node properties, edge/subgraph metadata,
synthetic subgraph transfers and preprocessed graph metadata. Ordinary rendered
output is unchanged; preserved inert metadata does not become a renderer option.

Validation includes special keys in nodes, edges and both subgraph declaration
orders, repeated declarations, nested mappings, own symbols, ordinary source
rendering and browser parsing. The baseline drops the own `__proto__` key for
`A@{__proto__: kept, label: Visible}`; the candidate retains it without altering
its prototype or visible label.

## Cost measurement

Run `node scripts/benchmark-shape-yaml.js BASELINE_CHECKOUT` against main
7559992 with Node 24.19.0. The existing harness first checks full graph/output
identity, alternates baseline/candidate order over nine rounds, discards two
warmup rounds and reports the median of seven. It uses 1,000 iterations for
short parses, 100 for a 100-line scalar, and ten for source rendering per round.

One controlled run measured milliseconds per operation:

| Workload | Baseline | Candidate |
| --- | ---: | ---: |
| Inline metadata parse | 0.03482 | 0.03514 |
| Short multiline parse | 0.03384 | 0.03658 |
| 100-line scalar parse | 0.04468 | 0.05348 |
| Metadata source render | 5.10829 | 5.03619 |

Defining own descriptors adds work versus assignment; this correctness change
is not a throughput optimization. These short parse timings are sensitive to
JIT/host variation, and the small render difference is not a speedup claim.
