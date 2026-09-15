# Third-party notices

FlowInk's own source is licensed under MIT.

The flowchart grammar, portions of parsing/semantic processing, and upstream
compatibility fixtures derive from Mermaid 12.0.0 (MIT), tag `mermaid@12.0.0`,
commit `98a0945418c76238f15df2afaddbba4272656c3b`.
Source: https://github.com/mermaid-js/mermaid/tree/mermaid%4012.0.0
The upstream license and grammar provenance are included in `vendor/mermaid`.
The parser is generated at build time by Jison (MIT).

Runtime dependencies retain their own licenses; they are installed separately
and not relicensed by FlowInk. In particular, elkjs is distributed under
`EPL-2.0 OR GPL-3.0-or-later`; its license is included in the installed elkjs
package. See https://github.com/kieler/elkjs/blob/master/LICENSE.md.

Graph::Easy is a visual reference. FlowInk contains no Graph::Easy code.
