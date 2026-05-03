# Reference Implementation Layout

**Status:** active convention
**First codified:** sprint-019 (PR #169)

This document is the canonical reference for how Pristine separates **SDK primitives** from **reference implementations**. Both `docs/specs/implementation-spec-005.md` §5.2 (general reference impls) and `docs/specs/implementation-spec-006.md` §13 (privacy / tool-wrapper) point here for the boundary rules.

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

## Relation to the privacy / tool-wrapper convention (spec-006 §13)

The package convention proposed in `docs/specs/implementation-spec-006.md` §13 (PR #153) for the privacy / tool-wrapper surface is the **same axis** applied to a different concern:

| Aspect | Spec-006 privacy/tool-wrapper convention | This convention |
|---|---|---|
| Engine | `@pristine/privacy-core` (focused privacy engine) | `src/` SDK primitives |
| Adapter | `@pristine/pi-privacy` (thin pi adapter) | `@pristine/<harness>-<tool>` reference impls |
| Naming axis | `<harness>` (one segment, single concern: privacy) | `<harness>-<tool>` (two segments, multiple tool concerns per harness) |
| Source shape | (Spec-006 doesn't name a source-tree shape; adapters live as separate packages) | `examples/<harness>/<tool>/` is the entry shape, with package promotion later |

**Same primitive/adapter boundary**; different surface and naming granularity. Where spec-006 splits the SDK itself further (extracting `@pristine/privacy-core` so the privacy adapter doesn't pull in `sqlite-vec`/embedder deps), this convention doesn't propose further SDK splits — that decision lives in spec-006 and can be picked up if/when it actually matters for a reference impl. Both conventions can ship simultaneously without conflict because they target different artifacts.

## When you write a new reference impl

Checklist:

1. **Is the work runtime-specific?** Does it know about pi hooks, Claude Code session lifecycle, Cursor command surface, or any other host-environment detail? → Yes: it's a reference impl, follow this convention.
2. **Pick the `<harness>` segment.** Use the canonical name the host uses for itself (`pi-dev`, `claude-code`, `cursor`).
3. **Pick the `<tool>` segment.** Use a verb-or-noun that describes the composition (`search-memory`, `session-start-hook`, `post-tool-use-ingest`). Hyphen-separated.
4. **Land in `examples/<harness>/<tool>/`** as the entry shape. Include a README that opens with *"This is one way to use Pristine primitives. You can write your own."*
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
