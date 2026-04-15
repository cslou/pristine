import { describe, test, expect, mock } from "bun:test"
import { getConversationId } from "./index"
import type { RunCheckpoint } from "../types/checkpoint"
import type { Provider, IngestResult } from "../types/provider"
import type { Benchmark } from "../types/benchmark"
import type { UnifiedSession, UnifiedQuestion } from "../types/unified"
import { CheckpointManager } from "./checkpoint"
import { runIngestPhase } from "./phases/ingest"
import { mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

describe("getConversationId", () => {
  test("extracts conversation ID from LOCOMO questionId format", () => {
    expect(getConversationId("42-q0")).toBe("42")
    expect(getConversationId("42-q1")).toBe("42")
    expect(getConversationId("100-q15")).toBe("100")
  })

  test("returns full string for non-matching format", () => {
    expect(getConversationId("standalone")).toBe("standalone")
    expect(getConversationId("no-questions-here")).toBe("no-questions-here")
  })
})

describe("containerTag per-conversation deduplication", () => {
  test("all questions from same conversation get same containerTag", () => {
    const checkpointManager = new CheckpointManager(join(tmpdir(), "mb-test-" + Date.now()))
    const checkpoint = checkpointManager.create(
      "test-run",
      "test-provider",
      "locomo",
      "gpt-4o",
      "gpt-4o"
    )

    // Simulate what orchestrator.run does for 3 questions from conversation 42
    for (const qId of ["42-q0", "42-q1", "42-q2"]) {
      const conversationId = getConversationId(qId)
      const containerTag = `conv-${conversationId}-${checkpoint.dataSourceRunId}`
      checkpointManager.initQuestion(checkpoint, qId, containerTag, {
        question: "test",
        groundTruth: "test",
        questionType: "single-hop",
      })
    }

    expect(checkpoint.questions["42-q0"].containerTag).toBe("conv-42-test-run")
    expect(checkpoint.questions["42-q1"].containerTag).toBe("conv-42-test-run")
    expect(checkpoint.questions["42-q2"].containerTag).toBe("conv-42-test-run")
  })

  test("different conversations get different containerTags", () => {
    const checkpointManager = new CheckpointManager(join(tmpdir(), "mb-test-" + Date.now()))
    const checkpoint = checkpointManager.create(
      "test-run",
      "test-provider",
      "locomo",
      "gpt-4o",
      "gpt-4o"
    )

    for (const qId of ["42-q0", "99-q0"]) {
      const conversationId = getConversationId(qId)
      const containerTag = `conv-${conversationId}-${checkpoint.dataSourceRunId}`
      checkpointManager.initQuestion(checkpoint, qId, containerTag, {
        question: "test",
        groundTruth: "test",
        questionType: "single-hop",
      })
    }

    expect(checkpoint.questions["42-q0"].containerTag).toBe("conv-42-test-run")
    expect(checkpoint.questions["99-q0"].containerTag).toBe("conv-99-test-run")
  })

  test("ingest phase calls provider.ingest only once per conversation", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mb-ingest-"))
    try {
      const checkpointManager = new CheckpointManager(tempDir)
      const checkpoint = checkpointManager.create(
        "test-run",
        "test-provider",
        "locomo",
        "gpt-4o",
        "gpt-4o"
      )

      // 2 conversations: conv-42 (3 questions, 2 sessions) and conv-99 (2 questions, 1 session)
      const sessions42: UnifiedSession[] = [
        { sessionId: "s1", messages: [{ role: "user", content: "hello" }] },
        { sessionId: "s2", messages: [{ role: "user", content: "world" }] },
      ]
      const sessions99: UnifiedSession[] = [
        { sessionId: "s3", messages: [{ role: "user", content: "foo" }] },
      ]

      const questions: UnifiedQuestion[] = [
        {
          questionId: "42-q0",
          question: "q1",
          questionType: "single-hop",
          groundTruth: "a1",
          haystackSessionIds: ["s1", "s2"],
        },
        {
          questionId: "42-q1",
          question: "q2",
          questionType: "multi-hop",
          groundTruth: "a2",
          haystackSessionIds: ["s1", "s2"],
        },
        {
          questionId: "42-q2",
          question: "q3",
          questionType: "temporal",
          groundTruth: "a3",
          haystackSessionIds: ["s1", "s2"],
        },
        {
          questionId: "99-q0",
          question: "q4",
          questionType: "single-hop",
          groundTruth: "a4",
          haystackSessionIds: ["s3"],
        },
        {
          questionId: "99-q1",
          question: "q5",
          questionType: "multi-hop",
          groundTruth: "a5",
          haystackSessionIds: ["s3"],
        },
      ]

      // Init all questions in checkpoint
      for (const q of questions) {
        const conversationId = getConversationId(q.questionId)
        const containerTag = `conv-${conversationId}-${checkpoint.dataSourceRunId}`
        checkpointManager.initQuestion(checkpoint, q.questionId, containerTag, {
          question: q.question,
          groundTruth: q.groundTruth,
          questionType: q.questionType,
        })
      }

      // Track provider.ingest calls
      let ingestCallCount = 0
      const ingestedContainerTags = new Set<string>()

      const mockProvider: Provider = {
        name: "test",
        async initialize() {},
        async ingest(
          _sessions: UnifiedSession[],
          options: { containerTag: string }
        ): Promise<IngestResult> {
          ingestCallCount++
          ingestedContainerTags.add(options.containerTag)
          return { documentIds: [`doc-${ingestCallCount}`] }
        },
        async awaitIndexing() {},
        async search() {
          return []
        },
        async clear() {},
      }

      const sessionsMap = new Map<string, UnifiedSession[]>([
        ["42-q0", sessions42],
        ["42-q1", sessions42],
        ["42-q2", sessions42],
        ["99-q0", sessions99],
        ["99-q1", sessions99],
      ])

      const mockBenchmark: Benchmark = {
        name: "locomo",
        async load() {},
        getQuestions: () => questions,
        getHaystackSessions: (qId: string) => sessionsMap.get(qId) || [],
        getGroundTruth: () => "",
        getQuestionTypes: () => ({}),
      }

      await runIngestPhase(
        mockProvider,
        mockBenchmark,
        checkpoint,
        checkpointManager,
        questions.map((q) => q.questionId)
      )

      // Should ingest 3 sessions total (2 for conv-42 + 1 for conv-99),
      // NOT 7 (2*3 + 1*2 per question)
      expect(ingestCallCount).toBe(3)

      // Should use only 2 unique containerTags (one per conversation)
      expect(ingestedContainerTags.size).toBe(2)
      expect(ingestedContainerTags.has("conv-42-test-run")).toBe(true)
      expect(ingestedContainerTags.has("conv-99-test-run")).toBe(true)

      // All 5 questions should be marked as completed
      for (const q of questions) {
        const status = checkpointManager.getPhaseStatus(checkpoint, q.questionId, "ingest")
        expect(status).toBe("completed")
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  test("old-format checkpoint is detected and rejected", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "mb-old-"))
    try {
      const checkpointManager = new CheckpointManager(tempDir)
      const checkpoint = checkpointManager.create(
        "test-run",
        "test-provider",
        "locomo",
        "gpt-4o",
        "gpt-4o"
      )

      // Init with OLD format containerTag (per-question)
      checkpointManager.initQuestion(checkpoint, "42-q0", "42-q0-test-run", {
        question: "q1",
        groundTruth: "a1",
        questionType: "single-hop",
      })

      const mockProvider: Provider = {
        name: "test",
        async initialize() {},
        async ingest(): Promise<IngestResult> {
          return { documentIds: [] }
        },
        async awaitIndexing() {},
        async search() {
          return []
        },
        async clear() {},
      }

      const mockBenchmark: Benchmark = {
        name: "locomo",
        async load() {},
        getQuestions: () => [
          {
            questionId: "42-q0",
            question: "q1",
            questionType: "single-hop",
            groundTruth: "a1",
            haystackSessionIds: ["s1"],
          },
        ],
        getHaystackSessions: () => [],
        getGroundTruth: () => "",
        getQuestionTypes: () => ({}),
      }

      await expect(
        runIngestPhase(mockProvider, mockBenchmark, checkpoint, checkpointManager, ["42-q0"])
      ).rejects.toThrow("old per-question containerTag format")
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })
})
