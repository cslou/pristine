import type { SearchResult, RetrievalMetrics } from "./unified"
import type { IngestResult } from "./provider"
import type { ConcurrencyConfig } from "./concurrency"

export type PhaseStatus = "pending" | "in_progress" | "completed" | "failed"

export type PhaseId = "ingest" | "indexing" | "search" | "answer" | "evaluate" | "report"

export const PHASE_ORDER: PhaseId[] = [
  "ingest",
  "indexing",
  "search",
  "answer",
  "evaluate",
  "report",
]

export function getPhasesFromPhase(fromPhase: PhaseId): PhaseId[] {
  const startIndex = PHASE_ORDER.indexOf(fromPhase)
  if (startIndex === -1) return PHASE_ORDER
  return PHASE_ORDER.slice(startIndex)
}

export interface IngestPhaseCheckpoint {
  status: PhaseStatus
  completedSessions: string[]
  ingestResult?: IngestResult
  /**
   * Total memories created by the provider across all sessions of this
   * question's conversation. Populated by providers that report memoryCount
   * via IngestResult (Pristine). Since the benchmark dedupes ingest at the
   * conversation level, sibling questions sharing a conversation get the
   * same value when their checkpoints are cloned from the primary question.
   * Undefined for providers that do not report counts (filesystem, rag).
   */
  memoryCount?: number
  startedAt?: string
  completedAt?: string
  durationMs?: number
  error?: string
}

export interface IndexingPhaseCheckpoint {
  status: PhaseStatus
  completedIds?: string[]
  failedIds?: string[]
  startedAt?: string
  completedAt?: string
  durationMs?: number
  error?: string
}

export interface SearchPhaseCheckpoint {
  status: PhaseStatus
  resultFile?: string
  results?: SearchResult[]
  resultCount?: number
  startedAt?: string
  completedAt?: string
  durationMs?: number
  error?: string
}

export interface AnswerPhaseCheckpoint {
  status: PhaseStatus
  hypothesis?: string
  startedAt?: string
  completedAt?: string
  durationMs?: number
  error?: string
}

export interface EvaluatePhaseCheckpoint {
  status: PhaseStatus
  label?: "correct" | "incorrect"
  score?: number
  explanation?: string
  retrievalMetrics?: RetrievalMetrics
  startedAt?: string
  completedAt?: string
  durationMs?: number
  error?: string
}

export interface SessionMetadata {
  sessionId: string
  date?: string
  messageCount: number
}

export interface QuestionCheckpoint {
  questionId: string
  containerTag: string
  question: string
  groundTruth: string
  questionType: string
  questionDate?: string
  sessions?: SessionMetadata[]
  phases: {
    ingest: IngestPhaseCheckpoint
    indexing: IndexingPhaseCheckpoint
    search: SearchPhaseCheckpoint
    answer: AnswerPhaseCheckpoint
    evaluate: EvaluatePhaseCheckpoint
  }
}

export type RunStatus = "initializing" | "running" | "completed" | "failed"

export type SelectionMode = "full" | "sample" | "limit"
export type SampleType = "consecutive" | "random"

export interface SamplingConfig {
  mode: SelectionMode
  sampleType?: SampleType
  perCategory?: number
  limit?: number
}

export interface RunCheckpoint {
  runId: string
  dataSourceRunId: string
  status: RunStatus
  provider: string
  benchmark: string
  judge: string
  answeringModel: string
  createdAt: string
  updatedAt: string
  limit?: number
  sampling?: SamplingConfig
  targetQuestionIds?: string[]
  concurrency?: ConcurrencyConfig
  temporalMode?: string
  questionTypes?: string[]
  questions: Record<string, QuestionCheckpoint>
}
