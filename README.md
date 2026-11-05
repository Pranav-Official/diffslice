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
| Node.js 22+, npm, and Git | Project installation and review |
| `uv` | Provisioning Graphify for the combined hook |
| Authenticated GitHub CLI (`gh`) | Reviewing PR links |
| Existing Graphify Python environment | Alternative to provisioning with uv |

Rules-only reviews need neither Graphify nor an API key. Graphify code extraction also runs locally without an LLM. Optional document/image semantic extraction is outside the combined hook.

## Install in your project

[DiffSlice is available on npm](https://www.npmjs.com/package/diffslice). The package ships the built CLI, browser viewer, and fonts. No DiffSlice clone, build, global install, Python, or API key is needed for rules-based reviews.

Run inside the Git repository you want to review:

```sh
npm install --save-dev --save-exact diffslice
npx diffslice init
npx diffslice compare HEAD~1 HEAD
```

Review the generated `diffslice.modules.json`, then commit it with `package.json` and your package-manager lockfile. Ensure `node_modules/` is ignored by Git. Teammates run `npm ci` and use the same commands and pinned DiffSlice version. If the repository has no `package.json`, run `npm init -y` first; this works for non-JavaScript projects too.

Installation and plain `init` never install Git hooks, provision Graphify, or stage files. Existing module rules are preserved byte for byte. Init works before the first commit; the `HEAD~1 HEAD` example needs two commits. Other existing base/head revisions work too.

Optionally add a shortcut to your project's existing npm scripts:

```json
{
  "scripts": {
    "review": "diffslice compare HEAD~1 HEAD"
  }
}
```

Then run `npm run review`. Preview rules without writing anything using `npx diffslice init --dry-run`.

Init detects common project manifests across JavaScript, Rust, Python, Go, Java/Gradle, .NET, PHP, Ruby, Elixir, Swift, and CMake. It suggests nested areas from source directories and explains each grouping in the terminal and the config's `description` fields. Source suggestions are bounded to two folder layers and require at least two files per area.

These are structural starting points, not verified business-domain boundaries. Edit names and rules to match your architecture. `--dry-run` writes nothing; `--json` prints the complete plan, counts, and diagnostics. New configs prepare the first review's committed-file cache when HEAD exists; existing-config inspection does not rewrite caches.

### Optional: Graphify and pre-commit updates

Rules-based review does not require a hook. For combined Graphify updates, first install `uv` or prepare a Python interpreter containing Graphify 0.9.102+, then explicitly activate the hook in each checkout:

```sh
npx diffslice hook install
git add diffslice.modules.json

# Optional: build the initial graph now, before your next commit.
npx diffslice hook run
```

Without `--graphify-python`, installation uses uv to provision an isolated Graphify 0.9.102 runtime with Python 3.12 and the `watch,sql` extras. This downloads dependencies; the first extraction happens on `hook run` or commit, not during installation. Reinstalling the hook upgrades older private environments that lack SQL support. Existing interpreters can be selected with `npx diffslice hook install --graphify-python /path/to/python`; they are inspected, never modified. `init --install-hook` combines initialization with this opt-in setup.

Project-local hooks locate the installed CLI relative to the checkout, so dependency reinstalls at the same location do not require reinstalling the hook. Linked worktrees use their local installation when present, otherwise the installing checkout's CLI. Repository-local configuration paths follow a moved checkout; external runtimes remain external. A moved Python environment may need reprovisioning with `npx diffslice hook install`. The hook uses the recorded Node executable, falling back to `node` on PATH if it is missing.

Hooks are per-checkout setup, not distributed by committing module rules. Do not add automatic Graphify/hook setup to `postinstall` or `prepare`: dependency installation should remain side-effect-free. Commits with changed staged code wait for Graphify; see the measured cost below.

## Review commits and PRs

```powershell
npx diffslice compare HEAD~1 HEAD
npx diffslice compare <base-sha> <head-sha> --repo /path/to/repo

npx diffslice pr https://github.com/owner/repo/pull/123 --repo /path/to/repo

npx diffslice compare HEAD~1 HEAD --modules /path/to/modules.json
npx diffslice compare HEAD~1 HEAD --map /path/to/graph.json
```

Commit comparisons use the exact two trees. PR mode resolves metadata with `gh`, fetches missing objects, and compares the merge base against the PR head. A local repository is required; automatic cloning and shallow-history repair are not implemented.

Rules are selected in this order:

1. Explicit `--modules`, or automatically detected `diffslice.modules.json`.
2. For an in-repository config, its version at the selected head commit; if absent there, its local file. This allows immediate review after init. External configs are read from disk.
3. Without rules, the Graphify map at `<repo>/graphify-out/graph.json`. Explicit `--map` selects Graphify instead of auto-detected rules.

Map details identify the rules source. Code and diffs always come from the selected commits, even when local rules are used. Ordinary comparison does not check out files, modify the working tree, or invoke Graphify/LLMs. Functional analysis requires an explicit Logical-generation request.

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
npx diffslice hook install
npx diffslice hook status
npx diffslice hook run
npx diffslice hook uninstall
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

These are samples, not latency guarantees. Full synchronous Graphify work makes changed commits expensive. Native parser warnings are forwarded; optional language extras may be needed. That historical Windows runtime lacked Graphify's optional SQL parser, so its SQL dependency coverage was incomplete, although DiffSlice still reviewed those files. Current private runtime provisioning includes SQL support.

On a fresh Linux DevChestra clone, a controlled Graphify 0.9.102 comparison with SQL support measured a one-file update at **10.12s native vs 8.32s with per-source path-rebase caching** (two runs each, about 18% faster). Full graph JSON was equal. Cold builds remained about 31s, and unchanged staged trees about 87–89ms. These are different hardware/platform measurements, not a 70s-to-8s speedup claim.

The hook still synchronously runs native extraction, dependency resolution, clustering, analysis, and rendering. The rebase adapter applies only to Graphify 0.9.102; other versions retain native behavior. Per-stage timings are returned by `hook run`, with Graphify details in `diffslice/graphify/timings.json` under the worktree's Git directory. See [performance methodology and remaining limits](docs/precommit-performance.md).

### DiffSlice-only cache refresh

```powershell
git add diffslice.modules.json
npx diffslice modules update --staged
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

### Functional change maps (opt-in AI)

DiffSlice can explain **what changes functionally**, grouped into capabilities and functional areas, using an installed Claude Code, Codex, OpenCode, or Pi CLI. It reuses that CLI's authentication; no direct provider API integration or global DiffSlice installation is required. Generation is explicit and may incur provider charges. Ordinary comparisons and hooks do not run AI automatically.

```sh
# Run from a project where DiffSlice is installed as a dev dependency.
npm exec -- diffslice logical BASE HEAD --agent codex --model MODEL_ID \
  --output ~/Downloads/logical-review.html

# Open the small HTML directly for an offline, mapping-only review.
# Or reconnect its analysis to local module/directory maps and lazy code diffs:
npm exec -- diffslice open ~/Downloads/logical-review.html --repo /path/to/checkout

# Export one SVG per functional area, without another AI call:
npm exec -- diffslice logical render ~/Downloads/logical-review.html \
  --format svg --overview --output ~/Downloads/logical-diagrams
```

The standalone HTML embeds **no source files or patches**. It contains graphical maps, behavior descriptions, inferred purpose, exact commit SHAs, and evidence references. Import extracts and validates its data without executing its scripts, verifies local committed evidence, and does not rerun AI. If module rules/Graphify data are absent, opening a report derives structural starter modules from committed paths and caches them externally—no `init` or repository writes required.

In the live viewer, choose **Logical → Generate mapping** and select an agent/model. You can also opt in from the terminal with `compare BASE HEAD --logical --agent codex --model MODEL_ID`, or import with `--logical-map report.html`. The Logical view's **Export HTML** action downloads the lightweight map-only report; the structural views retain their existing complete snapshot export.

Logical output, caches, and agent workspaces stay **outside repositories and Git metadata directories**. In-repository paths (including symlinked ancestors) are rejected. With no `--output`, exports go under the user cache directory and the command prints their location. Missing commits are reported; logical workflows never silently fetch or check out history. See [logical review commands, supported CLI versions, limits, and safety boundaries](docs/logical-reviews.md).

```powershell
npx diffslice compare HEAD~1 HEAD --export review.html
npx diffslice compare HEAD~1 HEAD --json
npx diffslice compare HEAD~1 HEAD --port 4387 --no-open
```

Export embeds fonts, viewer code, and all patches, and works without a server or internet. Normal browser mode loads patches on demand. Press Ctrl+C to stop the local server. `--cache-dir` overrides derived-cache storage; paths supplied as options are resolved from the CLI's current directory.

Binary files and patches over 3 MB show explanations instead of text. Physical line counts include blanks/comments; empty, binary, and unavailable files receive a minimum display weight. Exported HTML contains source code, so share it as source material.

## Development and verification

Only contributors need to clone and build DiffSlice:

```sh
git clone https://github.com/Pranav-Official/diffslice.git
cd diffslice
npm ci
```

```powershell
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:browser

npm run verify:init
npm run verify:precommit
npm run benchmark:hook
npm run benchmark:precommit -- /path/to/repo
```

The integration tests use temporary Git repos and cover changes, renames, binaries, caches, staged snapshots, hook preservation, linked worktrees, HTTP routes, offline export, and script escaping. Real Graphify tests need a prepared interpreter at `.artifacts/graphify-tool/venv`, or `DIFFSLICE_GRAPHIFY_PYTHON`; otherwise they report a skip. The clone verifier provisions its own runtime using uv.

The browser suite uses DevChestra and its prepared Graphify map. Override `DIFFSLICE_TEST_REPO` and `DIFFSLICE_TEST_MAP` to relocate those inputs; tested commit IDs are pinned. Clone verifiers leave the source checkout untouched and save reports under `.artifacts/init/` and `.artifacts/precommit/`.

DevChestra examples:

```powershell
npm run review:devchestra
npm run review:latest-two
```

The first-parent comparison `6feeff2 -> cb35677` has 11 changed files, +967/-273. The latest two log entries `5fecd6f -> cb35677` have identical trees, so the zero-change view is intentional.

### Package verification and release

```sh
npm run typecheck
npm run build
npm test
npm run verify:package
npm pack --ignore-scripts
```

The package verifier installs the tarball offline as a dev dependency in a temporary project outside this checkout. It exercises the local npm executable, initialization, commit comparison, live viewer assets/patches, and embedded offline export without Graphify or source/build dependencies.

To test an unpublished build, install the generated tarball in a project with `npm install --save-dev --save-exact /path/to/diffslice-<version>.tgz`. Tarball installs record a local file path in the lockfile; use a published version for a portable team setup.

CI verifies the consumer install on Linux and Windows. For a new release, bump the version in `package.json` and the lockfile, then run the checks above; published versions cannot be overwritten. The manually dispatched **Package and publish** workflow builds and uploads a verified npm tarball; publishing is off by default. To publish through the workflow, configure npm trusted publishing for this GitHub repository and `release.yml`, then dispatch with `publish` enabled. The publish job uses OIDC/provenance rather than a stored npm token. Nothing publishes on ordinary pushes or installs.

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
