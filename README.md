# DiffSlice

Review Git changes on a zoomable code map. DiffSlice opens a local dark-mode webpage with LOC-sized module blocks, highlights changed areas, and lets you drill into side-by-side file diffs.

- Named, nested modules from editable rules, with directory view alongside them.
- Collapsible changed-file tree with added/deleted line counts.
- Commit comparisons and GitHub PR links.
- Standalone HTML exports that work offline.
- Optional combined Graphify + DiffSlice pre-commit updates.

## Requirements

| Requirement | Used for |
|---|---|
| Node.js 22+ and Git | All commands |
| `uv` | Provisioning Graphify for the combined hook |
| Authenticated GitHub CLI (`gh`) | Reviewing PR links |
| Existing Graphify Python environment | Alternative to provisioning with uv |

Rules-only reviews need neither Graphify nor an API key. Graphify code extraction also runs locally without an LLM. Optional document/image semantic extraction is outside the combined hook.

## Install

Clone the repository and build the CLI:

```powershell
git clone https://github.com/Pranav-Official/diffslice.git
cd diffslice
npm install
npm run build
npm link
diffslice --help
```

Without linking, use `node D:/Misc/diffslice/dist/cli.js` in place of `diffslice`.

## Quick start: full hook setup

Run these commands inside the repository you want to review:

```powershell
cd D:\path\to\your-repo

diffslice init --install-hook
git add diffslice.modules.json

# Optional: build the initial graph now, before your next commit.
diffslice hook run

# Review two existing commits.
diffslice compare HEAD~1 HEAD
```

`init --install-hook` generates starter module rules, prepares committed-file membership/LOC caches, provisions an isolated Graphify 0.9.102 runtime using Python 3.12, and installs the combined pre-commit hook. Graphify's initial graph is built by the first `hook run` or commit; init does not perform that extraction itself.

Existing module rules are preserved byte for byte. Init never stages generated files. Stage `diffslice.modules.json` before committing with the hook enabled.

If Graphify is already installed in a Python environment:

```powershell
diffslice init --install-hook --graphify-python D:/tools/graphify/Scripts/python.exe
```

The supplied interpreter must contain Graphify 0.9.102 or newer. The hook records absolute Node/CLI and Python paths, so later commits do not require uv or the usual interactive-shell PATH. Reinstall the hook after moving the toolkit or changing its runtime.

## Quick start: rules only

```powershell
cd D:\path\to\your-repo

diffslice init --dry-run
diffslice init
diffslice compare HEAD~1 HEAD
```

Plain `init` does not install Graphify or hooks. It works before the first commit; comparison requires existing commits.

Init detects common project manifests across JavaScript, Rust, Python, Go, Java/Gradle, .NET, PHP, Ruby, Elixir, Swift, and CMake. It suggests nested areas from source directories and explains each grouping in the terminal and the config's `description` fields. Source suggestions are bounded to two folder layers and require at least two files per area.

These are structural starting points, not verified business-domain boundaries. Edit names and rules to match your architecture. `--dry-run` writes nothing; `--json` prints the complete plan, counts, and diagnostics. New configs prepare the first review's committed-file cache when HEAD exists; existing-config inspection does not rewrite caches.

## Review commits and PRs

```powershell
diffslice compare HEAD~1 HEAD
diffslice compare <base-sha> <head-sha> --repo D:/path/to/repo

diffslice pr https://github.com/owner/repo/pull/123 --repo D:/path/to/repo

diffslice compare HEAD~1 HEAD --modules D:/maps/modules.json
diffslice compare HEAD~1 HEAD --map D:/maps/graph.json
```

Commit comparisons use the exact two trees. PR mode resolves metadata with `gh`, fetches missing objects, and compares the merge base against the PR head. A local repository is required; automatic cloning and shallow-history repair are not implemented.

Rules are selected in this order:

1. Explicit `--modules`, or automatically detected `diffslice.modules.json`.
2. For an in-repository config, its version at the selected head commit; if absent there, its local file. This allows immediate review after init. External configs are read from disk.
3. Without rules, the Graphify map at `<repo>/graphify-out/graph.json`. Explicit `--map` selects Graphify instead of auto-detected rules.

Map details identify the rules source. Code and diffs always come from the selected commits, even when local rules are used. Comparison does not check out files, modify the working tree, or invoke Graphify/LLMs.

### Using the viewer

The map is the main view. Block area follows physical source lines, independently of edit count. Click blocks to drill down; use breadcrumbs or the back arrow to go up. Switch between **Modules** and **Directories**, search for names/paths, or enable **Changes only**.

Click a changed file to open its side-by-side diff below the map. The right file tree shows Git's additions/deletions and can be collapsed. Close the diff to restore the map's full height. Dark styling also applies to offline exports.

## Define module boundaries

Example `diffslice.modules.json`:

```json
{
  "schema": 1,
  "exclude": ["**/dist/**", "**/node_modules/**"],
  "modules": [
    {
      "id": "engine",
      "name": "Execution engine",
      "include": ["packages/engine/**"]
    },
    {
      "id": "web",
      "name": "Web application",
      "include": ["apps/web/**"],
      "children": [
        {
          "id": "usage",
          "name": "Usage",
          "include": ["apps/web/src/pages/usage/**"]
        }
      ]
    }
  ]
}
```

Rules support `*`, `**`, and `?`. The deepest matching rule owns the file. Equal-depth conflicts go into **Unassigned** with diagnostics; unmatched files also appear there. Each file has one primary home, while parent totals include descendants. Parent-owned files appear under **Other files**, alongside named children. Small leaf modules show files directly; larger ones expose directories.

Deleted files retain their base-revision owner under the selected rules. Renames belong to the destination module. Excluded files stay out of the normal map but remain reviewable under **Excluded changes** when modified.

## Combined pre-commit updates

For an initialized repository:

```powershell
diffslice hook install
diffslice hook status
diffslice hook run
diffslice hook uninstall
```

Every commit waits for this pipeline:

1. Run any preserved existing pre-commit hook and respect its exit code.
2. Capture the Git index and validate the staged rules.
3. Incrementally copy eligible raw staged blobs into a private source snapshot.
4. Run native `graphify update`, including clustering, against that snapshot.
5. Update DiffSlice's staged membership/LOC cache, verify the index stayed unchanged, and publish the graph and ready marker.

Unstaged edits and untracked files do not enter the snapshot. Checkout filters, symlinks, and submodule contents are not copied. Module exclusions also scope Graphify's input. Graphify failure, cache failure, or an index change rejects the commit. Nothing is automatically staged.

Existing hooks are backed up and invoked before the update; uninstall restores them. Manually edited managed hooks are left untouched. The installer respects `core.hooksPath` and preserves Husky 9's generated dispatcher. Default shared Git hooks use the current worktree, with separate snapshots and caches per worktree.

The runtime, snapshot, graph, and caches live in Git's private directories. The published graph is `diffslice/graphify/graph.json` under the worktree's Git directory and includes `diffslice_staged_tree`. No native Graphify post-commit hooks or permanent watchers are installed by this workflow.

### Measured commit cost

Local Windows measurements on a DevChestra clone:

| Case | Measured wall time |
|---|---:|
| Private runtime and hook setup | 12 seconds |
| First commit / cold Graphify build | 4 minutes |
| One-file changed commit | 70 seconds |
| Unchanged staged tree | 1-5 seconds |

These are samples, not latency guarantees. Full synchronous Graphify work makes changed commits expensive. Native parser warnings are forwarded; optional language extras may be needed. The test runtime lacked Graphify's optional SQL parser, so its SQL dependency coverage was incomplete, although DiffSlice still reviewed those files.

### DiffSlice-only cache refresh

```powershell
git add diffslice.modules.json
diffslice modules update --staged
```

This command refreshes only DiffSlice's staged module/LOC cache. It does not run Graphify or install a hook. Staged config contents are used, so partially staged rules remain consistent with the index.

## Use an existing Graphify map

An existing graph can be passed directly with `--map`. For separate Graphify operation:

```powershell
uv tool install "graphifyy[watch]==0.9.102"
graphify update D:/path/to/repo
graphify watch D:/path/to/repo
```

These are Graphify's commands. DiffSlice does not currently provide a general `diffslice update` or `diffslice watch` command. Graphify's dependency graph is not yet used to improve init's structural suggestions.

Graphify communities remain an optional view. Supplied labels are preserved; unlabeled communities use source-directory labels. Files may belong to multiple communities, so their overview area is apportioned to avoid duplicate total size. The graph is marked revision-unverified; historical community membership is not reconstructed.

## Export and options

```powershell
diffslice compare HEAD~1 HEAD --export review.html
diffslice compare HEAD~1 HEAD --json
diffslice compare HEAD~1 HEAD --port 4387 --no-open
```

Export embeds fonts, viewer code, and all patches, and works without a server or internet. Normal browser mode loads patches on demand. Press Ctrl+C to stop the local server. `--cache-dir` overrides derived-cache storage; paths supplied as options are resolved from the CLI's current directory.

Binary files and patches over 3 MB show explanations instead of text. Physical line counts include blanks/comments; empty, binary, and unavailable files receive a minimum display weight. Exported HTML contains source code, so share it as source material.

## Development and verification

```powershell
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:browser

npm run verify:init
npm run verify:precommit
npm run benchmark:hook
```

The integration tests use temporary Git repos and cover changes, renames, binaries, caches, staged snapshots, hook preservation, linked worktrees, HTTP routes, offline export, and script escaping. Real Graphify tests need a prepared interpreter at `.artifacts/graphify-tool/venv`, or `DIFFSLICE_GRAPHIFY_PYTHON`; otherwise they report a skip. The clone verifier provisions its own runtime using uv.

The browser suite uses DevChestra and its prepared Graphify map. Override `DIFFSLICE_TEST_REPO` and `DIFFSLICE_TEST_MAP` to relocate those inputs; tested commit IDs are pinned. Clone verifiers leave the source checkout untouched and save reports under `.artifacts/init/` and `.artifacts/precommit/`.

DevChestra examples:

```powershell
npm run review:devchestra
npm run review:latest-two
```

The first-parent comparison `6feeff2 -> cb35677` has 11 changed files, +967/-273. The latest two log entries `5fecd6f -> cb35677` have identical trees, so the zero-change view is intentional.

## Project layout

```text
src/cli.ts           CLI commands and browser launch
src/init.ts          explained starter module rules
src/module-index.ts  staged/committed membership and LOC cache
src/precommit.ts     combined hook installation and execution
src/staged-copy.ts   raw staged-blob materialization
src/git.ts           Git changes and GitHub PR resolution
src/graphify.ts      Graphify adapter and normalized-map cache
src/rule-map.ts      rule-based review ownership and metrics
src/review.ts        comparison manifest and change overlay
src/metrics.ts       physical line measurements from Git blobs
src/treemap.ts       module/directory hierarchy and area weights
src/patch.ts         lazy patches and aligned diff rows
src/server.ts        local server and standalone HTML export
src/viewer/          React treemap and diff interface
test/                integration and browser checks
```

MIT license. Graphify is a separate upstream project; the combined-hook installer provisions its runtime locally when requested.
