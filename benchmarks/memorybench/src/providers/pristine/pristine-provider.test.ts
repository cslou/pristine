import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { PristineProvider } from "./index"
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
