# Mermaid flowchart provenance

FlowInk vendors the Mermaid flowchart grammar from Mermaid `12.0.0`, commit
`98a0945418c76238f15df2afaddbba4272656c3b`. The exact upstream grammar is
`flow.jison`; its SHA-256 is recorded in [provenance.json](./provenance.json).

The accompanying `flowDb.ts` and `flowParser.ts` files are upstream reference
sources for semantic and parser behavior. FlowInk's pure JavaScript adapter is
`src/parser/semantic.js`; it retains the parser-facing FlowDB operations while
omitting Mermaid's DOM and rendering dependencies. Mermaid's MIT license is
included in `LICENSE`.

Upstream sources:

- https://github.com/mermaid-js/mermaid/tree/98a0945418c76238f15df2afaddbba4272656c3b/packages/mermaid/src/diagrams/flowchart
- https://github.com/mermaid-js/mermaid/blob/98a0945418c76238f15df2afaddbba4272656c3b/LICENSE
