# Logical reviews

Logical maps interpret capabilities, functional changes, and relationships across an exact pair of Git commits. They are not a call graph, a directory grouping, or an implementation/commit summary. Behavioral effects are separate from **inferred purpose**. Keep the underlying evidence in mind: an agent's interpretation can be wrong even when its evidence references are valid.

## Installation and agents

Install DiffSlice as a project dev dependency and use `npm exec -- diffslice …` (or your package manager's local executable runner). A global DiffSlice installation is optional. The repository defaults to the caller's working directory, not `node_modules`; packaged viewer assets resolve relative to the installed bundle.

Install and authenticate the chosen agent CLI separately. DiffSlice does not install CLIs, prompt for API keys, modify their authentication, or silently switch agents/models on failure.

| `--agent` | Binary | Supported headless profile |
| --- | --- | --- |
| `claude-code` | `claude` | 2.1.318+; streamed JSON, no built-in tools or inherited MCP, safe mode, normal CLI auth |
| `codex` | `codex` | 0.166.0+; JSON events, read-only sandbox, no approval prompts, ephemeral session |
| `opencode` | `opencode` | 2.2.3+; private standalone service, JSON events, tool/MCP/plugin/skill deny policies |
| `pi` | `pi` | 1.5.0+; JSON messages, no tools/extensions/MCP/context discovery, ephemeral session |

These are explicit version floors for the flags used; older versions fail before analysis. Help/versions were inspected on Claude Code 2.1.318, Codex 0.166.0, OpenCode 2.2.5, and Pi 1.5.0. Automated tests use synthetic CLI protocol stand-ins, not paid provider runs; they do not establish semantic quality or live compatibility with every newer CLI version.

`--model` accepts the CLI's model ID, including OpenCode's `provider/model#variant`. Pi also accepts `--provider PROVIDER --model MODEL`. Omit the model to use the CLI default; because that default can change, those runs do not reuse a cached analysis. Codex deliberately ignores user execution config/rules to suppress inherited tools/integrations while retaining its normal credential store; custom model-provider configuration is not imported in this profile. Claude safe mode retains normal authentication rather than using `--bare`, which disables subscription authentication.

Executables are discovered on PATH (including project-local `.bin` entries supplied by npm). Use `--agent-bin /absolute/path` for a custom location or a JavaScript entry point. On Windows, native executables and standard npm JavaScript `.cmd` shims are supported without interpolating prompts through a shell. Unknown shim formats require an explicit JavaScript/native entry point.

## Generate and export

```sh
npm exec -- diffslice logical BASE HEAD --agent codex --model MODEL \
  --output ~/Downloads/review.html

npm exec -- diffslice logical BASE HEAD --agent pi --provider PROVIDER --model MODEL \
  --format svg --overview --output ~/Downloads/diagrams

npm exec -- diffslice logical BASE HEAD --agent opencode --model PROVIDER/MODEL \
  --format json --output ~/Downloads/mapping.json
```

- `--format html` (default): one self-contained, offline, interactive **mapping-only** file. Embedded JSON includes a versioned schema, full SHAs, comparison semantics, functional areas/nodes/relationships, evidence paths/blob IDs/line counts/hunk ranges, coverage, limitations, and provenance. Source text and patches are never part of this payload.
- `--format svg`: one true vector SVG per functional area, plus `mapping.json`. `--overview` adds `00-overview.svg`. `--area ID` selects one area; `--state changes|before|after` selects topology and behavior. SVGs have no scripts, external assets, raster captures, or HTML `foreignObject` dependency. Existing-context nodes and status text are explicitly marked.

- `--format json`: the portable analysis payload only.
- `--output`: an external file for HTML/JSON, or an external directory for SVG. With no output, a unique destination is chosen under the user cache and printed. Existing destinations are refused unless `--overwrite` is explicit.
- `--cache-dir`: external storage root. Default: `%LOCALAPPDATA%/diffslice/logical` on Windows or `$XDG_CACHE_HOME/diffslice/logical` / `~/.cache/diffslice/logical` elsewhere.
- `--refresh`: deliberately rerun analysis rather than reuse a validated cache. Cache identity includes canonical repository location, exact SHAs, comparison semantics, requested agent/model/provider, executable/version, and analysis version.
- `--json`: machine-readable output paths and coverage on stdout. Progress is written to stderr. Failure returns nonzero. No automatic retries or provider fallback.

Focused diagrams retain directly connected capabilities from other areas as dashed, area-labelled boundary nodes. Their actual added/changed/removed state is preserved; they are not relabelled as unchanged functionality. The Context control can hide this supporting context. The overview prioritizes changed capabilities and opens into the full area rather than crowding every node onto one canvas.

Headless export does not launch a browser. Stop a CLI generation with Ctrl+C. Browser generation requires the explicit Generate/Regenerate action and has a Cancel button. Cancellation and server shutdown stop the owned agent process/group and remove temporary evidence. Provider billing for work already submitted cannot be undone.

## Re-render or reconnect without AI

```sh
npm exec -- diffslice logical render ~/Downloads/review.html \
  --format svg --overview --output ~/Downloads/diagrams

npm exec -- diffslice open ~/Downloads/review.html --repo /path/to/checkout

npm exec -- diffslice compare BASE HEAD --logical-map ~/Downloads/review.html
```

`render` reads HTML or JSON and uses DiffSlice's deterministic layout/renderer. It never invokes an agent. Re-rendering still requires a repository context (`--repo` or the current directory) to enforce external-output boundaries; it does not require the report's commits.

`open` extracts data only; it does not evaluate any imported HTML/scripts, follow report links, or use embedded executable/config paths. It validates the schema and references, verifies both commits, checks changed paths and blob IDs against local Git, and joins the map with a normal local review. File diffs load only when selected. Unclassified and excluded changes remain reviewable. Module rules follow normal head/local/external precedence. With no existing rules or Graphify map, structural starter rules are derived from committed filenames and stored externally; they are clearly labelled suggestions, not AI-discovered architecture. Explicit `--modules` / `--map` still select the user's supplied map.

Missing commits fail with an actionable message. No automatic fetching, checkout, worktree creation, init, hooks, staging, or Graphify extraction takes place. Imported metadata must match the exact comparison; current branch names/working-tree contents cannot replace it. A report does not prove the analysis was genuinely produced by its claimed agent; provenance is descriptive, not a cryptographic signature.

The normal `compare --export` path remains a **complete snapshot with patches**, including an attached logical map when present. For a compact report use `logical … --format html` or Export HTML while the Logical view is active. Logical workflows reject in-repository export paths even for a requested complete snapshot.

## Evidence, limits, and safety

Generation reads Git blobs and patches, not working files. Small committed README/package/module-rule files provide context. Repository text is treated as untrusted evidence, not agent instructions. Sources, patches, and prompts are bounded and omissions are labelled:

- Up to 4,000 changed paths; 1 MiB maximum source blob read.
- First 24 KB per source side plus bounded patch excerpts; large/binary/symlink/submodule sources are explicitly omitted rather than followed or executed.
- Approximately 120 KB of changed-source evidence per batch, up to 32 batches. Multiple batches are reconciled into one cross-area analysis. Excessive reconciliation output fails rather than silently dropping areas.
- Each agent subprocess has a ten-minute timeout and an 8 MiB stdout limit; version probing has a fifteen-second timeout. These limits are per invocation, not a total budget across a comparison.
- Imported HTML/JSON files are limited to 32 MiB. Typical mapping-only reports are far smaller because source files and patches are not embedded.
- Result schemas, IDs, relationship endpoints, evidence references/ranges, and portable paths are validated. Coverage is recomputed, not trusted from model output. Every changed path is either linked to node evidence or visibly unclassified. Reference validation does **not** establish semantic correctness.

All new logical artifacts/caches/workspaces are external. No ignored files, `.gitignore` edits, or writes under the source checkout/Git metadata are needed. CLI paths are canonicalized including symlinked ancestors and rejected inside **any** repository. Private caches/workspaces use owner-only permissions where supported; temporary prompts are removed on success/failure/cancellation. Existing structural init/hook commands retain their separate, explicitly requested setup behavior.

The agent runs outside the checkout with reduced tool/integration access and no permission-bypass flags. This is **not an OS sandbox for arbitrary installed CLI/plugin code**: CLIs run with the user's authority, may read their normal credential stores, refresh credentials, and maintain their own user-level state. OpenCode managed/global policy and built-in integrations can have higher authority than local configuration. Use trusted installations and your normal provider/privacy policy. Model requests necessarily need network access; standalone report viewing does not.

Browser-triggered generation requires a per-session token and same-origin checks. Imported text is escaped before SVG/HTML rendering. Standalone HTML disables network connections with a content-security policy and contains no generation controls. Download it and open locally; it is not a hosted interactive GitHub application. Only open trusted HTML directly; use DiffSlice's data-only import for an untrusted report. GitHub supports HTML and SVG attachments, but an uploaded report can disclose functional descriptions, commit SHAs, and file paths even without source code. Review it before sharing publicly.
