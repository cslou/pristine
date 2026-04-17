import { describe, test, expect } from "bun:test"
import { assertIngestProducedMemories } from "./index"
import type { RunCheckpoint, QuestionCheckpoint } from "../types/checkpoint"

function makeCheckpoint(
  questions: Record<
    string,
    { memoryCount?: number; conversationId?: string }
  >
): RunCheckpoint {
  const questionCheckpoints: Record<string, QuestionCheckpoint> = {}
  for (const [qid, meta] of Object.entries(questions)) {
    questionCheckpoints[qid] = {
      questionId: qid,
      containerTag: `conv-${meta.conversationId ?? qid}-test`,
      question: "",
      groundTruth: "",
      questionType: "single_hop",
      phases: {
        ingest: {
          status: "completed",
          completedSessions: [],
          ...(meta.memoryCount !== undefined ? { memoryCount: meta.memoryCount } : {}),
        },
        indexing: { status: "pending" },
        search: { status: "pending" },
        answer: { status: "pending" },
        evaluate: { status: "pending" },
      },
    } as unknown as QuestionCheckpoint
  }
  return {
    runId: "test",
    dataSourceRunId: "test",
    provider: "pristine",
    benchmark: "locomo",
    judgeModel: "test",
    status: "running",
    questions: questionCheckpoints,
  } as unknown as RunCheckpoint
}

describe("assertIngestProducedMemories", () => {
  test("throws when every reporting conversation has memoryCount=0", () => {
    const checkpoint = makeCheckpoint({
      "42-q0": { memoryCount: 0, conversationId: "42" },
      "42-q1": { memoryCount: 0, conversationId: "42" },
      "99-q0": { memoryCount: 0, conversationId: "99" },
    })
    expect(() => assertIngestProducedMemories(checkpoint)).toThrow(
      /Ingest produced 0 memories across all conversations/
    )
  })

  test("does NOT throw when at least one conversation has non-zero memoryCount", () => {
    const checkpoint = makeCheckpoint({
      "42-q0": { memoryCount: 0, conversationId: "42" },
      "99-q0": { memoryCount: 5, conversationId: "99" },
    })
    expect(() => assertIngestProducedMemories(checkpoint)).not.toThrow()
  })

  test("does NOT throw when no provider reported a memoryCount (filesystem/rag path)", () => {
    const checkpoint = makeCheckpoint({
      "42-q0": { conversationId: "42" }, // undefined memoryCount
      "99-q0": { conversationId: "99" },
    })
    expect(() => assertIngestProducedMemories(checkpoint)).not.toThrow()
  })

  test("only counts each conversation once (sibling questions are deduped)", () => {
    // Three questions share conv 42, all reporting 0. One question on conv 99
    // reports 3. Total is 3, not 0, so must NOT throw.
    const checkpoint = makeCheckpoint({
      "42-q0": { memoryCount: 0, conversationId: "42" },
      "42-q1": { memoryCount: 0, conversationId: "42" },
      "42-q2": { memoryCount: 0, conversationId: "42" },
      "99-q0": { memoryCount: 3, conversationId: "99" },
    })
    expect(() => assertIngestProducedMemories(checkpoint)).not.toThrow()
  })

  test("respects targetQuestionIds filter", () => {
    // Checkpoint has some conversations with memory and some without.
    // Only the zero-memory one is in the target set → must throw.
    const checkpoint = makeCheckpoint({
      "42-q0": { memoryCount: 0, conversationId: "42" },
      "99-q0": { memoryCount: 10, conversationId: "99" },
    })
    expect(() => assertIngestProducedMemories(checkpoint, ["42-q0"])).toThrow(
      /0 memories across all conversations/
    )
    expect(() => assertIngestProducedMemories(checkpoint, ["99-q0"])).not.toThrow()
  })

  test("handles missing question ids in the target set gracefully", () => {
    const checkpoint = makeCheckpoint({
      "42-q0": { memoryCount: 5, conversationId: "42" },
    })
    expect(() =>
      assertIngestProducedMemories(checkpoint, ["42-q0", "missing-q0"])
    ).not.toThrow()
  })
})
