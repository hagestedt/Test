#!/usr/bin/env node
// Spins up a disposable git project + the scripted mock LLM + a real `opencode serve` wired to it.
// Usage: node test/harness.mjs [--port 4096] [--mock-port 4555] [--dir /tmp/x]
// Prints a JSON line {"url","directory"} once the server is healthy, then stays in the foreground.
import { spawn, execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .join(" ")
    .split("--")
    .filter(Boolean)
    .map((a) => a.trim().split(/\s+/)),
)
const port = Number(args.port ?? 4096)
const mockPort = Number(args["mock-port"] ?? 4555)
const dir = args.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), "fleet-project-"))

fs.mkdirSync(dir, { recursive: true })
const writeConfig = () =>
  fs.writeFileSync(
    path.join(dir, "opencode.json"),
    JSON.stringify(
      {
        $schema: "https://opencode.ai/config.json",
        model: "mock/scripted",
        small_model: "mock/scripted",
        autoupdate: false,
        share: "disabled",
        enabled_providers: ["mock"],
        permission: { bash: "ask", edit: "allow", question: "allow" },
        provider: {
          mock: {
            npm: "@ai-sdk/openai-compatible",
            name: "Mock LLM",
            options: { baseURL: `http://127.0.0.1:${mockPort}/v1`, apiKey: "mock" },
            models: {
              scripted: { name: "Scripted", tool_call: true, limit: { context: 200000, output: 8192 } },
              "scripted-fast": { name: "Scripted Fast", tool_call: true, limit: { context: 200000, output: 8192 } },
            },
          },
        },
      },
      null,
      2,
    ),
  )

if (!fs.existsSync(path.join(dir, ".git"))) {
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" })
  git("init", "-q", "-b", "main")
  git("config", "user.email", "fleet@example.com")
  git("config", "user.name", "Fleet Harness")
  writeConfig()
  fs.writeFileSync(path.join(dir, "README.md"), "# Demo project\n\nA scratch repo for OpenCode Fleet.\n")
  git("add", ".")
  git("commit", "-q", "-m", "init")
}
const children = []
const cleanup = () => children.forEach((c) => c.kill("SIGTERM"))
process.on("SIGINT", () => (cleanup(), process.exit(0)))
process.on("SIGTERM", () => (cleanup(), process.exit(0)))
process.on("exit", cleanup)

children.push(
  spawn(process.execPath, [path.join(here, "mock-llm/server.mjs")], {
    env: { ...process.env, MOCK_LLM_PORT: String(mockPort) },
    stdio: ["ignore", "inherit", "inherit"],
  }),
)

const bin = path.join(root, "node_modules/.bin/opencode")
const env = { ...process.env, NO_PROXY: "127.0.0.1,localhost", no_proxy: "127.0.0.1,localhost" }
const oc = spawn(bin, ["serve", "--port", String(port), "--hostname", "127.0.0.1"], { cwd: dir, env, stdio: ["ignore", "pipe", "inherit"] })
children.push(oc)
oc.stdout.on("data", (d) => process.env.HARNESS_VERBOSE && process.stderr.write(d))
oc.on("exit", (code) => {
  console.error(`opencode exited with ${code}`)
  process.exit(code ?? 1)
})

const url = `http://127.0.0.1:${port}`
for (let i = 0; i < 120; i++) {
  try {
    // Per-probe timeout: opencode can accept the connection before it is ready to answer.
    const r = await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(2000) })
    if (r.ok) break
  } catch {}
  await new Promise((r) => setTimeout(r, 500))
}
console.log(JSON.stringify({ url, directory: dir }))
