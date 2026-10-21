# Unexpected-token source locations

`parse('flowchart LR\n A[ok)\n')` previously returned `PARSE_ERROR` at
line 2, column 4, the start of the preceding `ok` token. It now reports
line 2, column 6, the unexpected `)`.

The pinned Jison parser's `hash.loc` describes the previous accepted token.
Its fresh working lexer's `yylloc` describes the actual lookahead. A stable,
frozen adapter delegates `setInput` and captures that working clone once via
an invocation-local callback in Jison's copied `yy` context. No callback or
lexer state is exposed in the returned graph, and the generated parser is
unchanged. The wrapper does not run in the token loop.

For ordinary syntax errors, FlowInk copies the lookahead's beginning, not its
end or consumed offset. Lines and columns are one-based; columns count UTF-16
code units, so an astral emoji occupies two code units. Existing preprocessing
line offsets still apply to frontmatter, comments and directives; CRLF handling
is unchanged. Multiline offending tokens point to their first line/column.

Both EOF representations (Jison numeric `1` and grammar string `EOF`) retain
previous fallback locations. Lexical failures without a token location still
may lack structured coordinates. This is not a redesign of every diagnostic:
the original Jison message and cause remain unchanged, including parser-relative
line numbers inside message text after frontmatter removal. Consumers should
prefer the structured `line` and `column` fields when available.

## Validation

- Six regression tests cover mismatched delimiters, UTF-16 columns, actual
  multiline lookahead tokens, frontmatter, directives, comments, CRLF, both EOF
  representations, lexical fallback, repeated recovery and concurrent renders.
- Adapter tests prove separate working clones, callbacks, `yy` and condition
  stacks, an unchanged base lexer, and no callback in graph metadata.
- Independent comparison of 435 upstream cases: 432 identical successful graphs,
  three failures with unchanged codes/messages/cause hashes, and one intentional
  structured location correction.
- 574 tests, build, declarations, clean tarball consumer, eight real Chromium
  fixtures and browser runner failure guards pass. Package/browser checks assert
  the corrected token coordinates, not just the presence of a line number.

## Bounded overhead control

Run `node scripts/benchmark-shape-yaml.js BASELINE_CHECKOUT` against main
`75599923b9d8302ad1d049dd87eebc887281869a`. Node 24.19.0; nine alternating
baseline/candidate rounds, discard two warmups, median of seven samples.
The existing harness first requires identical valid parse/render outputs.
A ten-second hard timeout bounded each run; both completed.

| Workload | Baseline ms | Stable adapter ms |
| --- | ---: | ---: |
| Inline metadata parse | 0.041049 | 0.043796 |
| Short multiline metadata parse | 0.032347 | 0.032845 |
| 100-line metadata parse | 0.041908 | 0.042084 |
| Metadata source render | 4.351600 | 4.466064 |

This is a correctness fix, not a throughput improvement. In this run the
smallest case cost about 2.7 microseconds more (6.7%); end-to-end rendering was
2.6% slower. Small wall-clock differences remain host/JIT-sensitive.

An initial rejected prototype created an adapter and `setInput` function per
parse. Its same-workload medians were 0.037739 → 0.086915 ms,
0.035426 → 0.065690 ms, 0.043521 → 0.075660 ms, and
4.160790 → 4.184800 ms. The stable adapter avoids that large tiny-parse penalty.
Both raw runs are retained; no additional tuning or uniform speed claim is made.

## Final main-based validation

After rebasing onto main `3fc824e135ed6233874e74c4f6004c66aaff7429`,
582 tests, build/types, clean packed consumer, nine actual Chromium fixtures and
browser failure guards pass. This preserves the merged metadata-key and optional
error-location declaration corrections. The original bounded overhead results
above remain historical measurements against the explicitly named baseline;
no new throughput claim is made for the rebased candidate.
