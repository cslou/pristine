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
// searcher primitives (spec-005 §5.1). It will return once indexer +
// searcher land — likely sprint-015 / sprint-016.
//
// Until then, this file exports a throw-on-construct stub so any benchmark
// run that still references the provider fails loudly with an actionable
// message rather than dereferencing `undefined`.

import type { Provider, ProviderConfig } from '../../types/provider'

export class PristineProvider implements Provider {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public constructor(_config: ProviderConfig) {
    throw new Error(
      'PristineProvider is disabled under spec-005 Phase 1 (sprint-013). ' +
        'The LOCOMO-aimed fact-pipeline that this provider drove was removed; ' +
        'the provider will return once the Phase-2 indexer + Phase-3/4 searcher ' +
        'primitives land. See docs/specs/implementation-spec-005.md §5.1 and ' +
        'docs/sprints/sprint-013.md for context.',
    )
  }

  public readonly name = 'pristine'

  public async ingest(): Promise<never> {
    throw new Error('PristineProvider.ingest: disabled — see constructor error.')
  }

  public async search(): Promise<never> {
    throw new Error('PristineProvider.search: disabled — see constructor error.')
  }

  public async cleanup(): Promise<void> {
    // no-op — the stub never acquired resources
  }
}
