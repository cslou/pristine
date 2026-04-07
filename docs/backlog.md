# Backlog

Future work items not yet assigned to a sprint.

---

## CLI Setup Command

**Context:** Sprint 004d introduces `~/.pristine/models.json` as the source of truth for model configuration. Users create it manually or copy-paste from error messages. A CLI command would automate this.

**Scope:**
- `npx pristine-local setup ollama <model>` — pulls model via Ollama, writes `models.json`
- `npx pristine-local setup llamacpp <model>` — downloads GGUF from registry to `~/.pristine/models/`, writes `models.json` with the absolute path
- Interactive mode: `npx pristine-local setup` — asks which engine, which model, then does the above

**Depends on:** Sprint 004d (models.json), SDK packaging (Phase 7)

**Priority:** After SDK is shippable. This is onboarding UX, not core functionality.

---

## Per-Module Model Configuration

**Context:** Sprint 004d `models.json` has `privacy` and `memory` fields that can point to different models. Initially both will use the same model. When we have benchmarks showing that a smaller model works for classification but extraction needs a larger one, this becomes useful.

**Depends on:** Sprint 004d, benchmarks (Phase 8)

**Priority:** Low. Only matters when we have data showing model-per-pipeline improves quality or performance.
