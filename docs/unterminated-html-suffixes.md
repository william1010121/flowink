# Skip tag searches when no terminator remains

Raw HTML labels can contain literal, plausible openers such as `<a` without a
closing `>`. Previously, each opener rescanned the remaining suffix. A bounded
4,000-character `'<a'.repeat(2000)` fixture visits 4,000,000 characters in the
tag-terminator loop despite having no possible terminator.

`htmlTokenText` now computes the last literal `>` once and retains characters
after that position without attempting a tag scan. Comment handling remains
first: an unterminated `<!--` still consumes the rest of the input. The final
literal `>` is only a conservative bound, not an assertion that it is an
unquoted valid terminator. All existing quote scanning and tag validation remain
unchanged before that bound.

This does **not** make arbitrary malformed HTML linear-time. In particular,
repeated plausible openers before a final quoted `>` can still rescan. Entity
decoding and Markdown processing retain their existing order and semantics.

## Validation

- Three new tests cover repeated suffixes, comments before/after the final
  terminator, valid and malformed tags, both quote types, escaping, entities,
  Unicode, lone surrogates and text/Markdown modes.
- Independent differential against exact main `7559992`: 309,593 raw HTML cases,
  4,020 normalization/node-preparation cases, 100 repeated/recovery cases, and
  43 source-path text/render tests agree.
- 571 tests, build, declarations, clean package consumer, eight real Chromium
  fixtures and browser failure guards pass. Browser checks also render a literal
  unterminated suffix through the public source API.
- Instrumenting only the tag-search loop for 100/500/1,000/2,000/4,000-character
  fixtures gives 2,500/62,500/250,000/1,000,000/4,000,000 visits before, zero after.
  The new lastIndexOf traversal and ordinary character walk still perform work;
  these counts are not a count of all operations or regex-engine work.

## One bounded timing comparison

Run `node scripts/benchmark-html-suffix.js BASELINE_CHECKOUT` against main
`75599923b9d8302ad1d049dd87eebc887281869a`. Node 24.19.0; nine alternating
baseline/candidate rounds, discard two warmups, report the median of seven.
The harness checks exact outputs first and uses the same async invocation
wrapper for each side. A ten-second hard timeout bounded the complete run.

| Workload | Baseline ms | Candidate ms |
| --- | ---: | ---: |
| Plain Unicode label | 0.000891 | 0.001318 |
| Ordinary HTML | 0.001299 | 0.001388 |
| Quoted attribute | 0.001109 | 0.001173 |
| Markdown | 0.006030 | 0.006181 |
| Unterminated suffix, 1,000 characters | 0.783158 | 0.013694 |
| Unterminated suffix, 4,000 characters | 11.958730 | 0.056764 |
| Valid tag followed by 2,000-character suffix | 2.949302 | 0.028948 |
| Unclosed comment | 0.000579 | 0.001735 |
| Remaining quoted terminator, no fast-path benefit | 0.731719 | 0.891395 |
| Small source render | 4.696090 | 4.632874 |
| Source render with 256-character suffix | 4.663183 | 4.801058 |

The intended adversarial normalization improves about 57×/211× at these two
sizes. This is not a uniform throughput improvement: ordinary plain labels cost
about 0.43 microseconds more, the comment control about 1.16 microseconds more,
and the no-benefit malformed control was 22% slower in this run. Source rendering
was effectively similar at this scale, with the suffix case 3% slower. Raw
samples are preserved; host/JIT variability and the unchanged malformed-prefix
case limit generalization. No claim of zero overhead or globally linear parsing.

## Current-main refresh

Rebased onto main `1f9525d8a5178b8e4618ca129dda41c660a0aa62`, preserving
metadata, lookahead/BOM browser checks and the title fixture. All 600 tests,
build/types, ten Chromium fixtures and failure guards pass. The packed consumer
passes offline using existing cached dependencies; local registry HTTP 403 means
this is not a fresh online-install verification.

One new run of the same alternating harness completed within ten seconds on
Node 24.19.0, with all equality assertions passing:

| Workload | Baseline ms | Candidate ms |
| --- | ---: | ---: |
| Plain label | 0.001160 | 0.001470 |
| HTML label | 0.001423 | 0.001820 |
| Quoted HTML | 0.001231 | 0.001257 |
| Markdown | 0.006930 | 0.006645 |
| Unterminated 1,000 characters | 0.769714 | 0.013804 |
| Unterminated 4,000 characters | 12.039668 | 0.059563 |
| Valid tag followed by suffix | 3.057983 | 0.031812 |
| Unclosed comment | 0.000548 | 0.001187 |
| Remaining quoted terminator | 0.774182 | 0.817457 |
| Small full render | 4.618819 | 4.760011 |
| Suffix full render | 5.001169 | 4.975304 |

The plain/HTML controls add approximately 0.31/0.40 microseconds (+26.6%/+27.9%).
The unclosed-comment control adds 0.64 microseconds, despite a large relative
percentage; its comment-first semantics remain unchanged. The small full render
is 3.1% slower in this run, and the residual quoted-terminator case is 5.6% slower.
The intended 4,000-character suffix is about 202 times faster. These observations
are not a universal performance guarantee; all controls and historical samples
are retained, without further tuning or a global linear-time claim.
