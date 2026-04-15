import type { Provider, IndexingProgress } from "../../types/provider"
import type { RunCheckpoint, QuestionCheckpoint } from "../../types/checkpoint"
import { CheckpointManager } from "../checkpoint"
import { getConversationId } from "../index"
import { logger } from "../../utils/logger"
import { ConcurrentExecutor } from "../concurrent"
import { resolveConcurrency } from "../../types/concurrency"

function getEpisodeCount(question: QuestionCheckpoint): number {
  const ingestResult = question.phases.ingest.ingestResult
  if (!ingestResult) return 0
  return (ingestResult.documentIds?.length || 0) + (ingestResult.taskIds?.length || 0)
}

class IndexingProgressTracker {
  private progressByQuestion: Map<string, { completed: number; failed: number; total: number }> =
    new Map()
  private totalEpisodes: number = 0
  private lastDisplayed: string = ""

  constructor(questions: QuestionCheckpoint[]) {
    for (const q of questions) {
      const count = getEpisodeCount(q)
      this.totalEpisodes += count
      this.progressByQuestion.set(q.questionId, { completed: 0, failed: 0, total: count })
    }
  }

  update(questionId: string, progress: IndexingProgress): void {
    const current = this.progressByQuestion.get(questionId)
    if (current) {
      this.progressByQuestion.set(questionId, {
        completed: progress.completedIds.length,
        failed: progress.failedIds.length,
        total: progress.total,
      })
    }
    this.display()
  }

  markQuestionDone(questionId: string): void {
    const current = this.progressByQuestion.get(questionId)
    if (current) {
      this.progressByQuestion.set(questionId, {
        completed: current.total,
        failed: current.failed,
        total: current.total,
      })
    }
  }

  getAggregated(): { completed: number; failed: number; total: number } {
    let completed = 0
    let failed = 0
    for (const p of this.progressByQuestion.values()) {
      completed += p.completed
      failed += p.failed
    }
    return { completed, failed, total: this.totalEpisodes }
  }

  display(): void {
    const agg = this.getAggregated()
    const displayStr = `${agg.completed}/${agg.total}`
    if (displayStr !== this.lastDisplayed) {
      this.lastDisplayed = displayStr
      const percent = agg.total > 0 ? Math.round((agg.completed / agg.total) * 100) : 0
      const bar = "█".repeat(Math.floor(percent / 5)) + "░".repeat(20 - Math.floor(percent / 5))
      const failedStr = agg.failed > 0 ? ` (${agg.failed} failed)` : ""
      process.stdout.write(
        `\r\x1b[36m[${bar}]\x1b[0m ${percent}% Indexing: ${agg.completed}/${agg.total} episodes${failedStr}`
      )
    }
  }

  finish(): void {
    const agg = this.getAggregated()
    const failedStr = agg.failed > 0 ? ` (${agg.failed} failed)` : ""
    process.stdout.write(
      `\r\x1b[36m[${"█".repeat(20)}]\x1b[0m 100% Indexing: ${agg.completed}/${agg.total} episodes${failedStr}\n`
    )
  }

  getTotalEpisodes(): number {
    return this.totalEpisodes
  }
}

export async function runIndexingPhase(
  provider: Provider,
  checkpoint: RunCheckpoint,
  checkpointManager: CheckpointManager,
  questionIds?: string[]
): Promise<void> {
  const allQuestions = Object.values(checkpoint.questions)
  const targetQuestions = questionIds
    ? allQuestions.filter((q) => questionIds.includes(q.questionId))
    : allQuestions

  const toIndex = targetQuestions.filter(
    (q) => q.phases.ingest.status === "completed" && q.phases.indexing.status !== "completed"
  )

  if (toIndex.length === 0) {
    logger.info("No questions pending indexing")
    return
  }

  // Deduplicate by conversation: only one question per conversation needs awaitIndexing
  const indexedConversations = new Set<string>()
  for (const q of targetQuestions) {
    if (q.phases.indexing.status === "completed") {
      indexedConversations.add(getConversationId(q.questionId))
    }
  }

  const conversationPrimary = new Map<string, string>()
  for (const q of toIndex) {
    const convId = getConversationId(q.questionId)
    if (indexedConversations.has(convId)) continue
    if (!conversationPrimary.has(convId)) {
      conversationPrimary.set(convId, q.questionId)
    }
  }

  const primaryToIndex = toIndex.filter((q) => {
    const convId = getConversationId(q.questionId)
    return conversationPrimary.get(convId) === q.questionId
  })
  const siblingToIndex = toIndex.filter((q) => {
    const convId = getConversationId(q.questionId)
    return conversationPrimary.get(convId) !== q.questionId
  })

  const concurrency = resolveConcurrency("indexing", checkpoint.concurrency, provider.concurrency)

  const tracker = new IndexingProgressTracker(primaryToIndex)
  const totalEpisodes = tracker.getTotalEpisodes()

  logger.info(
    `Awaiting indexing for ${primaryToIndex.length} conversations, ${totalEpisodes} episodes (concurrency: ${concurrency})...`
  )

  tracker.display()

  await ConcurrentExecutor.execute(
    primaryToIndex,
    concurrency,
    checkpoint.runId,
    "indexing",
    async ({ item: question }) => {
      const ingestResult = question.phases.ingest.ingestResult
      const episodeCount = getEpisodeCount(question)

      if (!ingestResult || episodeCount === 0) {
        checkpointManager.updatePhase(checkpoint, question.questionId, "indexing", {
          status: "completed",
          completedIds: [],
          failedIds: [],
          completedAt: new Date().toISOString(),
          durationMs: 0,
        })
        tracker.markQuestionDone(question.questionId)
        return { questionId: question.questionId, durationMs: 0 }
      }

      const startTime = Date.now()
      checkpointManager.updatePhase(checkpoint, question.questionId, "indexing", {
        status: "in_progress",
        completedIds: [],
        failedIds: [],
        startedAt: new Date().toISOString(),
      })

      try {
        let lastProgress: IndexingProgress = {
          completedIds: [],
          failedIds: [],
          total: episodeCount,
        }

        await provider.awaitIndexing(ingestResult, question.containerTag, (progress) => {
          lastProgress = progress
          tracker.update(question.questionId, progress)

          checkpointManager.updatePhase(checkpoint, question.questionId, "indexing", {
            status: "in_progress",
            completedIds: progress.completedIds,
            failedIds: progress.failedIds,
          })
        })

        const durationMs = Date.now() - startTime
        checkpointManager.updatePhase(checkpoint, question.questionId, "indexing", {
          status: "completed",
          completedIds: lastProgress.completedIds,
          failedIds: lastProgress.failedIds,
          completedAt: new Date().toISOString(),
          durationMs,
        })

        return { questionId: question.questionId, durationMs }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        checkpointManager.updatePhase(checkpoint, question.questionId, "indexing", {
          status: "failed",
          error,
        })
        logger.error(`\nFailed to index ${question.questionId}: ${error}`)
        throw new Error(
          `Indexing failed at ${question.questionId}: ${error}. Fix the issue and resume with the same run ID.`
        )
      }
    }
  )

  // Mark sibling questions' indexing as completed
  for (const q of siblingToIndex) {
    const convId = getConversationId(q.questionId)
    const primaryQId = conversationPrimary.get(convId)

    const completedQId =
      primaryQId &&
      checkpointManager.getPhaseStatus(checkpoint, primaryQId, "indexing") === "completed"
        ? primaryQId
        : targetQuestions.find(
            (tq) =>
              getConversationId(tq.questionId) === convId &&
              checkpointManager.getPhaseStatus(checkpoint, tq.questionId, "indexing") === "completed"
          )?.questionId

    if (completedQId) {
      checkpointManager.updatePhase(checkpoint, q.questionId, "indexing", {
        status: "completed",
        completedIds: [],
        failedIds: [],
        completedAt: new Date().toISOString(),
        durationMs: 0,
      })
    }
  }

  tracker.finish()
  logger.success("Indexing phase complete")
}
