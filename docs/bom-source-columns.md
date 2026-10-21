# Leading BOM syntax-error columns

The parser removes a leading U+FEFF byte-order mark before parsing. For a
non-EOF syntax error on original source line 1, that character still occupies
one UTF-16 code unit in the source. The structured `column` now includes it:
`\uFEFFflowchart LR; A[ok)` reports line 1, column 20 instead of 19.

Preprocessing records whether it removed the leading BOM. Only a captured
syntax-token location, mapped back to original line 1, receives the adjustment.
Later lines, frontmatter offsets, CRLF, and existing EOF/lexical fallback
locations are unchanged. Human-readable messages and underlying parser cause
objects are intentionally unchanged; their text is not a source-position API.
No rendering or successful parse output changes are intended.

Regression coverage includes ASCII, CJK, astral emoji and combining labels,
comments/directives/frontmatter, repeated failure followed by valid parsing,
clean-package imports and real Chromium. This patch builds on the separately
prepared lookahead-token location correction, not on a different parser grammar.
