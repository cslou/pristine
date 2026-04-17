import { describe, test, expect, afterEach, spyOn } from "bun:test"
import { PristineProvider } from "./index"
import { logger } from "../../utils/logger"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"

const PRISTINE_DB_ROOT = join(process.cwd(), "data", "pristine-dbs")

type PrivateProvider = {
  dataSourceRunId: string | null
  clients: Map<string, { dispose: () => Promise<void> }>
  pristineModule: unknown
  getDbPath(containerTag: string, ensureDir?: boolean): string
}

function asPrivate(p: PristineProvider): PrivateProvider {
  return p as unknown as PrivateProvider
}

function createDisposeSpy() {
  let calls = 0
  return {
    dispose: async () => {
      calls += 1
    },
    get calls() {
      return calls
    },
  }
}

const testRuns: string[] = []

function cleanupTestRun(runId: string) {
  const dir = join(PRISTINE_DB_ROOT, runId)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
}

afterEach(() => {
  for (const runId of testRuns) cleanupTestRun(runId)
  testRuns.length = 0
})

describe("PristineProvider path derivation", () => {
  test("getDbPath uses dataSourceRunId from initialize, not containerTag parsing", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    // LOCOMO-shaped containerTag: conv-{sampleId}-{runId} where sampleId = "conv-26"
    const path = asPrivate(provider).getDbPath("conv-conv-26-run-A")

    expect(path).toContain(join("data", "pristine-dbs", "run-A"))
    // Sanitized filename preserves the containerTag shape (hyphens kept)
    expect(path.endsWith("conv-conv-26-run-A.db")).toBe(true)
  })

  test("different dataSourceRunId yields different DB folder", async () => {
    const providerA = new PristineProvider()
    await providerA.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    const providerB = new PristineProvider()
    await providerB.initialize({ apiKey: "none", dataSourceRunId: "run-B" })
    testRuns.push("run-B")

    const pathA = asPrivate(providerA).getDbPath("conv-26-run-A", false)
    const pathB = asPrivate(providerB).getDbPath("conv-26-run-B", false)

    expect(pathA).toContain(join("pristine-dbs", "run-A"))
    expect(pathB).toContain(join("pristine-dbs", "run-B"))
    expect(pathA).not.toBe(pathB)
  })

  test("getDbPath throws before initialize", () => {
    const provider = new PristineProvider()
    expect(() => asPrivate(provider).getDbPath("conv-26-run-X")).toThrow(
      /Pristine provider not initialized/
    )
  })

  test("initialize throws when dataSourceRunId is missing", async () => {
    const provider = new PristineProvider()
    await expect(provider.initialize({ apiKey: "none" })).rejects.toThrow(
      /requires dataSourceRunId/
    )
  })

  test("warns on resume when DB folder does not exist (migration case)", async () => {
    const provider = new PristineProvider()
    const runId = `missing-resume-${Date.now()}`
    testRuns.push(runId) // ensure cleanup even though folder shouldn't exist

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    try {
      await provider.initialize({
        apiKey: "none",
        dataSourceRunId: runId,
        resumeMode: true,
      })

      expect(warnSpy).toHaveBeenCalledTimes(1)
      const msg = String(warnSpy.mock.calls[0][0])
      expect(msg).toContain("Resuming run but DB folder")
      expect(msg).toContain(runId)
      expect(msg).toContain("--force")
    } finally {
      warnSpy.mockRestore()
    }
  })

  test("does NOT warn when resumeMode is false (fresh run path)", async () => {
    const provider = new PristineProvider()
    const runId = `fresh-run-${Date.now()}`
    testRuns.push(runId)

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    try {
      await provider.initialize({
        apiKey: "none",
        dataSourceRunId: runId,
        resumeMode: false,
      })

      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  test("does NOT warn when resumeMode is true but DB folder already exists (normal resume)", async () => {
    // Happy path: a legitimate checkpoint resume should NOT emit the
    // migration warn. Regression guard for "always warn on resume" where
    // the existsSync check is accidentally removed.
    const provider = new PristineProvider()
    const runId = `normal-resume-${Date.now()}`
    testRuns.push(runId)

    // Pre-create the run folder to simulate a prior ingest having completed.
    mkdirSync(join(PRISTINE_DB_ROOT, runId), { recursive: true })

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    try {
      await provider.initialize({
        apiKey: "none",
        dataSourceRunId: runId,
        resumeMode: true,
      })
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  test("warns when concurrency > 1 (any phase) is passed", async () => {
    const provider = new PristineProvider()
    const runId = `conc-warn-${Date.now()}`
    mkdirSync(join(PRISTINE_DB_ROOT, runId), { recursive: true })
    testRuns.push(runId)

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    try {
      await provider.initialize({
        apiKey: "none",
        dataSourceRunId: runId,
        concurrency: { default: 1, ingest: 4 },
      })

      const calls = warnSpy.mock.calls.map((c) => String(c[0]))
      const concurrencyCalls = calls.filter((m) => m.includes("concurrency > 1"))
      expect(concurrencyCalls).toHaveLength(1)
      expect(concurrencyCalls[0]).toContain("effective=4")
      expect(concurrencyCalls[0]).toContain("Ollama")
    } finally {
      warnSpy.mockRestore()
    }
  })

  test("does NOT warn when all concurrency values are <= 1", async () => {
    const provider = new PristineProvider()
    const runId = `conc-noop-${Date.now()}`
    mkdirSync(join(PRISTINE_DB_ROOT, runId), { recursive: true })
    testRuns.push(runId)

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    try {
      await provider.initialize({
        apiKey: "none",
        dataSourceRunId: runId,
        concurrency: { default: 1, ingest: 1 },
      })
      expect(
        warnSpy.mock.calls
          .map((c) => String(c[0]))
          .filter((m) => m.includes("concurrency > 1"))
      ).toHaveLength(0)
    } finally {
      warnSpy.mockRestore()
    }
  })

  test("does NOT warn when concurrency is absent entirely", async () => {
    const provider = new PristineProvider()
    const runId = `conc-absent-${Date.now()}`
    mkdirSync(join(PRISTINE_DB_ROOT, runId), { recursive: true })
    testRuns.push(runId)

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    try {
      await provider.initialize({ apiKey: "none", dataSourceRunId: runId })
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe("PristineProvider metadata.json stamp", () => {
  test("cold-start: folder absent → writes fresh stamp silently", async () => {
    const provider = new PristineProvider()
    const runId = `meta-cold-${Date.now()}`
    testRuns.push(runId)

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    try {
      await provider.initialize({
        apiKey: "none",
        dataSourceRunId: runId,
        extractionModel: "gemma4:e4b",
        benchmark: "locomo",
      })

      const metaPath = join(PRISTINE_DB_ROOT, runId, "metadata.json")
      expect(existsSync(metaPath)).toBe(true)
      const stamp = JSON.parse(readFileSync(metaPath, "utf8")) as Record<string, unknown>
      expect(stamp.extractionModel).toBe("gemma4:e4b")
      expect(stamp.benchmark).toBe("locomo")
      expect(typeof stamp.createdAt).toBe("string")
      // Mismatch warn must NOT fire when there was nothing to compare against.
      const mismatchWarns = warnSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes("Reusing DB folder"))
      expect(mismatchWarns).toHaveLength(0)
    } finally {
      warnSpy.mockRestore()
    }
  })

  test("legacy folder without metadata.json → info log, writes fresh stamp, no warn", async () => {
    const provider = new PristineProvider()
    const runId = `meta-legacy-${Date.now()}`
    testRuns.push(runId)

    // Pre-create folder to simulate a legacy state without metadata.json.
    mkdirSync(join(PRISTINE_DB_ROOT, runId), { recursive: true })

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    const infoSpy = spyOn(logger, "info").mockImplementation(() => {})
    try {
      await provider.initialize({
        apiKey: "none",
        dataSourceRunId: runId,
        extractionModel: "gemma4:e4b",
        benchmark: "locomo",
      })

      const metaPath = join(PRISTINE_DB_ROOT, runId, "metadata.json")
      expect(existsSync(metaPath)).toBe(true)
      // Info log announces the legacy path; no warn because the user didn't
      // cause the missing-metadata state.
      const infoMsgs = infoSpy.mock.calls.map((c) => String(c[0]))
      expect(infoMsgs.some((m) => m.includes("metadata.json missing"))).toBe(true)
      const mismatchWarns = warnSpy.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes("Reusing DB folder"))
      expect(mismatchWarns).toHaveLength(0)
    } finally {
      warnSpy.mockRestore()
      infoSpy.mockRestore()
    }
  })

  test("model mismatch → warn with prior createdAt + prior model + --force guidance", async () => {
    const provider = new PristineProvider()
    const runId = `meta-mismatch-${Date.now()}`
    testRuns.push(runId)

    // Pre-seed a metadata.json written by a prior run with a different model.
    const runDir = join(PRISTINE_DB_ROOT, runId)
    mkdirSync(runDir, { recursive: true })
    const priorStamp = {
      createdAt: "2026-04-10T12:00:00.000Z",
      extractionModel: "llama3.2:3b",
      benchmark: "locomo",
    }
    writeFileSync(join(runDir, "metadata.json"), JSON.stringify(priorStamp))

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    try {
      await provider.initialize({
        apiKey: "none",
        dataSourceRunId: runId,
        extractionModel: "gemma4:e4b", // different from prior
        benchmark: "locomo",
      })

      const mismatchWarn = warnSpy.mock.calls
        .map((c) => String(c[0]))
        .find((m) => m.includes("Reusing DB folder"))
      expect(mismatchWarn).toBeDefined()
      expect(mismatchWarn).toContain("2026-04-10T12:00:00.000Z")
      expect(mismatchWarn).toContain("llama3.2:3b")
      expect(mismatchWarn).toContain("gemma4:e4b")
      expect(mismatchWarn).toContain("--force")
    } finally {
      warnSpy.mockRestore()
    }

    // Original stamp should NOT be overwritten on a pure mismatch — we only
    // rewrite the stamp when the prior one is unreadable.
    const contents = JSON.parse(
      readFileSync(join(runDir, "metadata.json"), "utf8")
    ) as Record<string, unknown>
    expect(contents.extractionModel).toBe("llama3.2:3b")
    expect(contents.createdAt).toBe("2026-04-10T12:00:00.000Z")
  })

  test("model match → silent proceed (no warn, no info)", async () => {
    const provider = new PristineProvider()
    const runId = `meta-match-${Date.now()}`
    testRuns.push(runId)

    const runDir = join(PRISTINE_DB_ROOT, runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(
      join(runDir, "metadata.json"),
      JSON.stringify({
        createdAt: "2026-04-10T12:00:00.000Z",
        extractionModel: "gemma4:e4b",
        benchmark: "locomo",
      })
    )

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    const infoSpy = spyOn(logger, "info").mockImplementation(() => {})
    try {
      await provider.initialize({
        apiKey: "none",
        dataSourceRunId: runId,
        extractionModel: "gemma4:e4b",
        benchmark: "locomo",
      })

      const metaMsgs = [
        ...warnSpy.mock.calls.map((c) => String(c[0])),
        ...infoSpy.mock.calls.map((c) => String(c[0])),
      ].filter((m) => m.includes("metadata.json") || m.includes("Reusing DB folder"))
      expect(metaMsgs).toHaveLength(0)
    } finally {
      warnSpy.mockRestore()
      infoSpy.mockRestore()
    }
  })
})

describe("PristineProvider.initialize idempotency", () => {
  test("reinitialize with different dataSourceRunId disposes cached clients", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A", "run-B")

    const spy1 = createDisposeSpy()
    const spy2 = createDisposeSpy()
    asPrivate(provider).clients.set("conv-1-run-A", spy1)
    asPrivate(provider).clients.set("conv-2-run-A", spy2)

    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-B" })

    expect(spy1.calls).toBe(1)
    expect(spy2.calls).toBe(1)
    expect(asPrivate(provider).clients.size).toBe(0)
    expect(asPrivate(provider).dataSourceRunId).toBe("run-B")
  })

  test("reinitialize with same dataSourceRunId does NOT dispose existing clients", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    const spy = createDisposeSpy()
    asPrivate(provider).clients.set("conv-1-run-A", spy)

    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })

    expect(spy.calls).toBe(0)
    expect(asPrivate(provider).clients.size).toBe(1)
  })
})

describe("PristineProvider.shutdown", () => {
  test("disposes all cached clients and clears the map", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    const spy1 = createDisposeSpy()
    const spy2 = createDisposeSpy()
    asPrivate(provider).clients.set("conv-1-run-A", spy1)
    asPrivate(provider).clients.set("conv-2-run-A", spy2)

    await provider.shutdown!()

    expect(spy1.calls).toBe(1)
    expect(spy2.calls).toBe(1)
    expect(asPrivate(provider).clients.size).toBe(0)
  })

  test("is idempotent — calling twice does not double-dispose", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    const spy = createDisposeSpy()
    asPrivate(provider).clients.set("conv-1-run-A", spy)

    await provider.shutdown!()
    await provider.shutdown!()

    expect(spy.calls).toBe(1)
    expect(asPrivate(provider).clients.size).toBe(0)
  })

  test("is a no-op on a fresh provider with no cached clients", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    await expect(provider.shutdown!()).resolves.toBeUndefined()
    expect(asPrivate(provider).clients.size).toBe(0)
  })

  test("is concurrent-idempotent: racing second call sees empty map", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    // Build a client whose dispose resolves on a shared latch. While the first
    // shutdown is awaiting dispose, a second shutdown fires — it must observe
    // an already-cleared map and skip the already-in-flight dispose.
    let resolveDispose: () => void = () => {}
    const disposePromise = new Promise<void>((r) => {
      resolveDispose = r
    })
    let disposeCalls = 0
    const slowClient = {
      dispose: async () => {
        disposeCalls += 1
        await disposePromise
      },
    }
    asPrivate(provider).clients.set("conv-1-run-A", slowClient)

    const first = provider.shutdown!()
    // At this point shutdown has already snapshotted and cleared the map.
    expect(asPrivate(provider).clients.size).toBe(0)
    const second = provider.shutdown!()

    resolveDispose()
    await Promise.all([first, second])

    // dispose() runs exactly once even though shutdown() was called twice.
    expect(disposeCalls).toBe(1)
  })
})

describe("PristineProvider.purgeRunData", () => {
  test("removes the run folder and disposes cached clients", async () => {
    const runId = `purge-test-${Date.now()}`
    testRuns.push(runId)

    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: runId })

    // Seed the folder with a stub file so we can observe deletion
    const runDir = join(PRISTINE_DB_ROOT, runId)
    mkdirSync(runDir, { recursive: true })
    writeFileSync(join(runDir, "stub.db"), "x")
    expect(existsSync(runDir)).toBe(true)

    const spy = createDisposeSpy()
    asPrivate(provider).clients.set("conv-1-" + runId, spy)

    await provider.purgeRunData!(runId)

    expect(existsSync(runDir)).toBe(false)
    expect(spy.calls).toBe(1)
    expect(asPrivate(provider).clients.size).toBe(0)
  })

  test("is a no-op when folder does not exist (no throw)", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    // Non-existent run id — should not throw
    await expect(provider.purgeRunData!("never-created")).resolves.toBeUndefined()
  })
})

describe("PristineProvider silent no-op detection", () => {
  type FakeClientState = {
    ingestCalls: number
    deleteCalls: string[]
  }

  function installFakeClient(
    provider: PristineProvider,
    containerTag: string,
    memoryIdsToReturn: string[],
    opts: {
      findByMessages?: () => Promise<{ id: string; memoryCount: number } | null>
    } = {}
  ): FakeClientState {
    const state: FakeClientState = { ingestCalls: 0, deleteCalls: [] }
    const fakeClient = {
      dispose: async () => {},
      orchestrator: {
        ingest: async () => {
          state.ingestCalls += 1
          return {
            facts: [],
            decisions: [],
            memoryIds: memoryIdsToReturn,
            errors: [],
          }
        },
      },
      findConversationByMessages:
        opts.findByMessages ?? (async () => null),
      deleteConversation: async (id: string) => {
        state.deleteCalls.push(id)
      },
    }
    asPrivate(provider).clients.set(containerTag, fakeClient as never)
    return state
  }

  test("warns and reports memoryCount=0 when Pristine returns empty memoryIds", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    const containerTag = "conv-42-run-A"
    installFakeClient(provider, containerTag, []) // simulate duplicate-detected no-op

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    try {
      const result = await provider.ingest(
        [
          {
            sessionId: "sess-1",
            messages: [{ role: "user", content: "hi" }],
            metadata: {},
          },
        ],
        { containerTag }
      )

      expect(result.memoryCount).toBe(0)
      expect(warnSpy).toHaveBeenCalledTimes(1)
      const warnArg = String(warnSpy.mock.calls[0][0])
      expect(warnArg).toContain("0 memories")
      expect(warnArg).toContain("sess-1")
      expect(warnArg).toContain(containerTag)
      expect(warnArg).toContain("--force")
    } finally {
      warnSpy.mockRestore()
    }
  })

  test("populates memoryCount as the sum across sessions", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    const containerTag = "conv-42-run-A"
    installFakeClient(provider, containerTag, ["m1", "m2", "m3"]) // 3 memories per session

    const result = await provider.ingest(
      [
        { sessionId: "s1", messages: [{ role: "user", content: "a" }], metadata: {} },
        { sessionId: "s2", messages: [{ role: "user", content: "b" }], metadata: {} },
      ],
      { containerTag }
    )

    // Same fake client returns memoryIds for both sessions → sum is 6
    expect(result.memoryCount).toBe(6)
    expect(result.documentIds).toEqual(["s1", "s2"])
  })

  test("does NOT warn when session has zero messages (empty input is not a silent no-op)", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    const containerTag = "conv-42-run-A"
    installFakeClient(provider, containerTag, [])

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    try {
      await provider.ingest(
        [{ sessionId: "empty", messages: [], metadata: {} }],
        { containerTag }
      )
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })
})

describe("PristineProvider partial-ingest recovery (Option B)", () => {
  type FakeClientState = {
    ingestCalls: number
    deleteCalls: string[]
  }

  function installFakeClient(
    provider: PristineProvider,
    containerTag: string,
    opts: {
      findByMessages?: () => Promise<{ id: string; memoryCount: number } | null>
      memoryIdsFromIngest?: string[]
    } = {}
  ): FakeClientState {
    const state: FakeClientState = { ingestCalls: 0, deleteCalls: [] }
    const fakeClient = {
      dispose: async () => {},
      orchestrator: {
        ingest: async () => {
          state.ingestCalls += 1
          return {
            facts: [],
            decisions: [],
            memoryIds: opts.memoryIdsFromIngest ?? ["m-new"],
            errors: [],
          }
        },
      },
      findConversationByMessages:
        opts.findByMessages ?? (async () => null),
      deleteConversation: async (id: string) => {
        state.deleteCalls.push(id)
      },
    }
    asPrivate(provider).clients.set(containerTag, fakeClient as never)
    return state
  }

  const sampleSession = {
    sessionId: "s1",
    messages: [{ role: "user" as const, content: "hi" }],
    metadata: {},
  }

  test("path 1 — not-exists: ingest proceeds normally", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    const containerTag = "conv-42-run-A"
    const state = installFakeClient(provider, containerTag, {
      findByMessages: async () => null,
      memoryIdsFromIngest: ["m1"],
    })

    const result = await provider.ingest([sampleSession], { containerTag })

    expect(state.ingestCalls).toBe(1)
    expect(state.deleteCalls).toEqual([])
    expect(result.memoryCount).toBe(1)
  })

  test("path 2 — exists-empty: delete orphan conversation and re-ingest", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    const containerTag = "conv-42-run-A"
    const state = installFakeClient(provider, containerTag, {
      findByMessages: async () => ({ id: "orphan-123", memoryCount: 0 }),
      memoryIdsFromIngest: ["m-fresh-1", "m-fresh-2"],
    })

    const warnSpy = spyOn(logger, "warn").mockImplementation(() => {})
    try {
      const result = await provider.ingest([sampleSession], { containerTag })

      expect(state.deleteCalls).toEqual(["orphan-123"])
      expect(state.ingestCalls).toBe(1)
      expect(result.memoryCount).toBe(2)
      // Warn message announces the recovery
      const warnArgs = warnSpy.mock.calls.map((c) => String(c[0]))
      expect(warnArgs.some((m) => m.includes("partial-ingest"))).toBe(true)
      expect(warnArgs.some((m) => m.includes("orphan-123"))).toBe(true)
    } finally {
      warnSpy.mockRestore()
    }
  })

  test("path 3 — exists-populated: skip ingest, surface existing memoryCount", async () => {
    const provider = new PristineProvider()
    await provider.initialize({ apiKey: "none", dataSourceRunId: "run-A" })
    testRuns.push("run-A")

    const containerTag = "conv-42-run-A"
    const state = installFakeClient(provider, containerTag, {
      findByMessages: async () => ({ id: "done-456", memoryCount: 7 }),
    })

    const result = await provider.ingest([sampleSession], { containerTag })

    expect(state.ingestCalls).toBe(0) // skip the re-extraction
    expect(state.deleteCalls).toEqual([]) // do NOT delete populated conv
    expect(result.memoryCount).toBe(7) // report existing count for Story 6 guard
    expect(result.documentIds).toEqual(["s1"])
  })
})
