# Native grapheme Segmenter reuse

The rasterizer previously constructed an `Intl.Segmenter` for every label line.
It now retains at most one native Segmenter, keyed by constructor identity. Every
call still creates a fresh Segments object and iterator. Replacing the native
constructor replaces the cache; custom polyfills are constructed per call to
preserve potentially stateful behavior. Missing support retains the existing
code-point fallback, and constructor/getter failures still propagate.

Native detection uses the standard native function string. An unfamiliar engine
representation conservatively disables this optimization. This is not a security
boundary against modified JavaScript intrinsics. The cache does not track runtime
changes to the host's default locale without constructor replacement. This is consistent
with the existing cached Segmenter used for text measurement.

## Measurement

Run `node scripts/benchmark-segmenter.js BASELINE_CHECKOUT` against main
`7dfa9e9cbfdfd366012d17d6d30b3813c3131208`. Node 24.19.0, shared Linux host,
no other coordinated benchmark/build activity. Nine alternating baseline/candidate
rounds, discard two warmup rounds, report median of seven. Each raster batch runs
100 times; each complete source-render batch runs ten times. Exact output equality
is checked first; complete-render checks cover ASCII and Unicode framing.

| Workload | Baseline ms | Candidate ms |
| --- | ---: | ---: |
| One-line raster | 0.0681 | 0.0260 |
| 100 narrow Unicode/emoji/combining label lines, raster | 3.4372 | 2.5078 |
| Two-node source render | 4.1713 | 4.1411 |
| 30-line Unicode/emoji/combining source render | 5.2663 | 5.1561 |

The isolated multiline raster improved about 27%. Complete rendering remains
mostly layout-bound; its small differences are not a general throughput claim.
The tiny one-line case has substantial JIT/host noise. This is one environment,
not a guarantee for every runtime or diagram. A separate alternating 15,000-line
segmentation probe measured fresh construction at 149–204 ms versus reuse at
51–73 ms, explaining the optimization rather than predicting whole-render gains.

Regression coverage includes custom stateful constructors, absent support,
throwing getters/constructors, restored and cross-realm native constructors,
independent Segments objects, repeated/interleaved rendering, CJK, ZWJ emoji and
combining marks. Chromium checks render multiline graphemes in both charsets and
compare exact Node output.
