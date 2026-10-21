# Skip tab expansion when there are no tabs

The private `expandTabs` helper now returns its input unchanged when it contains
no tab. Its caller already supplies a primitive string after entity decoding and
CRLF normalization. The old path segmented every line, measured every grapheme,
and reconstructed exactly the same string even when no tab stops were needed.
The tab-containing path is unchanged, including four-cell stops, Unicode widths
and newline handling. Public label coercion is unchanged. Encoded tabs are decoded
before the check, so they still use the original expansion path.

## Measurement

Run `node scripts/benchmark-tab-expansion.js BASELINE_CHECKOUT` against main
`73f0e468c87d8c42e1764ed614c73b89f3d8e318`. Node 24.19.0 on the shared Linux host,
with other coordinated builds/timings paused. Nine alternating-order rounds;
discard two warmups and report the median of seven batches. Batch counts are
1,000 for short labels, 50 for long labels, 100 for tab-heavy labels, and ten for
complete renders. Exact outputs are checked before timing; source rendering is
compared in ASCII and Unicode.

| Workload | Baseline ms | Candidate ms |
| --- | ---: | ---: |
| Plain label preparation | 0.07837 | 0.000539 |
| Unicode label preparation | 0.03878 | 0.000499 |
| Long tab-free label preparation | 8.2128 | 0.7556 |
| Tab-heavy label preparation | 0.4016 | 0.4120 |
| Two-node Unicode source render | 4.6353 | 4.5615 |

Preparation benefits substantially when there are no tabs. Complete rendering
remains mostly layout-bound; the observed ~1.6% difference is not a general
throughput guarantee. The tab-heavy control was about 2.6% slower in this run; an earlier run
against pre-Segmenter-cache main was about 3.6% faster, suggesting host/JIT noise
rather than a consistent benefit. The extra includes check still has a cost, and
no tab-heavy speedup is claimed. Tiny absolute timings are especially host/JIT-sensitive.

Tests compare empty values, public coercion, HTML/Markdown, literal/encoded tabs,
CRLF/newlines, CJK, ZWJ emoji, combining marks and lone surrogates against the
frozen legacy implementation, plus 1,000 seeded mixed labels in both label modes.
Independent review checked 131,148 additional native/fallback and UTF-16 cases.
Real Chromium coverage compares a tab-containing Unicode node and a normal node
against Node output in both charsets. No dependency or public API change.
