# Synchronous pre-commit performance

## Measured result

Measured on 2026-11-05 using an isolated clone of `/home/pranavpp/Dev Works/DevChestra` at `cb3567798e7f31385b457d9fc13f20a1d9ea1f3a`: Linux, Node 26.11.1, Python 3.12.13, Graphify 0.9.102, and its SQL parser. The source checkout was not modified. The earlier Windows numbers are historical observations on another platform, not the comparison baseline below.

| Scenario | Native rebasing | Memoized native rebasing |
|---|---:|---:|
| Cold build, one run each | 31.154s | 31.098s |
| One changed file, mean of two runs | 10.122s | 8.321s |
| Unchanged staged tree, mean of two runs | 88.5ms | 86.5ms |

The changed-file reduction is about **18%**. Individual native changed runs were 9.227s/11.017s; adapted runs were 8.228s/8.414s. Do not infer a meaningful cold-build or unchanged-tree improvement from these samples. Both remain subject to machine load and filesystem/runtime caches.

Cold graphs had 9,171 nodes/28,166 edges; changed graphs had 9,171 nodes/28,165 edges. The benchmark asserted exact equality of the complete parsed graph JSON between variants, not just matching counts. Both variants ran native clustering. Each changed run materialized exactly one staged blob, preserving unstaged and untracked sentinels outside the graph.

Evidence (ignored local files):

- Initial Linux baseline: `.artifacts/precommit/1793874659610/{report.json,incremental-report.json,changed.pstats,profile.txt}`.
- Final controlled comparison: `.artifacts/precommit-benchmark/1793875633920/report.json`, plus per-case logs and isolated clone.
- Independent actual-commit verification: `.artifacts/precommit/1793875784039/report.json` and `incremental-report.json`; 34.351s cold, 7.461s changed, 90ms unchanged. This was a separate run, not the paired speedup calculation.
- An earlier comparison under `1793875316657` was diagnostic only: copying the snapshot rounded file mtimes and rewrote unchanged blobs. The benchmark now restores nanosecond signatures and asserts that a changed-file case writes exactly one blob.

## Bottlenecks and changes

The initial unmodified Linux hook measured 32.847s cold, 9.990s changed, and 85ms unchanged, without the SQL extra. A diagnostic cProfile run took 32.517s because profiling itself adds substantial overhead; those profiled seconds are not directly comparable to ordinary wall times.

That profile identified repeated `graphify.watch._StoredSourcePaths.rebase_preserved` calls. The native implementation recalculates the same relative path for every node/edge from a source. `src/graphify-update.ts` delegates that calculation to the original method once per source and resolver instance, then reuses its result. The cache is process-local, scoped to that resolver's roots, and never shared between worktrees. No path normalization, graph ownership, deletion, or relationship logic is replaced.

The private-API adapter is gated to **exactly Graphify 0.9.102**. Other versions use the native implementation without it. In the controlled changed cases, 36,416 lookups reused 914 native results. Graph reconciliation averaged 2.91s native versus 0.50s adapted. Clustering, analysis, graph construction, and other work still cost seconds. Cold extraction/assembly took about 25s, with about 20s in per-file parsing; there are no preserved paths to cache on that first build.

### SQL retries

The initial runtime reproduced the reported 16-file change set: one TypeScript source plus 15 SQL files whose parser was absent. All 16 per-file extraction attempts together took only 4.6ms in the profiled run. This is not evidence that SQL retries caused the multi-second delay.

Private runtime provisioning now installs `graphifyy[watch,sql]==0.9.102`, so SQL contributes symbols instead of being repeatedly retried. The final changed-file runs parsed just the changed TypeScript source. External interpreters are not modified; their parser availability is recorded on hook installation. Changing that feature stamp invalidates a prior ready marker even if the staged tree is unchanged. Other unsupported languages/zero-symbol sources may still be retried by native Graphify.

### Windows path warning

The `\\?\` stat-cache-root warning was not reproduced on Linux. Graphify's native cache-root/anchor and any root-switch warnings are now recorded in the diagnostics for a future Windows run. No speculative prefix stripping or Windows path-semantics workaround was added. Windows performance remains unmeasured here.

## Reproduce

Build the CLI first, then run:

```sh
npm run benchmark:precommit -- /path/to/source/repo
npm run verify:precommit -- /path/to/source/repo
```

Both operate on isolated clones under `.artifacts/`; neither installs a hook in the source. The benchmark provisions a private interpreter unless `DIFFSLICE_GRAPHIFY_PYTHON` supplies one. It restores the same cold state, staged tree, paths, and nanosecond snapshot mtimes for each changed-file comparison and alternates variant order. `native` means the same instrumented native pipeline with only the rebase memoization disabled. Full verification also performs actual commits, checks staged isolation, and uninstalls the managed hook.

For a changed staged tree in an initialized test checkout:

```sh
DIFFSLICE_GRAPHIFY_NATIVE=1 npx diffslice hook run
DIFFSLICE_PROFILE_GRAPHIFY=1 npx diffslice hook run
```

The first disables only memoization. The second writes `graphify/last-update.pstats` under the worktree's private DiffSlice directory. An unchanged-tree cache hit does not run Graphify or create a new profile. Profiling slows execution; use unprofiled runs to report speed.

`hook run` returns preparation, snapshot, Graphify subprocess, normalization/index-validation, module-cache, and graph-publication timings. `graphify/timings.json` adds import time, detection, parsing, extraction/resolution/assembly, reconciliation, clustering, scoring, analysis, report generation, JSON export, HTML rendering, and per-extension extraction counts/times. Some measurements are nested: parsing and resolution/assembly are within extraction, and the whole native rebuild contains its other phases. Do not sum nested timings. Graphify subprocess time also includes interpreter startup/teardown; `graphPublishMs` measures graph serialization/atomic replacement, and `elapsedMs` is stamped just before the final ready-marker write.

## Correctness and remaining limits

The synchronous combined mode is unchanged: preserved hook first, raw staged snapshot, native update including clustering/rendering, staged DiffSlice cache, index validation, then graph/ready publication. Nothing is sent to the background or automatically staged. Tests cover cross-file calls to unchanged code, SQL symbols, renames/deletions, linked-worktree caches, hook restoration/Husky, parser-stamp invalidation, and index mutation during extraction. Runtime/extraction failures and index changes reject the update before graph/ready publication; the index-race test verifies that the previously published graph and marker remain untouched.

This is a bounded optimization, not instantaneous indexing. Full graph reconciliation/clustering/analysis still runs when native Graphify requires it; the cold parser remains the largest cost. A different clustering algorithm, skipped outputs, or asynchronous mode would be a separate behavioral decision requiring fresh evidence and approval.
