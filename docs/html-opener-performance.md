# Impossible HTML opener fast path

Every literal `<` previously triggered a quote-aware search for a tag terminator before checking whether a tag could begin there. A label containing 4,000 literal `<` characters performed 7,998,000 character visits in that search alone.

After the existing comment handler, an ASCII-letter check (optionally following one slash) now rejects impossible tag prefixes before the search. Such prefixes previously appended the same literal `<` and advanced one position. Valid opening/closing tags, quoted attributes, comments, and the later tag matcher retain their original behavior.

This is not a parser redesign or global linear-time guarantee. Repeated plausible-but-unclosed `<a` prefixes can still trigger repeated scanning. Markdown parsing, Unicode segmentation, entity decoding, and rendering have separate costs.

## Validation

The normalization oracle is frozen from main `7bac01b` through `labelLines`; unrelated shape code is omitted. Tests cover repeated bounded 4,000-character labels, valid/comment/malformed tags, closing tags, quotes, case, whitespace, escaping, and 2,000 seeded inputs in both text and Markdown modes. Independent native review compared another 624,288 direct scanner inputs, including every UTF-16 code unit after `<` and `</` with adversarial suffixes, with zero differences.

The independent main-based candidate passes 551 tests, build, types, clean package consumer, real Chromium parity, and eight browser failure-guard mutants. It contains none of the pending geometry or parsed-graph API changes.

## Benchmark

Run `node scripts/benchmark-html-openers.js [BASELINE_SRC_INDEX_JS]`. Helper comparisons use the frozen oracle; optional end-to-end comparisons import a baseline entry point. Output equality is checked first. Nine alternating-order rounds discard two warmup rounds and report medians of seven samples; helper samples batch small cases, end-to-end samples render once. Node 24.19.0 on a shared cloud machine, with coordinated other builds/tests paused.

Measured baseline → candidate milliseconds:
- Plain short label: 0.065591 → 0.066164 (+0.9%).
- Small valid HTML: 0.055572 → 0.056025 (+0.8%).
- Quoted attribute/CJK/emoji: 0.018692 → 0.019558 (+4.6%).
- Markdown control: 0.073247 → 0.051989.
- 1,000 literal `<`: 6.422 → 4.839.
- 4,000 literal `<`: 39.561 → 16.752 (about 58% lower).
- 2,000 repeated `</`: 28.784 → 26.862.
- Small two-node render: 5.857 → 5.910 (+0.9%).
- Single-node render with 2,000 literal `<`: 45.791 → 17.001 (about 63% lower).

The Markdown control contains no HTML and does not exercise the fast path; its measured variation illustrates timing noise. Small realistic controls show small regressions in this run. Benefit concerns impossible tag-openers, not universal rendering throughput.
