// Pristine Provider — disabled while the benchmark adapter is rebuilt.
//
// The prior implementation drove an older LOCOMO-aimed fact-extraction pipeline
// that no longer matches Pristine's public source-pointer memory API. Rebuilding
// this provider requires a benchmark adapter around the current store/recall/forget
// primitives.
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
  "PristineProvider is disabled while the benchmark adapter is rebuilt around " +
  "the current public source-pointer memory API."

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
