import { describe, test, expect, afterEach, spyOn } from "bun:test"
import { PristineProvider } from "./index"
import { logger } from "../../utils/logger"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
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
