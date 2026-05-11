# Reference Implementation Layout

**Status:** active convention
**First codified:** sprint-019 (PR #169)

This document is the canonical reference for how Pristine separates **SDK primitives** from **reference implementations**. `docs/specs/implementation-spec-005.md` §5.2 cross-references this doc for the layout convention; `implementation-spec-006.md` §13 (currently a Draft in PR #153) is a related but independent convention covering the privacy / tool-wrapper surface — the two share the primitive/adapter axis but use different naming schemes (see "Relation to the privacy / tool-wrapper convention" below).

---

## TL;DR

- **Primitives** live in `src/`. They are runtime-agnostic: no host-environment knowledge, no harness-specific glue.
- **Reference implementations** never live in `src/`. They live in `examples/<harness>/<artifact-type>/<tool>/` while incubating and graduate to `@pristine/<harness>-<tool>` published packages when they ship externally.
- A reference impl depends on `@pristine/shield-local` (or its successors) the way any external consumer would. **It never reaches into `src/` internals.** That is the only invariant that matters.

---

## The `(harness, artifact type, tool)` source axis

Every source-tree reference impl is named by a visible harness/artifact/tool path:

| Segment | What it names | Examples |
|---|---|---|
| `<harness>` | The host environment the reference targets | `pi-dev`, `claude-code`, `cursor`, `cline` |
| `<artifact-type>` | The host artifact category users install or copy | `extensions`, `skills`, `hooks`, `commands` |
| `<tool>` | The reference itself | `search-memory`, `query-memory`, `session-start-hook`, `post-tool-use-ingest` |

Published package names still use the two semantic segments (`@pristine/<harness>-<tool>`). The artifact-type directory is for source-tree discoverability: users should be able to tell whether an example is an extension, skill, hook, or command before reading prose.

## Two artifact shapes

### Source-tree examples (initial / incubating)

```
examples/
├── pi-dev/
│   ├── extensions/
│   │   ├── search-memory/
│   │   └── jsonl-index/
│   ├── skills/
│   │   └── search-session-history/
│   └── shared/
├── claude-code/
│   └── hooks/
│       └── session-start-hook/
└── cursor/
    └── hooks/
        └── post-tool-use-ingest/
```

- **Use this shape first.** Easiest to iterate, easiest to fork, lowest packaging overhead.
- Each `<artifact-type>/<tool>/` directory is self-contained when it is user-installable: source, README, smoke test (where applicable), example config. Shared helper folders can exist beside artifact-type folders, but they must be documented as support code rather than loadable host artifacts.
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

The two shapes coexist. A reference impl can be both: live as `examples/pi-dev/extensions/search-memory/` for in-repo iteration AND publish `@pristine/pi-dev-search-memory` for external installs. They share source via the standard `package.json` mechanism (the example dir is the package source).

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
- **Clean dep graph.** A pi-dev consumer who wants only the search-memory adapter does not have to install Claude Code's hook script or the SessionStart wrapper. Each installable `(harness, tool)` is independent.
- **Multiple harnesses, one primitive.** The SDK ships one `searcher.sql`; pi-dev, Claude Code, and Cursor each compose it differently in their respective harness artifact directories without forking the primitive.

## Relation to the privacy / tool-wrapper convention (PR #153 / Draft spec-006 §13)

The package convention proposed in PR #153 (`docs/specs/implementation-spec-006.md` §13, currently a Draft) for the privacy / tool-wrapper surface shares the **primitive/adapter axis** with this convention but uses a **different naming scheme**, scoped to a different concern:

| Aspect | PR #153 privacy/tool-wrapper convention | This convention |
|---|---|---|
| Engine | `@pristine/privacy-core` (focused privacy engine, intentionally extracted to avoid `sqlite-vec` / embedder deps) | `src/` SDK primitives, surfaced via `@pristine/shield-local` |
| Adapter | `@pristine/pi-privacy` (single-segment: harness only — the surface is privacy-only, so no second segment is needed to disambiguate tools) | `@pristine/<harness>-<tool>` (two segments: multiple tool concerns per harness, so both axes are named) |
| Source shape | PR #153 §13 names the package shape but does not propose a source-tree incubation layout; adapters live as separate packages | `examples/<harness>/<artifact-type>/<tool>/` is the entry shape, with package promotion later |
| Engine package split | Wants `@pristine/privacy-core` extracted from the full SDK so the privacy adapter doesn't pull in unrelated deps | This convention does not propose further SDK splits — references depend on `@pristine/shield-local` as it ships today |

**Both conventions share the primitive/adapter boundary** (engine in `src/`, adapters never in `src/`). The naming schemes differ because the surfaces differ: PR #153's privacy convention only needs to disambiguate harnesses (its tool segment is implicitly `privacy`), while this convention needs to disambiguate both harnesses and tools. The two conventions can ship simultaneously without conflict because they target different artifacts; if PR #153 lands, a privacy adapter ships as `@pristine/pi-privacy` and a search reference for the same harness ships as `@pristine/pi-dev-search-memory` — both names are unambiguous and self-describing within their own conventions.

## When you write a new reference impl

Checklist:

1. **Is the work runtime-specific?** Does it know about pi hooks, Claude Code session lifecycle, Cursor command surface, or any other host-environment detail? → Yes: it's a reference impl, follow this convention.
2. **Pick the `<harness>` segment.** Use the canonical name the host uses for itself (`pi-dev`, `claude-code`, `cursor`).
3. **Pick the `<artifact-type>` segment.** Use the host category users recognize and install (`extensions`, `skills`, `hooks`, `commands`).
4. **Pick the `<tool>` segment.** Use a verb-or-noun that describes the composition (`search-memory`, `session-start-hook`, `post-tool-use-ingest`). Hyphen-separated.
5. **Land in `examples/<harness>/<artifact-type>/<tool>/`** as the entry shape. Include a README for human-facing installable artifacts that opens with *"This is one way to use Pristine primitives. You can write your own."*
6. **Declare dependencies in a local `package.json`.** Depend on `@pristine/shield-local` (or whichever successor package the SDK ships under at the time) as a regular npm dep — never via relative path into `src/`.
7. **Promote to `@pristine/<harness>-<tool>` later.** Only when a downstream consumer wants `npm install`, OR when the example is stable enough that semver-managed release notes start mattering.

## When you change a primitive

Primitives belong in `src/`. If a reference impl wants behavior the primitive doesn't expose:

- **First option:** compose the existing primitives differently in the reference impl. Most "the SDK should do X" requests turn out to be compositional.
- **Second option:** extend the primitive's public surface in `src/` via a normal sprint, then have the reference impl consume the new surface. The reference does not absorb logic that belongs in the primitive.

## What does NOT live here

- LLM-specific prompt engineering and condensation logic — that's a reference impl detail, not a primitive concern. Lives in `examples/<harness>/<artifact-type>/session-summary-generator/` or similar.
- Harness-specific config-file layouts (`.cursorrules`, `~/.pi/...`, etc.) — same.
- One-off scripts a maintainer runs against their own DB during development — those live in `scripts/` (not under `examples/`) because they aren't intended as reference patterns.
