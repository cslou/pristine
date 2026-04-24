// Pristine Provider — DEPRECATED under spec-005 Phase 1.
//
// The prior implementation drove the LOCOMO-aimed fact-extraction pipeline
// via PristineLocal.store() and PristineLocal.search() / orchestrator.ingest().
// sprint-013 (spec-005 Phase 1) removed the pipeline entirely:
//   - client.store() / client.search() deleted
//   - client.orchestrator is null on every construction path
//   - findConversationByMessages() / deleteConversation() deleted
//
// Rebuilding this provider requires the Phase-2 indexer and Phase-3/4
// searcher primitives (spec-005 §5.1). It will return once those land.
//
// Until then, this stub satisfies the `Provider` interface (zero-arg
// constructor + full method set) so the benchmarks package typechecks
// cleanly and the provider registry at `src/providers/index.ts` accepts
// it as a first-class entry. Every method throws on call with an
// actionable message — the registry can still construct the instance,
// but any run that selects `pristine` fails loudly at `initialize()`.

import type { Provider, ProviderConfig, IngestOptions, IngestResult, SearchOptions, IndexingProgressCallback } from "../../types/provider"
import type { UnifiedSession } from "../../types/unified"

const DEPRECATION_MESSAGE =
  "PristineProvider is disabled under spec-005 Phase 1 (sprint-013). " +
  "The LOCOMO-aimed fact-pipeline that this provider drove was removed; " +
  "the provider will return once the Phase-2 indexer + Phase-3/4 searcher " +
  "primitives land. See docs/specs/implementation-spec-005.md §5.1 and " +
  "docs/sprints/sprint-013.md for context."

export class PristineProvider implements Provider {
  public readonly name = "pristine"

  public async initialize(_config: ProviderConfig): Promise<void> {
    throw new Error(DEPRECATION_MESSAGE)
  }

  public async ingest(_sessions: UnifiedSession[], _options: IngestOptions): Promise<IngestResult> {
    throw new Error(DEPRECATION_MESSAGE)
  }

  public async awaitIndexing(
    _result: IngestResult,
    _containerTag: string,
    _onProgress?: IndexingProgressCallback,
  ): Promise<void> {
    throw new Error(DEPRECATION_MESSAGE)
  }

  public async search(_query: string, _options: SearchOptions): Promise<unknown[]> {
    throw new Error(DEPRECATION_MESSAGE)
  }

  public async clear(_containerTag: string): Promise<void> {
    throw new Error(DEPRECATION_MESSAGE)
  }

  public async shutdown(): Promise<void> {
    // no-op — the stub never acquired resources
  }
}

export default PristineProvider
