import type {
  Consolidator,
  Embedder,
  Extractor,
  QueryAnalyzer,
  Retriever,
  Store,
} from '../../core/interfaces.js';

export type { Orchestrator } from '../../core/interfaces.js';
export type {
  IngestOptions,
  IngestResult,
  PipelineContext,
  PipelineStep,
  StepError,
} from '../../core/types.js';

// ---------------------------------------------------------------------------
// Orchestrator Config (locally defined — references interfaces)
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  readonly extractor: Extractor;
  readonly embedder: Embedder;
  readonly store: Store;
  readonly consolidator: Consolidator;
  readonly retriever: Retriever;
  readonly queryAnalyzer: QueryAnalyzer;
  readonly appControlledResolve?: boolean;
}
