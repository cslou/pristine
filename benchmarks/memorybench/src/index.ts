import { cli } from "./cli"
import { getCurrentProvider } from "./orchestrator"

// Graceful shutdown on SIGINT (Ctrl-C) and SIGTERM (kill, docker stop, etc).
// Node runs signal handlers outside any active scope, so the only way to
// reach the live provider is the module-level registry in orchestrator/index.
// shutdown is best-effort: a failing shutdown must not block process exit.
// Exit codes follow POSIX: 128 + signal number (SIGINT=2, SIGTERM=15).
const handleSignal = async (signal: "SIGINT" | "SIGTERM") => {
  const provider = getCurrentProvider()
  if (provider?.shutdown) {
    try {
      await provider.shutdown()
    } catch {
      // Best-effort: swallow errors so exit is not blocked by a bad provider.
    }
  }
  process.exit(signal === "SIGINT" ? 130 : 143)
}
process.on("SIGINT", () => void handleSignal("SIGINT"))
process.on("SIGTERM", () => void handleSignal("SIGTERM"))

const args = process.argv.slice(2)
cli(args).catch(console.error)
