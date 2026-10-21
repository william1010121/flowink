# Preserve multiline shape-data YAML

Multiline shape metadata is now passed to js-yaml with the indentation
and line endings supplied by the Mermaid parser instead of trimming and dedenting its content. The parser keeps
its existing JSON_SCHEMA and error wrapping. The public metadata.raw string
remains trimmed as before; public source parsing still normalizes CRLF.

This intentionally corrects previously rejected or silently misparsed YAML:

- A scalar-only literal (`|`) or folded (`>`) label now parses without needing a
  sibling shape key.
- Text such as `shape: rect` or `# comment` inside a block scalar stays label text,
  rather than becoming a metadata key or being discarded as a YAML comment.
- Nested mappings remain nested. Keep/strip/clip chomping, explicit indentation,
  meaningful terminal spaces and blank lines follow js-yaml's YAML semantics.

Single-line comma-separated Mermaid shape metadata still uses the existing flow
mapping wrapper, even if surrounded by blank lines. If that wrapper fails and
parser-supplied line breaks exist, raw YAML is tried to handle empty block scalars. No
legacy dedent fallback is used for multiline errors: inconsistent indentation
that formerly happened to parse is now SHAPE_DATA_ERROR, rather than silently
reshaping the author's data. For example, a plain `label: Hello` followed by an
indented `shape: rect` is not treated as two root keys; align root keys instead. Likewise, an inline first key with one leading space
and a later root key at column zero is inconsistent YAML; remove the initial
space or align both keys. The bounded-overflow regression was canonicalized this
way without reducing its 150,001-line coverage.

The installed parser's documented API accepts a single YAML document, uses the
selected schema, and throws on malformed input:
https://github.com/nodeca/js-yaml/blob/4.1.0/README.md#load-string---options-
No YAML implementation, grammar, schema or dependency change is included.

## Compatibility and validation

All 432 previously accepted upstream fixture graphs remain identical, including
46 shape declarations (37 inline and nine multiline). This corpus result is not
an unconditional old-output guarantee: correcting malformed interpretations of
otherwise valid scalar/nested YAML is the purpose of the change.

Tests compare raw js-yaml results for literal/folded scalars, explicit indentation,
header comments, all chomping modes, key-like content, nested mappings, CRLF,
blank lines, terminal spaces and empty scalars. Invalid-format checks and repeated
source rendering verify recovery. Chromium checks real rendering, preserved keep
chomping, nested mappings and the prior large parse-only scalar regression.

## Ordinary-workload controls

Run `node scripts/benchmark-shape-yaml.js BASELINE_CHECKOUT` against main
3e769e7b73c6c9791b3ee5ed610770db6fd559cf. Node 24.19.0, shared Linux host with
coordinated CPU-quiet measurements. Nine alternating-order rounds, discard two
warmups, median of seven per-operation batches. Inline and short multiline parse
batches run 1,000 times, 100-line parse batches 100 times, and complete renders ten
times. Exact previously valid outputs are checked before timing.

| Workload | Baseline ms | Candidate ms |
| --- | ---: | ---: |
| Inline metadata parse | 0.03892 | 0.03860 |
| Short multiline metadata parse | 0.03874 | 0.03906 |
| 100-line metadata parse | 0.07102 | 0.05121 |
| Metadata source render | 4.57408 | 4.60811 |

The short parse and full-render controls are essentially neutral (the complete
render was about 0.7% slower in this run). Removing preprocessing helps the longer
parse fixture, but this is a correctness change, not a broad speed guarantee.
