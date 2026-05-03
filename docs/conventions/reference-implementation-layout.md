# Reference Implementation Layout

**Status:** active convention
**First codified:** sprint-019 (PR #169)

This document is the canonical reference for how Pristine separates **SDK primitives** from **reference implementations**. `docs/specs/implementation-spec-005.md` §5.2 cross-references this doc for the layout convention; `implementation-spec-006.md` §13 (currently a Draft in PR #153) is a related but independent convention covering the privacy / tool-wrapper surface — the two share the primitive/adapter axis but use different naming schemes (see "Relation to the privacy / tool-wrapper convention" below).

---

## TL;DR

- **Primitives** live in `src/`. They are runtime-agnostic: no host-environment knowledge, no harness-specific glue.
- **Reference implementations** never live in `src/`. They live in `examples/<harness>/<tool>/` while incubating and graduate to `@pristine/<harness>-<tool>` published packages when they ship externally.
- A reference impl depends on `@pristine/shield-local` (or its successors) the way any external consumer would. **It never reaches into `src/` internals.** That is the only invariant that matters.

---

## The `(harness, tool)` naming axis

Every reference impl is named by a **two-segment identifier**:

| Segment | What it names | Examples |
|---|---|---|
| `<harness>` | The host environment the reference targets | `pi-dev`, `claude-code`, `cursor`, `cline` |
| `<tool>` | The reference itself | `search-memory`, `query-memory`, `session-start-hook`, `post-tool-use-ingest` |

The two-segment form prevents naming collisions: the same tool concept can ship multiple harness-specific variants (`pi-dev-search-memory` vs `claude-code-search-memory`) without one stomping the other.

## Two artifact shapes

### Source-tree examples (initial / incubating)

```
examples/
├── pi-dev/
│   ├── search-memory/
│   ├── query-memory/
│   └── post-tool-use-ingest/
├── claude-code/
│   └── session-start-hook/
└── cursor/
    └── post-tool-use-ingest/
```

- **Use this shape first.** Easiest to iterate, easiest to fork, lowest packaging overhead.
- Each `<tool>/` directory is self-contained: source, README, smoke test (where applicable), example config.
- A consumer integrates by copy-paste; the directory ships as an example, not as a binary dependency.

### Published adapter packages (mature / external consumers)

```
@pristine/pi-dev-search-memory
@pristine/pi-dev-query-memory
@pristine/claude-code-session-start-hook
@pristine/cursor-post-tool-use-ingest
```

- **Promote a source example to a package** once a downstream consumer wants `npm install` rather than copy-paste, OR once the example stabilises enough to make a versioned release useful.
- The package name preserves both `(harness, tool)` segments from the source layout. No collapsing, no shortening.
- The package depends on `@pristine/shield-local` (or its successors) as a regular npm dep — same dependency contract that any external user would have.

The two shapes coexist. A reference impl can be both: live as `examples/pi-dev/search-memory/` for in-repo iteration AND publish `@pristine/pi-dev-search-memory` for external installs. They share source via the standard `package.json` mechanism (the example dir is the package source).

## Boundary against primitives

A reference impl is allowed to:

- import from `@pristine/shield-local` (the public barrel)
- import from any future split package (`@pristine/privacy-core`, `@pristine/memory-core`, etc.)
- declare its own dependencies, including LLM clients, harness SDKs, OS-specific utilities — anything outside Pristine

A reference impl is NOT allowed to:

- reach into `src/` paths via relative imports
- depend on internal modules that aren't exported through the public barrel
- modify SDK behavior (it composes; it does not extend)
- become canon: even a popular reference impl stays a reference. If the primitive surface needs to change, the change goes into `src/`, not into the reference.

## Why split this way

- **No conflation.** A reviewer (or `git log`, or a code-search) sees immediately whether a change belongs to a primitive or a harness adapter. Primitives stay in `src/`; adapters never do.
- **Per-harness lifecycle.** Each adapter can pin a specific SDK version, ship its own README/CI/release notes, and be owned by a different person from the SDK core.
- **Clean dep graph.** A pi-dev consumer who wants only the search-memory adapter does not have to install Claude Code's hook script or the SessionStart wrapper. Each `(harness, tool)` is independent.
- **Multiple harnesses, one primitive.** The SDK ships one `searcher.sql`; pi-dev, Claude Code, and Cursor each compose it differently in their respective `<harness>/search-memory/` dirs without forking the primitive.

## Relation to the privacy / tool-wrapper convention (PR #153 / Draft spec-006 §13)

The package convention proposed in PR #153 (`docs/specs/implementation-spec-006.md` §13, currently a Draft) for the privacy / tool-wrapper surface shares the **primitive/adapter axis** with this convention but uses a **different naming scheme**, scoped to a different concern:

| Aspect | PR #153 privacy/tool-wrapper convention | This convention |
|---|---|---|
| Engine | `@pristine/privacy-core` (focused privacy engine, intentionally extracted to avoid `sqlite-vec` / embedder deps) | `src/` SDK primitives, surfaced via `@pristine/shield-local` |
| Adapter | `@pristine/pi-privacy` (single-segment: harness only — the surface is privacy-only, so no second segment is needed to disambiguate tools) | `@pristine/<harness>-<tool>` (two segments: multiple tool concerns per harness, so both axes are named) |
| Source shape | PR #153 §13 names the package shape but does not propose a source-tree incubation layout; adapters live as separate packages | `examples/<harness>/<tool>/` is the entry shape, with package promotion later |
| Engine package split | Wants `@pristine/privacy-core` extracted from the full SDK so the privacy adapter doesn't pull in unrelated deps | This convention does not propose further SDK splits — references depend on `@pristine/shield-local` as it ships today |

**Both conventions share the primitive/adapter boundary** (engine in `src/`, adapters never in `src/`). The naming schemes differ because the surfaces differ: PR #153's privacy convention only needs to disambiguate harnesses (its tool segment is implicitly `privacy`), while this convention needs to disambiguate both harnesses and tools. The two conventions can ship simultaneously without conflict because they target different artifacts; if PR #153 lands, a privacy adapter ships as `@pristine/pi-privacy` and a search reference for the same harness ships as `@pristine/pi-dev-search-memory` — both names are unambiguous and self-describing within their own conventions.

## Inner layout (skills, extensions, hooks, scripts)

A reference impl in practice almost always spans **multiple harness primitives**. A `search-memory` reference for pi.dev might consist of a skill the LLM invokes, an extension that registers the tool handler, and a CLI script the skill calls. A Claude Code `session-start-hook` reference might combine a hook script, a skill, and an MCP server. The `<tool>` directory is the **bundle for one concern** — not for one file type.

Decompose by harness primitive **inside** the `<tool>` dir:

```
examples/<harness>/<tool>/
├── README.md               # "this is one way..." + bundle overview, wiring story
├── package.json            # depends on @pristine/shield-local
├── skills/                 # markdown skill files the harness loads
├── extensions/             # extension code (if the harness has extensions)
├── hooks/                  # hook handlers (event-triggered scripts)
├── commands/               # slash commands or CLI commands the harness exposes
├── mcp-servers/            # local MCP servers (if applicable)
├── sub-agents/             # sub-agent definitions (Claude Code, etc.)
├── scripts/                # CLI entry points the skills/hooks call
├── config/                 # example configs, settings, JSON-schema
└── tests/                  # smoke / integration tests
```

The **recognised inner subdir vocabulary** is `skills | extensions | hooks | commands | mcp-servers | sub-agents | scripts | config | tests`. Use only the subdirs that apply — a tool that's just a skill + a script doesn't need an empty `extensions/` dir.

### Example: `examples/pi-dev/search-memory/`

A pi.dev search-memory bundle composing a skill + extension + script:

```
examples/pi-dev/search-memory/
├── README.md
├── package.json
├── skills/
│   └── search-memory.md            # the skill the LLM invokes
├── extensions/
│   └── search-memory-extension.ts  # registers the tool handler with pi
└── scripts/
    └── search-memory.ts            # CLI the extension calls; wraps client.searcher.hybridSearch
```

### Example: `examples/claude-code/session-start-hook/`

A Claude Code SessionStart bundle that's just a hook + a skill:

```
examples/claude-code/session-start-hook/
├── README.md
├── package.json
└── hooks/
    └── session-start.ts            # called on `startup` matcher; wraps client.searcher.sql to pull recent summaries
```

### Why bundle by tool, not by primitive type

Two layouts were considered:

- **(A) chosen:** `<tool>` is the unit; `skills/` / `extensions/` / `hooks/` decompose inside. Result: one concern lives in one directory; consumers copy-paste the dir to get the full feature; the inner structure mirrors the harness's own primitive types so it feels native.
- **(B) rejected:** decompose by primitive at the top level (`examples/<harness>/skills/<tool>.md`, `examples/<harness>/extensions/<tool>.ts`, ...). Result: a single concern fragments across three dirs; "what is the search-memory reference impl?" no longer has a single home; consumers must hunt across three trees.

(A) is preferred because the unit of distribution and the unit of comprehension are the same — one tool, one dir. The harness-primitive split is an implementation detail of the bundle, not a top-level axis.

### README contents

Every `<tool>/README.md` opens with *"This is one way to use Pristine primitives. You can write your own."* and includes:

- **What this bundle does** (one sentence).
- **Which Pristine primitives it composes** (`searcher.sql`, `searcher.hybridSearch`, `storeAsync`, etc.).
- **Wiring story:** how the skill / extension / hook / script wire together at runtime — a 4-6 line description, ideally with a diagram fence if the wiring is non-obvious.
- **Install & config:** what to copy where (e.g., copy `skills/` into `~/.pi/skills/`), what env vars or config files to set.
- **Caveats / opinions baked in** (default limits, date formats, snippet escaping behaviour, etc.) — these are the parts a fork would adjust.

## When you write a new reference impl

Checklist:

1. **Is the work runtime-specific?** Does it know about pi hooks, Claude Code session lifecycle, Cursor command surface, or any other host-environment detail? → Yes: it's a reference impl, follow this convention.
2. **Pick the `<harness>` segment.** Use the canonical name the host uses for itself (`pi-dev`, `claude-code`, `cursor`).
3. **Pick the `<tool>` segment.** Use a verb-or-noun that describes the composition (`search-memory`, `session-start-hook`, `post-tool-use-ingest`). Hyphen-separated.
4. **Land in `examples/<harness>/<tool>/`** as the entry shape. Decompose internally by harness primitive (`skills/` / `extensions/` / `hooks/` / `commands/` / `mcp-servers/` / `sub-agents/` / `scripts/` / `config/` / `tests/`) — see "Inner layout" above for the recognised subdir vocabulary and examples. Include a README that opens with *"This is one way to use Pristine primitives. You can write your own."* and covers the wiring story, install steps, and baked-in opinions.
5. **Declare dependencies in a local `package.json`.** Depend on `@pristine/shield-local` (or whichever successor package the SDK ships under at the time) as a regular npm dep — never via relative path into `src/`.
6. **Promote to `@pristine/<harness>-<tool>` later.** Only when a downstream consumer wants `npm install`, OR when the example is stable enough that semver-managed release notes start mattering.

## When you change a primitive

Primitives belong in `src/`. If a reference impl wants behavior the primitive doesn't expose:

- **First option:** compose the existing primitives differently in the reference impl. Most "the SDK should do X" requests turn out to be compositional.
- **Second option:** extend the primitive's public surface in `src/` via a normal sprint, then have the reference impl consume the new surface. The reference does not absorb logic that belongs in the primitive.

## What does NOT live here

- LLM-specific prompt engineering and condensation logic — that's a reference impl detail, not a primitive concern. Lives in `examples/<harness>/session-summary-generator/` or similar.
- Harness-specific config-file layouts (`.cursorrules`, `~/.pi/...`, etc.) — same.
- One-off scripts a maintainer runs against their own DB during development — those live in `scripts/` (not under `examples/`) because they aren't intended as reference patterns.
