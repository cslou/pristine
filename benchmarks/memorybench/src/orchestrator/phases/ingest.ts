import type { Provider, IngestResult } from "../../types/provider"
import type { Benchmark } from "../../types/benchmark"
import type { RunCheckpoint } from "../../types/checkpoint"
import { CheckpointManager } from "../checkpoint"
import { getConversationId } from "../index"
import { logger } from "../../utils/logger"
import { ConcurrentExecutor } from "../concurrent"
import { resolveConcurrency } from "../../types/concurrency"

const RATE_LIMIT_MS = 1000

/**
 * Detect old-format checkpoints where containerTag was per-question.
 * Old format: "{questionId}-{runId}" e.g. "42-q0-run123"
 * New format: "conv-{conversationId}-{runId}" e.g. "conv-42-run123"
 */
function detectOldCheckpointFormat(checkpoint: RunCheckpoint): boolean {
  const questions = Object.values(checkpoint.questions)
  if (questions.length === 0) return false
  return questions.some((q) => !q.containerTag.startsWith("conv-"))
}

export async function runIngestPhase(
  provider: Provider,
  benchmark: Benchmark,
  checkpoint: RunCheckpoint,
  checkpointManager: CheckpointManager,
  questionIds?: string[]
): Promise<void> {
  if (detectOldCheckpointFormat(checkpoint)) {
    throw new Error(
      "Checkpoint uses old per-question containerTag format. " +
        "Use --force to start a fresh run with per-conversation deduplication."
    )
  }

  const questions = benchmark.getQuestions()
  const targetQuestions = questionIds
    ? questions.filter((q) => questionIds.includes(q.questionId))
    : questions

  // Group questions by conversation. Only the first question per conversation
  // actually ingests; siblings are marked completed immediately.
  const conversationPrimary = new Map<string, string>()
  const ingestedConversations = new Set<string>()

  // Check which conversations already have a completed ingestion
  for (const q of targetQuestions) {
    const convId = getConversationId(q.questionId)
    const status = checkpointManager.getPhaseStatus(checkpoint, q.questionId, "ingest")
    if (status === "completed") {
      ingestedConversations.add(convId)
    }
  }

  // Assign primary question per conversation (first pending question)
  for (const q of targetQuestions) {
    const convId = getConversationId(q.questionId)
    if (ingestedConversations.has(convId)) continue
    if (!conversationPrimary.has(convId)) {
      conversationPrimary.set(convId, q.questionId)
    }
  }

  // Filter to: primary questions that need ingestion + sibling questions that need marking
  const pendingQuestions = targetQuestions.filter((q) => {
    const status = checkpointManager.getPhaseStatus(checkpoint, q.questionId, "ingest")
    return status !== "completed"
  })

  if (pendingQuestions.length === 0) {
    logger.info("No questions pending ingestion")
    return
  }

  // Separate primary (actually ingest) from siblings (mark completed after primary)
  const primaryQuestions = pendingQuestions.filter((q) => {
    const convId = getConversationId(q.questionId)
    return conversationPrimary.get(convId) === q.questionId
  })
  const siblingQuestions = pendingQuestions.filter((q) => {
    const convId = getConversationId(q.questionId)
    return conversationPrimary.get(convId) !== q.questionId
  })

  const uniqueConversations = new Set(primaryQuestions.map((q) => getConversationId(q.questionId)))
  logger.info(
    `Ingesting ${uniqueConversations.size} conversations for ${pendingQuestions.length} questions...`
  )

  const concurrency = resolveConcurrency("ingest", checkpoint.concurrency, provider.concurrency)

  // Ingest primary questions (one per conversation)
  await ConcurrentExecutor.executeBatched({
    items: primaryQuestions,
    concurrency,
    rateLimitMs: RATE_LIMIT_MS,
    runId: checkpoint.runId,
    phaseName: "ingest",
    continueOnError: true,
    executeTask: async ({ item: question, index, total }) => {
      const containerTag = checkpoint.questions[question.questionId].containerTag
      const sessions = benchmark.getHaystackSessions(question.questionId)

      const sessionsMetadata = sessions.map((s) => ({
        sessionId: s.sessionId,
        date: s.metadata?.date as string | undefined,
        messageCount: s.messages.length,
      }))
      checkpointManager.updateSessions(checkpoint, question.questionId, sessionsMetadata)

      const startTime = Date.now()
      checkpointManager.updatePhase(checkpoint, question.questionId, "ingest", {
        status: "in_progress",
        startedAt: new Date().toISOString(),
      })

      try {
        const completedSessions =
          checkpoint.questions[question.questionId].phases.ingest.completedSessions
        const combinedResult: IngestResult = { documentIds: [], taskIds: [] }

        for (const session of sessions) {
          if (completedSessions.includes(session.sessionId)) {
            continue
          }

          const result = await provider.ingest([session], { containerTag })

          combinedResult.documentIds.push(...result.documentIds)
          if (result.taskIds) {
            combinedResult.taskIds!.push(...result.taskIds)
          }

          completedSessions.push(session.sessionId)
          checkpointManager.updatePhase(checkpoint, question.questionId, "ingest", {
            completedSessions,
          })
        }

        if (combinedResult.taskIds && combinedResult.taskIds.length === 0) {
          delete combinedResult.taskIds
        }

        const existingResult = checkpoint.questions[question.questionId].phases.ingest.ingestResult
        if (existingResult) {
          combinedResult.documentIds = [
            ...existingResult.documentIds,
            ...combinedResult.documentIds,
          ]
          if (existingResult.taskIds || combinedResult.taskIds) {
            combinedResult.taskIds = [
              ...(existingResult.taskIds || []),
              ...(combinedResult.taskIds || []),
            ]
          }
        }

        const durationMs = Date.now() - startTime
        checkpointManager.updatePhase(checkpoint, question.questionId, "ingest", {
          status: "completed",
          ingestResult: combinedResult,
          completedAt: new Date().toISOString(),
          durationMs,
        })

        const convId = getConversationId(question.questionId)
        logger.progress(
          index + 1,
          total,
          `Ingested conversation ${convId} (${sessions.length} sessions, ${durationMs}ms)`
        )

        return { questionId: question.questionId, durationMs }
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e)
        checkpointManager.updatePhase(checkpoint, question.questionId, "ingest", {
          status: "failed",
          error,
        })
        logger.error(`Failed to ingest ${question.questionId}: ${error}`)
        return { questionId: question.questionId, durationMs: Date.now() - startTime }
      }
    },
  })

  // Mark sibling questions as completed (they share the conversation container)
  for (const q of siblingQuestions) {
    const convId = getConversationId(q.questionId)
    const primaryQId = conversationPrimary.get(convId)

    // Find a completed primary or any completed sibling for this conversation
    const completedQId =
      primaryQId && checkpointManager.getPhaseStatus(checkpoint, primaryQId, "ingest") === "completed"
        ? primaryQId
        : targetQuestions.find(
            (tq) =>
              getConversationId(tq.questionId) === convId &&
              checkpointManager.getPhaseStatus(checkpoint, tq.questionId, "ingest") === "completed"
          )?.questionId

    if (completedQId) {
      const sourceCheckpoint = checkpoint.questions[completedQId].phases.ingest
      checkpointManager.updatePhase(checkpoint, q.questionId, "ingest", {
        status: "completed",
        completedSessions: [...sourceCheckpoint.completedSessions],
        ingestResult: sourceCheckpoint.ingestResult,
        completedAt: new Date().toISOString(),
        durationMs: 0,
      })
    }
  }

  logger.success("Ingest phase complete")
}
