# DiffSlice
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
TypeScript CLI, bundled React browser viewer. The accepted architecture specifies this stack.

## Users
Developers reviewing changes between Git revisions or in a GitHub pull request.

## Product Purpose
Explore named, nested modules from editable rules as the main, LOC-weighted treemap canvas. Each file has one primary home. Graphify communities remain an optional fallback. Click a block to drill down into its modules, directories, and files, then open a file's side-by-side diff on demand. A collapsible right sidebar contains a traditional changed-file directory tree with additions and deletions.

## Operating Context
Local command line, local Git repository, module rules or existing Graphify output, desktop browser. Verification repository: D:/Misc/Dev-Chestrav. User explicitly requests autonomous completion of a verified MVP.

## Capabilities and Constraints
Graphify owns extraction, indexing, clustering and watching. DiffSlice can read its saved output, or resolve rule-based modules from committed trees using the incremental cache; comparison never runs an indexer or LLM. Support SHA comparison, PR resolution using gh, local browser launch, portable HTML export. Keep unchanged modules for orientation, retain unmapped changes, label map provenance honestly. Do not change the reviewed working tree.

## Brand Commitments
Name: DiffSlice. Product language is direct and concise. The user requests a polished dark developer-tool interface, clear visual hierarchy, human-readable labels, and the treemap as the main surface. Preserve all working review functionality.

## Evidence on Hand
Real Git changes from DevChestra and Graphify output generated from that source. No illustrative metrics or claimed performance without measurement.

## Product Principles
- Keep the architecture visible while reading code.
- Preserve configured module boundaries and nested hierarchy; resolve files at the selected revision.
- Load expensive diffs when selected.
- Never hide changes because mapping is incomplete.
- The treemap is center stage; do not open the code pane until a file is selected.
- Size blocks by source line count, independently of how many lines changed.
