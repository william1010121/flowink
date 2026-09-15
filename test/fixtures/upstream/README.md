# Mermaid flowchart compatibility corpus

These files are copied from Mermaid mermaid@12.0.0 at commit 98a0945418c76238f15df2afaddbba4272656c3b.
The parser tests are retained verbatim under `specs/`; `cases.json` contains
deduplicated static arguments passed to the upstream parser in those tests.
Unbounded/generated and explicitly skipped test inputs are intentionally excluded;
bounded data-only templates are expanded into derived cases with provenance.
The compatibility harness uses Mermaid's raw flowchart parser and FlowDB for
these cases, matching the upstream tests. Focused preprocessing cases use
the public `mermaidAPI.getDiagramFromText()` frontend separately.

Source: https://github.com/mermaid-js/mermaid/tree/98a0945418c76238f15df2afaddbba4272656c3b/packages/mermaid/src/diagrams/flowchart/parser
License: Mermaid is MIT licensed; see `vendor/mermaid/LICENSE`.

## Integrity

- `specs/flow-arrows.spec.js`: 025ffc3f3fcee855bb4c9be841c7320e2309888f2206261c9262b9a318815feb
- `specs/flow-comments.spec.js`: 29988ed63d44bf0ea225721e3df4236e2b0101817389c23c58aa0cab6aa61fd6
- `specs/flow-direction.spec.js`: 507bc69c1302e5635eff505e6535e00805977b23e17171a732355a82cea76687
- `specs/flow-edges.spec.js`: f4b2d83c677f794327f5483131e492e52d2a97ef20318a86362d56e912cb79f0
- `specs/flow-huge.spec.js`: 6025e8b6842be1ddeb56d894c07d8d7f58e07b50af107e0c4a54675b8ddf1f42
- `specs/flow-interactions.spec.js`: 4664958cbedfbdeddff4cc5e8e947842e15f896c80c1678c02292cb354bc3715
- `specs/flow-lines.spec.js`: af81dfd07f8c977d418551cbde2d65e501958f347adb5f380e8b5696424f0cbf
- `specs/flow-md-string.spec.js`: 3fbc58cac25ab3d7a70278b7398321bf553ab821d43279eeee563261f5468e77
- `specs/flow-node-data.spec.js`: 120966e159d0ff1dde1a97aa848db07e89aadd19f4b5420c3c1ad58b3e93e0e0
- `specs/flow-singlenode.spec.js`: b747889e1c748f221f55b2cc95a2c4dcfd9b6a677b5cc0cb7766af7c3cb94bb4
- `specs/flow-style.spec.js`: 7f6638cbd8d81e60aebb25dc05c1d7a53ca2917ba73591611dbe3cdb06981eb7
- `specs/flow-text.spec.js`: 99de833e5993d41f7ae60605138f24ff8d8417890267fc00d93791f5448af468
- `specs/flow-vertice-chaining.spec.js`: 2833a1610c3ed721750b2d71ddf3d1e8b3cb5a6c8a76b0b7341a47d81cbbbb2f
- `specs/flow.spec.js`: badc905d2dfe8ddd13ead494dd38bcdc4d35c56aee1b8931dd2203f073060963
- `specs/subgraph.spec.js`: 3adbcb03a2be84a76c777502f7772922f05dd93643b2817a73180d11680d9a3f
